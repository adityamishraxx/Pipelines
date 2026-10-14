// ---------------------------------------------------------------------------
// Lead Confidence Scoring — pure formula module (no DB, no I/O).
//
// This is the single source of truth for the "Lead Confidence Scoring Formula"
// document. It implements, exactly as written:
//   * stage base confidence weights,
//   * the hourglass "jump" values between stages,
//   * the step-function decay driven by cumulative stage-SLA breach checkpoints,
//   * the non-zero floor,
//   * the Lost hard-override, On-Hold freeze, and PO Received terminal cases.
//
// Base weights and jump values are FIXED CONSTANTS shared across every platform
// (signage / jhes / surveillance). Only the per-stage SLA days are configurable
// per platform — those are passed in as `slaByStage`. Keeping this module pure
// makes the whole formula unit-testable without a database (see tests/scoring.test.js).
// ---------------------------------------------------------------------------

// The seven sequential pipeline stages, in order. 'On Hold' and 'Lost' are
// exception/terminal states handled separately (they are not in this list).
const STAGES = ['New', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'PO Expected', 'PO Received'];

// Stages that carry an SLA window (everything except the terminal PO Received).
const STAGES_WITH_SLA = ['New', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'PO Expected'];

// Base confidence (%) per stage — fixed.
const BASE = {
  New: 5, Qualified: 25, Demo: 40, Proposal: 48, Negotiation: 60, 'PO Expected': 75, 'PO Received': 95,
};

// Hourglass "jump from previous" values, keyed by the FROM stage of each transition:
//   New→Qualified 20, Qualified→Demo 15, Demo→Proposal 8, Proposal→Negotiation 12,
//   Negotiation→PO Expected 15, PO Expected→PO Received 20.
// Sequence 20, 15, 8, 12, 15, 20 — wide at the ends, narrowest around Proposal.
const JUMP_FROM = {
  New: 20, Qualified: 15, Demo: 8, Proposal: 12, Negotiation: 15, 'PO Expected': 20,
};

// Default SLA (days) per stage — the document's global table. Seeded per platform and then
// editable per platform; this map is the fallback whenever a platform has no override for a stage.
const DEFAULT_SLA = {
  New: 2, Qualified: 5, Demo: 7, Proposal: 7, Negotiation: 15, 'PO Expected': 7,
};

// A small non-zero floor (%) so a decayed-but-alive lead stays visually distinct from an explicitly
// Lost lead (0%). The document recommends 2%.
const FLOOR = 2;

const DAY_MS = 86400000;

function round2(n) { return Math.round(n * 100) / 100; }

// Whole days elapsed since `dateLike` up to `now`, clamped at 0. Non-dates → 0.
function daysSince(dateLike, now) {
  if (!dateLike) return 0;
  const then = new Date(dateLike);
  if (isNaN(then.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / DAY_MS));
}

// Resolve the SLA (days) for a stage from the platform map, falling back to the document default.
function slaFor(slaByStage, stage) {
  const v = slaByStage ? slaByStage[stage] : undefined;
  return (v === undefined || v === null || v === '') ? DEFAULT_SLA[stage] : Number(v);
}

// -------------------------------------------------------------------------
// computeConfidence — the full formula (Section 8 of the document).
//
// `lead` needs: { phase, last_activity_at, hold_frozen_confidence }.
//   - phase 'Lost'    → 0 (hard override).
//   - phase 'On Hold' → the frozen value captured at hold entry (no decay).
//   - phase 'PO Received' → base weight (terminal, no decay).
//   - otherwise → base(stage) minus the cumulative hourglass jumps for every SLA
//     checkpoint that `d` (days since last activity) has crossed, floored at FLOOR.
//
// Returns a Number (0–100) or null when the stage is unknown / a hold has no frozen value.
// -------------------------------------------------------------------------
function computeConfidence(lead, slaByStage, now = new Date()) {
  const phase = lead.phase;
  if (phase === 'Lost') return 0;
  if (phase === 'On Hold') {
    const f = lead.hold_frozen_confidence;
    return (f === null || f === undefined || f === '') ? null : round2(Number(f));
  }
  const base = BASE[phase];
  if (base === undefined) return null;                 // unknown / non-pipeline stage
  if (phase === 'PO Received') return base;            // terminal — no decay applies

  const i = STAGES.indexOf(phase);
  const d = daysSince(lead.last_activity_at, now);

  // Walk the cumulative SLA timeline T_k = SLA(S_i) + SLA(S_{i+1}) + ... + SLA(S_{i+k}).
  // Each checkpoint T_k crossed (d >= T_k) subtracts the hourglass jump for that stage's
  // transition to the next. Once we run past PO Expected there is nothing left to subtract.
  let acc = 0;          // acc after adding SLA(S_{i+k}) == T_k
  let deduction = 0;
  for (let k = 0; ; k++) {
    const idx = i + k;
    if (idx >= STAGES.length - 1) break;               // no SLA beyond PO Expected (PO Received terminal)
    const stage = STAGES[idx];
    acc += slaFor(slaByStage, stage);
    if (d >= acc) deduction += (JUMP_FROM[stage] || 0);
    else break;
  }

  return Math.max(round2(base - deduction), FLOOR);
}

const WEEK_MS = 7 * DAY_MS;

// -------------------------------------------------------------------------
// recomputeFields — computes the fresh confidence AND maintains the week-over-week
// trend baseline used for the up/down/flat arrow. Pure (no DB): callers persist the
// returned columns. `lead` also needs { confidence_score, confidence_prev, confidence_prev_at }.
//
// The baseline (confidence_prev) is rolled forward to the current score once a week, so
// `confidence_score` vs `confidence_prev` reflects the change over roughly the last 7 days.
// -------------------------------------------------------------------------
function recomputeFields(lead, slaByStage, now = new Date()) {
  const score = computeConfidence(lead, slaByStage, now);
  if (score === null) {
    // Unknown stage or a hold with no frozen value — leave the stored values untouched.
    return {
      confidence_score: lead.confidence_score === undefined ? null : lead.confidence_score,
      confidence_prev: lead.confidence_prev === undefined ? null : lead.confidence_prev,
      confidence_prev_at: lead.confidence_prev_at === undefined ? null : lead.confidence_prev_at,
      confidence_computed_at: now,
    };
  }
  let prev = lead.confidence_prev;
  let prevAt = lead.confidence_prev_at ? new Date(lead.confidence_prev_at) : null;
  if (prev === null || prev === undefined || prevAt === null || isNaN(prevAt.getTime())) {
    prev = score; prevAt = now;                        // first computation — no trend yet
  } else if (now.getTime() - prevAt.getTime() >= WEEK_MS) {
    const last = lead.confidence_score;                // roll baseline to last week's value
    prev = (last === null || last === undefined) ? score : Number(last);
    prevAt = now;
  }
  return { confidence_score: score, confidence_prev: Number(prev), confidence_prev_at: prevAt, confidence_computed_at: now };
}

module.exports = {
  STAGES, STAGES_WITH_SLA, BASE, JUMP_FROM, DEFAULT_SLA, FLOOR,
  computeConfidence, recomputeFields, daysSince,
};
