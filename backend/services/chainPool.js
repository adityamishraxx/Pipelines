// ---------------------------------------------------------------------------
// Chain device-pool logic (Global vs Individual PO mapping document).
//
// A chain's consumed device count is DERIVED, never stored: it is the sum of "devices" (the lead's
// headline Quantity) across the chain's Individual POs that have reached PO Received. A PO in any
// earlier stage, On Hold, or Lost contributes zero — so the pool changes ONLY on a PO Received
// transition, automatically, with no manual recalculation. The original chain total is a reference
// figure, not a hard cap: cumulative wins may exceed it, in which case the remaining goes negative and
// the chain is flagged "exceeded" rather than blocking the win.
// ---------------------------------------------------------------------------

const WON_STAGE = 'PO Received';

// Pure: compute a chain's pool status from its original total and its Individual POs.
// `individualPos` = [{ phase, devices }]. Returns { original, consumed, remaining, exceeded, wonCount }.
function chainStatus(deviceTotal, individualPos) {
  const original = Number(deviceTotal) || 0;
  let consumed = 0, wonCount = 0;
  for (const po of (Array.isArray(individualPos) ? individualPos : [])) {
    if (po && po.phase === WON_STAGE) {
      consumed += Number(po.devices) || 0;
      wonCount += 1;
    }
  }
  const remaining = original - consumed;      // negative => overage (see doc §4.3)
  return { original, consumed, remaining, exceeded: remaining < 0, wonCount };
}

// The device count a single lead (Individual PO) contributes to its chain.
// When the chain specifies a device_type matching a service label, the matching
// service line's qty from services_json is used. Falls back to headline quantity.
function leadDevices(lead, deviceType) {
  if (deviceType) {
    try {
      const raw = lead.services_json;
      const lines = typeof raw === 'string' ? JSON.parse(raw) : (Array.isArray(raw) ? raw : null);
      if (Array.isArray(lines)) {
        for (const line of lines) {
          if (line.label === deviceType) {
            const hwQty = (line.hw && Number(line.hw.qty)) || 0;
            const svcQty = (line.svc && Number(line.svc.qty)) || 0;
            return hwQty + svcQty;
          }
        }
      }
    } catch { /* fall through to headline qty */ }
  }
  return Number(lead.quantity) || 0;
}

module.exports = { chainStatus, leadDevices, WON_STAGE };
