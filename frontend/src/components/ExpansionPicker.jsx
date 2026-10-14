import React, { useMemo, useState } from 'react';
import { renewalStatus, renewalLabel, RENEWAL_BAND_STYLE, fmtDate, buildRenewedSet } from '../utils/leadHelpers';

// "+ Additional PO" modal — the single entry point for a follow-on PO on an EXISTING customer.
// Two modes:
//   • Additional — pick a customer. onPick(sourceLead, 'additional'); the lead form copies the
//     customer's STATIC details only (owner, source, state/city, rating, account type, contacts).
//   • Renewal   — pick a customer, then the SPECIFIC PO being renewed. onPick(sourceLead, 'renewal');
//     the form copies statics PLUS services + deal size, and links the new lead to that PO.
export default function ExpansionPicker({ leads, onPick, onClose }) {
  const [mode, setMode] = useState('additional'); // 'additional' | 'renewal'
  const [search, setSearch] = useState('');
  const [openCust, setOpenCust] = useState(null); // customer_code expanded (renewal mode)

  // Group leads by customer: most-recent lead as the "additional" source, plus the full PO list.
  const customers = useMemo(() => {
    const map = new Map();
    for (const l of (leads || [])) {
      if (!l.customer_code) continue;
      let c = map.get(l.customer_code);
      if (!c) { c = { customer_code: l.customer_code, customer_name: l.customer_name, cities: new Set(), pos: [] }; map.set(l.customer_code, c); }
      c.pos.push(l);
      if (l.city) c.cities.add(l.city);
    }
    for (const c of map.values()) {
      c.sourceLead = c.pos.reduce((a, b) => ((b.id || 0) > (a.id || 0) ? b : a), c.pos[0]);
      // Renewal candidates = won POs (they have a PO End Date to renew); newest first.
      c.renewable = c.pos.filter(p => p.phase === 'PO Received').sort((a, b) => (b.id || 0) - (a.id || 0));
    }
    return [...map.values()].sort((a, b) => a.customer_name.localeCompare(b.customer_name));
  }, [leads]);

  const renewedIds = useMemo(() => buildRenewedSet(leads || []), [leads]);
  const q = search.trim().toLowerCase();
  const filtered = q ? customers.filter(c => c.customer_name.toLowerCase().includes(q) || c.customer_code.toLowerCase().includes(q)) : customers;

  const tab = (key, label) => (
    <button type="button" onClick={() => { setMode(key); setOpenCust(null); }}
      style={{ border: 'none', background: mode === key ? '#e8f2ff' : '#fff', color: mode === key ? '#0066d6' : '#64748b', fontWeight: mode === key ? 700 : 500, padding: '8px 16px', cursor: 'pointer', borderRadius: 0 }}>
      {label}
    </button>
  );

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span style={{ fontWeight: 700, fontSize: 15 }}>Add a PO for an existing customer</span>
          <button className="btn btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Mode toggle */}
          <div style={{ display: 'flex', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', width: 'fit-content' }}>
            {tab('additional', 'Additional PO')}
            {tab('renewal', 'Renewal')}
          </div>

          <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>
            {mode === 'additional'
              ? 'Pick a customer. The new PO inherits their static details (owner, source, state/city, rating, account type, contacts). Services, deal size and dates you fill fresh.'
              : 'Pick a customer, then the exact PO being renewed. The renewal copies everything from it — statics, services and deal size — so you just adjust dates and price.'}
          </p>
          <input className="input" placeholder="Search customer…" value={search} onChange={e => setSearch(e.target.value)} />

          <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, maxHeight: 400, overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontStyle: 'italic', fontSize: 13 }}>
                {customers.length === 0 ? 'No customers in this business yet.' : 'No customers match.'}
              </div>
            )}

            {filtered.map(c => {
              const cities = [...c.cities];
              const sub = cities.length === 0 ? '—' : cities.length === 1 ? cities[0] : `${cities.length} cities`;

              // ADDITIONAL mode: a customer is one click → copy statics from the most recent lead.
              if (mode === 'additional') {
                return (
                  <button key={c.customer_code} type="button" onClick={() => onPick(c.sourceLead, 'additional')}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '12px 14px', background: '#fff', border: 'none', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', textAlign: 'left' }}>
                    <div>
                      <div style={{ fontWeight: 700, color: '#0f172a', fontSize: 13 }}>{c.customer_name}</div>
                      <div style={{ fontSize: 11, color: '#0a84ff', fontFamily: 'monospace' }}>{c.customer_code} · {sub}</div>
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{c.pos.length} PO{c.pos.length === 1 ? '' : 's'} <span style={{ color: '#cbd5e1', marginLeft: 8, fontWeight: 700 }}>›</span></div>
                  </button>
                );
              }

              // RENEWAL mode: expand a customer to its won POs, pick the specific one being renewed.
              const open = openCust === c.customer_code;
              return (
                <div key={c.customer_code} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <button type="button" onClick={() => setOpenCust(open ? null : c.customer_code)}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '12px 14px', background: open ? '#e8f2ff' : '#fff', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                    <div>
                      <div style={{ fontWeight: 700, color: '#0f172a', fontSize: 13 }}>{c.customer_name}</div>
                      <div style={{ fontSize: 11, color: '#0a84ff', fontFamily: 'monospace' }}>{c.customer_code} · {c.renewable.length} renewable PO{c.renewable.length === 1 ? '' : 's'}</div>
                    </div>
                    <span style={{ color: '#0a84ff', fontWeight: 700 }}>{open ? '▼' : '▶'}</span>
                  </button>
                  {open && (
                    <div style={{ background: '#f8fafc' }}>
                      {c.renewable.length === 0 && (
                        <div style={{ padding: '10px 18px', fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>No won POs to renew (a PO must be in "PO Received" to renew it).</div>
                      )}
                      {c.renewable.map(po => {
                        const st = renewalStatus(po, renewedIds);
                        const s = st ? (RENEWAL_BAND_STYLE[st.band] || RENEWAL_BAND_STYLE.ok) : null;
                        return (
                          <button key={po.id} type="button" onClick={() => onPick(po, 'renewal')}
                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '10px 18px', background: 'transparent', border: 'none', borderTop: '1px solid #eef2f7', cursor: 'pointer', textAlign: 'left' }}>
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 600 }}>{po.city || 'No city'} <span style={{ fontFamily: 'monospace', color: '#0a84ff', marginLeft: 6 }}>{po.lead_ref}</span></div>
                              <div style={{ fontSize: 11, color: '#64748b' }}>PO ends {po.service_end_date ? fmtDate(po.service_end_date) : '—'} · ₹{po.potential_tcv_lakhs || 0}L</div>
                            </div>
                            {st && st.band !== 'ok' && <span style={{ background: s.bg, color: s.fg, border: `1px solid ${s.border}`, borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{renewalLabel(st)}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 20px', borderTop: '1px solid #e2e8f0' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
