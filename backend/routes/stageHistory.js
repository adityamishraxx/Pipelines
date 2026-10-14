const router = require('express').Router();
const { StageHistory, Lead } = require('../models');
const { authenticate, requireAnyModule } = require('../middleware/auth');
const { leadScopeWhere } = require('../middleware/scope');
const { Op } = require('sequelize');

router.use(authenticate);

// GET /api/stage-history — all transitions, scoped to the caller's own
// leads for BDs. Powers the dashboard funnel, bottlenecks, and rotting
// alerts (all computed client-side from this raw feed).
router.get('/', requireAnyModule(['leads', 'dashboard', 'reports'], 'read'), async (req, res) => {
  try {
    const leadWhere = leadScopeWhere(req.user);
    const leadIds = (await Lead.findAll({ where: leadWhere, attributes: ['id'] })).map(l => l.id);

    const rows = await StageHistory.findAll({
      where: { lead_id: { [Op.in]: leadIds } },
      order: [['changed_at', 'ASC']],
    });
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
