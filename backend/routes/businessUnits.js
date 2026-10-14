// Business Units (migration 028) — the dynamic replacement for the former
// ENUM('signage','jhes','surveillance'). Phase 1 shipped the read-only list; Phase 2 adds the
// admin management surface: create, edit, status changes (disable / archive / reactivate),
// safe deletion, and clone-from-template.
//
// Authorization: the plain list (GET /) is PUBLIC because the login and SSO account-chooser screens
// need it before anyone is signed in. Everything else requires a signed-in GLOBAL ADMIN
// (super_admin scope). A Read-only Global Admin is blocked from all writes centrally in
// authenticate() (non-GET methods 403), so viewing is fine but mutating is not.
const router = require('express').Router();
const { Op } = require('sequelize');
const { BusinessUnit, User, Lead, GlobalPo, Voc, DropdownOption, SlaConfig, ServiceDefinition, sequelize } = require('../models');
const { authenticate, isSuperAdmin, isSuperAdminWrite } = require('../middleware/auth');
const { STAGES_WITH_SLA, DEFAULT_SLA } = require('../services/scoring');
const { FIELD_SECTIONS, FIELD_CATALOG, FIELD_TYPES, MODULE_CATALOG, DASHBOARD_CATALOG, REPORT_CATALOG } = require('../services/fieldCatalog');

// A slug is the stable key other tables point at. Lowercase letters, digits, hyphen/underscore only.
const SLUG_RE = /^[a-z][a-z0-9_-]{1,31}$/;
const STATUSES = ['active', 'disabled', 'archived'];

// Only a Global Admin may reach the management endpoints.
function globalAdminOnly(req, res, next) {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  if (isSuperAdmin(req.user)) return next();
  return res.status(403).json({ message: 'Only a Global Admin can manage business units.' });
}

// Looser gate for the management surface a Business Admin ALSO has access to — they can view/edit
// their OWN business unit (name/description/color/business_type/modules + template) but nothing else.
// Create, Clone, Status change, Delete all remain Global-Admin-only via `globalAdminOnly` below.
function managerOfBusinessUnit(req, res, next) {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  if (isSuperAdmin(req.user)) return next();
  if (req.user.role === 'business_admin') return next();
  return res.status(403).json({ message: 'Only a Global Admin or Business Admin can manage business units.' });
}

// Ensures a Business Admin acting on a specific :slug is only touching their OWN BU. A Global Admin
// passes freely. Returns 403 otherwise.
function ensureOwnBuForBa(req, res, next) {
  if (isSuperAdmin(req.user)) return next();
  if (req.user.role === 'business_admin' && req.user.business_unit === req.params.slug) return next();
  return res.status(403).json({ message: 'You can only manage your own business unit.' });
}

// Emails that belong to a Global Admin — their per-business accounts are auto-provisioned convenience
// rows, not real business users, so they don't count toward the deletion gate and are cascaded away.
async function globalAdminEmails() {
  const rows = await User.findAll({ where: { super_admin_scope: { [Op.ne]: null }, email: { [Op.ne]: null } }, attributes: ['email'] });
  return [...new Set(rows.map(r => r.email))];
}

// Count everything that references a business unit — used both for the safe-deletion gate and to
// show the admin what a unit holds. The user count excludes auto-provisioned Global Admin accounts
// (but keeps real users, including BDs whose email is null).
async function usageFor(slug) {
  const gaEmails = await globalAdminEmails();
  const userWhere = gaEmails.length
    ? { business_unit: slug, [Op.or]: [{ email: { [Op.notIn]: gaEmails } }, { email: null }] }
    : { business_unit: slug };
  const [users, leads, chains, vocs, dropdowns, slas] = await Promise.all([
    User.count({ where: userWhere }),
    Lead.count({ where: { business_unit: slug } }),
    GlobalPo.count({ where: { business_unit: slug } }),
    Voc.count({ where: { business_unit: slug } }),
    DropdownOption.count({ where: { business_unit: slug } }),
    SlaConfig.count({ where: { business_unit: slug } }),
  ]);
  // Uploaded PO documents live on lead rows (leads.po_document_url), so the leads count covers them.
  return { users, leads, chains, vocs, dropdowns, slas };
}

// Transactional data blocks a hard delete (never silently orphan real records). Config-only rows
// (dropdowns, SLA) do not block — they are cascaded on an explicit confirmed delete.
function hasTransactionalData(u) {
  return u.users > 0 || u.leads > 0 || u.chains > 0 || u.vocs > 0;
}

