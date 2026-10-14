// Unit tests for chain device-pool allocation (backend/services/chainPool.js).
// Run with:  npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { chainStatus } = require('../services/chainPool');

test('standalone Individual PO (no chain) — chainStatus only sums linked POs', () => {
  // A standalone PO simply is not in any chain's list, so it never affects a pool.
  const s = chainStatus(8000, []);
  assert.deepEqual(s, { original: 8000, consumed: 0, remaining: 8000, exceeded: false, wonCount: 0 });
});

test('an Individual PO short of PO Received has ZERO pool impact at every stage', () => {
  for (const phase of ['New', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'On Hold', 'Lost']) {
    const s = chainStatus(8000, [{ phase, devices: 100 }]);
    assert.equal(s.consumed, 0, `stage ${phase} must not consume`);
    assert.equal(s.remaining, 8000);
    assert.equal(s.wonCount, 0);
  }
});

test('two in-flight POs under the same chain do not affect the pool until one wins', () => {
  const s = chainStatus(8000, [
    { phase: 'Negotiation', devices: 100 },
    { phase: 'Proposal', devices: 200 },
  ]);
  assert.equal(s.consumed, 0);
  assert.equal(s.remaining, 8000);
});

test('pool subtracts only on PO Received (document worked example — Sunrise Hotels)', () => {
  // Property A won 100, Property B won 200, Property C still in Negotiation (not counted).
  const s = chainStatus(8000, [
    { phase: 'PO Received', devices: 100 }, // A
    { phase: 'PO Received', devices: 200 }, // B
    { phase: 'Negotiation', devices: 500 }, // C — not yet won
  ]);
  assert.equal(s.consumed, 300);            // "devices already won" vs original total
  assert.equal(s.remaining, 7700);          // 8000 - 300
  assert.equal(s.exceeded, false);
  assert.equal(s.wonCount, 2);
});

test('pool is a reference figure, not a hard cap — overage shows, never blocks', () => {
  // Cumulative wins exceed the original 8000 total.
  const s = chainStatus(8000, [
    { phase: 'PO Received', devices: 5000 },
    { phase: 'PO Received', devices: 4000 },
  ]);
  assert.equal(s.consumed, 9000);
  assert.equal(s.remaining, -1000);         // negative remaining = overage
  assert.equal(s.exceeded, true);
});

test('non-numeric / missing devices count as zero', () => {
  const s = chainStatus(8000, [
    { phase: 'PO Received' },                 // no devices
    { phase: 'PO Received', devices: null },
    { phase: 'PO Received', devices: 150 },
  ]);
  assert.equal(s.consumed, 150);
});
