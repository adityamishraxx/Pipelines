// ---------------------------------------------------------------------------
// Shared lead prioritization — the single ordering used by the Forecast Dashboard,
// the Leads list and the Kanban board's within-column card order. Import from here
// rather than re-sorting locally, so the three views can never disagree about which
// opportunity is most urgent.
//
// Precedence, in order:
//   1. Stage       — PO Expected, Negotiation, Proposal, Demo, Qualified, New
//   2. Confidence  — descending (the server-maintained score; see backend/services/scoring.js)
//   3. Chain       — chain-linked properties ahead of standalone ones
//   4. TCV         — descending, JHES platform + device, excluding IPTV
//
// PO Received is won and no longer part of active forecasting, so it is partitioned
// out of the ranked list entirely (see partitionByPriority) rather than merely sorted
// last. Stages outside the ranked sequence — On Hold, Lost — sink below the ranked
// ones but stay visible; the spec doesn't place them, and hiding them would lose data.
// ---------------------------------------------------------------------------
import { priorityTcvLakhs } from './leadHelpers';

export const WON_PHASE = 'PO Received';

// Lower rank sorts first.
const STAGE_RANK = {
  'PO Expected': 0,
  Negotiation: 1,
  Proposal: 2,
  Demo: 3,
  Qualified: 4,
  New: 5,
};
const UNRANKED_STAGE = 90; // On Hold / Lost / anything new — below the ranked sequence.

export const stageRank = (phase) => (phase in STAGE_RANK ? STAGE_RANK[phase] : UNRANKED_STAGE);

export const isWonLead = (lead) => lead?.phase === WON_PHASE;

// A chain-linked property carries a global PO; standalone properties don't (migration 014).
export const isChainLead = (lead) => !!lead?.global_po_id;

const confidenceOf = (lead) => {
  const n = parseFloat(lead?.confidence_score);
  return Number.isFinite(n) ? n : -1; // unscored sorts below any scored lead
};

// The comparator itself. Every value is read from the lead at call time, so a view that
// re-sorts on render always ranks on current confidence and a freshly derived TCV.
export function comparePriority(a, b) {
  const stage = stageRank(a.phase) - stageRank(b.phase);
  if (stage !== 0) return stage;

  const conf = confidenceOf(b) - confidenceOf(a);            // descending
  if (conf !== 0) return conf;

  const chain = (isChainLead(b) ? 1 : 0) - (isChainLead(a) ? 1 : 0); // chain first
  if (chain !== 0) return chain;

  const tcv = priorityTcvLakhs(b) - priorityTcvLakhs(a);     // descending
  if (tcv !== 0) return tcv;

  // Stable, predictable tiebreak so equal-priority rows don't shuffle between renders.
  return (a.id ?? 0) - (b.id ?? 0);
}

// Sort a list in priority order, won leads included and ranked among the rest.
// Use this where a view shows one flat list (e.g. within a single Kanban column).
export function sortByPriority(leads) {
  return [...(leads || [])].sort(comparePriority);
}

// Split into the ranked active pipeline and the won leads, each sorted. Views that
// present PO Received as its own trailing section consume both halves.
export function partitionByPriority(leads) {
  const active = [];
  const won = [];
  for (const l of leads || []) (isWonLead(l) ? won : active).push(l);
  return { active: active.sort(comparePriority), won: won.sort(comparePriority) };
}

// One flat list with the won leads appended after the ranked ones — for views that
// show a single table but still want PO Received pushed to the very end.
export function sortWithWonLast(leads) {
  const { active, won } = partitionByPriority(leads);
  return [...active, ...won];
}
