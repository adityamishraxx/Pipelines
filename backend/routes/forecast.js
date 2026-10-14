const router = require('express').Router();
const { Lead, User, ActivityLog, LeadContact, ServiceDefinition } = require('../models');
const { Op } = require('sequelize');
const { authenticate, requireModule } = require('../middleware/auth');
const { hasLevel } = require('../services/permissions');
const { slaMapFor } = require('../services/scoringEngine');
const { computeConfidence } = require('../services/scoring');
const { lineTcv, lineHasHardware } = require('../services/pricing');

const round2 = (n) => n > 0 ? +n.toFixed(2) : 0;
const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);

// Read the per-line 'Sent to SCM' state for one hardware slug on a lead. If the lead has a
// sent_to_scm_lines map, that is authoritative. Otherwise fall back to the legacy lead-level flag
// (leads marked before per-line tracking existed) so their existing display doesn't flip to "Pending".
function resolveLineScm(lead, slug) {
  const map = lead.sent_to_scm_lines;
  if (map && typeof map === 'object' && Object.prototype.hasOwnProperty.call(map, slug)) {
    const entry = map[slug];
    if (entry) return { sent: true, at: entry.sent_at || null, by: entry.sent_by || null };
    return { sent: false, at: null, by: null };
  }
  if (map && typeof map === 'object') {
    return { sent: false, at: null, by: null };
  }
  return { sent: !!lead.sent_to_scm, at: lead.sent_to_scm_at || null, by: lead.sent_to_scm_by || null };
}

