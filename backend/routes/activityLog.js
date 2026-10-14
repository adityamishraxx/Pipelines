const router = require('express').Router();
const { ActivityLog, Lead, User } = require('../models');
const { Op, fn, col } = require('sequelize');
const { authenticate, adminOnly, requireAnyModule } = require('../middleware/auth');
const { isSuperAdmin, canSeeActivityFeed } = require('../services/permissions');
const { ENTITY_TYPES, ENTITY_LABELS, ADMIN_ONLY_TYPES } = require('../services/audit');

router.use(authenticate);

const canReadLeadData = requireAnyModule(['leads', 'dashboard', 'reports'], 'read');

// Is this caller admin-tier for permission visibility? Only Business Admin and Global Admin see
// permission entries — a Manager with activity-feed access sees leads/chains/SLA but NOT who
// has what access, because that is as sensitive as the Settings screen itself.
const isAdminTier = (u) => ['super_admin', 'business_admin'].includes(u.role) || isSuperAdmin(u);

// The global feed (J1) is gated separately from lead-read: Business Admin / Global Admin by role,
// Manager only if granted, Team Member never. The per-lead Activity tab (GET /) is unaffected.
function requireActivityFeed(req, res, next) {
  if (canSeeActivityFeed(req.user)) return next();
  return res.status(403).json({ message: 'You do not have access to the platform activity feed.' });
}

