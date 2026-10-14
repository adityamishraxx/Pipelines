// === JIOAUTIFY INTEGRATION: load THIS app's own .env by absolute path. When this server is
// `require`d (mounted) inside the STB backend, process.cwd() is the STB root, so a bare
// dotenv.config() would miss these DB creds / JWT_SECRET. __dirname keeps it correct in both
// standalone (dev) and mounted (prod) modes. Mirrors JIOINVENTORY/server/server.js and
// RELEASEPLANNER/backend/server.js. ===
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const path = require('path');
const express = require('express');
const cors = require('cors');
const { runMigrations } = require('./scripts/migrate');

const app = express();

// --------------------------------------------------------------------------
// Global middleware — order matches reference app
// --------------------------------------------------------------------------
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));

// Static: uploaded PO documents accessible at /uploads/<file>. When mounted at /sales_crm this
// resolves to /sales_crm/uploads/<file>, which is what the frontend's fileUrl() builds in prod.
app.use('/uploads', express.static(path.join(__dirname, process.env.UPLOAD_DIR || 'uploads')));

// --------------------------------------------------------------------------
// Routes — one file per resource, mounted at /api/<resource>. When this app is mounted at
// /sales_crm by the STB backend, these are reached at /sales_crm/api/<resource>.
// --------------------------------------------------------------------------
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/business-units', require('./routes/businessUnits'));
app.use('/api/users',         require('./routes/users'));
app.use('/api/leads',         require('./routes/leads'));
app.use('/api/global-pos',    require('./routes/globalPos'));
app.use('/api/voc',           require('./routes/voc'));
app.use('/api/activity-log',  require('./routes/activityLog'));
app.use('/api/stage-history', require('./routes/stageHistory'));
app.use('/api/settings',      require('./routes/settings'));
app.use('/api/sla',           require('./routes/sla'));
app.use('/api/dropdowns',     require('./routes/dropdowns'));
app.use('/api/uploads',       require('./routes/uploads'));
app.use('/api/forecast',      require('./routes/forecast')); // public, no auth
app.use('/api/activities',    require('./routes/activities'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/contacts',      require('./routes/contacts'));
app.use('/api/campaigns',     require('./routes/campaigns'));
app.use('/api/search',        require('./routes/search'));
app.use('/api/reports',       require('./routes/reports'));
app.use('/api/change-log',    require('./routes/changeLog'));

// Health
app.get('/api/health', (req, res) => res.json({ status: 'ok', at: new Date().toISOString() }));

// --------------------------------------------------------------------------
// Boot — schema is owned entirely by versioned SQL files in migrations/, applied in order and
// tracked in schema_migrations. sequelize.sync() is NOT used, so the DB schema always matches
// what's checked into git.
//
// === JIOAUTIFY INTEGRATION: only run migrations + bind a port when run DIRECTLY (standalone/dev).
// When this file is `require`d by the STB backend it is mounted as a sub-app at /sales_crm and must
// NOT start its own listener (the STB server owns the port) or block STB boot on a DB migration.
// In production run `npm run migrate` once during deploy. `module.exports = app` below exposes the
// app for mounting. Mirrors JIOINVENTORY/server/server.js and RELEASEPLANNER/backend/server.js. ===
// --------------------------------------------------------------------------
if (require.main === module) {
  (async () => {
    try {
      await runMigrations();

      // Assign customer_code / lead_ref to any leads missing them (one-time, idempotent).
      const { backfillLeadCodes } = require('./services/leadCodes');
      await backfillLeadCodes();

      // Lead Confidence Scoring runs with no manual intervention: recompute once on boot, then hourly,
      // to apply time-based SLA decay. (Every lead save also recomputes itself — event-triggered.) In
      // production, prefer an external cron running `npm run recompute` instead of this interval.
      const { recomputeAll } = require('./services/scoringEngine');
      const runScoring = () => recomputeAll()
        .then(r => console.log(`[scoring] recomputed ${r.updated}/${r.total} lead(s)`))
        .catch(e => console.error('[scoring] recompute failed:', e.message));
      await runScoring();
      setInterval(runScoring, 60 * 60 * 1000).unref();

      const { startScheduler } = require('./services/notifications/scheduler');
      startScheduler();

      const port = Number(process.env.PORT) || 4000;
      app.listen(port, () => console.log(`Sales CRM API listening on http://localhost:${port}`));
    } catch (err) {
      console.error('Failed to boot:', err);
      process.exit(1);
    }
  })();
}

module.exports = app;
