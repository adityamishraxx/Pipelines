// Schema bootstrap (PostgreSQL / Supabase).
//
// The independent build derives its schema directly from the authoritative Sequelize models in
// models/index.js via sequelize.sync(), instead of replaying the legacy MySQL .sql migration files
// (which were MySQL-specific and are no longer used). On a fresh database this creates every table,
// enum type, index and foreign key to match the models exactly. On a database where the tables
// already exist it is a safe no-op: sync() never drops or rewrites existing tables.
//
// To change the schema later: edit the model in models/index.js. For additive changes on an
// existing database you can run a one-off `ALTER TABLE` in the Supabase SQL editor, or (in dev)
// use `npm run migrate -- --alter` which calls sync({ alter: true }).
//
// The export is still named runMigrations so server.js and seed.js keep working unchanged.

const { sequelize } = require('../models');

async function runMigrations({ silent = false, alter = false } = {}) {
  await sequelize.authenticate();
  await sequelize.sync(alter ? { alter: true } : undefined);
  if (!silent) console.log(`Schema ensured via sequelize.sync()${alter ? ' with alter' : ''}.`);
  return 0;
}

module.exports = { runMigrations };

if (require.main === module) {
  const alter = process.argv.includes('--alter');
  runMigrations({ alter })
    .then(() => process.exit(0))
    .catch((err) => { console.error(err.message); process.exit(1); });
}
