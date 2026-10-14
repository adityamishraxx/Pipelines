const router = require('express').Router();
const { sequelize, Lead, LeadContact, ActivityLog, StageHistory, User, DropdownOption, GlobalPo, ServiceDefinition, BusinessUnit } = require('../models');
const { authenticate, adminOnly, requireModule, requireAnyModule } = require('../middleware/auth');
// Lead rows back three modules — the Leads list, the Dashboard and Reports all read them — so a
// read is allowed if ANY of those grants it. Writes are specifically a Leads-module capability.
const canReadLeadData = requireAnyModule(['leads', 'dashboard', 'reports'], 'read');
const { leadScopeWhere } = require('../middleware/scope');
const { applyHoldTransition, scoringFieldsForSave, slaMapFor } = require('../services/scoringEngine');
const { computeConfidence } = require('../services/scoring');
const { cleanServiceLines, computeServicesTotals } = require('../services/pricing');
const { assignLeadCodes, recomputeLocationOnEdit } = require('../services/leadCodes');
const { Op } = require('sequelize');
const leadNotif = require('../services/notifications/rules/leadRules');
const renewalNotif = require('../services/notifications/rules/renewalRules');
const { logChanges } = require('../services/auditTrail');

router.use(authenticate);

// A 'forecast' account can only see the Forecast dashboard — it has no access to lead data.
router.use((req, res, next) => {
  if (req.user.role === 'forecast') return res.status(403).json({ message: 'Forecast accounts can only access the Forecast dashboard.' });
  next();
});

// Phases that have their own dedicated date column on the lead.
const PHASE_DATE_MAP = {
  New: 'start_date',
  Qualified: 'qualified_date',
  Demo: 'demo_date',
  Proposal: 'proposal_date',
  Negotiation: 'negotiation_date',
  'PO Received': 'po_received_date',
};

// Columns tracked by the activity log. The legacy per-service columns (includes_platform,
// *_rate, *_qty, sent_to_scm, etc.) were REMOVED when the unified services_json model landed —
// keeping them here produced a wall of "false → (empty)" noise entries on every save because
// the new save path never writes those columns.
const FIELD_LABELS = {
  property_type: 'Property Type', property_category: 'Property Category',
  customer_name: 'Customer Name', city: 'City', state: 'State', lead_source: 'Lead Source',
  channel_partner_name: 'Channel Partner', kam_name: 'KAM Name', affiliate_name: 'Affiliate Name', new_or_renewal: 'New/Renewal',
  lead_temperature: 'Lead Rating', competitor: 'Competitor', quantity: 'Quantity',
  potential_tcv_lakhs: 'Potential TCV (L)', contract_period_months: 'Contract Period (Mo)',
  po_validity_months: 'PO Validity (Mo)', phase: 'Phase', next_followup_date: 'Next Follow-Up Date',
  po_expected_date: 'PO Expected Date', service_start_date: 'Service Start Date', service_end_date: 'Service End Date',
  po_number: 'PO Number', lost_reason: 'Lost Reason', po_actual_value_lakhs: 'Actual PO Value (L)',
  device_requested_date: 'Hardware Requested Date',
  jhes_product: 'JHES Product', additional_notes: 'Additional Notes',
};

// Signage services and their cost nature, used to auto-calculate TCV. OPEX services bill monthly
// over the contract term; CAPEX services are one-time. Device's nature is per-lead (device_cost_type).
// Mirror of frontend SIGNAGE_SERVICES in frontend/src/utils/constants.js — keep the two in sync.
const TCV_SERVICES = [
  { key: 'platform',     nature: 'opex' },
  { key: 'cms',          nature: 'opex' },
  { key: 'connectivity', nature: 'opex' },
  { key: 'amc',          nature: 'opex' },
  { key: 'iptv',         nature: 'opex' },   // JHES only in the UI; other BUs never tick it (→ 0)
  { key: 'jhes',         nature: 'opex' },   // JHES only in the UI; other BUs never tick it (→ 0)
  { key: 'display',      nature: 'capex' },
  { key: 'installation', nature: 'capex' },
];

// Auto-calculated contract value, split into its OPEX (recurring) and CAPEX (one-time) parts,
// both in lakhs (₹ / 100,000), from the ticked services:
//   OPEX  → qty × rate × contract months   (recurring, billed across the term)
//   CAPEX → qty × rate                      (one-time)
// Device uses its per-lead cost type (defaults to capex).
// Mirror of computeTcvBreakdown() in frontend/src/utils/leadHelpers.js — keep the two in sync.
function computeTcvBreakdown(body) {
  const months = parseInt(body.contract_period_months, 10) || 0;
  let opex = 0, capex = 0;
  const add = (included, rate, qty, nature) => {
    if (!included) return;
    const r = parseFloat(rate) || 0;
    const q = parseInt(qty, 10) || 0;
    if (!r || !q) return;
    if (nature === 'opex') opex += r * q * months; else capex += r * q;
  };
  for (const svc of TCV_SERVICES) {
    add(body[`includes_${svc.key}`], body[`${svc.key}_rate`], body[`${svc.key}_qty`], svc.nature);
  }
  add(body.includes_device, body.device_rate, body.device_qty, body.device_cost_type === 'opex' ? 'opex' : 'capex');
  return { opexLakhs: opex / 100000, capexLakhs: capex / 100000 };
}

// Total Contract Value in lakhs — OPEX + CAPEX. Returns 0 when nothing is calculable.
function computeTcvLakhs(body) {
  const { opexLakhs, capexLakhs } = computeTcvBreakdown(body);
  const tcv = opexLakhs + capexLakhs;
  return tcv > 0 ? +tcv.toFixed(2) : 0;
}

// Surveillance leads carry a variable services list (JSON), not per-service columns. TCV split, in
// lakhs: OPEX = rate × qty × contract months (recurring), CAPEX = rate × qty (one-time).
function computeSurveillanceBreakdown(services, months) {
  const m = parseInt(months, 10) || 0;
  let opex = 0, capex = 0;
  for (const s of (Array.isArray(services) ? services : [])) {
    const r = parseFloat(s.rate) || 0;
    const q = parseInt(s.qty, 10) || 0;
    if (!r || !q) continue;
    if (s.nature === 'opex') opex += r * q * m; else capex += r * q;
  }
  return { opexLakhs: opex / 100000, capexLakhs: capex / 100000 };
}

