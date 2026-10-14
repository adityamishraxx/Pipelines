// Per-platform SLA (days-per-stage) config — admin only. Base weights and hourglass jumps are fixed
// constants in code and are NOT editable here; only the SLA window per stage is configurable, and it
// is independent for each platform (signage / jhes / surveillance).
const router = require('express').Router();
const { SlaConfig } = require('../models');
const { authenticate, adminOnly } = require('../middleware/auth');
const { STAGES_WITH_SLA, DEFAULT_SLA, BASE } = require('../services/scoring');
const { recomputeAll, isValidBusinessUnit } = require('../services/scoringEngine');
const { isSuperAdmin } = require('../services/permissions');
const audit = require('../services/audit');

router.use(authenticate);

// Editing the TAT is restricted to a business's PMO / Business Admin, plus any Global Admin
// (cross-platform super_admin_scope grant — a Global Admin usually has role='business_admin' with
// the scope layered on, so a bare role-only check would refuse them).
function tatEditors(req, res, next) {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  if (isSuperAdmin(req.user)) return next();
  if (['business_admin', 'pmo'].includes(req.user.role)) return next();
  return res.status(403).json({ message: 'Forbidden' });
}

// A Global Admin (super_admin_scope grant) may target any platform via ?business_unit= or the PUT
// body; everyone else is confined to their own. Keyed on the scope grant rather than user.role,
// because a Global Admin's stored role is normally 'business_admin' or 'pmo' — the scope is the
// additive cross-platform capability. Without this, JHES/Signage edits made from a Global Admin's
// UI would silently write to whichever BU their account is attached to.
function resolveBu(user, requested) {
  return isSuperAdmin(user) ? (requested || user.business_unit) : user.business_unit;
}

// Full stage list for a platform: the editable TAT (days) plus the FIXED confidence weightage per
// stage (a shared constant, shown read-only — it is not platform-specific and cannot be edited).
async function stagesFor(bu) {
  const rows = await SlaConfig.findAll({ where: { business_unit: bu } });
  const map = {};
  for (const r of rows) map[r.stage] = Number(r.sla_days);
  return STAGES_WITH_SLA.map(stage => ({
    stage,
    tat_days: map[stage] != null ? map[stage] : DEFAULT_SLA[stage],
    weight: BASE[stage],
  }));
}

// GET /api/sla?business_unit=signage → { business_unit, stages: [{stage, tat_days, weight}] }
// Readable by ANY authenticated user (scoped to their own business via resolveBu) — the Leads/Kanban
// aging indicator colours each lead against its stage TAT target, so BDs need to read it too. Editing
// (PUT) stays restricted to tatEditors.
router.get('/', async (req, res) => {
  try {
    const bu = resolveBu(req.user, req.query.business_unit);
    if (!(await isValidBusinessUnit(bu))) return res.status(400).json({ message: 'Invalid business_unit' });
    return res.json({ business_unit: bu, stages: await stagesFor(bu) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// PUT /api/sla  body: { business_unit, tats: { 'New': 2, 'Qualified': 5, ... } }
// Upserts the TAT days for the given platform, then recomputes confidence so the change is immediate.
// Only the business's PMO / Business Admin may call this (see tatEditors).
router.put('/', tatEditors, async (req, res) => {
  try {
    const bu = resolveBu(req.user, req.body.business_unit);
    if (!(await isValidBusinessUnit(bu))) return res.status(400).json({ message: 'Invalid business_unit' });
    const tats = req.body.tats || req.body.slas || {};

    for (const stage of STAGES_WITH_SLA) {
      const raw = tats[stage];
      if (raw === undefined || raw === null || raw === '') continue;
      const days = parseInt(raw, 10);
      if (!Number.isFinite(days) || days < 1 || days > 365) {
        return res.status(400).json({ message: `TAT for "${stage}" must be a whole number of days (1-365).` });
      }
      const [row, created] = await SlaConfig.findOrCreate({
        where: { business_unit: bu, stage },
        defaults: { business_unit: bu, stage, sla_days: days },
      });
      if (!created && Number(row.sla_days) !== days) {
        const wasDays = Number(row.sla_days);
        await SlaConfig.update({ sla_days: days }, { where: { id: row.id } });
        await audit.record({
          actor: req.user, entityType: 'sla', entityId: row.id, subject: `${stage} TAT`,
          businessUnit: bu, action: 'field_update',
          field: `${stage} TAT (days)`, from: wasDays, to: days,
        });
      }
    }

    try { await recomputeAll(); } catch (e) { /* SLA saved even if the refresh hiccups */ }
    return res.json({ business_unit: bu, stages: await stagesFor(bu) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
