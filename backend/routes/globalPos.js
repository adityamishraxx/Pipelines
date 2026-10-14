// Global PO (chain) records + their derived device-pool status. A Global PO is a reference record only
// (no funnel, no scoring); Individual POs (leads) link to it via leads.global_po_id. Consumed devices
// are DERIVED from linked leads at PO Received, so the figures are always live (see services/chainPool.js).
const router = require('express').Router();
const { GlobalPo, Lead } = require('../models');
const { authenticate, adminOnly, requireModule, requireAnyModule } = require('../middleware/auth');
const audit = require('../services/audit');
const { chainStatus, leadDevices, WON_STAGE } = require('../services/chainPool');

router.use(authenticate);
// Forecast accounts have no lead/PO access (mirrors the leads router).
router.use((req, res, next) => {
  if (req.user.role === 'forecast') return res.status(403).json({ message: 'Forecast accounts have no PO access.' });
  next();
});

// Individual POs (leads) linked to a chain — the raw rows used to derive consumption + contributors.
function linkedPos(globalPoId) {
  return Lead.findAll({
    where: { global_po_id: globalPoId },
    attributes: ['id', 'sr_no', 'customer_name', 'quantity', 'services_json', 'phase', 'po_received_date', 'phase_changed_at', 'owner_id'],
    order: [['sr_no', 'ASC']],
  });
}

function statusOf(globalPo, pos) {
  const dt = globalPo.device_type || null;
  return chainStatus(globalPo.device_total, pos.map(p => ({ phase: p.phase, devices: leadDevices(p, dt) })));
}

