// ---------------------------------------------------------------------------
// Pricing engine — the SINGLE source of truth for turning a lead's Services Offered
// lines into TCV and ACV. Previously this logic lived in four places (backend
// computeTcvBreakdown / computeSurveillanceBreakdown, frontend leadHelpers, and the
// inline survBreakdown in LeadForm) with "keep in sync" comments. Everything now
// funnels through here (and its identical frontend mirror, frontend/src/utils/pricing.js).
//
// Services Offered model (stored in leads.services_json):
//   line = {
//     category: 'hardware' | 'software' | 'hardware_software',
//     label:    "<catalog item name>",
//     hw:  { sku, nature, frequency, rate, qty } | null,   // hardware component
//     svc: { nature, frequency, rate, qty } | null,         // software/service component
//   }
// A component's `nature` is 'opex' | 'capex'. `frequency` applies only to opex and is one
// of monthly / quarterly / semi_annual / annual — it is the billing cadence the unit rate
// is quoted at, so the contract spans (contractMonths / periodMonths) billing periods.
// ---------------------------------------------------------------------------

const PERIOD_MONTHS = { monthly: 1, quarterly: 3, semi_annual: 6, annual: 12 };
const FREQUENCIES = Object.keys(PERIOD_MONTHS);

function periodMonths(frequency) {
  return PERIOD_MONTHS[frequency] || 1;   // default to monthly if unset/unknown
}

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
const round2 = (n) => (n > 0 ? +n.toFixed(2) : 0);

// Raw-rupee TCV of one component across the whole contract.
//   opex  → rate × qty × (contractMonths / periodMonths)   (rate is per billing period)
//   capex → rate × qty                                      (one-time, cadence ignored)
function componentTcv(comp, contractMonths) {
  if (!comp) return 0;
  const rate = num(comp.rate);
  const qty = int(comp.qty);
  if (!rate || !qty) return 0;
  if (comp.nature === 'opex') {
    const m = int(contractMonths);
    return rate * qty * (m / periodMonths(comp.frequency));
  }
  return rate * qty;
}

// Raw-rupee first-year ACV of one component.
//   opex  → rate × qty × (12 / periodMonths)   (one year's worth at this cadence)
//   capex → rate × qty                          (one-time cost realised in year 1)
function componentAcv(comp) {
  if (!comp) return 0;
  const rate = num(comp.rate);
  const qty = int(comp.qty);
  if (!rate || !qty) return 0;
  if (comp.nature === 'opex') return rate * qty * (12 / periodMonths(comp.frequency));
  return rate * qty;
}

// Raw-rupee TCV of one Services Offered line (hardware + service components).
function lineTcv(line, contractMonths) {
  if (!line) return 0;
  return componentTcv(line.hw, contractMonths) + componentTcv(line.svc, contractMonths);
}

// { tcvLakhs, acvLakhs } for all of a lead's service lines. TCV/ACV are stored in LAKHS
// (₹ / 100000) with two decimals, matching the existing potential_tcv_lakhs convention.
function computeServicesTotals(lines, contractMonths) {
  let tcv = 0;
  let acv = 0;
  for (const line of (Array.isArray(lines) ? lines : [])) {
    tcv += lineTcv(line, contractMonths);
    acv += componentAcv(line?.hw) + componentAcv(line?.svc);
  }
  return { tcvLakhs: round2(tcv / 100000), acvLakhs: round2(acv / 100000) };
}

// A line carries a hardware component when its category includes hardware. This is the
// SINGLE rule the Inventory Pipeline uses to decide what flows to procurement.
function lineHasHardware(line) {
  return !!line && (line.category === 'hardware' || line.category === 'hardware_software');
}

// Normalise one component off a raw request body sub-object, dropping blanks to null so a
// category's unused side stays null rather than a zeroed object.
function cleanComponent(raw, { allowCapex = true } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const rate = num(raw.rate);
  const qty = int(raw.qty);
  // A component with neither a rate nor a quantity carries no information — treat as absent.
  // (Hardware at ₹0 with a qty is still kept: qty > 0 keeps it for inventory.)
  if (!rate && !qty) return null;
  let nature = raw.nature === 'capex' ? 'capex' : 'opex';
  if (!allowCapex) nature = 'opex';                        // software/service is opex-only
  const frequency = FREQUENCIES.includes(raw.frequency) ? raw.frequency : 'monthly';
  const out = { nature, frequency: nature === 'opex' ? frequency : null, rate, qty };
  if (raw.sku !== undefined) out.sku = raw.sku ? String(raw.sku).trim().slice(0, 128) : null;
  return out;
}

// Normalise a full services_json array off a request body. Enforces per-category rules:
//   hardware           → hw only
//   software           → svc only, opex-only
//   hardware_software  → hw + svc
function cleanServiceLines(lines) {
  if (!Array.isArray(lines)) return [];
  const out = [];
  for (const line of lines) {
    if (!line || typeof line !== 'object') continue;
    const category = ['hardware', 'software', 'hardware_software'].includes(line.category) ? line.category : null;
    if (!category) continue;
    const hw = (category === 'hardware' || category === 'hardware_software') ? cleanComponent(line.hw) : null;
    const svc = (category === 'software' || category === 'hardware_software') ? cleanComponent(line.svc) : null;
    if (!hw && !svc) continue;                              // nothing priced on this line
    out.push({ category, label: line.label ? String(line.label).trim().slice(0, 200) : '', hw, svc });
  }
  return out;
}

module.exports = {
  PERIOD_MONTHS, FREQUENCIES, periodMonths,
  componentTcv, componentAcv, lineTcv, computeServicesTotals,
  lineHasHardware, cleanComponent, cleanServiceLines,
};
