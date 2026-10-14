// ---------------------------------------------------------------------------
// Pricing engine (frontend mirror of backend/services/pricing.js — keep the two in sync).
// Single source of truth for turning a lead's Services Offered lines into TCV / ACV for the
// live form preview. The backend recomputes authoritatively on save; this is purely UX.
//
// Services Offered model (stored in leads.services_json):
//   line = {
//     category: 'hardware' | 'software' | 'hardware_software',
//     label:    "<catalog item name>",
//     hw:  { sku, nature, frequency, rate, qty } | null,
//     svc: { nature, frequency, rate, qty } | null,
//   }
// `frequency` applies only to opex (monthly / quarterly / semi_annual / annual) and is the
// cadence the unit rate is quoted at.
// ---------------------------------------------------------------------------

export const PERIOD_MONTHS = { monthly: 1, quarterly: 3, semi_annual: 6, annual: 12 };
export const FREQUENCIES = Object.keys(PERIOD_MONTHS);
export const FREQUENCY_LABELS = { monthly: 'Monthly', quarterly: 'Quarterly', semi_annual: 'Semi-annually', annual: 'Annually' };

const periodMonths = (frequency) => PERIOD_MONTHS[frequency] || 1;
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
const round2 = (n) => (n > 0 ? +n.toFixed(2) : 0);

// Raw-rupee TCV of one component across the whole contract.
export function componentTcv(comp, contractMonths) {
  if (!comp) return 0;
  const rate = num(comp.rate);
  const qty = int(comp.qty);
  if (!rate || !qty) return 0;
  if (comp.nature === 'opex') return rate * qty * (int(contractMonths) / periodMonths(comp.frequency));
  return rate * qty;
}

// Raw-rupee first-year ACV of one component.
export function componentAcv(comp) {
  if (!comp) return 0;
  const rate = num(comp.rate);
  const qty = int(comp.qty);
  if (!rate || !qty) return 0;
  if (comp.nature === 'opex') return rate * qty * (12 / periodMonths(comp.frequency));
  return rate * qty;
}

export function lineTcv(line, contractMonths) {
  if (!line) return 0;
  return componentTcv(line.hw, contractMonths) + componentTcv(line.svc, contractMonths);
}

// { tcvLakhs, acvLakhs } for all of a lead's service lines (₹ / 100000, two decimals).
export function computeServicesTotals(lines, contractMonths) {
  let tcv = 0;
  let acv = 0;
  for (const line of (Array.isArray(lines) ? lines : [])) {
    tcv += lineTcv(line, contractMonths);
    acv += componentAcv(line?.hw) + componentAcv(line?.svc);
  }
  return { tcvLakhs: round2(tcv / 100000), acvLakhs: round2(acv / 100000) };
}

// Single rule the Inventory Pipeline uses: a line flows to procurement when it carries hardware.
export function lineHasHardware(line) {
  return !!line && (line.category === 'hardware' || line.category === 'hardware_software');
}