// Auto-provision every Global Admin as a Business Admin inside a business unit, so a GA can sign into
// (and switch to) any business. Their name/email/mobile/password are copied so they log in with their
// usual credentials; any GA who already has an account there is skipped. (Local/dev creates the row
// directly; the production STB user-sync is intentionally not invoked from here.)
async function ensureGlobalAdminAccounts(slug, t) {
  const gas = await User.findAll({
    where: { super_admin_scope: { [Op.ne]: null }, email: { [Op.ne]: null }, active: true },
    transaction: t,
  });
  const seen = new Set();
  for (const g of gas) {
    if (seen.has(g.email)) continue;
    seen.add(g.email);
    const exists = await User.findOne({ where: { email: g.email, business_unit: slug }, transaction: t });
    if (exists) continue;
    await User.create({
      name: g.name, email: g.email, mobile: g.mobile, business_unit: slug,
      role: 'business_admin', password_hash: g.password_hash, initials: g.initials,
      color: g.color, active: true, super_admin_scope: g.super_admin_scope,
    }, { transaction: t });
  }
}

// GET /api/business-units[?status=active] — PUBLIC. Non-sensitive presentation fields only.
router.get('/', async (req, res) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    const rows = await BusinessUnit.findAll({
      where,
      attributes: ['slug', 'name', 'description', 'color', 'status', 'sort_order'],
      order: [['sort_order', 'ASC'], ['name', 'ASC']],
    });
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// The effective form schema for a unit: its stored schema, or a default generated from the field
// catalog so the three originals (which predate the wizard) are still renderable and editable.
function resolveFormSchema(bu) {
  if (bu.config && bu.config.formSchema && Array.isArray(bu.config.formSchema.sections)) return bu.config.formSchema;
  return {
    sections: FIELD_SECTIONS.map(sec => ({
      key: sec.key, label: sec.label, enabled: true, custom: false,
      fields: sec.fields.map(f => ({ slug: f.slug, label: f.label, type: f.type, options: f.options || null, core: true, custom: false, enabled: true, mandatory: false })),
    })),
  };
}
const isOriginalSlug = (slug) => ['signage', 'jhes', 'surveillance'].includes(slug);

// GET /api/business-units/:slug/config — resolved config (form schema, services, modules) for one
// unit. Any authenticated user may read it: the lead form needs their own business's schema. This is
// registered BEFORE the global-admin gate below so business users can reach it.
router.get('/:slug/config', authenticate, async (req, res) => {
  try {
    const bu = await BusinessUnit.findOne({ where: { slug: req.params.slug } });
    if (!bu) return res.status(404).json({ message: 'Business unit not found' });
    const svc = await ServiceDefinition.findAll({ where: { business_unit: bu.slug, active: true }, order: [['sort_order', 'ASC']] });
    const cfg = bu.config || {};
    return res.json({
      slug: bu.slug, name: bu.name, color: bu.color, status: bu.status,
      isOriginal: isOriginalSlug(bu.slug),
      formSchema: resolveFormSchema(bu),
      services: svc.map(s => ({ slug: s.slug, label: s.label, nature: s.nature, hardware: !!s.hardware, category: s.category || (s.hardware ? 'hardware' : 'software') })),
      modules: cfg.modules || null,
      workflow: cfg.workflow || null,
      dashboards: cfg.dashboards || null,
      reports: cfg.reports || null,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// Everything below requires a signed-in user. Global Admin may do everything; Business Admin can
// only Edit / Edit template on their OWN BU — Create / Clone / Delete / Status change / list all
// stay Global-Admin-only via per-route guards further down.
router.use(authenticate, managerOfBusinessUnit);

// GET /api/business-units/catalog — the option set the creation wizard offers, derived from what
// already exists: the UNION of every unit's services (from service_definitions), the field union,
// the module list, and the dashboard/report option lists. A service or field added to an existing
// unit later shows up here automatically.
// Read-only reference data (field/service/module catalog) — both Global Admin and Business Admin
// need it: the Business Admin uses it to populate the Edit Template modal for their OWN BU.
router.get('/catalog', async (req, res) => {
  try {
    const svc = await ServiceDefinition.findAll({ where: { active: true }, order: [['sort_order', 'ASC'], ['label', 'ASC']] });
    const bySlug = new Map();
    for (const s of svc) {
      if (!bySlug.has(s.slug)) bySlug.set(s.slug, { slug: s.slug, label: s.label, nature: s.nature, usedBy: [] });
      bySlug.get(s.slug).usedBy.push(s.business_unit);
    }
    // Templates a new unit can start from: each existing unit, with the service slugs it uses, so the
    // wizard can pre-select "start from Signage" etc. "Union of all" is the default (handled client-side).
    const bus = await BusinessUnit.findAll({ attributes: ['slug', 'name', 'status'], order: [['sort_order', 'ASC']] });
    const templates = bus.map(b => ({
      slug: b.slug, name: b.name, status: b.status,
      serviceSlugs: [...bySlug.values()].filter(s => s.usedBy.includes(b.slug)).map(s => s.slug),
    }));

    return res.json({
      fieldSections: FIELD_SECTIONS,
      fields: FIELD_CATALOG,
      fieldTypes: FIELD_TYPES,
      services: [...bySlug.values()],
      modules: MODULE_CATALOG,
      dashboards: DASHBOARD_CATALOG,
      reports: REPORT_CATALOG,
      templates,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// GET /api/business-units/manage — full rows plus a usage summary, for the management page.
// A Global Admin sees every unit; a Business Admin sees only their own BU (scoped server-side so a
// crafted request can't fetch other units' configs).
router.get('/manage', async (req, res) => {
  try {
    const where = isSuperAdmin(req.user) ? {} : { slug: req.user.business_unit };
    const rows = await BusinessUnit.findAll({ where, order: [['sort_order', 'ASC'], ['name', 'ASC']] });
    const out = await Promise.all(rows.map(async (b) => ({
      ...b.toJSON(),
      usage: await usageFor(b.slug),
    })));
    return res.json(out);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// GET /api/business-units/:slug/usage — the safe-deletion preview for one unit. Global-Admin-only
// since the preview feeds the Delete flow, which is also GA-only.
router.get('/:slug/usage', globalAdminOnly, async (req, res) => {
  try {
    const bu = await BusinessUnit.findOne({ where: { slug: req.params.slug } });
    if (!bu) return res.status(404).json({ message: 'Business unit not found' });
    const usage = await usageFor(bu.slug);
    return res.json({ slug: bu.slug, usage, deletable: !hasTransactionalData(usage) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// POST /api/business-units — create a new business unit. Seeds default per-stage SLA so the unit is
// immediately usable by the confidence engine. Accepts an optional `config` from the creation wizard
// (fields / services / modules / dashboards / reports / workflow); when present it is stored on the
// unit and its enabled services are written to service_definitions so they flow through the app.
router.post('/', globalAdminOnly, async (req, res) => {
  try {
    const { slug, name, description, color, business_type, owner_id, sort_order, config } = req.body;
    const s = String(slug || '').trim().toLowerCase();
    if (!SLUG_RE.test(s)) {
      return res.status(400).json({ message: 'Slug must start with a letter and use only lowercase letters, digits, hyphen or underscore (2-32 chars).' });
    }
    if (!name || !String(name).trim()) return res.status(400).json({ message: 'Name is required' });

    const existing = await BusinessUnit.findOne({ where: { slug: s } });
    if (existing) return res.status(409).json({ message: `A business unit with slug "${s}" already exists.` });

    const maxOrder = (await BusinessUnit.max('sort_order')) || 0;
    const created = await sequelize.transaction(async (t) => {
      const bu = await BusinessUnit.create({
        slug: s,
        name: String(name).trim(),
        description: description || null,
        color: color || '#6366f1',
        status: 'active',
        business_type: business_type || null,
        owner_id: owner_id || null,
        config: config && typeof config === 'object' ? config : null,
        sort_order: Number.isFinite(+sort_order) ? +sort_order : maxOrder + 1,
      }, { transaction: t });

      // Seed default SLA (days-per-stage) so scoring works from day one.
      for (const stage of STAGES_WITH_SLA) {
        await SlaConfig.create({ business_unit: s, stage, sla_days: DEFAULT_SLA[stage] }, { transaction: t });
      }

      // Seed sensible default dropdowns so the lead form is usable immediately. These are fully
      // editable by the admin afterwards (and the form can add new values on the fly).
      const DEFAULT_DROPDOWNS = {
        lead_source:      ['Channel Partner', 'Direct Sales', 'Referral', 'Website', 'Cold Outreach'],
        lead_temperature: ['Hot', 'Warm', 'Cold'],
        new_or_renewal:   ['New', 'Renewal', 'Expansion'],
      };
      for (const [field, values] of Object.entries(DEFAULT_DROPDOWNS)) {
        for (let i = 0; i < values.length; i++) {
          await DropdownOption.create({ field_name: field, business_unit: s, value: values[i], sort_order: i + 1, active: true }, { transaction: t });
        }
      }

      // Write the enabled services (wizard selections + any custom ones) to the unit's catalogue.
      const services = Array.isArray(config?.services) ? config.services.filter(x => x && x.enabled && x.slug) : [];
      let order = 0;
      for (const svc of services) {
        const category = ['hardware', 'software', 'hardware_software'].includes(svc.category) ? svc.category : (svc.hardware ? 'hardware' : 'software');
        await ServiceDefinition.create({
          business_unit: s,
          slug: String(svc.slug).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 64),
          label: String(svc.label || svc.slug).trim().slice(0, 128),
          nature: svc.nature === 'capex' ? 'capex' : 'opex',
          category,
          hardware: category === 'hardware' || category === 'hardware_software',
          sort_order: ++order,
        }, { transaction: t });
      }

      // Give every Global Admin an account here so they can sign in to / switch to this business.
      await ensureGlobalAdminAccounts(s, t);
      return bu;
    });

    return res.status(201).json(created);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// PUT /api/business-units/:slug — edit presentation/status. Slug is immutable (it is the FK target).
// A Business Admin may only edit their OWN slug (ensureOwnBuForBa) and may NOT change status (that is
// a Global-Admin-only lever — disable/archive/activate are server-blocked below for a BA).
router.put('/:slug', ensureOwnBuForBa, async (req, res) => {
  try {
    const bu = await BusinessUnit.findOne({ where: { slug: req.params.slug } });
    if (!bu) return res.status(404).json({ message: 'Business unit not found' });

    const { name, description, color, status, business_type, owner_id, sort_order, config } = req.body;
    if (status !== undefined && !STATUSES.includes(status)) {
      return res.status(400).json({ message: `Status must be one of: ${STATUSES.join(', ')}` });
    }
    // Only a Global Admin can transition status (disable / archive / reactivate).
    if (status !== undefined && !isSuperAdmin(req.user)) {
      return res.status(403).json({ message: 'Only a Global Admin can change the status of a business unit.' });
    }
    if (name !== undefined && !String(name).trim()) return res.status(400).json({ message: 'Name cannot be empty' });

    const patch = {};
    if (name !== undefined) patch.name = String(name).trim();
    if (description !== undefined) patch.description = description || null;
    if (color !== undefined) patch.color = color || '#6366f1';
    if (status !== undefined) patch.status = status;
    if (business_type !== undefined) patch.business_type = business_type || null;
    if (owner_id !== undefined) patch.owner_id = owner_id || null;
    if (sort_order !== undefined && Number.isFinite(+sort_order)) patch.sort_order = +sort_order;
    // config carries the editable template (formSchema) + modules/dashboards/reports/workflow. Merge
    // it over any existing config so a partial save doesn't wipe other keys.
    if (config && typeof config === 'object') patch.config = { ...(bu.config || {}), ...config };

    await sequelize.transaction(async (t) => {
      await bu.update(patch, { transaction: t });
      // If the edit changed the services list, re-sync the unit's catalogue (enabled services only).
      // This only affects what the form offers, not existing lead data.
      if (config && Array.isArray(config.services)) {
        await ServiceDefinition.destroy({ where: { business_unit: bu.slug }, transaction: t });
        let order = 0;
        for (const svc of config.services.filter(x => x && x.enabled && x.slug)) {
          const category = ['hardware', 'software', 'hardware_software'].includes(svc.category) ? svc.category : (svc.hardware ? 'hardware' : 'software');
          await ServiceDefinition.create({
            business_unit: bu.slug,
            slug: String(svc.slug).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 64),
            label: String(svc.label || svc.slug).trim().slice(0, 128),
            nature: svc.nature === 'capex' ? 'capex' : 'opex',
            category,
            hardware: category === 'hardware' || category === 'hardware_software',
            sort_order: ++order,
          }, { transaction: t });
        }
      }
    });
    return res.json(bu);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// DELETE /api/business-units/:slug — safe deletion.
//   * If any users / leads / chains / VOCs exist, the delete is BLOCKED (409) with the usage report;
//     the admin should Archive instead. We never silently orphan real records.
//   * If only config rows (dropdowns, SLA) exist, the caller must pass ?confirm=<slug> to proceed;
//     those config rows are then cascade-removed inside the same transaction.
router.delete('/:slug', globalAdminOnly, async (req, res) => {
  try {
    if (!isSuperAdminWrite(req.user)) {
      return res.status(403).json({ message: 'Your Global Admin access is Read-only — you cannot delete a business unit.' });
    }
    const bu = await BusinessUnit.findOne({ where: { slug: req.params.slug } });
    if (!bu) return res.status(404).json({ message: 'Business unit not found' });

    const usage = await usageFor(bu.slug);
    if (hasTransactionalData(usage)) {
      return res.status(409).json({
        message: 'This business unit still holds data and cannot be deleted. Archive it instead to keep the records read-only.',
        usage, deletable: false,
      });
    }

    const confirm = req.query.confirm || req.body?.confirm;
    if (confirm !== bu.slug) {
      return res.status(400).json({
        message: `Deletion needs confirmation. Re-send with confirm="${bu.slug}". Config rows (dropdowns, SLA) will be removed.`,
        usage, requiresConfirm: true,
      });
    }

    const gaEmails = await globalAdminEmails();
    await sequelize.transaction(async (t) => {
      // Remove the auto-provisioned Global Admin accounts for this unit (they don't block deletion).
      if (gaEmails.length) {
        await User.destroy({ where: { business_unit: bu.slug, email: { [Op.in]: gaEmails } }, transaction: t });
      }
      await DropdownOption.destroy({ where: { business_unit: bu.slug }, transaction: t });
      await SlaConfig.destroy({ where: { business_unit: bu.slug }, transaction: t });
      await bu.destroy({ transaction: t });
    });
    return res.json({ message: `Business unit "${bu.slug}" deleted.`, usage });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// POST /api/business-units/:slug/clone — create a new unit from an existing one's CONFIG only.
// Copies dropdown options and SLA config; never copies users or transactional data (leads/chains/VOCs).
router.post('/:slug/clone', globalAdminOnly, async (req, res) => {
  try {
    const source = await BusinessUnit.findOne({ where: { slug: req.params.slug } });
    if (!source) return res.status(404).json({ message: 'Source business unit not found' });

    const { slug, name } = req.body;
    const s = String(slug || '').trim().toLowerCase();
    if (!SLUG_RE.test(s)) {
      return res.status(400).json({ message: 'New slug must start with a letter and use only lowercase letters, digits, hyphen or underscore (2-32 chars).' });
    }
    if (!name || !String(name).trim()) return res.status(400).json({ message: 'New name is required' });
    if (await BusinessUnit.findOne({ where: { slug: s } })) {
      return res.status(409).json({ message: `A business unit with slug "${s}" already exists.` });
    }

    const maxOrder = (await BusinessUnit.max('sort_order')) || 0;
    const created = await sequelize.transaction(async (t) => {
      const bu = await BusinessUnit.create({
        slug: s,
        name: String(name).trim(),
        description: source.description,
        color: source.color,
        status: 'active',
        business_type: source.business_type,
        config: source.config,
        sort_order: maxOrder + 1,
      }, { transaction: t });

      // Clone dropdown options (per-field lists) from the source unit.
      const opts = await DropdownOption.findAll({ where: { business_unit: source.slug }, transaction: t });
      for (const o of opts) {
        await DropdownOption.create({
          field_name: o.field_name, business_unit: s, value: o.value,
          sort_order: o.sort_order, active: o.active,
        }, { transaction: t });
      }

      // Clone SLA config; fall back to defaults for any stage the source is missing.
      const slas = await SlaConfig.findAll({ where: { business_unit: source.slug }, transaction: t });
      const byStage = Object.fromEntries(slas.map(r => [r.stage, Number(r.sla_days)]));
      for (const stage of STAGES_WITH_SLA) {
        await SlaConfig.create({
          business_unit: s, stage, sla_days: byStage[stage] != null ? byStage[stage] : DEFAULT_SLA[stage],
        }, { transaction: t });
      }

      // Global Admins get an account in the clone too.
      await ensureGlobalAdminAccounts(s, t);
      return bu;
    });

    return res.status(201).json(created);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
