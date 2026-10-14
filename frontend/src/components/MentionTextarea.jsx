import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { getBusinessMembers } from '../services/api';

export default function MentionTextarea({ value, onChange, placeholder, style, ...rest }) {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [show, setShow] = useState(false);
  const [query, setQuery] = useState('');
  const [atPos, setAtPos] = useState(null);
  const [sel, setSel] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    if (user?.business_unit) {
      getBusinessMembers(user.business_unit).then(r => setUsers(Array.isArray(r) ? r : [])).catch(() => {});
    }
  }, [user?.business_unit]);

  const filtered = (query
    ? users.filter(u => u.name && u.name.toLowerCase().includes(query.toLowerCase()))
    : users
  ).slice(0, 8);

  const handleChange = (e) => {
    const val = e.target.value;
    const pos = e.target.selectionStart;
    onChange(val);

    const before = val.slice(0, pos);
    const idx = before.lastIndexOf('@');
    if (idx >= 0 && (idx === 0 || /[\s\n]/.test(before[idx - 1]))) {
      const partial = before.slice(idx + 1);
      if (!partial.includes('\n') && partial.length <= 40) {
        const matches = users.filter(u => u.name && u.name.toLowerCase().includes(partial.toLowerCase()));
        if (matches.length > 0 || partial.length === 0) {
          setShow(true);
          setQuery(partial);
          setAtPos(idx);
          setSel(0);
          return;
        }
      }
    }
    setShow(false);
  };

  const pick = useCallback((u) => {
    if (atPos === null || !ref.current) return;
    const pos = ref.current.selectionStart;
    const before = value.slice(0, atPos);
    const after = value.slice(pos);
    const next = before + '@' + u.name + ' ' + after;
    onChange(next);
    setShow(false);
    const cursor = atPos + u.name.length + 2;
    setTimeout(() => { ref.current?.focus(); ref.current?.setSelectionRange(cursor, cursor); }, 0);
  }, [atPos, value, onChange]);

  const handleKey = (e) => {
    if (!show || filtered.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && show) { e.preventDefault(); pick(filtered[sel]); }
    else if (e.key === 'Escape') { setShow(false); }
  };

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKey}
        placeholder={placeholder}
        style={style}
        onBlur={() => setTimeout(() => setShow(false), 200)}
        {...rest}
      />
      {show && filtered.length > 0 && (
        <div style={{
          position: 'absolute', left: 0, bottom: '100%', marginBottom: 4,
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
          boxShadow: '0 4px 12px rgba(0,0,0,0.12)', maxHeight: 200, overflowY: 'auto',
          width: '100%', zIndex: 100,
        }}>
          {filtered.map((u, i) => (
            <div key={u.id}
              onMouseDown={(e) => { e.preventDefault(); pick(u); }}
              style={{
                padding: '8px 12px', cursor: 'pointer', fontSize: 13,
                background: i === sel ? '#e8f2ff' : '#fff',
                display: 'flex', alignItems: 'center', gap: 8,
                borderBottom: i < filtered.length - 1 ? '1px solid #f1f5f9' : 'none',
              }}>
              <span style={{
                width: 26, height: 26, borderRadius: '50%', display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 10,
                fontWeight: 700, color: '#fff', background: u.color || '#0a84ff', flexShrink: 0,
              }}>{u.initials || u.name?.charAt(0)?.toUpperCase()}</span>
              <span style={{ fontWeight: 500 }}>{u.name}</span>
              <span style={{ color: '#94a3b8', fontSize: 11, marginLeft: 'auto' }}>{u.role}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
