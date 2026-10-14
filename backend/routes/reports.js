const router = require('express').Router();
const { sequelize } = require('../models');
const { authenticate } = require('../middleware/auth');
const { QueryTypes } = require('sequelize');

router.use(authenticate);

// GET /api/reports/bd-performance?from=2026-01-01&to=2026-12-31
router.get('/bd-performance', async (req, res) => {
  try {
    const bu = req.user.business_unit;
    const { from, to } = req.query;

    let dateFilter = '';
    const replacements = { bu };
    if (from) { dateFilter += ' AND l.created_at >= :from'; replacements.from = from; }
    if (to)   { dateFilter += ' AND l.created_at <= :to';   replacements.to = to; }

    const rows = await sequelize.query(`
      SELECT
        u.name                                                    AS bd_name,
        COUNT(*)                                                  AS total_leads,
        SUM(CASE WHEN l.phase NOT IN ('PO Received','Lost') THEN 1 ELSE 0 END) AS active_leads,
        SUM(CASE WHEN l.phase = 'PO Received' THEN 1 ELSE 0 END) AS won_leads,
        SUM(CASE WHEN l.phase = 'Lost' THEN 1 ELSE 0 END)        AS lost_leads,
        COALESCE(SUM(l.potential_tcv_lakhs), 0)                   AS total_tcv,
        COALESCE(SUM(CASE WHEN l.phase = 'PO Received' THEN COALESCE(l.po_actual_value_lakhs, l.potential_tcv_lakhs, 0) ELSE 0 END), 0) AS won_tcv,
        ROUND(
          SUM(CASE WHEN l.phase = 'PO Received' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0),
          1
        ) AS conversion_rate
      FROM leads l
      JOIN users u ON u.id = l.owner_id
      WHERE l.business_unit = :bu ${dateFilter}
      GROUP BY l.owner_id, u.name
      ORDER BY won_tcv DESC
    `, { replacements, type: QueryTypes.SELECT });

    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// GET /api/reports/source-analysis?from=2026-01-01&to=2026-12-31
router.get('/source-analysis', async (req, res) => {
  try {
    const bu = req.user.business_unit;
    const { from, to } = req.query;

    let dateFilter = '';
    const replacements = { bu };
    if (from) { dateFilter += ' AND created_at >= :from'; replacements.from = from; }
    if (to)   { dateFilter += ' AND created_at <= :to';   replacements.to = to; }

    const rows = await sequelize.query(`
      SELECT
        COALESCE(lead_source, 'Unknown') AS source,
        COUNT(*)                                                  AS total_leads,
        SUM(CASE WHEN phase = 'PO Received' THEN 1 ELSE 0 END)  AS won_leads,
        COALESCE(SUM(potential_tcv_lakhs), 0)                     AS total_tcv,
        COALESCE(SUM(CASE WHEN phase = 'PO Received' THEN COALESCE(po_actual_value_lakhs, potential_tcv_lakhs, 0) ELSE 0 END), 0) AS won_tcv,
        ROUND(
          SUM(CASE WHEN phase = 'PO Received' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0),
          1
        ) AS conversion_rate
      FROM leads
      WHERE business_unit = :bu ${dateFilter}
      GROUP BY lead_source
      ORDER BY total_leads DESC
    `, { replacements, type: QueryTypes.SELECT });

    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// GET /api/reports/monthly-trend?months=12
router.get('/monthly-trend', async (req, res) => {
  try {
    const bu = req.user.business_unit;
    const months = parseInt(req.query.months, 10) || 12;

    const rows = await sequelize.query(`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') AS month,
        COUNT(*)                                                  AS new_leads,
        SUM(CASE WHEN phase = 'PO Received' THEN 1 ELSE 0 END)  AS won_leads,
        SUM(CASE WHEN phase = 'Lost' THEN 1 ELSE 0 END)          AS lost_leads,
        COALESCE(SUM(potential_tcv_lakhs), 0)                     AS new_tcv,
        COALESCE(SUM(CASE WHEN phase = 'PO Received' THEN COALESCE(po_actual_value_lakhs, potential_tcv_lakhs, 0) ELSE 0 END), 0) AS won_tcv
      FROM leads
      WHERE business_unit = :bu
        AND created_at >= CURRENT_DATE - (:months * INTERVAL '1 month')
      GROUP BY TO_CHAR(created_at, 'YYYY-MM')
      ORDER BY month ASC
    `, { replacements: { bu, months }, type: QueryTypes.SELECT });

    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// GET /api/reports/campaign-roi?from=2026-01-01&to=2026-12-31
router.get('/campaign-roi', async (req, res) => {
  try {
    const bu = req.user.business_unit;
    const { from, to } = req.query;

    let dateFilter = '';
    const replacements = { bu };
    if (from) { dateFilter += ' AND c.created_at >= :from'; replacements.from = from; }
    if (to)   { dateFilter += ' AND c.created_at <= :to';   replacements.to = to; }

    const rows = await sequelize.query(`
      SELECT
        c.name                                                     AS campaign_name,
        COALESCE(c.budget_lakhs, 0)                                AS budget_lakhs,
        COALESCE(s.lead_count, 0)                                  AS lead_count,
        COALESCE(s.won_count, 0)                                   AS won_count,
        COALESCE(s.revenue_lakhs, 0)                               AS revenue_lakhs,
        CASE
          WHEN COALESCE(c.budget_lakhs, 0) > 0
          THEN ROUND((COALESCE(s.revenue_lakhs, 0) - c.budget_lakhs) / c.budget_lakhs * 100, 1)
          ELSE 0
        END AS roi
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
      WHERE c.business_unit = :bu ${dateFilter}
      ORDER BY revenue_lakhs DESC
    `, { replacements, type: QueryTypes.SELECT });

    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
