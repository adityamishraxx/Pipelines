import React, { useEffect, useState } from 'react';
import { getUserPermissions, updateUserPermissions } from '../services/api';
import { MODULES } from '../utils/permissions';
import PermissionMatrix, { PermissionLegend } from './PermissionMatrix';

// ---------------------------------------------------------------------------
// PermissionsModal — set one access level per general module for a single user.
//
// Two things this screen deliberately does NOT offer:
//   * Settings. It is role-gated to the admin tier and cannot be granted here at
//     any level, which is what keeps the model simple.
//   * Anything that could widen a role. These levels are a ceiling: the role and
//     business-unit checks still run server-side on every request, so granting
//     Full Access can't let a BD delete leads or see another platform's rows.
// ---------------------------------------------------------------------------

export default function PermissionsModal({ userId, userName, onClose, onSaved }) {
  const [perms, setPerms] = useState(null);
  const [initial, setInitial] = useState(null);
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    getUserPermissions(userId)
      .then(d => {
        if (cancelled) return;
        setPerms(d.permissions); setInitial(d.permissions); setMeta(d);
      })
      .catch(e => { if (!cancelled) setErr(e.response?.data?.message || 'Could not load permissions'); });
    return () => { cancelled = true; };
  }, [userId]);

  const dirty = perms && initial && MODULES.some(m => perms[m] !== initial[m]);

  const save = async () => {
    setBusy(true); setErr('');
    try {
      await updateUserPermissions(userId, perms);
      onSaved?.(`Permissions updated for ${userName}`);
      onClose();
    } catch (e) {
      setErr(e.response?.data?.message || 'Could not save permissions');
    } finally {
      setBusy(false);
    }
  };

  // No close-on-backdrop-click: permission toggles must not be discarded by a stray click.
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 620 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Module Access — {userName}</span>
            {meta && (
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
                {meta.role} · {meta.business_unit}
              </p>
            )}
          </div>
          <button className="btn btn-sm" onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: 20 }}>
          {err && <div style={{ marginBottom: 12, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>{err}</div>}

          {!perms ? <p style={{ color: '#94a3b8', fontSize: 13 }}>Loading…</p> : (
            <>
              <PermissionMatrix value={perms} onChange={setPerms} idPrefix="edit-perm" />
              <div style={{ height: 14 }} />
              <PermissionLegend />
              <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.7, marginTop: 8 }}>
                Settings is not listed here: it stays restricted to Global Admin and PMO roles.
                These levels narrow what an account type already allows — they never widen it — and
                apply to the user immediately, without signing out.
              </div>
            </>
          )}
        </div>

        <div style={{ padding: '14px 20px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save Access'}</button>
        </div>
      </div>
    </div>
  );
}
