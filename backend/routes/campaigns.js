const router = require('express').Router();
const { sequelize, Campaign } = require('../models');
const { authenticate, requireModule } = require('../middleware/auth');
const { QueryTypes } = require('sequelize');

router.use(authenticate);
router.use(requireModule('campaigns', 'read'));

// GET /api/campaigns — list with lead stats
router.get('/', async (req, res) => {
  try {
    const bu = req.user.business_unit;
    const campaigns = await sequelize.query(`
      SELECT
        c.id, c.name, c.description, c.start_date, c.end_date,
        c.budget_lakhs, c.status, c.created_at, c.updated_at,
        COALESCE(s.lead_count, 0)   AS lead_count,
        COALESCE(s.won_count, 0)    AS won_count,
        COALESCE(s.revenue_lakhs, 0) AS revenue_lakhs
      FROM campaigns c
      LEFT JOIN (
        SELECT campaign_id,
               COUNT(*)                                       AS lead_count,
               SUM(CASE WHEN phase = 'PO Received' THEN 1 ELSE 0 END) AS won_count,
               SUM(CASE WHEN phase = 'PO Received' THEN COALESCE(po_actual_value_lakhs, potential_tcv_lakhs, 0) ELSE 0 END) AS revenue_lakhs
        FROM leads
        WHERE business_unit = :bu AND campaign_id IS NOT NULL
        GROUP BY campaign_id
      ) s ON s.campaign_id = c.id
      WHERE c.business_unit = :bu
      ORDER BY c.created_at DESC
    `, { replacements: { bu }, type: QueryTypes.SELECT });

    return res.json(campaigns);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// POST /api/campaigns
router.post('/', async (req, res) => {
  try {
    const { name, description, start_date, end_date, budget_lakhs, status } = req.body;
    const campaign = await Campaign.create({
      name,
      description: description || null,
      start_date: start_date || null,
      end_date: end_date || null,
      budget_lakhs: budget_lakhs || null,
      status: status || 'active',
      business_unit: req.user.business_unit,
      created_by: req.user.id,
    });
    return res.status(201).json(campaign);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// PUT /api/campaigns/:id
router.put('/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findByPk(req.params.id);
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
    if (campaign.business_unit !== req.user.business_unit) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const { name, description, start_date, end_date, budget_lakhs, status } = req.body;
    await campaign.update({
      name: name !== undefined ? name : campaign.name,
      description: description !== undefined ? description : campaign.description,
      start_date: start_date !== undefined ? start_date : campaign.start_date,
      end_date: end_date !== undefined ? end_date : campaign.end_date,
      budget_lakhs: budget_lakhs !== undefined ? budget_lakhs : campaign.budget_lakhs,
      status: status !== undefined ? status : campaign.status,
    });
    return res.json(campaign);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// DELETE /api/campaigns/:id
router.delete('/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findByPk(req.params.id);
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
    if (campaign.business_unit !== req.user.business_unit) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    await campaign.destroy();
    return res.json({ message: 'Campaign deleted' });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
