const router = require('express').Router();
const { sequelize, Voc, VocActivity, User, BusinessUnit } = require('../models');
const { authenticate } = require('../middleware/auth');
const { moduleEnabledForBu } = require('../services/permissions');
const { Op } = require('sequelize');

router.use(authenticate);

router.use(async (req, res, next) => {
  if (req.user.role === 'super_admin') return next();
  try {
    const bu = await BusinessUnit.findOne({ where: { slug: req.user.business_unit } });
    if (bu && moduleEnabledForBu(bu.config, 'voc')) return next();
  } catch {}
  return res.status(403).json({ message: 'The VOC module is not enabled for your business.' });
});

const FULL_ACCESS = ['super_admin', 'business_admin', 'pmo'];       // see/edit all + product-team fields
const isReviewer = (u) => FULL_ACCESS.includes(u.role);            // PMO / Business Admin / Super Admin
// Fields only the product/PMO reviewers may change (a BD cannot touch these on their own VOC).
const REVIEWER_FIELDS = ['status', 'product_remarks', 'target_release', 'closure_date'];

const VOC_FIELD_LABELS = {
  date_of_entry: 'Date of Entry', customer_name: 'Customer Name', total_account_value_lakhs: 'Total Account Value (L)',
  bd_owner_id: 'BD Owner', pmo_owner: 'PMO Owner', region_state: 'Region / State', customer_segment: 'Customer Segment',
  product_solution: 'Product / Solution', voc_type: 'VOC Type', description: 'Description', business_impact: 'Business Impact',
  revenue_impact_lakhs: 'Est. Revenue Impact (L)', competitor: 'Competitor', priority: 'Priority', attachment_url: 'Attachment',
  status: 'Status', product_remarks: 'Product Team Remarks', target_release: 'Target Release', closure_date: 'Closure Date',
};

function scopeWhere(user) {
  const where = { business_unit: user.business_unit };
  if (user.role === 'bd') where.bd_owner_id = user.id;
  return where;
}

// Build the persisted payload from a request body. `actor` decides whether reviewer-only fields apply.
function normalizeVoc(body, actor, existing) {
  const p = {
    date_of_entry: body.date_of_entry || null,
    customer_name: body.customer_name,
    total_account_value_lakhs: (body.total_account_value_lakhs === '' || body.total_account_value_lakhs == null) ? null : parseFloat(body.total_account_value_lakhs),
    bd_owner_id: body.bd_owner_id ? (parseInt(body.bd_owner_id, 10) || null) : null,
    pmo_owner: body.pmo_owner || null,
    region_state: body.region_state || null,
    customer_segment: body.customer_segment || null,
    // Product / Solution is a multi-select — persisted as a comma-separated list.
    product_solution: Array.isArray(body.product_solution) ? (body.product_solution.filter(Boolean).join(', ') || null) : (body.product_solution || null),
    voc_type: body.voc_type || null,
    description: body.description || null,
    business_impact: body.business_impact || null,
    revenue_impact_lakhs: (body.revenue_impact_lakhs === '' || body.revenue_impact_lakhs == null) ? null : parseFloat(body.revenue_impact_lakhs),
    competitor: body.competitor || null,
    priority: body.priority || null,
    attachment_url: body.attachment_url !== undefined ? (body.attachment_url || null) : (existing ? existing.attachment_url : null),
  };
  // Product-team fields: only reviewers may set them. A BD keeps whatever the reviewers set (or defaults).
  if (isReviewer(actor)) {
    p.status = body.status || (existing ? existing.status : 'New');
    p.product_remarks = body.product_remarks || null;
    p.target_release = body.target_release || null;
    p.closure_date = body.closure_date || null;
  } else if (existing) {
    for (const f of REVIEWER_FIELDS) p[f] = existing[f];
  } else {
    p.status = 'New';
  }
  return p;
}

function diffVoc(before, after) {
  const rows = [];
  for (const [key, label] of Object.entries(VOC_FIELD_LABELS)) {
    const o = before ? before[key] : undefined;
    const n = after[key];
    const os = (o === null || o === undefined) ? '' : String(o);
    const ns = (n === null || n === undefined) ? '' : String(n);
    if (os !== ns) rows.push({ field_changed: label, old_value: os || '(empty)', new_value: ns || '(empty)', action_type: key === 'status' ? 'status_change' : 'field_update' });
  }
  return rows;
}