// Normalise a surveillance services array to the persisted shape (only ticked rows with a rate & qty).
function cleanSurveillanceServices(services) {
  return (Array.isArray(services) ? services : [])
    .filter(s => s && (parseFloat(s.rate) || 0) > 0 && (parseInt(s.qty, 10) || 0) > 0)
    .map(s => ({ label: String(s.label || ''), nature: s.nature === 'opex' ? 'opex' : 'capex', rate: parseFloat(s.rate) || 0, qty: parseInt(s.qty, 10) || 0 }));
}

// Date-only helpers — deliberately avoid toISOString()/UTC conversion.
// A DATEONLY value like "2026-07-02" must mean the same calendar day
// regardless of server timezone; round-tripping through Date+toISOString
// shifts it by a day on any positive-UTC-offset server (e.g. IST), because
// "local midnight" converts to "yesterday, 18:30 UTC". We work in local
// calendar fields (getFullYear/getMonth/getDate) throughout instead.
function localDateString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function addDaysLocal(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return localDateString(dt);
}

// Clamp a phase date — defense-in-depth for the "BD can adjust the phase date" business rule.
// A BD can only backdate a phase change: today-7 to today, no future dates (a phase change records
// something that already happened). Manager / Business Admin / Global Admin (any non-BD role) are
// unrestricted and may set any date.
function clampPhaseDate(input, phase, role) {
  const todayStr = localDateString();
  let val = (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) ? input : todayStr;
  if (role === 'bd') {
    const minStr = addDaysLocal(todayStr, -7);
    const maxStr = todayStr;
    if (val < minStr) val = minStr;
    if (val > maxStr) val = maxStr;
  }
  return val;
}

// Build the persisted payload from a raw request body, applying all
// business rules server-side (quantity totals, phase-gated fields, etc).
function normalizePayload(body, { isCreate, existing, role }) {
  // TCV is either hand-typed (tcv_manual) or auto-calculated from the Services Offered lines ×
  // contract period. Computing it server-side keeps the stored value authoritative.
  const tcvManual = !!body.tcv_manual;
  const months = parseInt(body.contract_period_months, 10) || null;
  const years = months ? months / 12 : null;

  // Unified Services Offered model (v2): EVERY business stores its lines in services_json. Each line
  // is { category, label, hw, svc } — see backend/services/pricing.js. cleanServiceLines validates
  // and strips blanks; computeServicesTotals derives TCV/ACV (frequency-aware).
  const serviceLines = cleanServiceLines(body.services);
  let tcv, acv;
  if (tcvManual) {
    // Hand-typed TCV has no service breakdown, so annualise the whole value evenly.
    tcv = parseFloat(body.potential_tcv_lakhs) || 0;
    acv = tcv && years ? +(tcv / years).toFixed(2) : 0;
  } else {
    const totals = computeServicesTotals(serviceLines, months);
    tcv = totals.tcvLakhs;
    acv = totals.acvLakhs;
  }
  const phase = body.phase || 'New';

  // `quantity` = total hardware units across the lead, the Inventory Pipeline's fallback count.
  const totalQty = serviceLines.reduce((n, l) => n + (l.hw ? (parseInt(l.hw.qty, 10) || 0) : 0), 0);

  const phaseChanged = isCreate || (existing && existing.phase !== phase);
  const inactivePhase = ['PO Received', 'Lost'].includes(phase);

  const payload = {
    customer_name: body.customer_name,
    owner_id: body.owner_id,
    business_unit: body.business_unit || 'signage',
    // Account Mix (all businesses).
    property_type: body.property_type || null,
    property_category: body.property_category || null,
    // A lead is always an Individual PO. global_po_id links it to a chain (null = standalone property).
    po_type: 'individual',
    global_po_id: body.global_po_id ? (parseInt(body.global_po_id, 10) || null) : null,
    city: body.city || null,
    state: body.state || null,
    lead_source: body.lead_source || null,
    channel_partner_name: body.lead_source === 'Channel Partner' ? (body.channel_partner_name || null) : null,
    kam_name: body.lead_source === 'KAM' ? (body.kam_name || null) : null,
    affiliate_name: body.lead_source === 'Lead Affiliate' ? (body.affiliate_name || null) : null,
    new_or_renewal: body.new_or_renewal || null,
    // Link a Renewal PO back to the specific PO it renews (set by the + Additional PO → Renewal flow).
    renewed_from_lead_id: body.renewed_from_lead_id ? (parseInt(body.renewed_from_lead_id, 10) || null) : null,
    lead_temperature: body.lead_temperature || null,
    competitor: body.competitor || null,
    quantity: totalQty,
    potential_tcv_lakhs: tcv,
    tcv_manual: tcvManual,
    contract_period_months: months,
    // PO validity is derived automatically from the contract period (same duration).
    po_validity_months: months,
    acv_lakhs: acv,
    contract_value_lakhs: phase === 'PO Received' ? tcv : null,
    phase,
    po_expected_date: body.po_expected_date || null,
    next_followup_date: inactivePhase
      ? null
      : (body.next_followup_date || (phaseChanged ? defaultFollowup() : (existing ? existing.next_followup_date : defaultFollowup()))),
    // Device Expected Date — when the hardware for this deal is expected (drives Inventory Pipeline
    // sorting). Captured on the lead regardless of category; save whatever the client sent.
    device_requested_date: body.device_requested_date || null,
    // Unified Services Offered storage: the validated line list for EVERY business. The legacy
    // per-service columns (includes_*, *_rate, *_qty, device_*) are no longer written — they were
    // cleared by migration 038 and stay at their defaults.
    services_json: JSON.stringify(serviceLines),
    // Custom field values (admin-defined fields with no dedicated column), keyed by slug. Any business
    // unit — including the three originals — may add custom fields via Edit Template, so all of them
    // persist here. When the client sends no map, preserve whatever was already stored.
    custom_fields: (body.custom_fields && typeof body.custom_fields === 'object')
      ? body.custom_fields
      : (existing ? existing.custom_fields : null),
    additional_notes: body.additional_notes || null,
    po_document_url: body.po_document_url !== undefined ? body.po_document_url : (existing ? existing.po_document_url : null),
    // PO number (identifier) — captured only for a won deal, alongside the PO document.
    po_number: phase === 'PO Received' ? (body.po_number ? String(body.po_number).trim() : null) : null,
    lost_reason: phase === 'Lost' ? (body.lost_reason || null) : null,
    po_actual_value_lakhs: (phase === 'PO Received' && body.po_actual_value_lakhs) ? parseFloat(body.po_actual_value_lakhs) : null,
    // Service period is captured only once a deal is won (PO Received).
    service_start_date: phase === 'PO Received' ? (body.service_start_date || null) : null,
    service_end_date: phase === 'PO Received' ? (body.service_end_date || null) : null,
    billing_cycle: phase === 'PO Received' ? (body.billing_cycle || null) : null,
    payment_terms: phase === 'PO Received' ? (body.payment_terms || null) : null,
  };

  // Phase date handling — only touched on an actual phase transition.
  if (phaseChanged) {
    const dateCol = PHASE_DATE_MAP[phase];
    const clamped = clampPhaseDate(body.phase_date, phase, role);
    payload.phase_changed_at = new Date(`${clamped}T12:00:00`);
    if (dateCol) payload[dateCol] = clamped;
  } else if (existing) {
    payload.phase_changed_at = existing.phase_changed_at;
  }

  return { payload, phaseChanged, fromPhase: existing ? existing.phase : null };
}

