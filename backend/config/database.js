const path = require('path');
const { Sequelize } = require('sequelize');

// Load this app's own .env (local dev). On hosting platforms (Render / Railway / Vercel) the
// variables are injected into process.env directly, so a missing .env file is fine.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const env = process.env;

// ---------------------------------------------------------------------------
// PostgreSQL / Supabase connection.
//
// Two ways to configure, in priority order:
//   1. DATABASE_URL  — a single connection string (what Supabase gives you), e.g.
//        postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres
//      This is the recommended setup for Supabase and for cloud hosts.
//   2. Discrete vars — DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD (handy for local dev).
//
// SSL: Supabase (and most managed Postgres) require SSL. It is enabled automatically whenever a
// DATABASE_URL is used or the host is not localhost. Override with DB_SSL=true / DB_SSL=false.
// ---------------------------------------------------------------------------
const useSSL = (() => {
  if (env.DB_SSL === 'false') return false;
  if (env.DB_SSL === 'true') return true;
  if (env.DATABASE_URL) return true;
  const host = env.DB_HOST || 'localhost';
  return !['localhost', '127.0.0.1', '::1'].includes(host);
})();

const common = {
  dialect: 'postgres',
  logging: false,
  pool: { max: 10, min: 0, idle: 10000, acquire: 30000 },
  define: { timestamps: true, underscored: false },
  // rejectUnauthorized:false lets us connect to Supabase's pooler without bundling its CA chain.
  dialectOptions: useSSL ? { ssl: { require: true, rejectUnauthorized: false } } : {},
};

const sequelize = env.DATABASE_URL
  ? new Sequelize(env.DATABASE_URL, common)
  : new Sequelize(
      env.DB_NAME || 'pipelines',
      env.DB_USER || 'postgres',
      env.DB_PASSWORD || '',
      { host: env.DB_HOST || 'localhost', port: Number(env.DB_PORT) || 5432, ...common },
    );

module.exports = sequelize;
