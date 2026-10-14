import React, { useCallback, useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import BuWizard from '../components/BuWizard';
import BuTemplateEditor from '../components/BuTemplateEditor';
import {
  getBusinessUnitsManage, createBusinessUnit, updateBusinessUnit,
  deleteBusinessUnit, cloneBusinessUnit,
} from '../services/api';

// Global Admin surface for managing business units dynamically (no code change, no DDL). Create /
// edit / disable / archive / delete (safe) / clone-from-template. Only a Global Admin reaches this
// route; a Read-only Global Admin sees everything but every action control is hidden (canAct).
const STATUS_BADGE = {
  active:   { label: 'Active',   bg: '#dcfce7', fg: '#0a84ff' },
  disabled: { label: 'Disabled', bg: '#fef9c3', fg: '#854d0e' },
  archived: { label: 'Archived', bg: '#e2e8f0', fg: '#475569' },
};
const PRESET_COLORS = ['#0a84ff', '#ea580c', '#0891b2', '#16a34a', '#db2777', '#7c3aed', '#0ea5e9', '#f59e0b'];
const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);

export default function BusinessUnitsPage() {
  const { canAct, isSuperAdmin, user } = useAuth();
  // A Business Admin reaches this page scoped to their OWN BU only. They can Edit and Edit template
  // but cannot Create / Clone / Disable / Archive / Delete — those remain Global-Admin-only. The
  // backend enforces the same via per-route guards; this gate just hides the controls accordingly.
  const isGa = isSuperAdmin;
  const isBaOwnOnly = !isGa && user?.role === 'business_admin';
  const canCreate     = canAct && isGa;
  const canClone      = canAct && isGa;
  const canStatusEdit = canAct && isGa;   // Disable / Archive / Activate
  const canDelete     = canAct && isGa;
  const canEditBu     = canAct && (isGa || isBaOwnOnly);
  const [units, setUnits] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);   // { mode: 'create'|'edit'|'clone', bu? }
  const [wizard, setWizard] = useState(false); // guided creation wizard
  const [editTpl, setEditTpl] = useState(null); // { slug, name } — template editor target
  const [confirmDel, setConfirmDel] = useState(null); // { bu, usage, deletable }

  const load = useCallback(() => {
    setError('');
    getBusinessUnitsManage()
      .then(setUnits)
      .catch(err => setError(err.response?.data?.message || 'Could not load business units.'));
  }, []);

  useEffect(() => { load(); }, [load]);

  const onStatus = async (bu, status) => {
    try { await updateBusinessUnit(bu.slug, { status }); load(); }
    catch (err) { window.alert(err.response?.data?.message || 'Could not update status.'); }
  };

  const onDelete = async (bu) => {
    try {
      await deleteBusinessUnit(bu.slug, bu.slug);   // confirm=slug
      setConfirmDel(null);
      load();
    } catch (err) {
      window.alert(err.response?.data?.message || 'Could not delete business unit.');
    }
  };

  return (
    <Layout>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '8px 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0f172a' }}>{isGa ? 'Business Units' : 'Business Unit'}</h1>
            <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>
              {isGa
                ? 'Create and manage business platforms. A new unit appears in login and across the app immediately — no code changes.'
                : 'Edit the presentation and template for your business. Only a Global Admin can create, clone, disable, archive or delete a business unit.'}
            </p>
          </div>
          {canCreate && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" style={s.ghost} onClick={() => setModal({ mode: 'create' })}>+ Quick add</button>
              <button className="btn" style={s.primary} onClick={() => setWizard(true)}>+ Guided setup</button>
            </div>
          )}
        </div>

        {error && <div style={s.error}>{error}</div>}
        {!units && !error && <p style={{ fontSize: 13, color: '#64748b' }}>Loading…</p>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14, marginTop: 14 }}>
          {units && units.map(bu => {
            const badge = STATUS_BADGE[bu.status] || STATUS_BADGE.active;
            const u = bu.usage || {};
            return (
              <div key={bu.slug} className="card" style={{ padding: 16, borderTop: `4px solid ${bu.color}`, ...(bu.status !== 'active' ? { opacity: 0.55, filter: 'grayscale(0.6)' } : {}) }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 9, background: bu.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16, flexShrink: 0 }}>
                    {(bu.name || bu.slug || '?')[0].toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{bu.name}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>{bu.slug}</div>
                  </div>
                  <span style={{ ...s.badge, background: badge.bg, color: badge.fg }}>{badge.label}</span>
                </div>

                <p style={{ fontSize: 12.5, color: '#64748b', margin: '0 0 12px', minHeight: 32 }}>{bu.description || <span style={{ color: '#cbd5e1' }}>No description</span>}</p>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                  <Stat label="Users" n={u.users} />
                  <Stat label="Leads" n={u.leads} />
                  <Stat label="Chains" n={u.chains} />
                  <Stat label="VOCs" n={u.vocs} />
                </div>

                {canEditBu && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, borderTop: '1px solid #f1f5f9', paddingTop: 10 }}>
                    <button className="btn btn-sm" style={s.ghost} onClick={() => setModal({ mode: 'edit', bu })}>Edit</button>
                    <button className="btn btn-sm" style={s.ghost} onClick={() => setEditTpl({ slug: bu.slug, name: bu.name })}>Edit template</button>
                    {canClone && <button className="btn btn-sm" style={s.ghost} onClick={() => setModal({ mode: 'clone', bu })}>Clone</button>}
                    {canStatusEdit && bu.status !== 'active'   && <button className="btn btn-sm" style={s.ghost} onClick={() => onStatus(bu, 'active')}>Activate</button>}
                    {canStatusEdit && bu.status === 'active'   && <button className="btn btn-sm" style={s.ghost} onClick={() => onStatus(bu, 'disabled')}>Disable</button>}
                    {canStatusEdit && bu.status !== 'archived' && <button className="btn btn-sm" style={s.ghost} onClick={() => onStatus(bu, 'archived')}>Archive</button>}
                    {canDelete && <button className="btn btn-sm" style={s.danger} onClick={() => setConfirmDel({ bu, usage: u, deletable: !(u.users || u.leads || u.chains || u.vocs) })}>Delete</button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {wizard && (
        <BuWizard onClose={() => setWizard(false)} onCreated={() => { setWizard(false); load(); }} />
      )}

      {editTpl && (
        <BuTemplateEditor bu={editTpl} onClose={() => setEditTpl(null)} onSaved={() => { setEditTpl(null); load(); }} />
      )}

      {modal && (
        <BuFormModal
          mode={modal.mode}
          bu={modal.bu}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}

      {confirmDel && (
        <DeleteModal
          info={confirmDel}
          onClose={() => setConfirmDel(null)}
          onArchive={() => { onStatus(confirmDel.bu, 'archived'); setConfirmDel(null); }}
          onDelete={() => onDelete(confirmDel.bu)}
        />
      )}
    </Layout>
  );
}

function Stat({ label, n }) {
  return (
    <div style={{ background: '#f8fafc', border: '1px solid #eef2f7', borderRadius: 8, padding: '4px 9px', fontSize: 11.5 }}>
      <span style={{ fontWeight: 700, color: '#334155' }}>{n ?? 0}</span> <span style={{ color: '#94a3b8' }}>{label}</span>
    </div>
  );
}

// Create / Edit / Clone share one form. Clone starts from the source unit's presentation but needs
// a brand-new slug + name (config is copied server-side).
function BuFormModal({ mode, bu, onClose, onSaved }) {
  const isEdit = mode === 'edit';
  const isClone = mode === 'clone';
  const [form, setForm] = useState({
    slug: isEdit ? bu.slug : '',
    name: isEdit ? bu.name : (isClone ? '' : ''),
    description: (isEdit || isClone) ? (bu.description || '') : '',
    color: (isEdit || isClone) ? bu.color : PRESET_COLORS[0],
    business_type: (isEdit || isClone) ? (bu.business_type || '') : '',
  });
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const onName = (v) => { set('name', v); if (!slugTouched && !isEdit) set('slug', slugify(v)); };

  const title = isEdit ? `Edit ${bu.name}` : isClone ? `Clone ${bu.name}` : 'New Business Unit';

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      if (isEdit) {
        await updateBusinessUnit(bu.slug, { name: form.name, description: form.description, color: form.color, business_type: form.business_type });
      } else if (isClone) {
        await cloneBusinessUnit(bu.slug, { slug: form.slug, name: form.name });
      } else {
        await createBusinessUnit({ slug: form.slug, name: form.name, description: form.description, color: form.color, business_type: form.business_type });
      }
      onSaved();
    } catch (e2) {
      setErr(e2.response?.data?.message || 'Could not save.');
      setBusy(false);
    }
  };

  return (
    <Overlay onClose={onClose}>
      <form onSubmit={submit} style={{ padding: 22 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>{title}</h2>
        {isClone && <p style={{ fontSize: 12.5, color: '#64748b', margin: '0 0 14px' }}>Copies fields, dropdowns and SLA config from <b>{bu.name}</b>. Users and leads are never copied.</p>}

        <label style={s.label}>Name</label>
        <input style={s.input} value={form.name} onChange={e => onName(e.target.value)} autoFocus required placeholder="e.g. Telecom" />

        <label style={s.label}>Slug {isEdit && <span style={{ color: '#94a3b8', fontWeight: 400 }}>(fixed)</span>}</label>
        <input style={{ ...s.input, fontFamily: 'monospace', background: isEdit ? '#f1f5f9' : '#fff' }}
          value={form.slug} disabled={isEdit}
          onChange={e => { setSlugTouched(true); set('slug', slugify(e.target.value)); }}
          required placeholder="e.g. telecom" />
        {!isEdit && <div style={s.hint}>Lowercase id used across the system. Cannot change later.</div>}

        {!isClone && (
          <>
            <label style={s.label}>Description</label>
            <input style={s.input} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Short description" />

            <label style={s.label}>Business Type</label>
            <input style={s.input} value={form.business_type} onChange={e => set('business_type', e.target.value)} placeholder="e.g. Hardware, SaaS, Services" />

            <label style={s.label}>Colour</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
              {PRESET_COLORS.map(c => (
                <button type="button" key={c} onClick={() => set('color', c)}
                  style={{ width: 28, height: 28, borderRadius: 7, background: c, cursor: 'pointer',
                    border: form.color === c ? '3px solid #0f172a' : '2px solid #e2e8f0' }} />
              ))}
            </div>
          </>
        )}

        {err && <div style={{ ...s.error, marginTop: 12 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button type="button" className="btn" style={s.ghost} onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" style={s.primary} disabled={busy}>
            {busy ? 'Saving…' : isEdit ? 'Save changes' : isClone ? 'Create clone' : 'Create'}
          </button>
        </div>
      </form>
    </Overlay>
  );
}

function DeleteModal({ info, onClose, onArchive, onDelete }) {
  const { bu, usage, deletable } = info;
  const [typed, setTyped] = useState('');
  const rows = [
    ['Users', usage.users], ['Leads', usage.leads], ['Chains', usage.chains],
    ['VOCs', usage.vocs], ['Dropdown options', usage.dropdowns], ['SLA rows', usage.slas],
  ];
  return (
    <Overlay onClose={onClose}>
      <div style={{ padding: 22 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>Delete “{bu.name}”?</h2>
        <p style={{ fontSize: 12.5, color: '#64748b', margin: '0 0 14px' }}>Here is everything this business unit holds:</p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 14 }}>
          {rows.map(([label, n]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', background: '#f8fafc', border: '1px solid #eef2f7', borderRadius: 8, padding: '6px 10px', fontSize: 12.5 }}>
              <span style={{ color: '#64748b' }}>{label}</span>
              <span style={{ fontWeight: 700, color: (n > 0 ? '#0f172a' : '#cbd5e1') }}>{n ?? 0}</span>
            </div>
          ))}
        </div>

        {!deletable ? (
          <>
            <div style={{ ...s.warn }}>
              This unit still holds users, leads, chains or VOCs, so it cannot be deleted — that would orphan real records. <b>Archive</b> it instead: existing data stays readable and no new records can be added.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn" style={s.ghost} onClick={onClose}>Cancel</button>
              <button className="btn" style={s.primary} onClick={onArchive}>Archive instead</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ ...s.warn }}>
              No users or leads exist. Deleting removes the unit and its config (dropdowns, SLA). This cannot be undone. Type <b>{bu.slug}</b> to confirm.
            </div>
            <input style={{ ...s.input, fontFamily: 'monospace', marginTop: 10 }} value={typed} onChange={e => setTyped(e.target.value)} placeholder={bu.slug} autoFocus />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn" style={s.ghost} onClick={onClose}>Cancel</button>
              <button className="btn" style={{ ...s.danger, opacity: typed === bu.slug ? 1 : 0.5 }} disabled={typed !== bu.slug} onClick={onDelete}>Delete permanently</button>
            </div>
          </>
        )}
      </div>
    </Overlay>
  );
}

function Overlay({ children }) {
  // Deliberately NO close-on-backdrop-click: a stray click outside must not discard in-progress form
  // input or a typed delete-confirm slug. Use the × / Cancel button inside to close.
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 440, boxShadow: '0 20px 50px rgba(0,0,0,0.2)', maxHeight: '90vh', overflowY: 'auto' }}>
        {children}
      </div>
    </div>
  );
}

const s = {
  primary: { background: '#0a84ff', color: '#fff', border: 'none' },
  ghost:   { background: '#fff', color: '#334155', border: '1px solid #e2e8f0' },
  danger:  { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' },
  badge:   { fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap' },
  label:   { fontSize: 12, fontWeight: 600, color: '#334155', display: 'block', marginBottom: 6, marginTop: 12 },
  input:   { width: '100%', padding: '9px 11px', border: '1.5px solid #e2e8f0', borderRadius: 9, fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  hint:    { fontSize: 11, color: '#94a3b8', marginTop: 4 },
  error:   { background: '#fee2e2', color: '#b91c1c', padding: '8px 12px', borderRadius: 8, fontSize: 13 },
  warn:    { background: '#fffbeb', color: '#92400e', padding: '10px 12px', borderRadius: 8, fontSize: 12.5, border: '1px solid #fde68a' },
};
