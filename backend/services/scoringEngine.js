// ---------------------------------------------------------------------------
// Scoring engine — the DB-facing layer around the pure formula (services/scoring.js).
//
//   * loads per-platform SLA maps from sla_config,
//   * applies the On-Hold freeze / resume transition when a lead is saved,
//   * recomputes a single lead on save (event-triggered), and
//   * recomputes every lead on a schedule (time-based decay).
// ---------------------------------------------------------------------------
const { Lead, SlaConfig, BusinessUnit } = require('../models');
const { computeConfidence, recomputeFields, BASE, DEFAULT_SLA, FLOOR } = require('./scoring');

const DAY_MS = 86400000;

// Business units are now data-driven (migration 028) rather than a hardcoded list, so a new BU is
// picked up here with no code change. Ordered by the admin-set sort order.
async function listBusinessUnitSlugs() {
  const rows = await BusinessUnit.findAll({ attributes: ['slug'], order: [['sort_order', 'ASC'], ['name', 'ASC']] });
  return rows.map(r => r.slug);
}

// Does this slug name a real business unit? Used by routes (e.g. SLA config) to validate a target BU.
async function isValidBusinessUnit(slug) {
  if (!slug) return false;
  return !!(await BusinessUnit.findOne({ where: { slug }, attributes: ['id'] }));
}

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

// { stage: sla_days } for one platform, defaults filled in for any missing stage.
async function slaMapFor(businessUnit) {
  const rows = await SlaConfig.findAll({ where: { business_unit: businessUnit } });
  const map = { ...DEFAULT_SLA };
  for (const r of rows) map[r.stage] = Number(r.sla_days);
  return map;
}

// { business_unit: { stage: sla_days } } for every platform.
async function slaMapsAll() {
  const slugs = await listBusinessUnitSlugs();
  const rows = await SlaConfig.findAll();
  const maps = {};
  for (const bu of slugs) maps[bu] = { ...DEFAULT_SLA };
  for (const r of rows) {
    (maps[r.business_unit] ||= { ...DEFAULT_SLA })[r.stage] = Number(r.sla_days);
  }
  return maps;
}

// Apply the On-Hold freeze/resume rules and stamp last_activity_at when the lead's PHASE actually
// changes (create, transition between stages, entering or leaving On Hold). Mutates `payload` in
// place. `existing` is the pre-save row (null on create); `body` is the raw request (for an explicit
// hold_end_date); `phaseChanged` is true when the caller detected a real stage transition.
function applyHoldTransition(payload, existing, isCreate, body, now = new Date(), phaseChanged = false) {
  const newPhase = payload.phase;
  const wasHold = !isCreate && existing && existing.phase === 'On Hold';

  // Only a genuine touchpoint restarts the SLA decay clock: creating the lead, moving it between
  // stages, or entering / leaving On Hold. Routine field edits (notes, contacts, custom fields,
  // address tweaks) must not reset the clock — otherwise every save springs a decayed lead back to
  // its base weight, so a "Just typed in the notes box" edit looks like it raised the score.
  const isTouchpoint = isCreate || phaseChanged;
  if (isTouchpoint) {
    payload.last_activity_at = now;
  } else if (existing) {
    payload.last_activity_at = existing.last_activity_at;
  }

  if (newPhase === 'On Hold') {
    if (wasHold) {
      // Staying on hold — preserve the freeze, allow editing only the resume/end date.
      payload.hold_frozen_confidence = existing.hold_frozen_confidence;
      payload.hold_entered_at = existing.hold_entered_at;
      payload.pre_hold_stage = existing.pre_hold_stage;
      payload.hold_end_date = body.hold_end_date || payload.next_followup_date || existing.hold_end_date || null;
    } else {
      // Entering hold — freeze confidence at its current value (Section 7.2).
      const frozen = (!isCreate && existing && existing.confidence_score != null)
        ? Number(existing.confidence_score)
        : (BASE[(!isCreate && existing) ? existing.phase : 'New'] ?? FLOOR);
      payload.hold_frozen_confidence = frozen;
      payload.hold_entered_at = now;
      payload.pre_hold_stage = (!isCreate && existing) ? existing.phase : null;
      payload.hold_end_date = body.hold_end_date || payload.next_followup_date || addDaysLocal(localDateString(now), 60);
    }
  } else {
    // Active / Lost / PO Received — not on hold. Clear the freeze (this also covers a manual resume,
    // which then restarts at the stage's base weight because last_activity_at is now).
    payload.hold_frozen_confidence = null;
    payload.hold_entered_at = null;
    payload.pre_hold_stage = null;
    payload.hold_end_date = null;
  }
}

// Compute the confidence columns for a lead being saved. Returns the fields to merge into `payload`.
// Call AFTER applyHoldTransition so last_activity_at / hold fields are already set.
async function scoringFieldsForSave(payload, existing) {
  const now = new Date();
  const sla = await slaMapFor(payload.business_unit);
  const effective = { ...(existing || {}), ...payload };
  return recomputeFields(effective, sla, now);
}

// Recompute EVERY lead's confidence (time-based decay). Used by the scheduled job and one-shot script.
async function recomputeAll() {
  const now = new Date();
  const maps = await slaMapsAll();
  const leads = await Lead.findAll();
  let updated = 0;
  for (const lead of leads) {
    const sla = maps[lead.business_unit] || DEFAULT_SLA;
    const fields = recomputeFields(lead, sla, now);
    const scoreChanged = numOrNull(lead.confidence_score) !== numOrNull(fields.confidence_score);
    const prevChanged = numOrNull(lead.confidence_prev) !== numOrNull(fields.confidence_prev);
    if (scoreChanged || prevChanged || lead.confidence_computed_at == null) {
      await Lead.update(fields, { where: { id: lead.id } });
      updated++;
    }
  }
  return { total: leads.length, updated };
}

function numOrNull(v) { return (v === null || v === undefined) ? null : Number(v); }

module.exports = { slaMapFor, slaMapsAll, applyHoldTransition, scoringFieldsForSave, recomputeAll, listBusinessUnitSlugs, isValidBusinessUnit };
