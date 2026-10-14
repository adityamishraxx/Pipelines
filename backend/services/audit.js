// ---------------------------------------------------------------------------
// Audit — the one way anything in the app records a change.
//
// Everything lands in activity_log (widened by migration 022), so the per-lead
// Activity tab and the global feed read the same store and can never disagree
// about what happened.
//
// Entry shape is the same whatever changed — who, what field, old → new, when —
// with `entity_type` as the category tag that keeps a mixed feed readable.
// ---------------------------------------------------------------------------
const { ActivityLog } = require('../models');

// The categories the feed knows about. Adding one here makes it filterable and
// taggable everywhere without touching the feed endpoint or the UI.
const ENTITY_TYPES = ['lead', 'chain', 'permissions', 'sla'];

const ENTITY_LABELS = {
  lead: 'Lead',
  chain: 'Chain',
  permissions: 'Permissions',
  sla: 'SLA Config',
};

// Categories only the admin tier may see. Permission changes reveal who can do
// what, which is exactly as sensitive as the settings that produce them.
const ADMIN_ONLY_TYPES = ['permissions'];

// Record one change. Never throws: an audit failure must not roll back or break
// the operation the user actually asked for — it is logged and swallowed.
// `transaction` is passed through when the caller is already inside one.
async function record({
  actor,            // the req.user performing the change
  entityType,       // 'lead' | 'chain' | 'permissions' | 'sla'
  entityId,         // id of the thing that changed
  subject,          // human label for it — lead/property name, chain name, user name
  businessUnit,     // platform it belongs to; null = cross-platform (admin-only in the feed)
  action,           // action_type, e.g. 'field_update', 'chain_created'
  field,            // which field changed, in human words
  from,             // old value
  to,               // new value
  note,             // optional free text
  leadId,           // set for lead events so the per-lead tab still finds them
  transaction,
}) {
  try {
    await ActivityLog.create({
      lead_id: leadId ?? (entityType === 'lead' ? entityId : null),
      entity_type: entityType,
      entity_id: entityId ?? null,
      business_unit: businessUnit ?? null,
      customer_name: subject ?? null,
      user_name: actor?.name || 'System',
      user_id: actor?.id ?? null,
      user_email: actor?.email ?? null,
      action_type: action || 'field_update',
      field_changed: field ?? null,
      old_value: from === undefined || from === null ? null : String(from),
      new_value: to === undefined || to === null ? null : String(to),
      note: note ?? null,
    }, transaction ? { transaction } : undefined);
  } catch (err) {
    // Deliberately swallowed — see above.
    console.error('[audit] could not record entry:', err.message);
  }
}

// Did this field actually change? Numbers are compared numerically, because a DECIMAL column
// reads back as "8.00" while the form posts 8 — string-comparing those logs a change that never
// happened. Everything else compares as a trimmed string, with null/undefined/'' all equal.
function unchanged(from, to) {
  const a = from ?? '';
  const b = to ?? '';
  const na = Number(a);
  const nb = Number(b);
  if (a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  return String(a).trim() === String(b).trim();
}

// Record several field changes from one save, as separate entries so each reads
// as "field: old → new" in the feed. Pairs where nothing changed are skipped.
async function recordDiff(base, changes) {
  for (const c of changes) {
    if (unchanged(c.from, c.to)) continue;
    await record({ ...base, field: c.field, from: c.from, to: c.to });
  }
}

module.exports = { record, recordDiff, ENTITY_TYPES, ENTITY_LABELS, ADMIN_ONLY_TYPES };