router.get('/devices', authenticate, requireModule('forecast', 'read'), async (req, res) => {
  try {
    const bu = req.user.business_unit;
    // Catalog entries that carry hardware (category hardware or hardware_software → hardware=true),
    // used to resolve a line's stable slug for the row id and per-line SCM tracking.
    const hwServices = await ServiceDefinition.findAll({ where: { business_unit: bu, active: true, hardware: true } });
    const hwByLabel = new Map(hwServices.map(s => [s.label, s]));

    const commonAttrs = [
      'id', 'customer_name', 'business_unit', 'city', 'state', 'phase',
      'owner_id', 'po_expected_date', 'device_requested_date',
      'property_category', 'new_or_renewal', 'potential_tcv_lakhs',
      'contract_period_months', 'confidence_score', 'global_po_id',
      'sent_to_scm', 'sent_to_scm_at', 'sent_to_scm_by', 'sent_to_scm_lines',
    ];

    const includeRels = [
      { model: User, as: 'owner', attributes: ['name'] },
      ...(hasLevel(req.user, 'leads', 'read')
        ? [{ model: LeadContact, as: 'contacts', attributes: ['name', 'phone', 'email', 'designation'] }]
        : []),
    ];

    // Unified model: every business stores its Services Offered in services_json. A line flows into
    // the Inventory Pipeline when it carries a hardware component (category hardware or
    // hardware_software). Each such line explodes into one row, keyed on the catalog slug.
    const payload = [];
    const rows = await Lead.findAll({
      where: { business_unit: bu, phase: { [Op.ne]: 'Lost' } },
      attributes: [...commonAttrs, 'services_json'],
      include: includeRels,
    });

    for (const row of rows) {
      const lead = row.toJSON();
      let lines = [];
      try { lines = JSON.parse(lead.services_json || '[]'); } catch {}
      delete lead.services_json;

      const months = parseInt(lead.contract_period_months, 10) || 0;
      for (const line of lines) {
        if (!lineHasHardware(line) || !line.hw) continue;
        const qty = parseInt(line.hw.qty, 10) || 0;
        if (qty === 0) continue;
        const def = hwByLabel.get(line.label);
        const slug = def ? def.slug : slugify(line.label);
        let hwLabel = line.label;
        if (line.hw.sku) hwLabel += ` — ${line.hw.sku}`;
        const perLine = resolveLineScm(lead, slug);
        payload.push({
          ...lead,
          hw_service: hwLabel,
          hw_slug: slug,
          hw_qty: qty,
          hw_nature: line.hw.nature,
          // Full line value (hardware + any service component), in lakhs — so a hardware+service line
          // like Connectivity (SIM ₹0 + ₹399/mo) still shows its deal value against the hardware row.
          price_tcv_lakhs: round2(lineTcv(line, months) / 100000),
          sent_to_scm: perLine.sent,
          sent_to_scm_at: perLine.at,
          sent_to_scm_by: perLine.by,
          _row_id: `${lead.id}_${slug}`,
        });
      }
    }
    for (const row of payload) delete row.sent_to_scm_lines;

    const slaMap = await slaMapFor(bu);
    const now = new Date();
    for (const row of payload) {
      const live = computeConfidence(row, slaMap, now);
      if (live !== null) row.confidence_score = live;
    }

    return res.json(payload);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// PATCH /api/forecast/devices/:id/sent-to-scm — body { sent_to_scm: boolean }
//
// Lives on the forecast router rather than /api/leads on purpose: the people who perform the SCM
// handoff are exactly the dashboard's audience, and that audience can't use the leads API — a
// 'forecast' account is refused outright there, and a BD may only write leads they own, while the
// dashboard deliberately shows every device lead in the business unit. So this endpoint grants one
// narrow write (this flag, nothing else) to anyone who can already see the row.
//
// Purely a tracking marker: no notification, no handoff, and nothing else on the lead is touched.
router.patch('/devices/:id/sent-to-scm', authenticate, requireModule('forecast', 'edit'), async (req, res) => {
  try {
    const { sent_to_scm, line_slug } = req.body;
    if (typeof sent_to_scm !== 'boolean') {
      return res.status(400).json({ message: 'sent_to_scm must be true or false' });
    }
    // line_slug is REQUIRED for per-line tracking: each hardware line on a lead is its own SCM
    // handoff. Legacy callers that omit it are refused rather than silently flipping every line.
    if (!line_slug || typeof line_slug !== 'string') {
      return res.status(400).json({ message: 'line_slug (the hardware service slug) is required' });
    }

    // Scope to the caller's own business unit, matching the devices listing above.
    const lead = await Lead.findOne({ where: { id: req.params.id, business_unit: req.user.business_unit } });
    if (!lead) return res.status(404).json({ message: 'Lead not found' });

    const prevLine = resolveLineScm(lead, line_slug);
    if (prevLine.sent === sent_to_scm) {
      // Already in the requested state — report it without writing a spurious audit entry.
      return res.json({ id: lead.id, line_slug, sent_to_scm: prevLine.sent, sent_to_scm_at: prevLine.at, sent_to_scm_by: prevLine.by });
    }

    // First per-line write on a legacy lead (map is null and the lead-level flag was true): backfill
    // every currently-configured hardware slug as sent, using the lead-level author/timestamp. This
    // preserves the display for other lines that were showing as sent via the legacy fallback, so
    // toggling ONE line doesn't quietly flip the others back to "Pending".
    let map = (lead.sent_to_scm_lines && typeof lead.sent_to_scm_lines === 'object')
      ? { ...lead.sent_to_scm_lines }
      : {};
    if (!lead.sent_to_scm_lines && lead.sent_to_scm) {
      const hwServices = await ServiceDefinition.findAll({
        where: { business_unit: lead.business_unit, active: true, hardware: true },
        attributes: ['slug'],
      });
      for (const s of hwServices) {
        map[s.slug] = { sent_at: lead.sent_to_scm_at, sent_by: lead.sent_to_scm_by };
      }
    }

    const now = new Date();
    if (sent_to_scm) {
      map[line_slug] = { sent_at: now.toISOString(), sent_by: req.user.name };
    } else {
      map[line_slug] = null;
    }

    lead.sent_to_scm_lines = map;
    // Aggregate flag stays in sync: true iff any line is sent. Kept for legacy readers of the lead
    // row that don't understand per-line state (dashboards, reports, exports written before this).
    const anySent = Object.values(map).some(v => v && typeof v === 'object');
    lead.sent_to_scm = anySent;
    lead.sent_to_scm_at = anySent ? now : null;
    lead.sent_to_scm_by = anySent ? req.user.name : null;
    await lead.save();

    await ActivityLog.create({
      lead_id: lead.id, lead_sr_no: lead.sr_no, customer_name: lead.customer_name,
      user_name: req.user.name, user_id: req.user.id, user_email: req.user.email,
      action_type: 'field_update', field_changed: `Sent to SCM (${line_slug})`,
      old_value: prevLine.sent ? 'Yes' : 'No', new_value: sent_to_scm ? 'Yes' : 'No',
      note: sent_to_scm ? `Marked "${line_slug}" as sent to SCM` : `Unmarked "${line_slug}" as sent to SCM`,
    });

    const nextLine = resolveLineScm(lead, line_slug);
    return res.json({ id: lead.id, line_slug, sent_to_scm: nextLine.sent, sent_to_scm_at: nextLine.at, sent_to_scm_by: nextLine.by });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
