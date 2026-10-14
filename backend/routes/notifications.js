const router = require('express').Router();
const { Notification, NotificationPreference } = require('../models');
const { authenticate } = require('../middleware/auth');
const { Op } = require('sequelize');

router.use(authenticate);

const RULE_KEYS = [
  'lead_phase_change', 'lead_reassigned', 'lead_created', 'lead_lost', 'lead_on_hold',
  'po_document_uploaded', 'renewal_due', 'renewal_created', 'stale_lead', 'stage_tat_breach',
  'followup_overdue', 'hold_ending', 'task_status_change', 'confidence_drop',
  'pipeline_below_target', 'mention', 'task_assigned',
];

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    const where = { user_id: req.user.id };
    if (req.query.unread === '1') where.is_read = false;

    const { count, rows } = await Notification.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });
    return res.json({ total: count, notifications: rows });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.get('/unread-count', async (req, res) => {
  try {
    const count = await Notification.count({ where: { user_id: req.user.id, is_read: false } });
    return res.json({ count });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.patch('/:id/read', async (req, res) => {
  try {
    const notif = await Notification.findOne({ where: { id: req.params.id, user_id: req.user.id } });
    if (!notif) return res.status(404).json({ message: 'Not found' });
    await notif.update({ is_read: true, read_at: new Date() });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.post('/read-all', async (req, res) => {
  try {
    await Notification.update(
      { is_read: true, read_at: new Date() },
      { where: { user_id: req.user.id, is_read: false } },
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.get('/preferences', async (req, res) => {
  try {
    const prefs = await NotificationPreference.findAll({ where: { user_id: req.user.id } });
    const map = {};
    for (const p of prefs) map[p.rule_key] = { enabled: p.enabled };
    for (const k of RULE_KEYS) if (!map[k]) map[k] = { enabled: true };
    return res.json(map);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.put('/preferences', async (req, res) => {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object') return res.status(400).json({ message: 'Invalid body' });

    for (const [ruleKey, val] of Object.entries(updates)) {
      if (!RULE_KEYS.includes(ruleKey)) continue;
      const enabled = val.enabled !== false;
      await NotificationPreference.upsert({
        user_id: req.user.id,
        rule_key: ruleKey,
        enabled,
      });
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
