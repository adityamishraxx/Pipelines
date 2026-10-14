const { slaMapFor, slaMapsAll } = require('../scoringEngine');

function daysBetween(a, b) {
  const ms = new Date(b).setHours(0, 0, 0, 0) - new Date(a).setHours(0, 0, 0, 0);
  return Math.round(ms / 86400000);
}

function daysInStage(lead) {
  const dateStr = lead.phase_changed_at || lead.created_at || lead.createdAt;
  if (!dateStr) return null;
  return Math.max(0, daysBetween(dateStr, new Date()));
}

function stageAging(lead, tatMap) {
  if (['PO Received', 'Lost', 'On Hold'].includes(lead.phase)) return { days: null, target: null, level: null };
  const days = daysInStage(lead);
  if (days === null) return { days: null, target: null, level: null };
  const target = (tatMap && tatMap[lead.phase] != null) ? Number(tatMap[lead.phase]) : null;
  let level = null;
  if (target != null) level = days > target * 2 ? 'over' : days > target ? 'warn' : 'ok';
  return { days, target, level };
}

module.exports = { daysBetween, daysInStage, stageAging, slaMapFor, slaMapsAll };
