import React, { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeColumnKeys } from '../utils/forecastColumns';
import usePersistedState from '../utils/usePersistedState';

// ---------------------------------------------------------------------------
// ColumnPicker — a reusable check/uncheck popover for choosing which columns a
// table (or an export) includes. One implementation drives both the Forecast
// Dashboard's on-screen table and its Excel export; each caller keeps its own
// independent selection, so a user can view a wide set on screen while
// exporting a narrower one.
//
// Columns flagged `locked` render checked and disabled — they can never be
// deselected, so the table can't be reduced to nothing identifiable.
// ---------------------------------------------------------------------------
export default function ColumnPicker({ columns, value, onChange, label = 'Columns', defaultKeys }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Close on outside click / Escape, the way a native dropdown behaves.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const selected = useMemo(() => new Set(value), [value]);

  const toggle = (key, locked) => {
    if (locked) return;
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange(normalizeColumnKeys([...next]));
  };

  const selectAll = () => onChange(normalizeColumnKeys(columns.map(c => c.key)));
  const reset = () => onChange(normalizeColumnKeys(defaultKeys || columns.filter(c => c.default).map(c => c.key)));

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" className="btn btn-sm" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="true">
        ⚙ {label} <span style={{ color: '#64748b', fontWeight: 400 }}>({selected.size})</span>
      </button>

      {open && (
        <div
          role="group"
          aria-label={label}
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 50,
            background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
            boxShadow: '0 10px 30px rgba(15,23,42,.14)', width: 268, padding: 8,
            maxHeight: 360, overflowY: 'auto',
          }}
        >
          <div style={{ display: 'flex', gap: 6, padding: '4px 6px 8px', borderBottom: '1px solid #f1f5f9', marginBottom: 6 }}>
            <button type="button" className="btn btn-sm" style={{ flex: 1 }} onClick={selectAll}>Select all</button>
            <button type="button" className="btn btn-sm" style={{ flex: 1 }} onClick={reset}>Reset</button>
          </div>

          {columns.map(col => {
            const checked = selected.has(col.key);
            return (
              <label
                key={col.key}
                title={col.locked ? 'Always shown — this column cannot be removed' : undefined}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px', borderRadius: 6,
                  cursor: col.locked ? 'not-allowed' : 'pointer', opacity: col.locked ? 0.6 : 1, fontSize: 13,
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={col.locked}
                  onChange={() => toggle(col.key, col.locked)}
                  style={{ cursor: col.locked ? 'not-allowed' : 'pointer' }}
                />
                <span>{col.label}</span>
                {col.locked && <span style={{ marginLeft: 'auto', fontSize: 10, color: '#94a3b8' }}>locked</span>}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Column selection persisted per user, so it survives a reload as that user's
// personal default. normalizeColumnKeys repairs anything stale in storage (columns
// removed from the registry, locked columns someone stripped out by hand).
export function useColumnPreference(storageKey, defaultKeys) {
  return usePersistedState(storageKey, defaultKeys, normalizeColumnKeys);
}
