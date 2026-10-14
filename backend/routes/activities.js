// Activities — kanban board of internal follow-ups, tasks and calls per BU. Each BU can create
// multiple TABS (each tab is its own kanban board), and each card carries Previous Steps, Recent
// Updates and Next Steps so the board tells the story at a glance without opening a card.
//
// Access model (three gates, all must pass):
//   1. Role — Manager (pmo) / Business Admin / Global Admin only. Team Members (BD) are denied.
//   2. Module enablement per BU — business_units.config.modules.activities must be true.
//   3. Module permission per user — users.module_permissions.activities (read / edit / full).
//
// Endpoints:
//   GET    /api/activities/tabs        — list tabs for the caller's BU (auto-creates default)
//   POST   /api/activities/tabs        — create a tab
//   PATCH  /api/activities/tabs/:id    — rename a tab
//   DELETE /api/activities/tabs/:id    — remove a tab (its cards cascade)
//   GET    /api/activities             — list cards for the caller's BU (all tabs)
//   POST   /api/activities             — create a card
//   PATCH  /api/activities/:id         — update a card (also used for move / reassign)
//   DELETE /api/activities/:id         — delete a card
const router = require('express').Router();
const { Activity, ActivityTab, User, BusinessUnit } = require('../models');
const { authenticate, requireModule } = require('../middleware/auth');
const { moduleEnabledForBu, isSuperAdmin } = require('../services/permissions');

const VALID_STATUS = new Set(['to_do', 'in_progress', 'delayed', 'blocked', 'completed']);
const VALID_PRIORITY = new Set(['low', 'medium', 'high']);
// Roles allowed to reach the Task Board module. Business Development (bd) is now included — the board
// is available to BDs as well, gated the normal way by the per-user activities permission and the
// per-BU module enablement (not hard-blocked by role).
const ALLOWED_ROLES = new Set(['pmo', 'business_admin', 'super_admin', 'bd']);

