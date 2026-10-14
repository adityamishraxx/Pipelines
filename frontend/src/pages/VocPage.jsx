import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import MultiSelect from '../components/MultiSelect';
import { useAuth } from '../context/AuthContext';
import { getVocs, getVoc, createVoc, updateVoc, addVocComment, deleteVoc, getBds } from '../services/api';
import {
  VOC_SEGMENTS, VOC_PRODUCTS, VOC_TYPES, VOC_IMPACTS, VOC_PRIORITIES, VOC_STATUSES, VOC_OPEN_STATUSES,
  VOC_STATUS_BADGE, VOC_PRIORITY_BADGE, INDIAN_STATES, UNION_TERRITORIES,
} from '../utils/constants';
import { fmtDate } from '../utils/leadHelpers';
import { writeFormattedSheet } from '../utils/excelExport';
import MentionTextarea from '../components/MentionTextarea';

const CAN_REVIEW = ['super_admin', 'business_admin', 'pmo'];   // PMO / Business Admin / Super Admin
const today = () => new Date().toISOString().slice(0, 10);
const EMPTY = {
  date_of_entry: '', customer_name: '', total_account_value_lakhs: '', bd_owner_id: '', pmo_owner: '',
  region_state: '', customer_segment: '', product_solution: [], voc_type: '', description: '',
  business_impact: '', revenue_impact_lakhs: '', competitor: '', priority: '', attachment_url: '',
  status: 'New', product_remarks: '', target_release: '', closure_date: '',
};

