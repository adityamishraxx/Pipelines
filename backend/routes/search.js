const router = require('express').Router();
const { sequelize } = require('../models');
const { authenticate } = require('../middleware/auth');
const { QueryTypes } = require('sequelize');

router.use(authenticate);

// GET /api/search?q=term
router.get('/', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) {
      return res.status(400).json({ message: 'Query parameter q must be at least 2 characters' });
    }

    const bu = req.user.business_unit;
    const term = `%${q}%`;

    const [leads, chains, vocs, activities] = await Promise.all([
      sequelize.query(`
        SELECT id, sr_no, customer_name, phase, city, state
        FROM leads
        WHERE business_unit = :bu
          AND (customer_name ILIKE :term OR city ILIKE :term OR state ILIKE :term)
        LIMIT 10
      `, { replacements: { bu, term }, type: QueryTypes.SELECT }),

      sequelize.query(`
        SELECT id, chain_name
        FROM global_pos
        WHERE business_unit = :bu
          AND chain_name ILIKE :term
        LIMIT 5
      `, { replacements: { bu, term }, type: QueryTypes.SELECT }),

      sequelize.query(`
        SELECT id, customer_name, customer_segment AS category
        FROM vocs
        WHERE business_unit = :bu
          AND (customer_name ILIKE :term OR description ILIKE :term)
        LIMIT 5
      `, { replacements: { bu, term }, type: QueryTypes.SELECT }),

      sequelize.query(`
        SELECT id, title, status
        FROM activities
        WHERE business_unit = :bu
          AND (title ILIKE :term OR description ILIKE :term)
        LIMIT 5
      `, { replacements: { bu, term }, type: QueryTypes.SELECT }),
    ]);

    return res.json({ leads, chains, vocs, activities });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
