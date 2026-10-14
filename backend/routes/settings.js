const router = require('express').Router();
const { Setting } = require('../models');
const { authenticate, adminOnly } = require('../middleware/auth');

router.use(authenticate);

// GET /api/settings — key/value map.
router.get('/', async (req, res) => {
  try {
    const rows = await Setting.findAll();
    const map = {};
    for (const r of rows) map[r.key_name] = r.value;
    return res.json(map);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// PUT /api/settings/:key — admin/PMO only. Body: { value }
router.put('/:key', adminOnly, async (req, res) => {
  try {
    const { value } = req.body;
    if (value === undefined) return res.status(400).json({ message: 'value is required' });

    const stored = String(value);
    const [setting] = await Setting.findOrCreate({ where: { key_name: req.params.key }, defaults: { value: stored } });
    if (setting.value !== stored) {
      setting.value = stored;
      await setting.save();
    }
    return res.json({ key: setting.key_name, value: setting.value });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
