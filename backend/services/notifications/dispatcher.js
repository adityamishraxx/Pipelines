const { Notification, NotificationPreference } = require('../../models');

// Insert a notification, silently deduping on (user_id, dedupe_key).
// Follows the "never throws" pattern from services/audit.js.
async function dispatch(notif) {
  try {
    await Notification.create(notif, {
      ignoreDuplicates: true,
    });
  } catch (e) {
    if (e.name === 'SequelizeUniqueConstraintError') return;
    console.error('[notifications] dispatch error:', e.message);
  }
}

// Dispatch to multiple users. Each gets their own row with their own dedupe_key.
async function dispatchMany(notifications) {
  for (const n of notifications) {
    await dispatch(n);
  }
}

// Check if a user has disabled a rule via preferences.
async function isRuleEnabled(userId, ruleKey) {
  try {
    const pref = await NotificationPreference.findOne({ where: { user_id: userId, rule_key: ruleKey } });
    if (!pref) return true;
    return pref.enabled !== false;
  } catch { return true; }
}

// Build a notification object (does not insert).
function build({ userId, businessUnit, ruleKey, severity, title, body, leadId, entityType, entityId, linkPath, dedupeKey }) {
  return {
    user_id: userId,
    business_unit: businessUnit,
    rule_key: ruleKey,
    severity: severity || 'info',
    title,
    body: body || null,
    lead_id: leadId || null,
    entity_type: entityType || null,
    entity_id: entityId || null,
    link_path: linkPath || null,
    dedupe_key: dedupeKey,
    is_read: false,
  };
}

// Fire-and-forget: build + check prefs + dispatch for a list of recipient user IDs.
async function notify({ recipients, businessUnit, ruleKey, severity, title, body, leadId, entityType, entityId, linkPath, dedupeKey }) {
  try {
    const notifications = [];
    for (const uid of recipients) {
      const enabled = await isRuleEnabled(uid, ruleKey);
      if (!enabled) continue;
      notifications.push(build({
        userId: uid, businessUnit, ruleKey, severity, title, body,
        leadId, entityType, entityId, linkPath, dedupeKey,
      }));
    }
    await dispatchMany(notifications);
  } catch (e) {
    console.error('[notifications] notify error:', e.message);
  }
}

module.exports = { dispatch, dispatchMany, build, notify, isRuleEnabled };
