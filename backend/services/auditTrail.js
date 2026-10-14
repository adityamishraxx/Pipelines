const { ChangeLog } = require('../models');

const SKIP_FIELDS = new Set([
  'id', 'createdAt', 'updatedAt', 'created_at', 'updated_at', 'created_by', 'updated_by',
]);

function stringify(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

/**
 * Compare oldData vs newData field-by-field and insert a change_log row for
 * each changed field.  Designed to never throw — failures are logged, not propagated.
 */
async function logChanges({ entityType, entityId, oldData, newData, userId, userName, businessUnit }) {
  try {
    const rows = [];
    const allKeys = new Set([...Object.keys(oldData || {}), ...Object.keys(newData || {})]);

    for (const key of allKeys) {
      if (SKIP_FIELDS.has(key)) continue;

      const oldVal = stringify(oldData ? oldData[key] : null);
      const newVal = stringify(newData ? newData[key] : null);

      // Both null/undefined — no change
      if (oldVal === null && newVal === null) continue;
      // Same string representation — no change
      if (oldVal === newVal) continue;

      rows.push({
        entity_type: entityType,
        entity_id: entityId,
        field_name: key,
        old_value: oldVal,
        new_value: newVal,
        changed_by: userId,
        changed_by_name: userName,
        business_unit: businessUnit,
      });
    }

    if (rows.length > 0) {
      await ChangeLog.bulkCreate(rows);
    }
  } catch (err) {
    console.error('[auditTrail] logChanges failed:', err.message);
  }
}

module.exports = { logChanges };