// GET /api/activity-log?lead_id=123 — the per-lead Activity tab. Unchanged.
router.get('/', canReadLeadData, async (req, res) => {
  try {
    const { lead_id } = req.query;
    if (!lead_id) return res.status(400).json({ message: 'lead_id is required' });

    const lead = await Lead.findByPk(lead_id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    if (req.user.role === 'bd' && lead.owner_id !== req.user.id) return res.status(403).json({ message: 'Forbidden' });

    const rows = await ActivityLog.findAll({ where: { lead_id }, order: [['createdAt', 'DESC']] });
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// --------------------------------------------------------------------------
// GET /api/activity-log/feed — the global cross-user feed.
//
// Visibility is built from what the caller can already reach, never widened:
//   * lead events    — only leads they can see (their platform, and only their own if a BD)
//   * chain / SLA    — only their platform, unless they are cross-platform
//   * permissions    — admin tier only, and filtered out entirely for everyone else
//
// Query: ?limit= &before= (cursor) &user= &platform= &type= &from= &to=
// Newest first. `before` is the id of the last row already shown, which pages
// consistently even while new events arrive at the top.
// --------------------------------------------------------------------------
router.get('/feed', requireActivityFeed, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const admin = isAdminTier(req.user);
    const and = [];

    // --- category ---
    const visibleTypes = ENTITY_TYPES.filter(t => admin || !ADMIN_ONLY_TYPES.includes(t));
    const requested = (req.query.type || '').split(',').map(s => s.trim()).filter(Boolean);
    const types = requested.length ? requested.filter(t => visibleTypes.includes(t)) : visibleTypes;
    if (!types.length) return res.json({ entries: [], nextCursor: null, hasMore: false });
    and.push({ entity_type: { [Op.in]: types } });

    // --- platform ---
    // Scoped to the business the caller signed into. NULL-business entries (cross-platform admin
    // actions like Super Admin grants) are included only when they are admin-only types — lead,
    // chain, and SLA events must always carry a business_unit and never leak across platforms.
    and.push({
      [Op.or]: [
        { business_unit: req.user.business_unit },
        ...(admin ? [{ business_unit: null, entity_type: { [Op.in]: ADMIN_ONLY_TYPES } }] : []),
      ],
    });

    // --- BD scoping: a BD only ever sees activity on leads they own ---
    if (req.user.role === 'bd') {
      const own = await Lead.findAll({ where: { owner_id: req.user.id }, attributes: ['id'] });
      const ids = own.map(l => l.id);
      and.push({
        [Op.or]: [
          { entity_type: { [Op.ne]: 'lead' } },
          ids.length ? { lead_id: { [Op.in]: ids } } : { lead_id: null },
        ],
      });
    }

    // --- filters ---
    // Prefer filtering by account id — two accounts share the name "PMO", so a name filter alone
    // would conflate them. The name filter stays for rows predating migration 023.
    if (req.query.user_id) and.push({ user_id: parseInt(req.query.user_id, 10) });
    else if (req.query.user) and.push({ user_name: req.query.user });
    if (req.query.from) and.push({ createdAt: { [Op.gte]: new Date(`${req.query.from}T00:00:00`) } });
    if (req.query.to)   and.push({ createdAt: { [Op.lte]: new Date(`${req.query.to}T23:59:59`) } });
    if (req.query.before) and.push({ id: { [Op.lt]: parseInt(req.query.before, 10) } });

    // Fetch one extra to tell whether another page exists without a second count query.
    const rows = await ActivityLog.findAll({
      where: and.length ? { [Op.and]: and } : undefined,
      order: [['id', 'DESC']],
      limit: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const entries = page.map(r => ({
      id: r.id,
      type: r.entity_type,
      typeLabel: ENTITY_LABELS[r.entity_type] || r.entity_type,
      user: r.user_name,
      userId: r.user_id,
      userEmail: r.user_email,
      subject: r.customer_name,          // lead/property name, chain name, or affected user
      leadId: r.lead_id,                 // set for lead events, so the UI can link back
      entityId: r.entity_id,
      businessUnit: r.business_unit,
      action: r.action_type,
      field: r.field_changed,
      from: r.old_value,
      to: r.new_value,
      note: r.note,
      at: r.createdAt,
    }));

    return res.json({
      entries,
      nextCursor: hasMore ? page[page.length - 1].id : null,
      hasMore,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// GET /api/activity-log/feed/filters — the option lists the filter bar offers.
//
// The user list is the whole TEAM in scope, not only the people who happen to have made a change.
// Listing everyone means "has this person touched anything?" is a question the filter can answer —
// selecting someone with nothing to their name returns an explicit empty result rather than that
// person being silently missing from the dropdown. Each option carries its own count so the UI can
// say so up front.
router.get('/feed/filters', requireActivityFeed, async (req, res) => {
  try {
    const admin = isAdminTier(req.user);
    // Scoped to the business the caller signed into, matching the feed query above.
    const where = {
      [Op.or]: [
        { business_unit: req.user.business_unit },
        ...(admin ? [{ business_unit: null, entity_type: { [Op.in]: ADMIN_ONLY_TYPES } }] : []),
      ],
    };

    // How many visible events each account is responsible for.
    const counted = await ActivityLog.findAll({
      where,
      attributes: ['user_id', 'user_name', 'user_email', [fn('COUNT', col('id')), 'n']],
      group: ['user_id', 'user_name', 'user_email'],
      raw: true,
    });
    const byId = new Map();
    const orphans = [];                       // actors with no matching account row (deleted, legacy)
    for (const r of counted) {
      if (r.user_id != null) byId.set(r.user_id, Number(r.n));
      else if (r.user_name) orphans.push({ id: null, name: r.user_name, email: r.user_email, businessUnit: null, count: Number(r.n) });
    }

    // Everyone the caller could plausibly be asking about — the roster of their own business. A BD
    // sees only their own lead activity, but the roster is still the platform's, so "nobody else
    // has touched my platform" is an answer the filter can give.
    const people = await User.findAll({
      where: { business_unit: req.user.business_unit },
      attributes: ['id', 'name', 'email', 'business_unit', 'active'],
      order: [['name', 'ASC']],
    });

    const users = people
      // Skip dormant accounts that never did anything (the "Unassigned" placeholder BD, disabled
      // users who left no trace) — they would be noise, not a meaningful filter.
      .filter(u => u.active || byId.has(u.id))
      .map(u => ({
        id: u.id, name: u.name, email: u.email, businessUnit: u.business_unit,
        active: u.active, count: byId.get(u.id) || 0,
      }))
      .concat(orphans)
      // Contributors first (most active at the top), then everyone else alphabetically.
      .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));

    return res.json({
      users,
      platforms: [req.user.business_unit],
      types: ENTITY_TYPES
        .filter(t => admin || !ADMIN_ONLY_TYPES.includes(t))
        .map(t => ({ value: t, label: ENTITY_LABELS[t] })),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
