import React, { useEffect, useRef, useState } from 'react';
import { emptyFilterFor, isFilterActive, optionsForColumn } from '../utils/forecastColumns';

// ---------------------------------------------------------------------------
// ColumnFilter — the filter control that lives in a table header cell. The
// control rendered depends on the column's declared filter type:
//   text   → substring search
//   multi  → checkbox list of the values actually present in the data
//   number → min/max range
//   date   → from/to range
//
// The trigger is a funnel that turns solid and indigo while the column is
// filtering, so an active filter is visible on the header without opening it.
// ---------------------------------------------------------------------------
const PANEL_W = 220;

export default function ColumnFilter({ column, value, onChange, leads }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const wrapRef = useRef(null);
  const btnRef = useRef(null);
  const active = isFilterActive(column.filter, value);
  const f = value || emptyFilterFor(column.filter);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    // The table scrolls horizontally inside its own container, so a panel anchored to the
    // header would drift away from its button. Close on any scroll rather than chase it.
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  // Anchor the panel in viewport coordinates. It has to escape the table's
  // overflow container, which would otherwise clip it.
  const toggle = () => {
    if (open) { setOpen(false); return; }
    const r = btnRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.right - PANEL_W, window.innerWidth - PANEL_W - 8));
    setPos({ top: r.bottom + 4, left });
    setOpen(true);
  };

  if (!column.filter) return null;

  const set = (patch) => onChange({ ...f, ...patch });
  const clear = () => onChange(emptyFilterFor(column.filter));

  const panel = {
    position: 'fixed', top: pos?.top ?? 0, left: pos?.left ?? 0, zIndex: 200,
    background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
    boxShadow: '0 10px 30px rgba(15,23,42,.14)', padding: 10, width: PANEL_W,
    textTransform: 'none', fontWeight: 400, color: '#0f172a',
  };
  const lbl = { fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 3 };

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-block', marginLeft: 4 }}>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        title={active ? `Filtering on ${column.label} — click to change` : `Filter ${column.label}`}
        aria-label={`Filter ${column.label}`}
        aria-expanded={open}
        style={{
          border: 'none', background: active ? '#e0e7ff' : 'transparent', cursor: 'pointer',
          color: active ? '#0066d6' : '#94a3b8', borderRadius: 5, padding: '1px 4px',
          fontSize: 11, lineHeight: 1.4,
        }}
      >
        {active ? '▼' : '▽'}
      </button>

      {open && (
        <div style={panel} onClick={(e) => e.stopPropagation()}>
          {column.filter === 'text' && (
            <label>
              <span style={lbl}>Contains</span>
              <input
                className="input" autoFocus value={f.q || ''}
                placeholder={`Search ${column.label}…`}
                onChange={(e) => set({ q: e.target.value })}
              />
            </label>
          )}

          {column.filter === 'multi' && (
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              {optionsForColumn(column, leads).map(opt => {
                const checked = (f.values || []).includes(opt);
                return (
                  <label key={opt || '(blank)'} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 2px', fontSize: 13, cursor: 'pointer' }}>
                    <input
                      type="checkbox" checked={checked}
                      onChange={() => {
                        const cur = new Set(f.values || []);
                        if (cur.has(opt)) cur.delete(opt); else cur.add(opt);
                        set({ values: [...cur] });
                      }}
                    />
                    <span>{opt === '' ? '— (blank)' : opt}</span>
                  </label>
                );
              })}
            </div>
          )}

          {column.filter === 'number' && (
            <div style={{ display: 'flex', gap: 6 }}>
              <label style={{ flex: 1 }}>
                <span style={lbl}>Min</span>
                <input className="input" type="number" value={f.min ?? ''} onChange={(e) => set({ min: e.target.value })} />
              </label>
              <label style={{ flex: 1 }}>
                <span style={lbl}>Max</span>
                <input className="input" type="number" value={f.max ?? ''} onChange={(e) => set({ max: e.target.value })} />
              </label>
            </div>
          )}

          {column.filter === 'date' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label>
                <span style={lbl}>From</span>
                <input className="input" type="date" value={f.from || ''} onChange={(e) => set({ from: e.target.value })} />
              </label>
              <label>
                <span style={lbl}>To</span>
                <input className="input" type="date" value={f.to || ''} onChange={(e) => set({ to: e.target.value })} />
              </label>
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, marginTop: 8, paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
            <button type="button" className="btn btn-sm" style={{ flex: 1 }} onClick={clear} disabled={!active}>Clear</button>
            <button type="button" className="btn btn-sm" style={{ flex: 1 }} onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </span>
  );
}
