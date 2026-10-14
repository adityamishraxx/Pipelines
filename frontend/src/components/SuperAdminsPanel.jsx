import React, { useCallback, useEffect, useState } from 'react';
import { getSuperAdmins, setSuperAdmin, getSuperAdminAudit } from '../services/api';
import { useAuth } from '../context/AuthContext';

// ---------------------------------------------------------------------------
// SuperAdminsPanel — the dedicated cross-platform section.
//
// Deliberately NOT part of any single platform's user list: a Super Admin spans
// every platform at once, so managing them inside (say) the Signage user table
// would misrepresent what the grant does.
//
// Only an existing Super Admin sees or can use this. The grant is additive — it
// never touches the person's platform role — and it is global: Read-only or
// Read+Write applies to every platform, with no per-platform configuration.
// ---------------------------------------------------------------------------
const SCOPE_STYLE = {
  write: { bg: '#e8f2ff', fg: '#0a84ff', br: '#bbf7d0', label: 'Read + Write' },
  read:  { bg: '#eff6ff', fg: '#1d4ed8', br: '#bfdbfe', label: 'Read-only' },
};

export default function SuperAdminsPanel({ reloadSignal }) {
  const { user, canAct } = useAuth();
  const [data, setData] = useState(null);
  const [audit, setAudit] = useState([]);
  const [showAudit, setShowAudit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [addId, setAddId] = useState('');
  const [addScope, setAddScope] = useState('read');

  const load = useCallback(() => {
    getSuperAdmins().then(setData).catch(() => setData({ superAdmins: [], candidates: [] }));
  }, []);
  // Reload on mount and whenever the parent signals a change (e.g. a new user was just added in
  // Settings) so a freshly-created Business Admin appears as a grant candidate without a page refresh.
  useEffect(() => { load(); }, [load, reloadSignal]);

  const change = async (id, scope, label) => {
    setBusy(true); setMsg('');
    try {
      const r = await setSuperAdmin(id, scope);
      setMsg(r.message || `Updated ${label}`);
      load();
      if (showAudit) getSuperAdminAudit().then(setAudit).catch(() => {});
    } catch (e) {
      setMsg(e.response?.data?.message || 'Could not update Global Admin access');
    } finally { setBusy(false); }
  };

  const toggleAudit = () => {
    const next = !showAudit;
    setShowAudit(next);
    if (next) getSuperAdminAudit().then(setAudit).catch(() => setAudit([]));
  };

  if (!data) return null;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.4, color: '#334155', margin: 0 }}>
            GLOBAL ADMINS — ALL PLATFORMS
          </p>
          <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0', maxWidth: 620 }}>
            Cross-platform access spanning Signage, JHES and Surveillance at once — and any platform
            added later, automatically. The grant sits on top of the person's existing platform role
            and doesn't replace it. Only a Global Admin can change this.
          </p>
        </div>
        <button className="btn btn-sm" onClick={toggleAudit}>{showAudit ? 'Hide history' : 'View history'}</button>
      </div>

      {msg && (
        <div style={{ marginTop: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#334155' }}>
          {msg}
        </div>
      )}

      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.superAdmins.length === 0 && (
          <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>No Global Admins yet.</p>
        )}
        {data.superAdmins.map(sa => {
          const st = SCOPE_STYLE[sa.scope] || SCOPE_STYLE.read;
          const isSelf = sa.id === user.id;
          return (
            <div key={sa.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 10 }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{sa.name}</span>
                {isSelf && <span style={{ fontSize: 11, color: '#94a3b8' }}> · you</span>}
                <div style={{ fontSize: 11, color: '#64748b' }}>
                  {sa.email} · platform role: {sa.role} ({sa.business_unit})
                  {!sa.active && <span style={{ color: '#b91c1c' }}> · disabled</span>}
                </div>
              </div>
              <span style={{ background: st.bg, color: st.fg, border: `1px solid ${st.br}`, borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>
                {st.label}
              </span>
              {canAct && !isSelf && (
                <>
                  <button className="btn btn-sm" disabled={busy}
                    onClick={() => change(sa.id, sa.scope === 'write' ? 'read' : 'write', sa.name)}>
                    {sa.scope === 'write' ? '→ Read-only' : '→ Read + Write'}
                  </button>
                  <button className="btn btn-sm btn-danger" disabled={busy}
                    onClick={() => change(sa.id, null, sa.name)}>Revoke</button>
                </>
              )}
              {isSelf && <span style={{ fontSize: 11, color: '#94a3b8' }}>another Global Admin must change yours</span>}
            </div>
          );
        })}
      </div>

      {canAct && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #f1f5f9', display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label className="field-label">Grant Global Admin to</label>
            <select className="input" value={addId} onChange={e => setAddId(e.target.value)}>
              <option value="">Select a user…</option>
              {data.candidates.map(c => (
                <option key={c.id} value={c.id}>{c.name} — {c.role} ({c.business_unit})</option>
              ))}
            </select>
          </div>
          <div style={{ minWidth: 170 }}>
            <label className="field-label">Mode (all platforms)</label>
            <select className="input" value={addScope} onChange={e => setAddScope(e.target.value)}>
              <option value="read">Read-only</option>
              <option value="write">Read + Write</option>
            </select>
          </div>
          <button className="btn btn-primary" disabled={busy || !addId}
            onClick={() => { const c = data.candidates.find(x => String(x.id) === String(addId)); change(addId, addScope, c?.name || ''); setAddId(''); }}>
            Grant
          </button>
        </div>
      )}

      <p style={{ fontSize: 11, color: '#94a3b8', margin: '12px 0 0', lineHeight: 1.7 }}>
        <b>Read + Write</b> is unrestricted by design — Full Access to every module including Settings,
        on every platform, with no per-module limits.{' '}
        <b>Read-only</b> sees everything across all platforms and can change nothing anywhere.
      </p>

      {showAudit && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #f1f5f9' }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#334155', margin: '0 0 8px' }}>Change history</p>
          {audit.length === 0 ? (
            <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>No changes recorded yet.</p>
          ) : (
            <div style={{ maxHeight: 220, overflowY: 'auto', fontSize: 12 }}>
              {audit.map((e, i) => (
                <div key={i} style={{ padding: '5px 0', borderBottom: '1px solid #f8fafc', color: '#475569' }}>
                  <span style={{ color: '#94a3b8' }}>{String(e.at).slice(0, 19).replace('T', ' ')}</span>
                  {' · '}<b>{e.user}</b> changed <b>{e.subject}</b>: {e.from} → {e.to}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