// Small titled breakdown: label → count with a proportional bar. Clicking a row is optional.
function Breakdown({ title, data, color = '#0a84ff' }) {
  const rows = Object.entries(data || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <div className="card" style={{ padding: 14 }}>
      <p className="section-title" style={{ margin: '0 0 8px' }}>{title}</p>
      {rows.length === 0 ? <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>—</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {rows.map(([label, n]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
              <div style={{ width: 110, fontWeight: 600, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={label}>{label}</div>
              <div style={{ flex: 1, height: 14, background: '#f1f5f9', borderRadius: 5 }}>
                <div style={{ height: '100%', width: `${Math.max(6, Math.round((n / max) * 100))}%`, background: color, borderRadius: 5 }} />
              </div>
              <div style={{ width: 26, textAlign: 'right', fontWeight: 700 }}>{n}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function VocPage() {
  const { user, buHasModule } = useAuth();
  const canReview = CAN_REVIEW.includes(user.role);
  const allowed = buHasModule('voc') || user.role === 'super_admin';

  const [vocs, setVocs] = useState([]);
  const [bds, setBds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [fStatus, setFStatus] = useState([]);
  const [fPriority, setFPriority] = useState([]);
  const [fProduct, setFProduct] = useState([]);
  const [fType, setFType] = useState([]);
  const [fBd, setFBd] = useState([]);
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [showDash, setShowDash] = useState(true);

  const [modal, setModal] = useState(null);   // null | { mode:'new' } | { mode:'edit', voc }
  const [deleteId, setDeleteId] = useState(null);

  const fetchAll = useCallback(() => {
    setLoading(true);
    getVocs().then(setVocs).catch(() => setVocs([])).finally(() => setLoading(false));
  }, []);
  useEffect(() => { if (allowed) fetchAll(); }, [allowed, fetchAll]);
  useEffect(() => { getBds(user.business_unit).then(setBds).catch(() => setBds([])); }, [user.business_unit]);

  const filtered = useMemo(() => vocs.filter(v => {
    const s = search.toLowerCase();
    const match = !s || [v.customer_name, v.description, v.competitor, v.region_state]
      .some(f => f?.toLowerCase().includes(s));
    const prods = v.product_solution ? v.product_solution.split(',').map(x => x.trim()) : [];
    return match
      && (!fStatus.length || fStatus.includes(v.status))
      && (!fPriority.length || fPriority.includes(v.priority))
      && (!fProduct.length || fProduct.some(p => prods.includes(p)))
      && (!fType.length || fType.includes(v.voc_type))
      && (!fBd.length || fBd.includes(v.bdOwner?.name))
      && (!fFrom || (v.date_of_entry && v.date_of_entry >= fFrom))
      && (!fTo || (v.date_of_entry && v.date_of_entry <= fTo));
  }), [vocs, search, fStatus, fPriority, fProduct, fType, fBd, fFrom, fTo]);

  // Dashboard aggregates (over ALL scoped VOCs, not the filtered subset).
  const stats = useMemo(() => {
    const tally = (fn) => vocs.reduce((m, v) => { const k = fn(v) || '—'; m[k] = (m[k] || 0) + 1; return m; }, {});
    // Product is multi-valued — count each selected product separately.
    const byProduct = {};
    for (const v of vocs) {
      const prods = v.product_solution ? v.product_solution.split(',').map(s => s.trim()).filter(Boolean) : ['—'];
      for (const p of prods) byProduct[p] = (byProduct[p] || 0) + 1;
    }
    return {
      total: vocs.length,
      open: vocs.filter(v => VOC_OPEN_STATUSES.includes(v.status)).length,
      closed: vocs.filter(v => !VOC_OPEN_STATUSES.includes(v.status)).length,
      byPriority: tally(v => v.priority),
      byStatus: tally(v => v.status),
      byProduct,
      byRegion: tally(v => v.region_state),
      byBd: tally(v => v.bdOwner?.name || v.pmo_owner),
      byType: tally(v => v.voc_type),
    };
  }, [vocs]);

  const exportExcel = async () => {
    const XLSX = await import('xlsx');
    const rows = filtered.map(v => ({
      'VOC No': v.voc_no, 'Date': v.date_of_entry || '', 'Customer': v.customer_name, 'Total Account Value (L)': v.total_account_value_lakhs || '',
      'BD Owner': v.bdOwner?.name || '', 'PMO Owner': v.pmo_owner || '', 'Region/State': v.region_state || '',
      'Segment': v.customer_segment || '', 'Product': v.product_solution || '', 'VOC Type': v.voc_type || '',
      'Description': v.description || '', 'Business Impact': v.business_impact || '', 'Revenue Impact (L)': v.revenue_impact_lakhs || '',
      'Competitor': v.competitor || '', 'Priority': v.priority || '', 'Status': v.status,
      'Product Remarks': v.product_remarks || '', 'Target Release': v.target_release || '', 'Closure Date': v.closure_date || '',
    }));
    writeFormattedSheet(XLSX, rows, 'VOC', `VOC_${user.business_unit}_${today()}.xlsx`);
  };

  const bdNames = bds.map(b => b.name);

  if (!allowed) {
    return <Layout><div style={{ padding: 40 }}><h1 style={{ fontSize: 18 }}>VOC</h1><p style={{ color: '#64748b' }}>The Voice of Customer module is not enabled for your business. Please contact your administrator.</p></div></Layout>;
  }

  return (
    <Layout>
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>VOC — Voice of Customer</h1>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>{stats.open} open · {stats.total} total</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => setShowDash(s => !s)}>{showDash ? 'Hide' : 'Show'} dashboard</button>
          <button className="btn" onClick={exportExcel}>Export Excel</button>
          <button className="btn btn-primary" onClick={() => setModal({ mode: 'new' })}>+ New VOC</button>
        </div>
      </div>

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {showDash && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {[['Total VOCs', stats.total, '#0a84ff'], ['Open', stats.open, '#f59e0b'], ['Closed', stats.closed, '#16a34a']].map(([label, val, color]) => (
                <div key={label} className="card" style={{ padding: 16 }}>
                  <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{label}</div>
                  <div style={{ fontSize: 30, fontWeight: 800, color }}>{val}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              <Breakdown title="By Priority" data={stats.byPriority} color="#dc2626" />
              <Breakdown title="By Status" data={stats.byStatus} color="#0ea5e9" />
              <Breakdown title="By Product" data={stats.byProduct} color="#7c3aed" />
              <Breakdown title="By VOC Type" data={stats.byType} color="#0891b2" />
              <Breakdown title="By Region" data={stats.byRegion} color="#059669" />
              <Breakdown title="By BD Owner" data={stats.byBd} color="#ea580c" />
            </div>
          </>
        )}

        {/* Filters */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 14px' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>Filters</span>
          <input className="input" style={{ width: 220 }} placeholder="Search customer, description…" value={search} onChange={e => setSearch(e.target.value)} />
          <MultiSelect label="Status" options={VOC_STATUSES} selected={fStatus} onChange={setFStatus} />
          <MultiSelect label="Priority" options={VOC_PRIORITIES} selected={fPriority} onChange={setFPriority} />
          <MultiSelect label="Product" options={VOC_PRODUCTS} selected={fProduct} onChange={setFProduct} />
          <MultiSelect label="Type" options={VOC_TYPES} selected={fType} onChange={setFType} />
          {canReview && <MultiSelect label="BD Owner" options={bdNames} selected={fBd} onChange={setFBd} />}
          <label style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>From <input type="date" className="input" style={{ width: 140 }} value={fFrom} onChange={e => setFFrom(e.target.value)} /></label>
          <label style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>To <input type="date" className="input" style={{ width: 140 }} value={fTo} onChange={e => setFTo(e.target.value)} /></label>
        </div>

        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          {loading ? <p style={{ padding: 20, color: '#94a3b8' }}>Loading…</p> : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>VOC</th><th>Date</th><th>Customer</th><th>Product</th><th>Type</th>
                  <th>Priority</th><th>Impact</th><th>Status</th><th>BD Owner</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(v => (
                  <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => setModal({ mode: 'edit', voc: v })}>
                    <td style={{ color: '#94a3b8', fontWeight: 600 }}>#{v.voc_no}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{v.date_of_entry ? fmtDate(v.date_of_entry) : '—'}</td>
                    <td><p style={{ fontWeight: 700, margin: 0 }}>{v.customer_name}</p>{v.total_account_value_lakhs != null && <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>₹{v.total_account_value_lakhs}L</p>}</td>
                    <td>{v.product_solution || '—'}</td>
                    <td style={{ fontSize: 12 }}>{v.voc_type || '—'}</td>
                    <td>{v.priority ? <span className={`badge ${VOC_PRIORITY_BADGE[v.priority] || 'badge-gray'}`}>{v.priority}</span> : '—'}</td>
                    <td style={{ fontSize: 12 }}>{v.business_impact || '—'}</td>
                    <td><span className={`badge ${VOC_STATUS_BADGE[v.status] || 'badge-gray'}`}>{v.status}</span></td>
                    <td style={{ fontSize: 12 }}>{v.bdOwner?.name?.split(' ')[0] || '—'}</td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: '#94a3b8', padding: 40 }}>No VOC entries match your filters.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {modal && (
        <VocModal
          mode={modal.mode}
          voc={modal.voc}
          bds={bds}
          canReview={canReview}
          user={user}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); fetchAll(); }}
          onDelete={(id) => { setModal(null); setDeleteId(id); }}
        />
      )}

      {deleteId && (
        <div className="modal-overlay" onClick={() => setDeleteId(null)}>
          <div className="modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div className="modal-body">
              <p style={{ fontWeight: 700, marginBottom: 8 }}>Delete this VOC?</p>
              <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>This permanently removes the VOC and its history.</p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn" onClick={() => setDeleteId(null)}>Cancel</button>
                <button className="btn btn-danger" onClick={async () => { await deleteVoc(deleteId); setDeleteId(null); fetchAll(); }}>Delete</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

// ---- Create / Edit modal ------------------------------------------------
function VocModal({ mode, voc, bds, canReview, user, onClose, onSaved, onDelete }) {
  const isEdit = mode === 'edit';
  const [form, setForm] = useState({ ...EMPTY, date_of_entry: today(), bd_owner_id: user.role === 'bd' ? user.id : '' });
  const [tab, setTab] = useState('form');
  const [detail, setDetail] = useState(null);   // full voc w/ activity (edit)
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  // BD can edit only their own; reviewer-only fields are read-only for a BD.
  const ownVoc = !isEdit || !voc || voc.bd_owner_id === user.id;
  const canEdit = canReview || ownVoc;
  const reviewerRO = !canReview;   // reviewer fields read-only for non-reviewers

  useEffect(() => {
    if (isEdit && voc) {
      getVoc(voc.id).then(d => {
        setDetail(d);
        setForm({
          date_of_entry: d.date_of_entry || '', customer_name: d.customer_name || '', total_account_value_lakhs: d.total_account_value_lakhs || '',
          bd_owner_id: d.bd_owner_id || '', pmo_owner: d.pmo_owner || '', region_state: d.region_state || '',
          customer_segment: d.customer_segment || '', product_solution: d.product_solution ? d.product_solution.split(',').map(s => s.trim()).filter(Boolean) : [], voc_type: d.voc_type || '',
          description: d.description || '', business_impact: d.business_impact || '', revenue_impact_lakhs: d.revenue_impact_lakhs || '',
          competitor: d.competitor || '', priority: d.priority || '', attachment_url: d.attachment_url || '',
          status: d.status || 'New', product_remarks: d.product_remarks || '', target_release: d.target_release || '', closure_date: d.closure_date || '',
        });
      }).catch(() => {});
    }
  }, [isEdit, voc]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.customer_name.trim()) return setErr('Customer name is required.');
    if (!form.description.trim()) return setErr('A description of the requirement is required.');
    setBusy(true); setErr('');
    try {
      if (isEdit) await updateVoc(voc.id, form);
      else await createVoc(form);
      onSaved();
    } catch (er) {
      setErr(er.response?.data?.message || 'Could not save VOC.');
    } finally { setBusy(false); }
  };

  const postComment = async () => {
    if (!comment.trim()) return;
    setBusy(true);
    try { await addVocComment(voc.id, comment.trim()); setComment(''); const d = await getVoc(voc.id); setDetail(d); }
    finally { setBusy(false); }
  };

  const Sel = ({ label, k, opts, required, ro }) => {
    const hasOther = opts.includes('Other') || opts.includes('Others');
    const standardOpts = hasOther ? opts.filter(o => o !== 'Other' && o !== 'Others') : opts;
    const isCustom = hasOther && form[k] && form[k].trim() && !opts.includes(form[k]);
    return (
      <div>
        <label className="field-label">{label}{required && ' *'}</label>
        {hasOther && isCustom ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="input" style={{ flex: 1 }} placeholder={`Enter ${label.toLowerCase()}`} value={form[k]} onChange={set(k)} disabled={ro || !canEdit} autoFocus />
            <button type="button" className="btn btn-sm" style={{ whiteSpace: 'nowrap' }} disabled={ro || !canEdit} onClick={() => setForm(f => ({ ...f, [k]: '' }))}>✕</button>
          </div>
        ) : (
          <select className="input" value={form[k]} onChange={e => {
            if (e.target.value === '__sel_other__') setForm(f => ({ ...f, [k]: ' ' }));
            else { const fn = set(k); fn(e); }
          }} disabled={ro || !canEdit} required={required}>
            <option value="">Select</option>
            {standardOpts.map(o => <option key={o} value={o}>{o}</option>)}
            {hasOther && <option value="__sel_other__">Other (type custom)</option>}
          </select>
        )}
      </div>
    );
  };

  // No close-on-backdrop-click: a stray click must not discard half-filled VOC input.
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 720 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span className={`tab ${tab === 'form' ? 'active' : ''}`} onClick={() => setTab('form')}>{isEdit ? `VOC #${voc.voc_no}` : 'New VOC'}</span>
            {isEdit && <span className={`tab ${tab === 'activity' ? 'active' : ''}`} onClick={() => setTab('activity')}>Activity</span>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {isEdit && canReview && <button className="btn btn-sm btn-danger" onClick={() => onDelete(voc.id)}>Delete</button>}
            <button className="btn btn-sm" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="modal-body">
          {tab === 'form' ? (
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {!canEdit && <div className="badge badge-amber" style={{ padding: '8px 12px' }}>You can view this VOC but only its owner or a PMO/Admin can edit it.</div>}
              <section>
                <p className="section-title">Requirement</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div><label className="field-label">Date of Entry</label><input type="date" className="input" value={form.date_of_entry} onChange={set('date_of_entry')} disabled={!canEdit} /></div>
                  <div><label className="field-label">Customer Name *</label><input className="input" value={form.customer_name} onChange={set('customer_name')} required disabled={!canEdit} /></div>
                  <div><label className="field-label">Total Account Value (₹ Lakhs)</label><input type="number" step="0.01" min="0" className="input" value={form.total_account_value_lakhs} onChange={set('total_account_value_lakhs')} disabled={!canEdit} /></div>
                  <div>
                    <label className="field-label">BD Owner</label>
                    <select className="input" value={form.bd_owner_id} onChange={set('bd_owner_id')} disabled={!canEdit || user.role === 'bd'}>
                      <option value="">Select BD</option>
                      {bds.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                  <div><label className="field-label">PMO Owner</label><input className="input" value={form.pmo_owner} onChange={set('pmo_owner')} disabled={!canEdit} /></div>
                  <div>
                    <label className="field-label">Region / State</label>
                    <select className="input" value={form.region_state} onChange={set('region_state')} disabled={!canEdit}>
                      <option value="">Select</option>
                      <optgroup label="States">{INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}</optgroup>
                      <optgroup label="Union Territories">{UNION_TERRITORIES.map(s => <option key={s} value={s}>{s}</option>)}</optgroup>
                    </select>
                  </div>
                  <Sel label="Customer Segment" k="customer_segment" opts={VOC_SEGMENTS} />
                  <div>
                    <label className="field-label">Product / Solution</label>
                    {canEdit ? (
                      <MultiSelect label="Select products" options={VOC_PRODUCTS} selected={form.product_solution} onChange={sel => setForm(f => ({ ...f, product_solution: sel }))} width="100%" />
                    ) : (
                      <input className="input" readOnly disabled value={(form.product_solution || []).join(', ')} />
                    )}
                  </div>
                  <Sel label="VOC Type" k="voc_type" opts={VOC_TYPES} required />
                  <Sel label="Business Impact" k="business_impact" opts={VOC_IMPACTS} />
                  <Sel label="Priority" k="priority" opts={VOC_PRIORITIES} required />
                  <div><label className="field-label">Est. Revenue Impact (₹L)</label><input type="number" step="0.01" min="0" className="input" value={form.revenue_impact_lakhs} onChange={set('revenue_impact_lakhs')} disabled={!canEdit} /></div>
                  <div><label className="field-label">Competitor Mentioned</label><input className="input" value={form.competitor} onChange={set('competitor')} disabled={!canEdit} /></div>
                  <div><label className="field-label">Supporting Attachment (link)</label><input className="input" value={form.attachment_url} onChange={set('attachment_url')} placeholder="https://…" disabled={!canEdit} /></div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <label className="field-label">Detailed Description of Requirement *</label>
                  <MentionTextarea className="input" rows={3} value={form.description || ''} onChange={v => setForm(f => ({ ...f, description: v }))} required disabled={!canEdit} style={{ resize: 'vertical' }} />
                </div>
              </section>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Sel label="Status" k="status" opts={VOC_STATUSES} ro={reviewerRO} />
              </div>

              {err && <p style={{ fontSize: 12, color: '#dc2626', margin: 0 }}>{err}</p>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid #e2e8f0', paddingTop: 14 }}>
                <button type="button" className="btn" onClick={onClose}>Cancel</button>
                {canEdit && <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : (isEdit ? 'Save Changes' : 'Create VOC')}</button>}
              </div>
            </form>
          ) : (
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                <MentionTextarea className="input" rows={1} placeholder="Add a comment… @Name to mention" value={comment} onChange={v => setComment(v)} style={{ minHeight: 36 }} />
                <button className="btn btn-primary btn-sm" disabled={busy || !comment.trim()} onClick={postComment}>Add</button>
              </div>
              <p className="section-title">Activity & Audit Trail</p>
              {!detail?.activity?.length ? <p style={{ fontSize: 13, color: '#94a3b8' }}>No activity yet.</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {detail.activity.map(a => (
                    <div key={a.id} style={{ borderLeft: '2px solid #e2e8f0', paddingLeft: 10 }}>
                      <div style={{ fontSize: 12 }}>
                        <span style={{ fontWeight: 700 }}>{a.user_name}</span>
                        <span style={{ color: '#94a3b8' }}> · {fmtDate(a.created_at)}</span>
                        {a.action_type === 'created' && <span style={{ color: '#059669' }}> · created</span>}
                        {a.action_type === 'status_change' && <span style={{ color: '#0ea5e9' }}> · status</span>}
                        {a.action_type === 'comment' && <span style={{ color: '#7c3aed' }}> · comment</span>}
                      </div>
                      {a.field_changed && <div style={{ fontSize: 12, color: '#334155' }}>{a.field_changed}: <span style={{ color: '#94a3b8' }}>{a.old_value}</span> → <b>{a.new_value}</b></div>}
                      {a.note && <div style={{ fontSize: 12, color: '#334155' }}>{a.note}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