function defaultFollowup() {
  return addDaysLocal(localDateString(), 14);
}

// When a lead is saved with a source name (Channel Partner / KAM / Lead Affiliate) entered via the
// form's "Other" option, add it as a managed dropdown option for that business so it's offered for
// future leads. Runs for every business unit — the field names are channel_partner / kam / lead_affiliate.
async function ensureSourceNameOptions(payload, transaction) {
  const bu = payload.business_unit;
  const kinds = [
    ['Channel Partner', 'channel_partner', payload.channel_partner_name],
    ['KAM', 'kam', payload.kam_name],
    ['Lead Affiliate', 'lead_affiliate', payload.affiliate_name],
  ];
  for (const [src, field, raw] of kinds) {
    if (payload.lead_source !== src) continue;
    const value = (raw || '').trim();
    if (!value) continue;
    const maxOrder = (await DropdownOption.max('sort_order', { where: { field_name: field, business_unit: bu }, transaction })) || 0;
    await DropdownOption.findOrCreate({
      where: { field_name: field, business_unit: bu, value },
      defaults: { field_name: field, business_unit: bu, value, sort_order: maxOrder + 1, active: true },
      transaction,
    });
  }
}

// Diff two field sets and return one activity_log-shaped row per change.
// Sequelize returns DECIMAL columns as fixed-format strings ("12.50"), while
// the incoming request has plain JS numbers (12.5). Compare numerically when
// both sides parse as numbers, so re-saving an unchanged value never logs a
// false "changed" entry.
function valuesEqual(o, n) {
  const os = o === null || o === undefined ? '' : String(o);
  const ns = n === null || n === undefined ? '' : String(n);
  if (os === '' && ns === '') return true;
  const of = parseFloat(os), nf = parseFloat(ns);
  const bothNumeric = os !== '' && ns !== '' && !isNaN(of) && !isNaN(nf) && String(of) !== 'NaN';
  if (bothNumeric) return Math.abs(of - nf) < 0.001;
  return os === ns;
}

// `actor` is the full req.user, not a name string: names repeat across accounts (two are called
// "PMO") and can be renamed, so the id and email are what actually identify who made the change.
// Values that read as "nothing" (null, undefined, '', false, 0, '0'). Used to skip no-op diffs
// where a legacy column transitions from falsy-stored to falsy-missing — that's not a real change.
function isEmptyish(v) {
  return v === null || v === undefined || v === '' || v === false || v === 0 || v === '0';
}

function diffActivity(before, after, leadId, srNo, customerName, actor) {
  const rows = [];
  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    const o = before ? before[key] : undefined;
    const n = after[key];
    if (valuesEqual(o, n)) continue;
    if (isEmptyish(o) && isEmptyish(n)) continue; // both effectively empty — not a real change
    const os = o === null || o === undefined ? '' : String(o);
    const ns = n === null || n === undefined ? '' : String(n);
    rows.push({
      lead_id: leadId, lead_sr_no: srNo, customer_name: customerName,
      user_name: actor?.name, user_id: actor?.id ?? null, user_email: actor?.email ?? null,
      action_type: key === 'phase' ? 'phase_change' : 'field_update',
      field_changed: label, old_value: os || '(empty)', new_value: ns || '(empty)',
    });
  }
  return rows;
}

