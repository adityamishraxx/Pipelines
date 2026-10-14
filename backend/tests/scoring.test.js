// Unit tests for the Lead Confidence Scoring formula (backend/services/scoring.js).
// Run with:  npm test   (uses the built-in Node test runner — no extra dependency).
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeConfidence, recomputeFields, BASE, FLOOR, DEFAULT_SLA } = require('../services/scoring');

// A fixed "now" so day-diff maths is deterministic.
const NOW = new Date('2026-08-08T12:00:00');
// d days ago (as the lead's last-activity timestamp).
const ago = (d) => new Date(NOW.getTime() - d * 86400000);

// The document's global SLA table (also the seeded default for every platform).
const GLOBAL_SLA = { ...DEFAULT_SLA }; // New:2 Qualified:5 Demo:7 Proposal:7 Negotiation:15 PO Expected:7

test('within SLA → full base weight, no decay', () => {
  // Qualified base 25, SLA 5 — 4 days since activity, not breached.
  assert.equal(computeConfidence({ phase: 'Qualified', last_activity_at: ago(4) }, GLOBAL_SLA, NOW), 25);
  // New base 5, SLA 2 — 1 day, not breached.
  assert.equal(computeConfidence({ phase: 'New', last_activity_at: ago(1) }, GLOBAL_SLA, NOW), 5);
});

test("document worked example — Qualified overstaying its SLA and the stages that follow", () => {
  const conf = (d) => computeConfidence({ phase: 'Qualified', last_activity_at: ago(d) }, GLOBAL_SLA, NOW);
  // Start (within SLA): 25
  assert.equal(conf(0), 25);
  // Qualified's own SLA (5 days) breached → −15 (Qualified→Demo) → 10
  assert.equal(conf(5), 10);
  assert.equal(conf(11), 10);   // still only the first checkpoint crossed (T1 = 12)
  // + Demo's SLA (7) also elapsed (d ≥ 12) → −8 (Demo→Proposal) → 2
  assert.equal(conf(12), 2);
  assert.equal(conf(18), 2);
  // + Proposal's SLA (7) also elapsed (d ≥ 19, now in Negotiation's window) → −12 (Proposal→Negotiation)
  //   25 − 15 − 8 − 12 = −10, floored. The document labels this row 0%, but the spec's floor is a
  //   non-zero 2% (Section 4.3) so a decayed-but-alive lead stays distinct from Lost (0%).
  assert.equal(conf(19), FLOOR);
  assert.equal(conf(40), FLOOR); // stays at the floor no matter how long it sits
});

test('stage progression reset — advancing resets to the new stage base (d = 0)', () => {
  // Section 4.4: on real progression, confidence resets to Base(next) and the decay clock restarts.
  // In the app a save stamps last_activity_at = now, so d = 0 → base weight.
  assert.equal(computeConfidence({ phase: 'Demo', last_activity_at: NOW }, GLOBAL_SLA, NOW), 40);
  assert.equal(computeConfidence({ phase: 'Proposal', last_activity_at: NOW }, GLOBAL_SLA, NOW), 48);
  assert.equal(computeConfidence({ phase: 'Negotiation', last_activity_at: NOW }, GLOBAL_SLA, NOW), 60);
});

test('Lost is a hard 0 override regardless of stage/time', () => {
  assert.equal(computeConfidence({ phase: 'Lost', last_activity_at: ago(0) }, GLOBAL_SLA, NOW), 0);
  assert.equal(computeConfidence({ phase: 'Lost', last_activity_at: ago(100) }, GLOBAL_SLA, NOW), 0);
});

test('PO Received is terminal — base 95, no decay', () => {
  assert.equal(computeConfidence({ phase: 'PO Received', last_activity_at: ago(0) }, GLOBAL_SLA, NOW), 95);
  assert.equal(computeConfidence({ phase: 'PO Received', last_activity_at: ago(90) }, GLOBAL_SLA, NOW), BASE['PO Received']);
});

test('On Hold freezes at the captured value with zero decay (even past the end date)', () => {
  const held = { phase: 'On Hold', hold_frozen_confidence: 37.5, last_activity_at: ago(500) };
  assert.equal(computeConfidence(held, GLOBAL_SLA, NOW), 37.5);
  // Resuming (manual): stage restored, last_activity_at reset to now → back to that stage's base.
  const resumed = { phase: 'Demo', last_activity_at: NOW };
  assert.equal(computeConfidence(resumed, GLOBAL_SLA, NOW), BASE['Demo']);
});

test('per-platform SLA isolation — same lead, different platform SLA → different decay', () => {
  const lead = { phase: 'New', last_activity_at: ago(3) }; // New base 5, jump New→Qualified 20
  const fastSla = { ...GLOBAL_SLA, New: 2 };  // signage default: breached at d≥2
  const slowSla = { ...GLOBAL_SLA, New: 10 }; // a platform that gives New 10 days: not breached at d=3
  assert.equal(computeConfidence(lead, fastSla, NOW), FLOOR); // 5 − 20 floored → 2
  assert.equal(computeConfidence(lead, slowSla, NOW), 5);     // still within SLA → base 5
});

test('recomputeFields maintains the week-over-week trend baseline', () => {
  // First computation: baseline seeds to the current score (flat, no trend).
  const first = recomputeFields({ phase: 'Qualified', last_activity_at: NOW }, GLOBAL_SLA, NOW);
  assert.equal(first.confidence_score, 25);
  assert.equal(first.confidence_prev, 25);

  // Mid-week decay (baseline < 7 days old) keeps the same baseline → downward trend shows.
  const midWeek = recomputeFields(
    { phase: 'Qualified', last_activity_at: ago(12), confidence_score: 25, confidence_prev: 25, confidence_prev_at: ago(3) },
    GLOBAL_SLA, NOW,
  );
  assert.equal(midWeek.confidence_score, 2);
  assert.equal(midWeek.confidence_prev, 25);           // unchanged → arrow points down

  // After a week, the baseline rolls forward to last week's value.
  const rolled = recomputeFields(
    { phase: 'Qualified', last_activity_at: ago(12), confidence_score: 10, confidence_prev: 25, confidence_prev_at: ago(8) },
    GLOBAL_SLA, NOW,
  );
  assert.equal(rolled.confidence_prev, 10);            // rolled to the last stored score
});
