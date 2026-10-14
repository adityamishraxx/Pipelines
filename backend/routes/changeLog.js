const router = require('express').Router();
const { ChangeLog } = require('../models');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// GET /api/change-log?entity_type=lead&entity_id=123
router.get('/', async (req, res) => {
  try {
    const { entity_type, entity_id } = req.query;
    if (!entity_type || !entity_id) {
      return res.status(400).json({ message: 'entity_type and entity_id are required' });
    }

    const rows = await ChangeLog.findAll({
      where: {
        entity_type,
        entity_id: Number(entity_id),
        business_unit: req.user.business_unit,
      },
      order: [['created_at', 'DESC']],
    });

    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