// GET /api/global-pos — chains for the caller's business, each with live pool status (for the
// chain-selection dropdown and the chains list).
router.get('/', requireAnyModule(['leads', 'dashboard', 'reports'], 'read'), async (req, res) => {
  try {
    const chains = await GlobalPo.findAll({ where: { business_unit: req.user.business_unit }, order: [['chain_name', 'ASC']] });
    const out = [];
    for (const c of chains) {
      const pos = await linkedPos(c.id);
      out.push({ ...c.toJSON(), poolStatus: statusOf(c, pos), linked_count: pos.length });
    }
    return res.json(out);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// GET /api/global-pos/:id — detail: original/consumed/remaining/overage + contributing won POs.
router.get('/:id', requireAnyModule(['leads', 'dashboard', 'reports'], 'read'), async (req, res) => {
  try {
    const c = await GlobalPo.findByPk(req.params.id);
    if (!c) return res.status(404).json({ message: 'Global PO not found' });
    if (c.business_unit !== req.user.business_unit) return res.status(403).json({ message: 'Forbidden' });
    const pos = await linkedPos(c.id);
    const status = statusOf(c, pos);
    // Contributors = the Individual POs that have actually been won (traceability, doc §4.4).
    const dt = c.device_type || null;
    const contributors = pos
      .filter(p => p.phase === WON_STAGE)
      .map(p => ({
        id: p.id, sr_no: p.sr_no, customer_name: p.customer_name, devices: leadDevices(p, dt),
        won_date: p.po_received_date || (p.phase_changed_at ? String(p.phase_changed_at).slice(0, 10) : null),
      }));
    return res.json({ ...c.toJSON(), poolStatus: status, contributors, linked_count: pos.length });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

function parseChainBody(body) {
  const out = {}; const errs = [];
  if (body.chain_name !== undefined) {
    if (!String(body.chain_name).trim()) errs.push('Chain name is required');
    else out.chain_name = String(body.chain_name).trim();
  }
  if (body.device_total !== undefined) {
    const d = parseInt(body.device_total, 10);
    if (!Number.isFinite(d) || d < 0) errs.push('Number of devices must be a non-negative whole number');
    else out.device_total = d;
  }
  if (body.device_type !== undefined) {
    const dt = String(body.device_type).trim();
    if (!dt) errs.push('Device type is required');
    else out.device_type = dt;
  }
  if (body.price_lakhs !== undefined) out.price_lakhs = (body.price_lakhs === '' || body.price_lakhs === null) ? null : parseFloat(body.price_lakhs);
  if (body.expected_start_date !== undefined) out.expected_start_date = body.expected_start_date || null;
  if (body.expected_end_date !== undefined) out.expected_end_date = body.expected_end_date || null;
  const VALID_STATUSES = ['New', 'Under Discussion', 'Contract Received'];
  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status)) errs.push('Status must be one of: ' + VALID_STATUSES.join(', '));
    else out.status = body.status;
  }
  if (body.notes !== undefined) out.notes = body.notes || null;
  return { out, errs };
}

// POST /api/global-pos — create a chain reference record. Any non-forecast user (same as creating a lead).
router.post('/', requireModule('leads', 'full'), async (req, res) => {
  try {
    const { out, errs } = parseChainBody(req.body);
    if (!out.chain_name) errs.push('Chain name is required');
    if (out.device_total === undefined) errs.push('Number of devices is required');
    if (errs.length) return res.status(400).json({ message: errs[0] });
    const created = await GlobalPo.create({
      ...out, business_unit: req.user.business_unit, created_by: req.user.id, updated_by: req.user.id,
    });
    await audit.record({
      actor: req.user, entityType: 'chain', entityId: created.id, subject: created.chain_name,
      businessUnit: created.business_unit, action: 'chain_created',
      field: 'Chain', from: null, to: created.chain_name, note: 'Chain created',
    });
    return res.status(201).json(created);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// PUT /api/global-pos/:id — edit chain fields.
router.put('/:id', requireModule('leads', 'full'), async (req, res) => {
  try {
    const c = await GlobalPo.findByPk(req.params.id);
    if (!c) return res.status(404).json({ message: 'Global PO not found' });
    if (c.business_unit !== req.user.business_unit) return res.status(403).json({ message: 'Forbidden' });
    const { out, errs } = parseChainBody(req.body);
    if (errs.length) return res.status(400).json({ message: errs[0] });
    const before = c.toJSON();
    await GlobalPo.update({ ...out, updated_by: req.user.id }, { where: { id: c.id } });
    const CHAIN_LABELS = {
      chain_name: 'Chain Name', device_total: 'Device Total', device_type: 'Device Type', status: 'Status', notes: 'Notes', price_lakhs: 'Price (L)',
      expected_start_date: 'Expected Start', expected_end_date: 'Expected End',
    };
    await audit.recordDiff(
      { actor: req.user, entityType: 'chain', entityId: c.id, subject: out.chain_name || before.chain_name,
        businessUnit: c.business_unit, action: 'field_update' },
      Object.keys(CHAIN_LABELS)
        .filter(k => k in out)
        .map(k => ({ field: CHAIN_LABELS[k], from: before[k], to: out[k] })),
    );
    if ('notes' in out) {
      const { processMentions } = require('../services/mentions');
      processMentions({
        text: out.notes, oldText: before.notes,
        businessUnit: c.business_unit, actorId: req.user.id,
        entityType: 'chain', entityLabel: `Chain: ${out.chain_name || before.chain_name}`,
        linkPath: '/global-pos',
      }).catch(() => {});
    }
    return res.json(await GlobalPo.findByPk(c.id));
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// DELETE /api/global-pos/:id — admin only. Linked Individual POs become standalone (FK ON DELETE SET NULL).
router.delete('/:id', adminOnly, requireModule('leads', 'full'), async (req, res) => {
  try {
    const c = await GlobalPo.findByPk(req.params.id);
    if (!c) return res.status(404).json({ message: 'Global PO not found' });
    if (req.user.role !== 'super_admin' && c.business_unit !== req.user.business_unit) return res.status(403).json({ message: 'Forbidden' });
    await c.destroy();
    await audit.record({
      actor: req.user, entityType: 'chain', entityId: c.id, subject: c.chain_name,
      businessUnit: c.business_unit, action: 'chain_deleted',
      field: 'Chain', from: c.chain_name, to: null, note: 'Chain deleted',
    });
    return res.json({ message: 'Global PO deleted' });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
