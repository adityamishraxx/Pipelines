import React, { useEffect, useRef, useState } from 'react';
import { getDropdownsManage, addDropdownOption, removeDropdownOption } from '../services/api';

// Inline "✎ Manage" control shown next to a data-driven dropdown. Lets Super Admin / Business Admin
// add or remove that dropdown's options for their business. Calls `onChange` after any edit so the
// parent can reload its option list. Rendered inside the lead <form>, so every button is type="button".
export default function DropdownManager({ field, label, onChange }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ref = useRef(null);

  const load = () => getDropdownsManage(field).then(setRows).catch(() => setRows([]));
  useEffect(() => { if (open) load(); }, [open]); // eslint-disable-line
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const add = async () => {
    const v = val.trim();
    if (!v) return;
    setBusy(true); setErr('');
    try { await addDropdownOption(field, v); setVal(''); await load(); onChange && onChange(); }
    catch (e) { setErr(e.response?.data?.message || 'Failed to add'); }
    finally { setBusy(false); }
  };
  const remove = async (id) => {
    setBusy(true); setErr('');
    try { await removeDropdownOption(id); await load(); onChange && onChange(); }
    catch (e) { setErr(e.response?.data?.message || 'Failed to remove'); }
    finally { setBusy(false); }
  };

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block', flexShrink: 0 }}>
      <button type="button" className="btn btn-sm" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => setOpen(o => !o)} title={`Add or remove ${label} options`}>
        {open ? 'Close' : '✎ Manage'}
      </button>
      {open && (
        <div style={{ position: 'absolute', zIndex: 40, top: '110%', right: 0, width: 260, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', padding: 12 }}>
          <p style={{ fontSize: 12, fontWeight: 700, margin: '0 0 8px' }}>Manage “{label}” options</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 180, overflowY: 'auto' }}>
            {rows.length === 0 && <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>No options yet — add one below.</p>}
            {rows.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.value}</span>
                <button type="button" className="btn btn-sm btn-danger" style={{ padding: '1px 7px', fontSize: 11 }} disabled={busy} onClick={() => remove(r.id)} title="Remove">✕</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <input className="input" style={{ fontSize: 12, padding: '6px 8px' }} placeholder={`Add ${label}…`} value={val}
              onChange={e => setVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
            <button type="button" className="btn btn-sm btn-primary" disabled={busy || !val.trim()} onClick={add}>Add</button>
          </div>
          {err && <p style={{ fontSize: 11, color: '#dc2626', margin: '6px 0 0' }}>{err}</p>}
        </div>
      )}
    </span>
  );
}