// Reject requests when either the caller's role isn't in the allow-list, or the module is disabled
// for the caller's business unit. Defense-in-depth on top of the Sidebar hide and the ModuleRoute
// gate on the frontend.
async function requireBuModule(req, res, next) {
  try {
    if (!(isSuperAdmin(req.user) || ALLOWED_ROLES.has(req.user.role))) {
      return res.status(403).json({ message: 'Your role does not have access to the Task Board.' });
    }
    const bu = await BusinessUnit.findOne({ where: { slug: req.user.business_unit }, attributes: ['config'] });
    if (!moduleEnabledForBu(bu?.config, 'activities')) {
      return res.status(403).json({ message: 'Task Board is not enabled for this business unit.' });
    }
    next();
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

router.use(authenticate, requireBuModule);

// Ensure at least one tab exists for the caller's BU so the frontend always has somewhere to render
// cards. Called on any tab-related read so a fresh BU never hits an empty board with no tabs.
async function ensureDefaultTab(bu) {
  const existing = await ActivityTab.findOne({ where: { business_unit: bu } });
  if (existing) return existing;
  return await ActivityTab.create({ business_unit: bu, label: 'General', sort_order: 0 });
}

// -------------------------- Tabs --------------------------
router.get('/tabs', requireModule('activities', 'read'), async (req, res) => {
  try {
    await ensureDefaultTab(req.user.business_unit);
    const rows = await ActivityTab.findAll({
      where: { business_unit: req.user.business_unit },
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
    });
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.post('/tabs', requireModule('activities', 'full'), async (req, res) => {
  try {
    const label = String(req.body.label || '').trim().slice(0, 64);
    if (!label) return res.status(400).json({ message: 'Tab name is required.' });
    const max = await ActivityTab.max('sort_order', { where: { business_unit: req.user.business_unit } });
    const tab = await ActivityTab.create({
      business_unit: req.user.business_unit,
      label,
      sort_order: Number.isFinite(max) ? max + 1 : 0,
      created_by: req.user.id,
    });
    return res.status(201).json(tab);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.patch('/tabs/:id', requireModule('activities', 'full'), async (req, res) => {
  try {
    const tab = await ActivityTab.findOne({ where: { id: req.params.id, business_unit: req.user.business_unit } });
    if (!tab) return res.status(404).json({ message: 'Tab not found.' });
    if (req.body.label !== undefined) {
      const label = String(req.body.label || '').trim().slice(0, 64);
      if (!label) return res.status(400).json({ message: 'Tab name is required.' });
      tab.label = label;
    }
    if (req.body.sort_order !== undefined && Number.isFinite(+req.body.sort_order)) {
      tab.sort_order = +req.body.sort_order;
    }
    await tab.save();
    return res.json(tab);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.delete('/tabs/:id', requireModule('activities', 'full'), async (req, res) => {
  try {
    const tab = await ActivityTab.findOne({ where: { id: req.params.id, business_unit: req.user.business_unit } });
    if (!tab) return res.status(404).json({ message: 'Tab not found.' });
    // Refuse to delete the last tab — the board would have nowhere to render cards.
    const count = await ActivityTab.count({ where: { business_unit: req.user.business_unit } });
    if (count <= 1) return res.status(400).json({ message: 'At least one tab is required — rename this one instead.' });
    await tab.destroy(); // cards cascade via the association's onDelete
    return res.json({ message: 'Deleted.' });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// -------------------------- Cards -------------------------
function normalizePayload(body) {
  return {
    tab_id: body.tab_id ? parseInt(body.tab_id, 10) || null : null,
    title: (body.title || '').trim(),
    description: body.description || null,
    previous_steps: body.previous_steps || null,
    recent_updates: body.recent_updates || null,
    next_steps: body.next_steps || null,
    status: VALID_STATUS.has(body.status) ? body.status : 'to_do',
    priority: VALID_PRIORITY.has(body.priority) ? body.priority : null,
    // Owner is now free text (user's request). owner_id kept nullable in the schema for the few
    // legacy rows that carried a FK; new writes leave it null.
    owner_name: body.owner_name ? String(body.owner_name).trim().slice(0, 255) : null,
    owner_id: null,
    start_date: body.start_date || null,
    next_followup_date: body.next_followup_date || null,
    due_date: body.due_date || null,       // still persisted if a caller sends it, but the UI no longer does
    lead_id: body.lead_id ? parseInt(body.lead_id, 10) || null : null,
    sort_order: Number.isFinite(+body.sort_order) ? +body.sort_order : 0,
  };
}

router.get('/', requireModule('activities', 'read'), async (req, res) => {
  try {
    await ensureDefaultTab(req.user.business_unit);
    const rows = await Activity.findAll({
      where: { business_unit: req.user.business_unit },
      include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'color', 'initials'] }],
      order: [['status', 'ASC'], ['sort_order', 'ASC'], ['created_at', 'DESC']],
    });
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.post('/', requireModule('activities', 'full'), async (req, res) => {
  try {
    const payload = normalizePayload(req.body);
    if (!payload.title) return res.status(400).json({ message: 'Title is required.' });
    // If no tab supplied, drop the card into the BU's first tab (or the default we auto-create).
    if (!payload.tab_id) {
      const first = await ensureDefaultTab(req.user.business_unit);
      payload.tab_id = first.id;
    } else {
      // Cross-BU write attempt: refuse a tab_id that doesn't belong to this business.
      const tab = await ActivityTab.findOne({ where: { id: payload.tab_id, business_unit: req.user.business_unit } });
      if (!tab) return res.status(400).json({ message: 'Unknown tab.' });
    }
    const card = await Activity.create({
      ...payload,
      business_unit: req.user.business_unit,
      created_by: req.user.id,
      created_by_name: req.user.name,
    });
    const full = await Activity.findByPk(card.id, {
      include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'color', 'initials'] }],
    });

    if (payload.owner_name) {
      const { onTaskAssigned } = require('../services/notifications/rules/teamRules');
      onTaskAssigned({ card: full.toJSON(), actor: req.user, businessUnit: req.user.business_unit }).catch(() => {});
    }

    const { processMentions } = require('../services/mentions');
    for (const f of ['previous_steps', 'recent_updates', 'next_steps']) {
      if (payload[f]) {
        processMentions({
          text: payload[f], oldText: null,
          businessUnit: req.user.business_unit, actorId: req.user.id,
          entityType: 'activity', entityLabel: `Task: ${payload.title}`,
          linkPath: '/activities',
        }).catch(() => {});
      }
    }

    return res.status(201).json(full);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.patch('/:id', requireModule('activities', 'edit'), async (req, res) => {
  try {
    const card = await Activity.findOne({ where: { id: req.params.id, business_unit: req.user.business_unit } });
    if (!card) return res.status(404).json({ message: 'Card not found.' });
    const oldStatus = card.status;
    const payload = normalizePayload({ ...card.toJSON(), ...req.body });
    if (!payload.title) return res.status(400).json({ message: 'Title is required.' });
    if (payload.tab_id) {
      const tab = await ActivityTab.findOne({ where: { id: payload.tab_id, business_unit: req.user.business_unit } });
      if (!tab) return res.status(400).json({ message: 'Unknown tab.' });
    }
    if (payload.status !== oldStatus) payload.status_changed_at = new Date();
    await card.update(payload);
    const full = await Activity.findByPk(card.id, {
      include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'color', 'initials'] }],
    });

    const { onTaskStatusChange, onTaskAssigned } = require('../services/notifications/rules/teamRules');
    if (payload.status !== oldStatus) {
      onTaskStatusChange({ card: full.toJSON(), oldStatus, newStatus: payload.status, actor: req.user, businessUnit: req.user.business_unit }).catch(() => {});
    }

    const oldCard = card.toJSON();
    if (payload.owner_name && payload.owner_name !== oldCard.owner_name) {
      onTaskAssigned({ card: full.toJSON(), actor: req.user, businessUnit: req.user.business_unit }).catch(() => {});
    }

    const { processMentions } = require('../services/mentions');
    const mentionFields = ['previous_steps', 'recent_updates', 'next_steps'];
    for (const f of mentionFields) {
      if (req.body[f] !== undefined) {
        processMentions({
          text: payload[f], oldText: oldCard[f],
          businessUnit: req.user.business_unit, actorId: req.user.id,
          entityType: 'activity', entityLabel: `Task: ${payload.title}`,
          linkPath: '/activities',
        }).catch(() => {});
      }
    }

    return res.json(full);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.delete('/:id', requireModule('activities', 'full'), async (req, res) => {
  try {
    const card = await Activity.findOne({ where: { id: req.params.id, business_unit: req.user.business_unit } });
    if (!card) return res.status(404).json({ message: 'Card not found.' });
    await card.destroy();
    return res.json({ message: 'Deleted' });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
