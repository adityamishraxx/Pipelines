import React, { useMemo } from 'react';
import { FREQUENCIES, FREQUENCY_LABELS, componentTcv, computeServicesTotals } from '../utils/pricing';

// Services Offered — the shared, catalog-driven section for EVERY business's lead form. The Global
// Admin defines the catalog (per category) in the wizard / Edit Template; here the BD picks the
// items on this deal and fills the commercial terms. Emits the services_json line list upward.
//
// line = { category, label, hw:{sku,nature,frequency,rate,qty}|null, svc:{nature,frequency,rate,qty}|null }

const CATS = [
  { key: 'hardware',          title: 'Hardware',             hint: 'Devices / SKUs — flow into the Inventory Pipeline.' },
  { key: 'software',          title: 'Software / Services',  hint: 'Services & licences — OPEX or CAPEX.' },
  { key: 'hardware_software', title: 'Hardware + Software',  hint: 'A device plus a licensing / service component — the hardware flows into the Inventory Pipeline.' },
];

const inStyle = { padding: '6px 8px' };

function FreqSelect({ value, onChange, disabled }) {
  return (
    <select className="input" style={inStyle} value={value || 'monthly'} disabled={disabled} onChange={e => onChange(e.target.value)}>
      {FREQUENCIES.map(f => <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>)}
    </select>
  );
}

// One priced component (hardware or service) — nature, frequency (opex only), rate, qty. The SKU /
// device model is NOT entered here: it's fixed by the catalog item (defined by the Global Admin in
// Edit Template), so BDs / Managers / Business Admins only pick the item and set its commercials.
function ComponentFields({ comp, onPatch, disabled }) {
  const nature = comp.nature || 'opex';
  const isOpex = nature === 'opex';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '130px 140px 1fr 90px', gap: 8, alignItems: 'center' }}>
      <select className="input" style={inStyle} value={nature} disabled={disabled} onChange={e => onPatch({ nature: e.target.value })}>
        <option value="capex">CAPEX (one-time)</option>
        <option value="opex">OPEX (recurring)</option>
      </select>
      {isOpex
        ? <FreqSelect value={comp.frequency} disabled={disabled} onChange={v => onPatch({ frequency: v })} />
        : <span style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>one-time</span>}
      <input className="input" style={inStyle} type="number" step="0.01" min="0" value={comp.rate ?? ''} disabled={disabled}
        onChange={e => onPatch({ rate: e.target.value })} placeholder={isOpex ? 'Unit rate / period' : 'Unit rate'} />
      <input className="input" style={inStyle} type="number" min="0" value={comp.qty ?? ''} disabled={disabled}
        onChange={e => onPatch({ qty: e.target.value })} placeholder="Qty" />
    </div>
  );
}

export default function ServicesOffered({ catalog = [], contractMonths, value = [], onChange, readOnly }) {
  const byCat = useMemo(() => {
    const m = { hardware: [], software: [], hardware_software: [] };
    for (const c of catalog) {
      const cat = c.category || (c.hardware ? 'hardware' : 'software');
      if (m[cat]) m[cat].push(c);
    }
    return m;
  }, [catalog]);

  const lineByLabel = useMemo(() => {
    const m = new Map();
    for (const l of (value || [])) m.set(l.label, l);
    return m;
  }, [value]);

  const setLine = (label, next) => {
    const others = (value || []).filter(l => l.label !== label);
    onChange(next ? [...others, next] : others);
  };

  const toggle = (item, on) => {
    if (readOnly) return;
    if (!on) { setLine(item.label, null); return; }
    const cat = item.category || (item.hardware ? 'hardware' : 'software');
    const defNat = item.nature === 'capex' ? 'capex' : 'opex';
    const line = { category: cat, label: item.label, hw: null, svc: null };
    if (cat === 'hardware' || cat === 'hardware_software') line.hw = { nature: defNat, frequency: 'monthly', rate: '', qty: '' };
    if (cat === 'software' || cat === 'hardware_software') line.svc = { nature: 'opex', frequency: 'monthly', rate: '', qty: '' };
    setLine(item.label, line);
  };

  const patch = (label, which, p) => {
    const line = lineByLabel.get(label);
    if (!line) return;
    setLine(label, { ...line, [which]: { ...line[which], ...p } });
  };

  const totals = computeServicesTotals(value, contractMonths);
  const months = parseInt(contractMonths, 10) || 0;

  return (
    <section>
      <p className="section-title">Services Offered</p>
      <p style={{ fontSize: 11, color: '#94a3b8', margin: '-6px 0 12px' }}>
        Pick the items on this deal and set OPEX/CAPEX, billing frequency (OPEX), unit rate and quantity.
        TCV is auto-calculated from these × the contract period.
      </p>

      {CATS.map(cat => {
        const items = byCat[cat.key] || [];
        return (
          <div key={cat.key} style={{ border: '1px solid #e5e9f0', borderRadius: 10, marginBottom: 12 }}>
            <div style={{ padding: '9px 12px', background: '#f8fafc', borderRadius: '10px 10px 0 0' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{cat.title}</span>
              <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 8 }}>{cat.hint}</span>
            </div>
            <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {items.length === 0 && (
                <p style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0' }}>No items in this catalog — a Global Admin can add them in Edit Template.</p>
              )}
              {items.map(item => {
                const line = lineByLabel.get(item.label);
                const on = !!line;
                const lineTotal = on ? (componentTcv(line.hw, months) + componentTcv(line.svc, months)) : 0;
                return (
                  <div key={item.slug || item.label} className="card-sm" style={{ borderColor: on ? '#c7d2fe' : '#e2e8f0', background: on ? '#e8f2ff' : '#fff' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: readOnly ? 'default' : 'pointer', fontSize: 13, fontWeight: 600 }}>
                        <input type="checkbox" checked={on} disabled={readOnly} onChange={e => toggle(item, e.target.checked)} />
                        {item.label}
                      </label>
                      {on && lineTotal > 0 && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#0066d6' }}>₹{(lineTotal / 100000).toFixed(2)} L</span>
                      )}
                    </div>
                    {on && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                        {line.hw && (
                          <div>
                            {cat.key === 'hardware_software' && <div style={{ fontSize: 10.5, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4 }}>Hardware component</div>}
                            <ComponentFields comp={line.hw} disabled={readOnly} onPatch={p => patch(item.label, 'hw', p)} />
                          </div>
                        )}
                        {line.svc && (
                          <div>
                            {cat.key === 'hardware_software' && <div style={{ fontSize: 10.5, fontWeight: 700, color: '#0369a1', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4 }}>Service component</div>}
                            <ComponentFields comp={line.svc} disabled={readOnly} onPatch={p => patch(item.label, 'svc', p)} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, fontSize: 13, fontWeight: 700, color: '#0f172a', padding: '4px 2px' }}>
        <span>TCV: ₹{totals.tcvLakhs.toFixed(2)} L</span>
        <span style={{ color: '#64748b' }}>First-year ACV: ₹{totals.acvLakhs.toFixed(2)} L</span>
      </div>
    </section>
  );
}

// Parse a lead's stored services_json into the line array this component expects.
export function parseServiceLines(servicesJson) {
  if (!servicesJson) return [];
  try {
    const arr = typeof servicesJson === 'string' ? JSON.parse(servicesJson) : servicesJson;
    return Array.isArray(arr) ? arr.filter(l => l && l.category) : [];
  } catch {
    return [];
  }
}