// GET /api/voc — list with filters. BDs are scoped to their own.
router.get('/', async (req, res) => {
  try {
    const where = scopeWhere(req.user);
    const { customer, bd_owner_id, pmo_owner, product_solution, priority, status, voc_type, region, from, to } = req.query;
    if (customer) where.customer_name = { [Op.like]: `%${customer}%` };
    if (bd_owner_id && req.user.role !== 'bd') where.bd_owner_id = { [Op.in]: bd_owner_id.split(',') };
    if (pmo_owner) where.pmo_owner = { [Op.like]: `%${pmo_owner}%` };
    if (product_solution) where.product_solution = { [Op.in]: product_solution.split(',') };
    if (priority) where.priority = { [Op.in]: priority.split(',') };
    if (status) where.status = { [Op.in]: status.split(',') };
    if (voc_type) where.voc_type = { [Op.in]: voc_type.split(',') };
    if (region) where.region_state = { [Op.like]: `%${region}%` };
    if (from || to) where.date_of_entry = { ...(from ? { [Op.gte]: from } : {}), ...(to ? { [Op.lte]: to } : {}) };

    const vocs = await Voc.findAll({
      where,
      include: [{ model: User, as: 'bdOwner', attributes: ['id', 'name'] }],
      order: [['voc_no', 'DESC']],
    });
    return res.json(vocs);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// GET /api/voc/stats — dashboard aggregates.
router.get('/stats', async (req, res) => {
  try {
    const vocs = await Voc.findAll({ where: scopeWhere(req.user), include: [{ model: User, as: 'bdOwner', attributes: ['name'] }] });
    const OPEN = ['New', 'Under Review', 'Accepted', 'Planned', 'In Development'];
    const CLOSED = ['Released', 'Rejected', 'Closed'];
    const tally = (fn) => vocs.reduce((m, v) => { const k = fn(v) || '-'; m[k] = (m[k] || 0) + 1; return m; }, {});
    // Product / Solution is multi-valued (comma-separated) — count each product separately.
    const byProduct = {};
    for (const v of vocs) {
      const prods = v.product_solution ? v.product_solution.split(',').map(s => s.trim()).filter(Boolean) : ['-'];
      for (const p of prods) byProduct[p] = (byProduct[p] || 0) + 1;
    }
    return res.json({
      total: vocs.length,
      open: vocs.filter(v => OPEN.includes(v.status)).length,
      closed: vocs.filter(v => CLOSED.includes(v.status)).length,
      byPriority: tally(v => v.priority),
      byStatus: tally(v => v.status),
      byProduct,
      byRegion: tally(v => v.region_state),
      byBd: tally(v => v.bdOwner?.name || v.pmo_owner),
      byType: tally(v => v.voc_type),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// GET /api/voc/:id — detail with audit trail.
router.get('/:id', async (req, res) => {
  try {
    const voc = await Voc.findByPk(req.params.id, {
      include: [
        { model: User, as: 'bdOwner', attributes: ['id', 'name'] },
        { model: VocActivity, as: 'activity' },
      ],
      order: [[{ model: VocActivity, as: 'activity' }, 'created_at', 'DESC']],
    });
    if (!voc || voc.business_unit !== req.user.business_unit) return res.status(404).json({ message: 'VOC not found' });
    if (req.user.role === 'bd' && voc.bd_owner_id !== req.user.id) return res.status(403).json({ message: 'Forbidden' });
    return res.json(voc);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// POST /api/voc — create.
router.post('/', async (req, res) => {
  const t = await sequelize.transaction();
  try {
    if (!req.body.customer_name || !req.body.customer_name.trim()) { await t.rollback(); return res.status(400).json({ message: 'Customer name is required' }); }
    const payload = normalizeVoc(req.body, req.user, null);
    // BDs default the BD owner to themselves.
    if (req.user.role === 'bd') payload.bd_owner_id = req.user.id;
    if (!payload.date_of_entry) payload.date_of_entry = new Date().toISOString().slice(0, 10);
    const maxNo = (await Voc.max('voc_no')) || 0;
    const voc = await Voc.create({ ...payload, business_unit: req.user.business_unit, voc_no: maxNo + 1, created_by: req.user.id, updated_by: req.user.id }, { transaction: t });
    await VocActivity.create({ voc_id: voc.id, user_name: req.user.name, action_type: 'created', note: 'VOC created' }, { transaction: t });
    await t.commit();

    if (payload.description) {
      const { processMentions } = require('../services/mentions');
      processMentions({
        text: payload.description, oldText: null,
        businessUnit: req.user.business_unit, actorId: req.user.id,
        entityType: 'voc', entityLabel: `VOC #${voc.voc_no} "${payload.customer_name}"`,
        linkPath: '/voc',
      }).catch(() => {});
    }

    return res.status(201).json(voc);
  } catch (err) {
    await t.rollback();
    return res.status(500).json({ message: err.message });
  }
});

// PUT /api/voc/:id — update (audited). BD may edit only their own; reviewer fields are reviewer-only.
router.put('/:id', async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const existing = await Voc.findByPk(req.params.id, { transaction: t });
    if (!existing || existing.business_unit !== req.user.business_unit) { await t.rollback(); return res.status(404).json({ message: 'VOC not found' }); }
    if (req.user.role === 'bd' && existing.bd_owner_id !== req.user.id) { await t.rollback(); return res.status(403).json({ message: 'You can only edit your own VOCs.' }); }
    if (!req.body.customer_name || !req.body.customer_name.trim()) { await t.rollback(); return res.status(400).json({ message: 'Customer name is required' }); }

    const before = existing.toJSON();
    const payload = normalizeVoc(req.body, req.user, before);
    if (req.user.role === 'bd') payload.bd_owner_id = existing.bd_owner_id; // BDs cannot reassign

    await Voc.update({ ...payload, updated_by: req.user.id }, { where: { id: existing.id }, transaction: t });
    const rows = diffVoc(before, payload).map(r => ({ ...r, voc_id: existing.id, user_name: req.user.name }));
    if (rows.length) await VocActivity.bulkCreate(rows, { transaction: t });

    await t.commit();
    const full = await Voc.findByPk(existing.id, { include: [{ model: User, as: 'bdOwner', attributes: ['id', 'name'] }] });

    if (payload.description !== undefined) {
      const { processMentions } = require('../services/mentions');
      processMentions({
        text: payload.description, oldText: before.description,
        businessUnit: req.user.business_unit, actorId: req.user.id,
        entityType: 'voc', entityLabel: `VOC #${existing.voc_no} "${payload.customer_name || before.customer_name}"`,
        linkPath: '/voc',
      }).catch(() => {});
    }

    return res.json(full);
  } catch (err) {
    await t.rollback();
    return res.status(500).json({ message: err.message });
  }
});

// POST /api/voc/:id/comment — add a comment to the audit trail.
router.post('/:id/comment', async (req, res) => {
  try {
    const voc = await Voc.findByPk(req.params.id);
    if (!voc || voc.business_unit !== req.user.business_unit) return res.status(404).json({ message: 'VOC not found' });
    if (req.user.role === 'bd' && voc.bd_owner_id !== req.user.id) return res.status(403).json({ message: 'Forbidden' });
    const note = (req.body.note || '').trim();
    if (!note) return res.status(400).json({ message: 'Comment is required' });
    await VocActivity.create({ voc_id: voc.id, user_name: req.user.name, action_type: 'comment', note });

    const { processMentions } = require('../services/mentions');
    processMentions({
      text: note, oldText: null,
      businessUnit: req.user.business_unit, actorId: req.user.id,
      entityType: 'voc', entityLabel: `VOC #${voc.voc_no} comment`,
      linkPath: '/voc',
    }).catch(() => {});

    return res.status(201).json({ message: 'Comment added' });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// DELETE /api/voc/:id — reviewers only.
router.delete('/:id', async (req, res) => {
  try {
    if (!isReviewer(req.user)) return res.status(403).json({ message: 'Only PMO / Admin can delete a VOC.' });
    const voc = await Voc.findByPk(req.params.id);
    if (!voc || voc.business_unit !== req.user.business_unit) return res.status(404).json({ message: 'VOC not found' });
    await VocActivity.destroy({ where: { voc_id: voc.id } });
    await voc.destroy();
    return res.json({ message: 'VOC deleted' });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
