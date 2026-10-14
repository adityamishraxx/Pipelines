// One-shot confidence recompute for every lead. Use in production as a scheduled job
// (e.g. an hourly/daily cron: `node scripts/recompute.js`). In dev the server also runs
// this on boot and on an interval (see server.js), and every lead save recomputes itself.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { runMigrations } = require('./migrate');
const { recomputeAll } = require('../services/scoringEngine');

(async () => {
  try {
    await runMigrations({ silent: true });
    const { total, updated } = await recomputeAll();
    console.log(`Confidence recompute complete — ${updated} of ${total} lead(s) updated.`);
    process.exit(0);
  } catch (err) {
    console.error('Recompute failed:', err.message);
    process.exit(1);
  }
})();