// --------------------------------------------------------------------------
// GET /api/leads — list, scoped to owner for BDs, with filters
// --------------------------------------------------------------------------
router.get('/', canReadLeadData, async (req, res) => {
  try {
    const { phase, lead_temperature, lead_source, owner_id, search, overdue } = req.query;
    // business_unit is always taken from the authenticated user (leadScopeWhere) and cannot be
    // overridden via query param, so a PMO/BD can never read another business unit's leads.
    const where = leadScopeWhere(req.user);
    if (phase) where.phase = { [Op.in]: phase.split(',') };
    if (lead_temperature) where.lead_temperature = { [Op.in]: lead_temperature.split(',') };
    if (lead_source) where.lead_source = { [Op.in]: lead_source.split(',') };
    if (owner_id && req.user.role !== 'bd') where.owner_id = { [Op.in]: owner_id.split(',') };
    if (search) {
      const s = `%${search}%`;
      where[Op.or] = ['customer_name', 'city', 'state', 'competitor', 'additional_notes', 'device_sku']
        .map(f => ({ [f]: { [Op.like]: s } }));
    }
    if (overdue === 'true') {
      where.next_followup_date = { [Op.lt]: new Date() };
      where.phase = { [Op.notIn]: ['Lost', 'PO Received', 'On Hold'] };
    }

    const leads = await Lead.findAll({
      where,
      include: [
        { model: User, as: 'owner', attributes: ['id', 'name', 'color', 'initials'] },
        { model: LeadContact, as: 'contacts', attributes: ['name', 'phone', 'email', 'designation'] },
      ],
      order: [['sr_no', 'ASC']],
    });
    const slaMap = await slaMapFor(req.user.business_unit);
    const now = new Date();
    const result = leads.map(l => {
      const j = l.toJSON();
      const live = computeConfidence(j, slaMap, now);
      if (live !== null) j.confidence_score = live;
      return j;
    });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// --------------------------------------------------------------------------
// GET /api/leads/customers
//
// Customer → Location roll-up for the Customers tab on the Leads page. Scoped the same way as
// GET /leads (leadScopeWhere), so a BD sees only their own customers. Returns:
//   [{ customer_code, customer_name, totals, locations: [{ location_code, city, state, totals,
//      sources: { 'Channel Partner': [...names], 'KAM': [...names] }, lead_ids: [...] }] }]
// totals = { leads, open, won, lost, openTCV, wonTCV }
// --------------------------------------------------------------------------
router.get('/customers', canReadLeadData, async (req, res) => {
  try {
    const where = leadScopeWhere(req.user);
    const rows = await Lead.findAll({
      where,
      attributes: [
        'id', 'customer_code', 'customer_name', 'location_code', 'city', 'state',
        'phase', 'potential_tcv_lakhs', 'po_actual_value_lakhs',
        'lead_source', 'channel_partner_name', 'kam_name', 'affiliate_name',
      ],
      order: [['customer_code', 'ASC'], ['location_code', 'ASC'], ['id', 'ASC']],
    });

    const emptyTotals = () => ({ leads: 0, open: 0, won: 0, lost: 0, openTCV: 0, wonTCV: 0 });
    const addTotals = (totals, l) => {
      totals.leads += 1;
      const tcv = parseFloat(l.potential_tcv_lakhs) || 0;
      const paid = parseFloat(l.po_actual_value_lakhs) || tcv;
      if (l.phase === 'PO Received') { totals.won += 1; totals.wonTCV += paid; }
      else if (l.phase === 'Lost')   { totals.lost += 1; }
      else { totals.open += 1; totals.openTCV += tcv; }
    };

    const byCustomer = new Map();
    for (const l of rows) {
      const cc = l.customer_code || 'UNCODED';
      let cust = byCustomer.get(cc);
      if (!cust) {
        cust = { customer_code: cc, customer_name: l.customer_name, totals: emptyTotals(), locations: new Map() };
        byCustomer.set(cc, cust);
      }
      addTotals(cust.totals, l);
      const lc = l.location_code || 'UNK';
      let loc = cust.locations.get(lc);
      if (!loc) {
        loc = { location_code: lc, city: l.city || '', state: l.state || '', totals: emptyTotals(), sources: {}, lead_ids: [] };
        cust.locations.set(lc, loc);
      }
      addTotals(loc.totals, l);
      loc.lead_ids.push(l.id);
      // Capture the specific source name (Channel Partner / KAM / Affiliate) so the UI can show it.
      if (l.lead_source) {
        const name = l.channel_partner_name || l.kam_name || l.affiliate_name || null;
        if (!loc.sources[l.lead_source]) loc.sources[l.lead_source] = new Set();
        if (name) loc.sources[l.lead_source].add(name);
      }
    }

    // Flatten Maps -> arrays, Sets -> arrays.
    const out = [...byCustomer.values()].map(c => ({
      customer_code: c.customer_code,
      customer_name: c.customer_name,
      totals: c.totals,
      locations: [...c.locations.values()].map(l => ({
        ...l,
        sources: Object.fromEntries(Object.entries(l.sources).map(([k, v]) => [k, [...v]])),
      })),
    })).sort((a, b) => a.customer_name.localeCompare(b.customer_name));

    return res.json(out);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// --------------------------------------------------------------------------
// GET /api/leads/:id — single lead with contacts, activity, stage history
// --------------------------------------------------------------------------
router.get('/:id', canReadLeadData, async (req, res) => {
  try {
    const lead = await Lead.findByPk(req.params.id, {
      include: [
        { model: User, as: 'owner', attributes: ['id', 'name', 'color', 'initials'] },
        { model: LeadContact, as: 'contacts' },
        { model: GlobalPo, as: 'globalPo' },
        { model: ActivityLog, as: 'activity', order: [['createdAt', 'DESC']] },
        { model: StageHistory, as: 'stageHistory', order: [['changed_at', 'ASC']] },
      ],
    });
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    if (req.user.role === 'bd' && lead.owner_id !== req.user.id) return res.status(403).json({ message: 'Forbidden' });
    const j = lead.toJSON();
    const slaMap = await slaMapFor(j.business_unit);
    const live = computeConfidence(j, slaMap, new Date());
    if (live !== null) j.confidence_score = live;
    return res.json(j);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// --------------------------------------------------------------------------
// POST /api/leads — create
// --------------------------------------------------------------------------
router.post('/', requireModule('leads', 'full'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const body = { ...req.body };
    if (req.user.role === 'bd') body.owner_id = req.user.id; // BDs can only create leads for themselves

    const { payload } = normalizePayload(body, { isCreate: true, role: req.user.role });

    // Validate the chain link (if any): the Global PO must exist and belong to the same business.
    if (payload.global_po_id) {
      const chain = await GlobalPo.findByPk(payload.global_po_id, { transaction: t });
      if (!chain || chain.business_unit !== payload.business_unit) {
        await t.rollback();
        return res.status(400).json({ message: 'Invalid chain (Global PO) selection.' });
      }
    }

    // Confidence scoring: stamp last-activity + hold fields, then compute the initial confidence.
    // A create is always a touchpoint, so phaseChanged=true.
    applyHoldTransition(payload, null, true, body, new Date(), true);
    Object.assign(payload, await scoringFieldsForSave(payload, null));

    const maxSrNo = await Lead.max('sr_no') || 0;
    const codes = await assignLeadCodes(payload.business_unit || req.user.business_unit, payload.customer_name, payload.city, payload.state, t);
    const lead = await Lead.create({ ...payload, sr_no: maxSrNo + 1, ...codes, created_by: req.user.id, updated_by: req.user.id }, { transaction: t });
    await ensureSourceNameOptions(payload, t);

    // Contacts
    if (Array.isArray(body.contacts) && body.contacts.length) {
      await LeadContact.bulkCreate(
        body.contacts.map(c => ({ lead_id: lead.id, name: c.name, phone: c.phone || null, email: c.email || null, designation: c.designation || null })),
        { transaction: t }
      );
    }

    // Stage history — first entry, no "from"
    await StageHistory.create({
      lead_id: lead.id, from_stage: null, to_stage: payload.phase,
      changed_by: req.user.name, changed_at: payload.phase_changed_at || new Date(),
    }, { transaction: t });

    // Activity log — creation event
    await ActivityLog.create({
      lead_id: lead.id, lead_sr_no: lead.sr_no, customer_name: lead.customer_name,
      user_name: req.user.name, user_id: req.user.id, user_email: req.user.email,
      action_type: 'lead_created', note: 'New lead created',
      business_unit: req.user.business_unit,
    }, { transaction: t });

    await t.commit();
    const full = await Lead.findByPk(lead.id, { include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'color', 'initials'] }] });

    // Fire-and-forget notifications (never blocks the response).
    const nCtx = { lead: { id: lead.id, sr_no: lead.sr_no, customer_name: lead.customer_name, owner_id: lead.owner_id }, actor: req.user, businessUnit: req.user.business_unit };
    leadNotif.onLeadCreated(nCtx).catch(() => {});
    if (payload.renewed_from_lead_id) {
      renewalNotif.onRenewalCreated({ ...nCtx, originalLeadId: payload.renewed_from_lead_id }).catch(() => {});
    }

    if (payload.additional_notes) {
      const { processMentions } = require('../services/mentions');
      processMentions({
        text: payload.additional_notes, oldText: null,
        businessUnit: req.user.business_unit, actorId: req.user.id,
        entityType: 'lead', entityLabel: `PO #${lead.sr_no} "${lead.customer_name}"`,
        linkPath: `/leads?lead=${lead.id}`,
      }).catch(() => {});
    }

    return res.status(201).json(full);
  } catch (err) {
    await t.rollback();
    return res.status(500).json({ message: err.message });
  }
});

// --------------------------------------------------------------------------
// PUT /api/leads/:id — update
// --------------------------------------------------------------------------
router.put('/:id', requireModule('leads', 'edit'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const existing = await Lead.findByPk(req.params.id, { transaction: t });
    if (!existing) {
      await t.rollback();
      return res.status(404).json({ message: 'Lead not found' });
    }

    if (req.user.role === 'bd' && existing.owner_id !== req.user.id) {
      await t.rollback();
      return res.status(403).json({ message: 'Forbidden' });
    }

    const body = { ...req.body };
    if (req.user.role === 'bd') body.owner_id = existing.owner_id; // BDs cannot reassign leads

    const before = existing.toJSON();
    const { payload, phaseChanged, fromPhase } = normalizePayload(body, { isCreate: false, existing: before, role: req.user.role });

    // Validate the chain link (if any): the Global PO must exist and belong to the same business.
    if (payload.global_po_id) {
      const chain = await GlobalPo.findByPk(payload.global_po_id, { transaction: t });
      if (!chain || chain.business_unit !== payload.business_unit) {
        await t.rollback();
        return res.status(400).json({ message: 'Invalid chain (Global PO) selection.' });
      }
    }

    // Confidence scoring: apply the On-Hold freeze/resume transition + last-activity stamp (only
    // on a real phase transition — routine field edits inherit the previous last_activity_at so
    // decayed leads stay decayed), then recompute confidence.
    applyHoldTransition(payload, before, false, body, new Date(), phaseChanged);
    Object.assign(payload, await scoringFieldsForSave(payload, before));

    // Keep the location_code + lead_ref in sync with the lead's current city/state. If the edit moved
    // the lead to a different location bucket (e.g. a blank city filled in as "Patna"), re-issue both
    // so Customer -> Location grouping stays correct. customer_code never changes here.
    const nextCity = payload.city !== undefined ? payload.city : before.city;
    const nextState = payload.state !== undefined ? payload.state : before.state;
    const locPatch = await recomputeLocationOnEdit(before, nextCity, nextState, t);
    if (locPatch) Object.assign(payload, locPatch);

    // Use a static UPDATE (not existing.update) so the write does NOT rely on Sequelize's
    // per-instance dirty-tracking. In the mounted (STB) process that dirty-tracking was flagging
    // every data field as "unchanged", so instance.update() emitted only `SET updated_at=?` and the
    // real edits (phase, service fields, etc.) were silently dropped — while the transaction still
    // committed, so it looked like a no-op. A static update always writes the given columns.
    await Lead.update({ ...payload, updated_by: req.user.id }, { where: { id: existing.id }, transaction: t });
    await ensureSourceNameOptions(payload, t);

    // Contacts — replace-all, matching original app behavior
    if (Array.isArray(body.contacts)) {
      await LeadContact.destroy({ where: { lead_id: existing.id }, transaction: t });
      if (body.contacts.length) {
        await LeadContact.bulkCreate(
          body.contacts.map(c => ({ lead_id: existing.id, name: c.name, phone: c.phone || null, email: c.email || null, designation: c.designation || null })),
          { transaction: t }
        );
      }
    }

    if (phaseChanged) {
      await StageHistory.create({
        lead_id: existing.id, from_stage: fromPhase, to_stage: payload.phase,
        changed_by: req.user.name, changed_at: payload.phase_changed_at || new Date(),
      }, { transaction: t });
    }

    const rows = diffActivity(before, payload, existing.id, existing.sr_no, existing.customer_name, req.user);
    if (rows.length) {
      for (const r of rows) r.business_unit = req.user.business_unit;
      await ActivityLog.bulkCreate(rows, { transaction: t });
    }

    await t.commit();
    const full = await Lead.findByPk(existing.id, { include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'color', 'initials'] }] });

    // Audit trail — fire-and-forget (logChanges never throws)
    logChanges({
      entityType: 'lead',
      entityId: existing.id,
      oldData: before,
      newData: full.toJSON(),
      userId: req.user.id,
      userName: req.user.name,
      businessUnit: req.user.business_unit,
    });

    // Fire-and-forget notifications.
    const nLead = { id: existing.id, sr_no: existing.sr_no, customer_name: existing.customer_name, owner_id: payload.owner_id || before.owner_id, lost_reason: payload.lost_reason, hold_end_date: payload.hold_end_date };
    const nCtx = { lead: nLead, actor: req.user, businessUnit: req.user.business_unit };
    if (phaseChanged) {
      leadNotif.onPhaseChange({ ...nCtx, fromPhase, toPhase: payload.phase }).catch(() => {});
      if (payload.phase === 'Lost') leadNotif.onLeadMarkedLost(nCtx).catch(() => {});
      if (payload.phase === 'On Hold') leadNotif.onLeadOnHold(nCtx).catch(() => {});
    }
    if (payload.owner_id && payload.owner_id !== before.owner_id) {
      leadNotif.onOwnerChange({ ...nCtx, oldOwnerId: before.owner_id, newOwnerId: payload.owner_id }).catch(() => {});
    }
    if (payload.po_document_url && payload.po_document_url !== before.po_document_url) {
      leadNotif.onPoDocumentUploaded(nCtx).catch(() => {});
    }

    if (payload.additional_notes !== undefined) {
      const { processMentions } = require('../services/mentions');
      processMentions({
        text: payload.additional_notes, oldText: before.additional_notes,
        businessUnit: req.user.business_unit, actorId: req.user.id,
        entityType: 'lead', entityLabel: `PO #${existing.sr_no} "${existing.customer_name}"`,
        linkPath: `/leads?lead=${existing.id}`,
      }).catch(() => {});
    }

    return res.json(full);
  } catch (err) {
    await t.rollback();
    return res.status(500).json({ message: err.message });
  }
});

// --------------------------------------------------------------------------
// PUT /api/leads/bulk — bulk reassign or bulk phase change (admin only)
// --------------------------------------------------------------------------
router.put('/bulk/update', adminOnly, requireModule('leads', 'edit'), async (req, res) => {
  try {
    const { ids, owner_id, phase } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ message: 'ids[] required' });

    const updates = { updated_by: req.user.id };
    if (owner_id) updates.owner_id = owner_id;
    if (phase) {
      updates.phase = phase;
      updates.phase_changed_at = new Date();
      // A phase change is a touchpoint → reset the decay clock, and clear any hold freeze when the
      // bulk move is to an active (non-hold) stage.
      updates.last_activity_at = new Date();
      if (phase !== 'On Hold') {
        Object.assign(updates, { hold_frozen_confidence: null, hold_entered_at: null, hold_end_date: null, pre_hold_stage: null });
      }
    }

    await Lead.update(updates, { where: { id: { [Op.in]: ids } } });
    // Refresh confidence for the affected leads immediately (recomputes all; cheap at this scale).
    if (phase) { try { await require('../services/scoringEngine').recomputeAll(); } catch (e) { /* non-fatal */ } }

    if (owner_id) leadNotif.onBulkReassign({ ids, newOwnerId: owner_id, actor: req.user, businessUnit: req.user.business_unit }).catch(() => {});

    return res.json({ message: `Updated ${ids.length} lead(s)` });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// --------------------------------------------------------------------------
// DELETE /api/leads/:id — admin only
// --------------------------------------------------------------------------
router.delete('/:id', adminOnly, requireModule('leads', 'full'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const lead = await Lead.findByPk(req.params.id, { transaction: t });
    if (!lead) { await t.rollback(); return res.status(404).json({ message: 'Lead not found' }); }

    await LeadContact.destroy({ where: { lead_id: lead.id }, transaction: t });
    await ActivityLog.destroy({ where: { lead_id: lead.id }, transaction: t });
    await StageHistory.destroy({ where: { lead_id: lead.id }, transaction: t });
    await lead.destroy({ transaction: t });

    await t.commit();
    return res.json({ message: 'Lead deleted' });
  } catch (err) {
    await t.rollback();
    return res.status(500).json({ message: err.message });
  }
});

// --------------------------------------------------------------------------
// POST /api/leads/bulk — bulk import from Excel upload
// --------------------------------------------------------------------------
const VALID_PHASES = ['New', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'PO Expected', 'PO Received', 'Lost', 'On Hold'];
const VALID_TEMPS = ['Hot', 'Warm', 'Cold'];
const VALID_RENEWAL = ['New', 'Renewal', 'Expansion'];
const VALID_LOST_REASONS = ['Pricing', 'Competition', 'No Budget', 'No Decision', 'Timing', 'Product Fit', 'Other'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Build the Services Offered line list for one bulk row from the BU's catalog. Columns are keyed
// svc:<slug>:rate / :qty (and :hw_rate/:hw_qty/:svc_rate/:svc_qty for Hardware + Software). Nature
// comes from the catalog default; frequency defaults to monthly (editable later on the lead form).
function buildServiceLinesFromRow(r, catalog) {
  const lines = [];
  const comp = (rate, qty, nature) => {
    const rr = (rate !== undefined && rate !== '') ? Number(rate) : 0;
    const qq = (qty !== undefined && qty !== '') ? parseInt(qty, 10) : 0;
    if ((!rr || Number.isNaN(rr)) && (!qq || Number.isNaN(qq))) return null;
    return { nature: nature === 'capex' ? 'capex' : 'opex', frequency: 'monthly', rate: Number.isNaN(rr) ? 0 : rr, qty: Number.isNaN(qq) ? 0 : qq };
  };
  for (const c of catalog) {
    const cat = c.category || (c.hardware ? 'hardware' : 'software');
    const base = `svc:${c.slug}:`;
    if (cat === 'hardware_software') {
      const hw = comp(r[`${base}hw_rate`], r[`${base}hw_qty`], c.nature);
      const svc = comp(r[`${base}svc_rate`], r[`${base}svc_qty`], c.nature);
      if (hw || svc) lines.push({ category: cat, label: c.label, hw, svc });
    } else {
      const one = comp(r[`${base}rate`], r[`${base}qty`], c.nature);
      if (one) lines.push({ category: cat, label: c.label, hw: cat === 'hardware' ? one : null, svc: cat === 'software' ? one : null });
    }
  }
  return lines;
}

router.post('/bulk', adminOnly, async (req, res) => {
  const { rows, dryRun = true, business_unit } = req.body;
  const bu = business_unit || req.user.business_unit;

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: 'No rows provided.' });
  }
  if (rows.length > 500) {
    return res.status(400).json({ message: 'Maximum 500 rows per upload.' });
  }

  const users = await User.findAll({ where: { business_unit: bu, active: true }, attributes: ['id', 'email', 'name'] });
  // Leads are assigned by owner NAME in the import. Names can repeat, so map each name to the list of
  // matching users and disambiguate per row (a single match assigns; zero or many is a row error).
  const usersByName = {};
  users.forEach(u => { if (u.name) { const k = u.name.toLowerCase().trim(); (usersByName[k] = usersByName[k] || []).push(u); } });
  // This business's service catalog — drives how the svc:* columns are parsed into services_json.
  const catalog = await ServiceDefinition.findAll({ where: { business_unit: bu, active: true }, order: [['sort_order', 'ASC']] });
  // Contacts are required on import only if the template marks a contact field mandatory (same rule
  // as the lead form). Otherwise contacts are optional.
  const buRow = await BusinessUnit.findOne({ where: { slug: bu }, attributes: ['config'] });
  const contactsSec = (buRow?.config?.formSchema?.sections || []).find(s => s.key === 'contacts');
  const contactFieldReq = (slug) => !!(contactsSec?.fields || []).find(f => f.slug === slug && f.mandatory);
  const contactsRequired = contactFieldReq('contact_name') || contactFieldReq('contact_email');

  const valid = [];
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2;
    const errs = [];

    const customerName = (r.customer_name || '').trim();
    const ownerName = (r.owner_name || '').trim();
    const phase = (r.phase || '').trim();

    if (!customerName) errs.push({ field: 'Customer Name', message: 'Required' });
    if (!ownerName) errs.push({ field: 'Lead Owner', message: 'Required' });
    if (!phase) errs.push({ field: 'Phase', message: 'Required' });

    let ownerId = null;
    if (ownerName) {
      const matches = usersByName[ownerName.toLowerCase()] || [];
      if (matches.length === 1) ownerId = matches[0].id;
      else if (matches.length === 0) errs.push({ field: 'Lead Owner', message: `No active user "${ownerName}" in this business` });
      else errs.push({ field: 'Lead Owner', message: `Multiple active users named "${ownerName}" — cannot assign by name. Rename one or assign manually after import.` });
    }

    if (phase && !VALID_PHASES.includes(phase)) {
      errs.push({ field: 'Phase', message: `Invalid. Valid: ${VALID_PHASES.join(', ')}` });
    }
    if (phase === 'Lost' && !(r.lost_reason || '').trim()) {
      errs.push({ field: 'Lost Reason', message: 'Required when Phase is Lost' });
    }
    if (r.lost_reason && !VALID_LOST_REASONS.includes(r.lost_reason.trim())) {
      errs.push({ field: 'Lost Reason', message: `Invalid. Valid: ${VALID_LOST_REASONS.join(', ')}` });
    }
    if (r.lead_temperature && !VALID_TEMPS.includes(r.lead_temperature.trim())) {
      errs.push({ field: 'Lead Temperature', message: 'Must be Hot, Warm, or Cold' });
    }
    if (r.new_or_renewal && !VALID_RENEWAL.includes(r.new_or_renewal.trim())) {
      errs.push({ field: 'New or Renewal', message: 'Must be New, Renewal, or Expansion' });
    }

    const numericFields = ['tcv_lakhs', 'contract_period_months', 'quantity', 'po_actual_value_lakhs'];
    for (const nf of numericFields) {
      if (r[nf] !== undefined && r[nf] !== '' && isNaN(Number(r[nf]))) {
        errs.push({ field: nf, message: 'Must be a number' });
      }
    }
    // Catalog service rate/qty columns (svc:<slug>:...) must be numeric when provided.
    for (const [key, val] of Object.entries(r)) {
      if (key.startsWith('svc:') && val !== undefined && val !== '' && isNaN(Number(val))) {
        errs.push({ field: key, message: 'Must be a number' });
      }
    }

    const dateFields = ['next_followup_date', 'po_expected_date', 'po_received_date', 'hold_end_date', 'service_start_date', 'service_end_date', 'device_requested_date'];
    for (const df of dateFields) {
      if (r[df] && !DATE_RE.test(r[df])) errs.push({ field: df, message: 'Date must be YYYY-MM-DD' });
    }

    const contacts = [];
    for (let c = 1; c <= 3; c++) {
      const cn = (r[`contact_${c}_name`] || '').trim();
      const ce = (r[`contact_${c}_email`] || '').trim();
      if (cn || ce) {
        if (!cn) errs.push({ field: `Contact ${c} Name`, message: 'Name required when email is provided' });
        if (!ce) errs.push({ field: `Contact ${c} Email`, message: 'Email required when name is provided' });
        contacts.push({ name: cn, email: ce, phone: (r[`contact_${c}_phone`] || '').trim() || null, designation: (r[`contact_${c}_designation`] || '').trim() || null });
      }
    }
    if (contactsRequired && contacts.length === 0) errs.push({ field: 'Contact 1 Name', message: 'At least one contact with Name and Email required' });

    if (errs.length > 0) {
      errors.push({ row: rowNum, errors: errs });
    } else {
      const leadSource = (r.lead_source || '').trim() || null;
      const sourceName = (r.source_name || '').trim() || null;
      const parseBool = (v) => {
        if (!v) return false;
        const s = String(v).trim().toLowerCase();
        return s === 'yes' || s === 'true' || s === '1';
      };
      const optNum = (v) => (v !== undefined && v !== '' ? Number(v) : null);
      const optStr = (v) => (v ? String(v).trim() : null);

      const leadData = {
        customer_name: customerName,
        owner_id: ownerId,
        business_unit: bu,
        city: optStr(r.city),
        state: optStr(r.state),
        lead_source: leadSource,
        channel_partner_name: leadSource === 'Channel Partner' ? sourceName : null,
        kam_name: leadSource === 'KAM' ? sourceName : null,
        affiliate_name: leadSource === 'Lead Affiliate' ? sourceName : null,
        new_or_renewal: optStr(r.new_or_renewal),
        lead_temperature: optStr(r.lead_temperature),
        competitor: optStr(r.competitor),
        property_type: optStr(r.property_type),
        property_category: optStr(r.property_category),
        phase,
        next_followup_date: r.next_followup_date || null,
        po_expected_date: r.po_expected_date || null,
        po_received_date: phase === 'PO Received' ? (r.po_received_date || null) : null,
        lost_reason: phase === 'Lost' ? optStr(r.lost_reason) : null,
        hold_end_date: phase === 'On Hold' ? (r.hold_end_date || null) : null,
        contract_period_months: optNum(r.contract_period_months),
        quantity: r.quantity ? Number(r.quantity) : 0,
        po_number: optStr(r.po_number),
        po_actual_value_lakhs: optNum(r.po_actual_value_lakhs),
        service_start_date: r.service_start_date || null,
        service_end_date: r.service_end_date || null,
        billing_cycle: phase === 'PO Received' ? (optStr(r.billing_cycle) || null) : null,
        payment_terms: phase === 'PO Received' ? (optStr(r.payment_terms) || null) : null,
        additional_notes: optStr(r.additional_notes),
        device_requested_date: r.device_requested_date || null,
        _contacts: contacts,
        _rowNum: i + 2,
      };

      // Unified Services Offered — build the line list from the catalog columns, store as JSON, and
      // set the hardware-unit total used by the Inventory Pipeline fallback.
      const serviceLines = cleanServiceLines(buildServiceLinesFromRow(r, catalog));
      leadData.services_json = JSON.stringify(serviceLines);
      leadData.quantity = serviceLines.reduce((n, l) => n + (l.hw ? (parseInt(l.hw.qty, 10) || 0) : 0), 0);

      // Extract custom_xxx fields into a JSON object for storage in custom_fields column
      const customFields = {};
      for (const [key, val] of Object.entries(r)) {
        if (key.startsWith('custom_') && val !== undefined && val !== '') {
          customFields[key.replace('custom_', '')] = String(val).trim();
        }
      }
      if (Object.keys(customFields).length > 0) leadData.custom_fields = customFields;

      if (r.tcv_lakhs !== undefined && r.tcv_lakhs !== '') {
        const months = optNum(r.contract_period_months);
        const years = months ? months / 12 : null;
        leadData.potential_tcv_lakhs = Number(r.tcv_lakhs);
        leadData.acv_lakhs = (leadData.potential_tcv_lakhs && years) ? +(leadData.potential_tcv_lakhs / years).toFixed(2) : 0;
        leadData.tcv_manual = true;
      } else {
        const totals = computeServicesTotals(serviceLines, optNum(r.contract_period_months));
        leadData.potential_tcv_lakhs = totals.tcvLakhs || null;
        leadData.acv_lakhs = totals.acvLakhs || 0;
        leadData.tcv_manual = totals.tcvLakhs > 0 ? false : true;
      }

      valid.push(leadData);
    }
  }

  if (dryRun) {
    return res.json({ validCount: valid.length, errorCount: errors.length, errors, totalRows: rows.length });
  }

  const t = await sequelize.transaction();
  try {
    let maxSr = (await Lead.max('sr_no', { transaction: t })) || 0;
    const createdIds = [];

    for (const row of valid) {
      maxSr += 1;
      const contacts = row._contacts;
      delete row._contacts;
      delete row._rowNum;

      // For an imported PO Received lead with a real PO Received Date, anchor phase_changed_at to that
      // historical date so weekly/monthly performance (which uses po_received_date, falling back to
      // phase_changed_at) reflects when the PO actually landed — not the import date.
      const historicalPhaseDate = (row.phase === 'PO Received' && row.po_received_date) ? new Date(row.po_received_date) : new Date();
      const payload = {
        ...row,
        sr_no: maxSr,
        po_type: 'individual',
        phase_changed_at: historicalPhaseDate,
        last_activity_at: new Date(),
        created_by: req.user.id,
        updated_by: req.user.id,
      };

      applyHoldTransition(payload, null, true, row, new Date(), true);
      Object.assign(payload, await scoringFieldsForSave(payload, null));
      Object.assign(payload, await assignLeadCodes(payload.business_unit || bu, payload.customer_name, payload.city, payload.state, t));

      const lead = await Lead.create(payload, { transaction: t });
      await ensureSourceNameOptions(payload, t);

      if (contacts.length > 0) {
        await LeadContact.bulkCreate(
          contacts.map(c => ({ lead_id: lead.id, name: c.name, phone: c.phone, email: c.email, designation: c.designation })),
          { transaction: t },
        );
      }

      await StageHistory.create({
        lead_id: lead.id, from_stage: null, to_stage: payload.phase,
        changed_by: req.user.name, changed_at: new Date(),
      }, { transaction: t });

      await ActivityLog.create({
        lead_id: lead.id, lead_sr_no: lead.sr_no, customer_name: lead.customer_name,
        user_name: req.user.name, user_id: req.user.id, user_email: req.user.email,
        action_type: 'lead_created', note: 'Bulk import',
        business_unit: bu,
      }, { transaction: t });

      createdIds.push(lead.id);
    }

    await t.commit();
    return res.json({
      validCount: valid.length, errorCount: errors.length, errors,
      created: createdIds.length,
      message: `Successfully imported ${createdIds.length} lead${createdIds.length !== 1 ? 's' : ''}.`,
    });
  } catch (err) {
    await t.rollback();
    return res.status(500).json({ message: `Import failed: ${err.message}` });
  }
});

module.exports = router;
