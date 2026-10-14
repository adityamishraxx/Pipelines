import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { globalSearch } from '../services/api';

const PHASE_COLORS = {
  New: '#3b82f6', Qualified: '#8b5cf6', Demo: '#06b6d4', Proposal: '#f59e0b',
  Negotiation: '#ec4899', 'PO Expected': '#f97316', 'PO Received': '#10b981',
  Lost: '#ef4444', 'On Hold': '#64748b',
};

export default function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const timerRef = useRef(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const search = useCallback((q) => {
    if (q.trim().length < 2) { setResults(null); setOpen(false); return; }
    setLoading(true);
    setOpen(true);
    globalSearch(q.trim())
      .then((data) => { setResults(data); setLoading(false); })
      .catch(() => { setResults(null); setLoading(false); });
  }, []);

  const handleChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(val), 300);
  };

  const go = (path) => {
    setOpen(false);
    setQuery('');
    setResults(null);
    navigate(path);
  };

  const leads = results?.leads || [];
  const chains = results?.chains || [];
  const vocs = results?.vocs || [];
  const activities = results?.activities || [];
  const hasResults = leads.length || chains.length || vocs.length || activities.length;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 14, pointerEvents: 'none' }}>
          {'🔍'}
        </span>
        <input
          className="input"
          placeholder="Search leads, chains, VOC..."
          value={query}
          onChange={handleChange}
          onFocus={() => { if (results) setOpen(true); }}
          style={{ width: 280, paddingLeft: 32, fontSize: 13 }}
        />
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4,
          width: 400, maxHeight: 400, overflowY: 'auto',
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 1000,
        }}>
          {loading && (
            <div style={{ padding: '16px 14px', color: '#94a3b8', fontSize: 13 }}>Searching...</div>
          )}

          {!loading && !hasResults && (
            <div style={{ padding: '16px 14px', color: '#94a3b8', fontSize: 13 }}>No results</div>
          )}

          {!loading && hasResults && (
            <>
              {leads.length > 0 && (
                <div>
                  <div style={{ padding: '8px 14px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    Leads ({leads.length})
                  </div>
                  {leads.map((l) => (
                    <div key={l.id} onClick={() => go(`/leads?lead=${l.id}`)}
                      style={{ padding: '8px 14px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                      <span style={{ fontSize: 11, color: '#0a84ff', fontFamily: 'monospace', flexShrink: 0 }}>#{l.sr_no}</span>
                      <span style={{ fontSize: 13, color: '#0f172a', flex: 1 }}>{l.customer_name}</span>
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
                        background: PHASE_COLORS[l.phase] ? `${PHASE_COLORS[l.phase]}18` : '#f1f5f9',
                        color: PHASE_COLORS[l.phase] || '#64748b',
                      }}>{l.phase}</span>
                    </div>
                  ))}
                </div>
              )}

              {chains.length > 0 && (
                <div>
                  <div style={{ padding: '8px 14px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    Chains ({chains.length})
                  </div>
                  {chains.map((c) => (
                    <div key={c.id} onClick={() => go('/global-pos')}
                      style={{ padding: '8px 14px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', fontSize: 13, color: '#0f172a' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                      {c.chain_name}
                    </div>
                  ))}
                </div>
              )}

              {vocs.length > 0 && (
                <div>
                  <div style={{ padding: '8px 14px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    VOC ({vocs.length})
                  </div>
                  {vocs.map((v) => (
                    <div key={v.id} onClick={() => go('/voc')}
                      style={{ padding: '8px 14px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                      <span style={{ color: '#0f172a', flex: 1 }}>{v.customer_name}</span>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>{v.category}</span>
                    </div>
                  ))}
                </div>
              )}

              {activities.length > 0 && (
                <div>
                  <div style={{ padding: '8px 14px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    Activities ({activities.length})
                  </div>
                  {activities.map((a) => (
                    <div key={a.id} onClick={() => go('/activities')}
                      style={{ padding: '8px 14px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                      <span style={{ color: '#0f172a', flex: 1 }}>{a.title}</span>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>{a.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
