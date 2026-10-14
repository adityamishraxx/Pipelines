const { listBusinessUnitSlugs } = require('../scoringEngine');
const { sweepRenewalDue } = require('./rules/renewalRules');
const { sweepStaleLeads, sweepStageTAT, sweepFollowupOverdue, sweepHoldEnding } = require('./rules/teamRules');
const { sweepConfidenceDrop, sweepPipelineTarget } = require('./rules/forecastRules');

async function runAllSweeps() {
  try {
    const slugs = await listBusinessUnitSlugs();
    console.log(`[notifications] running sweeps for ${slugs.length} BU(s)...`);

    for (const bu of slugs) {
      await sweepRenewalDue(bu);
      await sweepStaleLeads(bu);
      await sweepStageTAT(bu);
      await sweepFollowupOverdue(bu);
      await sweepHoldEnding(bu);
      await sweepConfidenceDrop(bu);
      await sweepPipelineTarget(bu);
    }

    console.log('[notifications] sweeps complete.');
  } catch (e) {
    console.error('[notifications] scheduler error:', e.message);
  }
}

function startScheduler() {
  runAllSweeps();
  setInterval(runAllSweeps, 60 * 60 * 1000).unref();
}

module.exports = { runAllSweeps, startScheduler };
