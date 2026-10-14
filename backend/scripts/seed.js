require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Setting, DropdownOption } = require('../models');
const { runMigrations } = require('./migrate');

// ---------------------------------------------------------------------------
// Blank-install seed. Pipelines ships as a generic CRM with NO businesses, users or demo data.
// This seeds only the global essentials every install needs:
//   • the pipeline stage list (workflow — shared across all businesses)
//   • system/notification settings
//
// The first Global Admin is created through the in-app one-time setup screen (POST /api/auth/setup),
// NOT here. Each business (and its users, services, SLA, dropdowns) is added by the admin from the UI.
// Everything below is idempotent, so re-running is safe.
// ---------------------------------------------------------------------------

// Pipeline stages are global (business_unit = NULL): the funnel workflow is the same for every BU.
const PHASES = ['New', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'PO Expected', 'PO Received', 'Lost', 'On Hold'];

const SETTINGS = [
  { key_name: 'weekly_target_lakhs', value: '0' },
  { key_name: 'bd_weekly_targets',   value: '{}' },
  { key_name: 'notification_stale_days',         value: '14' },
  { key_name: 'notification_digest_hour_ist',    value: '9' },
  { key_name: 'hold_ending_days',                value: '3' },
  { key_name: 'stage_tat_escalation_multiplier', value: '2' },
  { key_name: 'hardware_spike_threshold_pct',    value: '50' },
];

(async () => {
  try {
    await runMigrations({ silent: true });

    for (let i = 0; i < PHASES.length; i++) {
      await DropdownOption.findOrCreate({
        where: { field_name: 'phase', business_unit: null, value: PHASES[i] },
        defaults: { field_name: 'phase', business_unit: null, value: PHASES[i], sort_order: i + 1, active: true },
      });
    }
    console.log('✓ Pipeline stages seeded (global)');

    for (const s of SETTINGS) {
      await Setting.findOrCreate({ where: { key_name: s.key_name }, defaults: s });
    }
    console.log('✓ System settings seeded');

    console.log('\nBlank install ready. Open the app to create your admin account, then add your first business.');
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  }
})();
