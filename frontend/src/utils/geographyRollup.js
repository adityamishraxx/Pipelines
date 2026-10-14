// ---------------------------------------------------------------------------
// Geography (state-wise) device rollup for the Forecast Dashboard.
//
// SCM plans regional installation capacity from this, so two things matter:
//
//  1. It counts ONLY the confirmed physical-device portion of a requirement —
//     `device_qty`, the Quantity field inside the lead's Device service block.
//     It deliberately does NOT fall back to the generic `quantity` column the
//     way forecastUnits() does: that broader figure is the whole property
//     requirement, of which only part lands as hardware to ship and install.
//
//  2. It groups on each property's OWN state. A chain's properties can sit in
//     different states, and nothing here consults the chain's reference
//     location — `global_po_id` is never read.
//
// Scope: near-term installation load only, i.e. PO Expected onward. Earlier
// stages aren't committed hardware yet and would inflate regional planning.
// ---------------------------------------------------------------------------

// Stages whose hardware is close enough to landing to plan capacity around.
export const INSTALL_STAGES = ['PO Expected', 'PO Received'];

export const UNSPECIFIED_STATE = 'Unspecified';

export function deviceOnlyQty(lead) {
  if (!lead) return 0;
  if (lead.hw_qty != null) {
    const n = parseInt(lead.hw_qty, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  if (lead.includes_device === false) return 0;
  const n = parseInt(lead.device_qty, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// The property's own recorded state, or the explicit Unspecified bucket —
// never dropped, so a blank state is visible and fixable rather than invisible.
export function stateOf(lead) {
  const s = (lead?.state || '').trim();
  return s || UNSPECIFIED_STATE;
}

// Group leads into per-state buckets of device quantity.
//   → [{ state, totalQty, propertyCount, leads: [...] }]
// Sorted by quantity descending (biggest installation load first), with the
// Unspecified bucket pinned last so it reads as a data-quality item.
export function rollupByState(leads, { stages = INSTALL_STAGES } = {}) {
  const inScope = (leads || []).filter(l => stages.includes(l.phase));
  const buckets = new Map();

  for (const lead of inScope) {
    const state = stateOf(lead);
    if (!buckets.has(state)) buckets.set(state, { state, totalQty: 0, propertyCount: 0, leads: [] });
    const b = buckets.get(state);
    b.totalQty += deviceOnlyQty(lead);
    b.propertyCount += 1;
    b.leads.push(lead);
  }

  const rows = [...buckets.values()];
  for (const b of rows) b.leads.sort((a, z) => deviceOnlyQty(z) - deviceOnlyQty(a));
  rows.sort((a, b) => {
    if (a.state === UNSPECIFIED_STATE) return 1;
    if (b.state === UNSPECIFIED_STATE) return -1;
    if (b.totalQty !== a.totalQty) return b.totalQty - a.totalQty;
    return a.state.localeCompare(b.state);
  });
  return rows;
}

export const rollupTotal = (rows) => rows.reduce((s, r) => s + r.totalQty, 0);
