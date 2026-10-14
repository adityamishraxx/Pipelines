import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import MultiSelect from '../components/MultiSelect';
import { useAuth } from '../context/AuthContext';
import { getLeads, getBds, getDropdowns, getContacts, createContact, updateContact as updateContactApi, deleteContact as deleteContactApi } from '../services/api';
import { isOverdue, fmtDate, stripHtml, renewalStatus, renewalLabel, RENEWAL_BAND_STYLE, buildRenewedSet } from '../utils/leadHelpers';

// Small renewal badge used in the Customers list and on PO cards.
function RenewalBadge({ status, showOk = false }) {
  if (!status) return <span style={{ color: '#cbd5e1' }}>—</span>;
  if (status.band === 'ok' && !showOk) return <span style={{ color: '#94a3b8', fontSize: 12 }}>Due in {status.days}d</span>;
  const s = RENEWAL_BAND_STYLE[status.band] || RENEWAL_BAND_STYLE.ok;
  return (
    <span style={{ background: s.bg, color: s.fg, border: `1px solid ${s.border}`, borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
      {renewalLabel(status) || `Due in ${status.days}d`}
    </span>
  );
}

// Nearest upcoming expiry across a set of POs (expired counts as most urgent). Returns
// { days, band, lead } for the soonest-expiring won PO, or null when none carry a PO End Date.
// Carries the source lead so the UI can name WHICH location/PO is expiring (not the whole customer).
function nearestRenewal(pos, renewedIds) {
  let best = null, bestLead = null;
  for (const l of pos) {
    const st = renewalStatus(l, renewedIds);
    if (!st) continue;
    // "Renewed" POs still show up (green badge) but they don't count as the *nearest* urgency.
    if (st.band === 'renewed') { if (!best) { best = st; bestLead = l; } continue; }
    if (!best || best.band === 'renewed' || st.days < best.days) { best = st; bestLead = l; }
  }
  return best ? { ...best, lead: bestLead } : null;
}

// ---------------------------------------------------------------------------
// Customers page — read-only. Reached from the 👥 Customers button on Leads.
//   /customers              → Customers list. Each row shows customer-level
//                             rollups (lifetime value, quantity, services,
//                             states) and EXPANDS INLINE into a State → City
//                             tree. A city leaf opens the PO cards.
//   /customers/:code/:loc   → PO Details (read-only cards for one customer+city).
// Its own filter bar (not shared with Leads). PO cards are purely read-only.
// ---------------------------------------------------------------------------

const PHASES = ['New', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'PO Expected', 'PO Received', 'Lost', 'On Hold'];
const SOURCES = ['Channel Partner', 'KAM', 'Direct Sales', 'Lead Affiliate'];
const SCORE_BANDS = ['0–25%', '25–50%', '50–75%', '75–100%'];
const scoreBandOf = (l) => {
  const n = Number(l.confidence_score);
  if (!Number.isFinite(n)) return null;
  if (n < 25) return '0–25%';
  if (n < 50) return '25–50%';
  if (n < 75) return '50–75%';
  return '75–100%';
};

// Per-PO value for the lifetime total: actual PO value once won, else the potential TCV.
const poValue = (l) => parseFloat(l.po_actual_value_lakhs) || parseFloat(l.potential_tcv_lakhs) || 0;

const FREQ_SHORT = { monthly: 'mo', quarterly: 'qtr', semi_annual: 'half-yr', annual: 'yr' };
// Distinct service labels on a lead (used to roll up a customer's "services offered").
function serviceLabelsOf(l) {
  try {
    const lines = l.services_json ? JSON.parse(l.services_json) : [];
    return (Array.isArray(lines) ? lines : []).map(ln => ln.label).filter(Boolean);
  } catch { return []; }
}
// Full per-PO services string for the detail card.
function formatServices(l) {
  try {
    const lines = l.services_json ? JSON.parse(l.services_json) : [];
    if (!Array.isArray(lines) || lines.length === 0) return null;
    const parts = [];
    for (const line of lines) {
      const bits = [];
      if (line.hw && (line.hw.qty || line.hw.rate)) {
        const label = line.hw.sku || line.label || 'HW';
        bits.push(`${label} × ${line.hw.qty || 0}`);
      }
      if (line.svc && (line.svc.qty || line.svc.rate)) {
        const freq = line.svc.nature === 'opex' ? `/${FREQ_SHORT[line.svc.frequency] || 'mo'}` : '';
        bits.push(`${line.label || 'Service'}${freq}`);
      }
      if (bits.length) parts.push(bits.join(' + '));
    }
    return parts.length ? parts.join(', ') : null;
  } catch { return null; }
}

const CONTACT_ROLES = ['Decision Maker', 'Technical POC', 'Procurement', 'Finance', 'Operations', 'Other'];
const emptyContact = { contact_name: '', role: '', designation: '', phone: '', email: '', notes: '' };

function ContactsPanel({ customerName }) {
  const [contacts, setContacts] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState(null); // null | 'new' | contact id
  const [form, setForm] = React.useState(emptyContact);

  const load = React.useCallback(() => {
    if (!customerName) return;
    setLoading(true);
    getContacts(customerName)
      .then(data => { setContacts(Array.isArray(data) ? data : (data.contacts || [])); })
      .catch(() => setContacts([]))
      .finally(() => setLoading(false));
  }, [customerName]);

  React.useEffect(() => { load(); }, [load]);

  const startAdd = () => { setEditing('new'); setForm({ ...emptyContact, customer_name: customerName }); };
  const startEdit = (c) => { setEditing(c.id); setForm({ contact_name: c.contact_name || c.name || '', role: c.role || '', designation: c.designation || '', phone: c.phone || '', email: c.email || '', notes: c.notes || '' }); };
  const cancel = () => { setEditing(null); setForm(emptyContact); };

  const save = async () => {
    const data = { ...form, customer_name: customerName };
    try {
      if (editing === 'new') {
        await createContact(data);
      } else {
        await updateContactApi(editing, data);
      }
      cancel();
      load();
    } catch (e) {
      alert(e.response?.data?.message || 'Could not save contact.');
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this contact?')) return;
    try {
      await deleteContactApi(id);
      load();
    } catch (e) {
      alert(e.response?.data?.message || 'Could not delete contact.');
    }
  };

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div style={{ marginTop: 12, padding: '12px 16px', background: '#fafbfc', border: '1px solid #e2e8f0', borderRadius: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#334155' }}>Contacts</div>
        {editing === null && <button className="btn btn-sm btn-primary" onClick={startAdd}>+ Add Contact</button>}
      </div>

      {loading && <div style={{ color: '#94a3b8', fontSize: 12 }}>Loading contacts...</div>}

      {editing !== null && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12, padding: 12, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <div>
            <label className="field-label">Contact Name *</label>
            <input className="input" value={form.contact_name} onChange={e => setF('contact_name', e.target.value)} placeholder="Name" />
          </div>
          <div>
            <label className="field-label">Role</label>
            <select className="input" value={form.role} onChange={e => setF('role', e.target.value)}>
              <option value="">Select role</option>
              {CONTACT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Designation</label>
            <input className="input" value={form.designation} onChange={e => setF('designation', e.target.value)} placeholder="e.g. VP Engineering" />
          </div>
          <div>
            <label className="field-label">Phone</label>
            <input className="input" value={form.phone} onChange={e => setF('phone', e.target.value)} placeholder="Phone" />
          </div>
          <div>
            <label className="field-label">Email</label>
            <input className="input" type="email" value={form.email} onChange={e => setF('email', e.target.value)} placeholder="Email" />
          </div>
          <div>
            <label className="field-label">Notes</label>
            <input className="input" value={form.notes} onChange={e => setF('notes', e.target.value)} placeholder="Notes" />
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button className="btn btn-sm" onClick={cancel}>Cancel</button>
            <button className="btn btn-sm btn-primary" onClick={save} disabled={!form.contact_name.trim()}>Save</button>
          </div>
        </div>
      )}

      {!loading && contacts.length === 0 && editing === null && (
        <div style={{ color: '#94a3b8', fontSize: 12, fontStyle: 'italic' }}>No contacts yet. Click "+ Add Contact" to add one.</div>
      )}

      {contacts.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['Name', 'Role', 'Designation', 'Phone', 'Email', 'Notes', ''].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700, color: '#64748b', borderBottom: '1px solid #e2e8f0', fontSize: 11 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {contacts.map(c => (
              <tr key={c.id}>
                <td style={{ padding: '6px 8px', borderBottom: '1px solid #f1f5f9' }}>{c.contact_name || c.name}</td>
                <td style={{ padding: '6px 8px', borderBottom: '1px solid #f1f5f9' }}>{c.role || '—'}</td>
                <td style={{ padding: '6px 8px', borderBottom: '1px solid #f1f5f9' }}>{c.designation || '—'}</td>
                <td style={{ padding: '6px 8px', borderBottom: '1px solid #f1f5f9' }}>{c.phone || '—'}</td>
                <td style={{ padding: '6px 8px', borderBottom: '1px solid #f1f5f9' }}>{c.email || '—'}</td>
                <td style={{ padding: '6px 8px', borderBottom: '1px solid #f1f5f9' }}>{c.notes || '—'}</td>
                <td style={{ padding: '6px 8px', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm" style={{ marginRight: 4, fontSize: 11 }} onClick={() => startEdit(c)}>Edit</button>
                  <button className="btn btn-sm btn-danger" style={{ fontSize: 11 }} onClick={() => remove(c.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function CustomersPage() {
  const navigate = useNavigate();
  const { code: paramCode, loc: paramLoc } = useParams();
  const { user, isAdmin } = useAuth();

  const [leads, setLeads] = useState(null);
  const [bds, setBds] = useState([]);
  const [dropdowns, setDropdowns] = useState({});
  const [err, setErr] = useState('');
  const [view, setView] = useState('customers'); // 'customers' | 'partners'
  const [expanded, setExpanded] = useState(() => new Set());           // customer_codes expanded (Customers view)
  const [expandedPartner, setExpandedPartner] = useState(() => new Set());   // partner names expanded (Partners view)
  const [expandedPC, setExpandedPC] = useState(() => new Set());       // `${partner}||${customer_code}` expanded (Partners view)

  useEffect(() => {
    getLeads().then(setLeads).catch(e => setErr(e.response?.data?.message || 'Could not load leads.'));
    getBds(user.business_unit).then(setBds).catch(() => {});
    getDropdowns().then(setDropdowns).catch(() => {});
  }, [user.business_unit]);

  // ---- Filter bar state (independent of Leads page) ----
  const [search, setSearch] = useState('');
  const [filterPhases, setFilterPhases] = useState([]);
  const [filterScores, setFilterScores] = useState([]);
  const [filterSources, setFilterSources] = useState([]);
  const [filterBDs, setFilterBDs] = useState([]);
  const [filterCustomers, setFilterCustomers] = useState([]);
  const [filterRenewal, setFilterRenewal] = useState([]);
  const [filterOverdue, setFilterOverdue] = useState(false);

  const bdNames = bds.map(b => b.name);
  const customerNames = useMemo(() => [...new Set((leads || []).map(l => l.customer_name).filter(Boolean))].sort(), [leads]);
  const sourceOpts = [...new Set([...(dropdowns.lead_source || SOURCES), ...(leads || []).map(l => l.lead_source).filter(Boolean)])];

  // Set of lead IDs that have been renewed — so their expiry badges show "Renewed" instead of nagging.
  const renewedIds = useMemo(() => buildRenewedSet(leads || []), [leads]);

  const RENEWAL_FILTER_OPTS = ['Expired', 'Due ≤ 30d', 'Due 31–60d', 'Due 61–90d', 'Due > 90d', 'Renewed'];
  const renewalBandMatch = (lead) => {
    const st = renewalStatus(lead, renewedIds);
    if (!st) return null;
    if (st.band === 'renewed') return 'Renewed';
    if (st.band === 'expired') return 'Expired';
    if (st.band === 'red') return 'Due ≤ 30d';
    if (st.band === 'amber') return 'Due 31–60d';
    if (st.band === 'yellow') return 'Due 61–90d';
    return 'Due > 90d';
  };

  const filtered = useMemo(() => {
    if (!leads) return [];
    const q = search.trim().toLowerCase();
    return leads.filter(l => {
      const text = !q || [l.customer_name, l.city, l.state, l.lead_source, l.competitor, l.lead_ref, l.customer_code]
        .some(f => f?.toLowerCase().includes(q));
      return text
        && (!filterPhases.length  || filterPhases.includes(l.phase))
        && (!filterScores.length  || filterScores.includes(scoreBandOf(l)))
        && (!filterSources.length || filterSources.includes(l.lead_source))
        && (!filterBDs.length     || filterBDs.includes(l.owner?.name))
        && (!filterCustomers.length || filterCustomers.includes(l.customer_name))
        && (!filterRenewal.length || filterRenewal.includes(renewalBandMatch(l)))
        && (!filterOverdue        || isOverdue(l));
    });
  }, [leads, search, filterPhases, filterScores, filterSources, filterBDs, filterCustomers, filterRenewal, filterOverdue, renewedIds]);

  // Group filtered leads: customer → location bucket, and customer → state → location (for the tree).
  // Also roll up lifetime value, total quantity and the set of services offered per customer.
  const customers = useMemo(() => {
    const byCust = new Map();
    for (const l of filtered) {
      const cc = l.customer_code || 'UNCODED';
      let c = byCust.get(cc);
      if (!c) { c = { customer_code: cc, customer_name: l.customer_name, locs: new Map(), pos: [], serviceLabels: new Set() }; byCust.set(cc, c); }
      c.pos.push(l);
      const lc = l.location_code || 'UNK';
      let loc = c.locs.get(lc);
      if (!loc) { loc = { location_code: lc, city: l.city || '', state: l.state || '', pos: [] }; c.locs.set(lc, loc); }
      loc.pos.push(l);
      for (const lbl of serviceLabelsOf(l)) c.serviceLabels.add(lbl);
    }
    return [...byCust.values()].map(c => {
      const locations = [...c.locs.values()].sort((a, b) => (a.city || a.location_code).localeCompare(b.city || b.location_code));
      // Group locations by state for the expandable tree.
      const stateMap = new Map();
      for (const loc of locations) {
        const sk = loc.state || 'No state';
        if (!stateMap.has(sk)) stateMap.set(sk, { state: sk, locations: [], poCount: 0 });
        const sg = stateMap.get(sk);
        sg.locations.push(loc);
        sg.poCount += loc.pos.length;
      }
      const states = [...stateMap.values()].sort((a, b) => a.state.localeCompare(b.state));
      return {
        customer_code: c.customer_code,
        customer_name: c.customer_name,
        poCount: c.pos.length,
        clv: c.pos.reduce((s, l) => s + poValue(l), 0),
        totalQty: c.pos.reduce((s, l) => s + (parseInt(l.quantity, 10) || 0), 0),
        serviceLabels: [...c.serviceLabels],
        locations,
        states,
      };
    }).sort((a, b) => a.customer_name.localeCompare(b.customer_name));
  }, [filtered]);

  // Partners view: channel partners grouped from leads where Lead Source = Channel Partner, then
  // Partner → Customer → PO. Only POs that THIS partner actually sourced are counted under them.
  const partners = useMemo(() => {
    const byPartner = new Map();
    for (const l of filtered) {
      if (l.lead_source !== 'Channel Partner') continue;
      const name = (l.channel_partner_name || '').trim();
      if (!name) continue;
      let p = byPartner.get(name);
      if (!p) { p = { name, custs: new Map(), pos: [] }; byPartner.set(name, p); }
      p.pos.push(l);
      const cc = l.customer_code || 'UNCODED';
      let cust = p.custs.get(cc);
      if (!cust) { cust = { customer_code: cc, customer_name: l.customer_name, pos: [] }; p.custs.set(cc, cust); }
      cust.pos.push(l);
    }
    return [...byPartner.values()].map(p => ({
      name: p.name,
      poCount: p.pos.length,
      customers: [...p.custs.values()].sort((a, b) => a.customer_name.localeCompare(b.customer_name)),
      wonVal: p.pos.filter(l => l.phase === 'PO Received').reduce((s, l) => s + poValue(l), 0),
      openVal: p.pos.filter(l => !['PO Received', 'Lost'].includes(l.phase)).reduce((s, l) => s + (parseFloat(l.potential_tcv_lakhs) || 0), 0),
      totalQty: p.pos.reduce((s, l) => s + (parseInt(l.quantity, 10) || 0), 0),
    })).sort((a, b) => a.name.localeCompare(b.name));
  }, [filtered]);

  const togglePartner = (name) => setExpandedPartner(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  const togglePC = (key) => setExpandedPC(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // PO Details view target (only when the URL carries both code + loc).
  const activeCustomer = useMemo(() => (paramCode ? customers.find(c => c.customer_code === paramCode) || null : null), [paramCode, customers]);
  const activeLocation = useMemo(() => ((activeCustomer && paramLoc) ? activeCustomer.locations.find(l => l.location_code === paramLoc) || null : null), [activeCustomer, paramLoc]);
  const showList = !paramLoc;

  const toggle = (cc) => setExpanded(prev => { const n = new Set(prev); n.has(cc) ? n.delete(cc) : n.add(cc); return n; });

  const anyFilterActive = !!(search || filterPhases.length || filterScores.length || filterSources.length || filterBDs.length || filterCustomers.length || filterRenewal.length || filterOverdue);
  const clearAll = () => { setSearch(''); setFilterPhases([]); setFilterScores([]); setFilterSources([]); setFilterBDs([]); setFilterCustomers([]); setFilterRenewal([]); setFilterOverdue(false); };

  const headerCell = { textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#64748b', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', letterSpacing: 0.3 };
  const bodyCell   = { padding: '12px', fontSize: 13, color: '#334155', borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' };

  const title = activeLocation ? `${activeCustomer.customer_name} · ${activeLocation.city || activeLocation.location_code}` : 'Customers';

  return (
    <Layout>
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-sm" onClick={() => navigate(activeLocation ? '/customers' : '/leads')}>← Back</button>
          <div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{title}</h1>
            {!activeLocation && <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>{customers.length} customer{customers.length === 1 ? '' : 's'}{anyFilterActive ? ' · filtered' : ''}</p>}
            {activeLocation && <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>{activeCustomer.customer_code}-{activeLocation.location_code} · {activeLocation.pos.length} PO{activeLocation.pos.length === 1 ? '' : 's'}</p>}
          </div>
        </div>
      </div>

      <div style={{ padding: 20 }}>
        {err && <div style={{ marginBottom: 16, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>{err}</div>}

        {/* ---- Filter bar (own state, not shared with Leads) ---- */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 14px' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginRight: 2 }}>Filters</span>
          <input className="input" style={{ width: 240 }} placeholder="Search customer, city, ref…" value={search} onChange={e => setSearch(e.target.value)} />
          <MultiSelect label="Phase" options={PHASES} selected={filterPhases} onChange={setFilterPhases} />
          <MultiSelect label="Lead Scoring" options={SCORE_BANDS} selected={filterScores} onChange={setFilterScores} />
          <MultiSelect label="Source" options={sourceOpts} selected={filterSources} onChange={setFilterSources} />
          <MultiSelect label="Customer" options={customerNames} selected={filterCustomers} onChange={setFilterCustomers} />
          <MultiSelect label="Renewal Due" options={RENEWAL_FILTER_OPTS} selected={filterRenewal} onChange={setFilterRenewal} />
          {isAdmin && <MultiSelect label="BD" options={bdNames} selected={filterBDs} onChange={setFilterBDs} />}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#334155' }}>
            <input type="checkbox" checked={filterOverdue} onChange={e => setFilterOverdue(e.target.checked)} /> Followup overdue only
          </label>
          {anyFilterActive && <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={clearAll}>Clear all</button>}
        </div>

        {!leads && <p style={{ color: '#94a3b8' }}>Loading…</p>}

        {/* ---- View toggle: Customers | Partners (only on the list, not on PO details) ---- */}
        {showList && (
          <div style={{ display: 'flex', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', width: 'fit-content', marginBottom: 16 }}>
            <button className="btn btn-sm" style={{ border: 'none', borderRadius: 0, background: view === 'customers' ? '#e8f2ff' : '#fff', fontWeight: view === 'customers' ? 700 : 500 }} onClick={() => setView('customers')}>Customers</button>
            <button className="btn btn-sm" style={{ border: 'none', borderRadius: 0, background: view === 'partners' ? '#e8f2ff' : '#fff', fontWeight: view === 'partners' ? 700 : 500 }} onClick={() => setView('partners')}>Partners</button>
          </div>
        )}

        {leads && showList && view === 'customers' && customers.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontStyle: 'italic' }}>
            {anyFilterActive ? 'No customers match the current filters.' : 'No customers yet.'}
          </div>
        )}
        {leads && showList && view === 'partners' && partners.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontStyle: 'italic' }}>
            {anyFilterActive ? 'No channel-partner-sourced leads match the current filters.' : 'No channel-partner-sourced leads yet.'}
          </div>
        )}

        {/* ---- PARTNERS VIEW: Channel Partner → Customer → PO cards (inline) ---- */}
        {showList && view === 'partners' && partners.length > 0 && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...headerCell, width: 32 }} />
                  <th style={headerCell}>Channel Partner</th>
                  <th style={headerCell}>Customers</th>
                  <th style={{ ...headerCell, textAlign: 'right' }}>POs</th>
                  <th style={{ ...headerCell, textAlign: 'right' }}>Won / Open</th>
                  <th style={{ ...headerCell, textAlign: 'right' }}>Total Qty</th>
                </tr>
              </thead>
              <tbody>
                {partners.map(p => {
                  const popen = expandedPartner.has(p.name);
                  const names = p.customers.map(x => x.customer_name);
                  const custSummary = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${names.length - 3} more`;
                  return (
                    <React.Fragment key={p.name}>
                      <tr style={{ cursor: 'pointer', background: popen ? '#e8f2ff' : '#fff' }} onClick={() => togglePartner(p.name)}>
                        <td style={{ ...bodyCell, textAlign: 'center', color: '#0a84ff', fontWeight: 700 }}>{popen ? '▼' : '▶'}</td>
                        <td style={bodyCell}>
                          <div style={{ fontWeight: 700, color: '#0f172a' }}>{p.name}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>{p.customers.length} customer{p.customers.length === 1 ? '' : 's'}</div>
                        </td>
                        <td style={{ ...bodyCell, fontSize: 12, color: '#475569' }}>{custSummary}</td>
                        <td style={{ ...bodyCell, textAlign: 'right', fontWeight: 700 }}>{p.poCount}</td>
                        <td style={{ ...bodyCell, textAlign: 'right', fontWeight: 700 }}>
                          <span style={{ color: '#059669' }}>₹{p.wonVal.toFixed(1)}L</span> <span style={{ color: '#cbd5e1' }}>/</span> <span>₹{p.openVal.toFixed(1)}L</span>
                        </td>
                        <td style={{ ...bodyCell, textAlign: 'right', fontWeight: 700 }}>{p.totalQty || '—'}</td>
                      </tr>

                      {popen && p.customers.map(cust => {
                        const pcKey = `${p.name}||${cust.customer_code}`;
                        const copen = expandedPC.has(pcKey);
                        const custVal = cust.pos.reduce((s, l) => s + poValue(l), 0);
                        return (
                          <React.Fragment key={pcKey}>
                            <tr style={{ cursor: 'pointer', background: '#f8fafc' }} onClick={() => togglePC(pcKey)}>
                              <td style={bodyCell} />
                              <td style={{ ...bodyCell, paddingLeft: 24 }} colSpan={5}>
                                <span style={{ color: '#0a84ff', fontWeight: 700, marginRight: 8 }}>{copen ? '▼' : '▶'}</span>
                                <strong style={{ color: '#0f172a' }}>{cust.customer_name}</strong>
                                <span style={{ fontSize: 11, color: '#0a84ff', fontFamily: 'monospace', marginLeft: 8 }}>{cust.customer_code}</span>
                                <span style={{ color: '#94a3b8', marginLeft: 8 }}>— {cust.pos.length} PO{cust.pos.length === 1 ? '' : 's'} · ₹{custVal.toFixed(1)}L</span>
                              </td>
                            </tr>
                            {copen && (
                              <tr style={{ background: '#fff' }}>
                                <td style={bodyCell} />
                                <td style={{ ...bodyCell, paddingLeft: 48 }} colSpan={5}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                    {cust.pos.map(l => <PoCard key={l.id} l={l} renewedIds={renewedIds} />)}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ---- Customers list with inline State → City tree ---- */}
        {showList && view === 'customers' && customers.length > 0 && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...headerCell, width: 32 }} />
                  <th style={headerCell}>Customer</th>
                  <th style={headerCell}>States</th>
                  <th style={{ ...headerCell, textAlign: 'right' }}>Lifetime Value</th>
                  <th style={{ ...headerCell, textAlign: 'right' }}>Total Qty</th>
                  <th style={headerCell}>Renewal Due</th>
                  <th style={headerCell}>Services Offered</th>
                </tr>
              </thead>
              <tbody>
                {customers.map(c => {
                  const open = expanded.has(c.customer_code);
                  const stateNames = c.states.map(s => s.state);
                  const statesSummary = stateNames.length === 0 ? '—' : stateNames.join(', ');
                  const svc = c.serviceLabels.length === 0 ? '—'
                    : c.serviceLabels.length <= 3 ? c.serviceLabels.join(', ')
                    : `${c.serviceLabels.slice(0, 3).join(', ')} +${c.serviceLabels.length - 3} more`;
                  const renewal = nearestRenewal(c.locations.flatMap(l => l.pos), renewedIds);
                  return (
                    <React.Fragment key={c.customer_code}>
                      {/* Customer row — click toggles the inline tree. */}
                      <tr style={{ cursor: 'pointer', background: open ? '#e8f2ff' : '#fff' }} onClick={() => toggle(c.customer_code)}>
                        <td style={{ ...bodyCell, textAlign: 'center', color: '#0a84ff', fontWeight: 700 }}>{open ? '▼' : '▶'}</td>
                        <td style={bodyCell}>
                          <div style={{ fontWeight: 700, color: '#0f172a' }}>{c.customer_name}</div>
                          <div style={{ fontSize: 11, color: '#0a84ff', fontFamily: 'monospace' }}>{c.customer_code} · {c.poCount} PO{c.poCount === 1 ? '' : 's'}</div>
                        </td>
                        <td style={bodyCell}>{statesSummary}</td>
                        <td style={{ ...bodyCell, textAlign: 'right', fontWeight: 700 }}>₹{c.clv.toFixed(1)}L</td>
                        <td style={{ ...bodyCell, textAlign: 'right', fontWeight: 700 }}>{c.totalQty || '—'}</td>
                        <td style={bodyCell}>
                          {renewal ? (
                            <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
                              <RenewalBadge status={renewal} />
                              {/* Name the location so it's clear this is ONE PO expiring, not the whole customer. */}
                              <span style={{ fontSize: 10, color: '#94a3b8' }}>{renewal.lead.city || renewal.lead.location_code || '—'}{c.poCount > 1 ? ' (earliest)' : ''}</span>
                            </span>
                          ) : <span style={{ color: '#cbd5e1' }}>—</span>}
                        </td>
                        <td style={{ ...bodyCell, fontSize: 12, color: '#475569' }}>{svc}</td>
                      </tr>

                      {/* Inline tree: State header rows + clickable City rows → PO cards. */}
                      {open && c.states.map(s => (
                        <React.Fragment key={`${c.customer_code}-${s.state}`}>
                          <tr style={{ background: '#f8fafc' }}>
                            <td style={bodyCell} />
                            <td style={{ ...bodyCell, paddingLeft: 24, fontWeight: 700, color: '#334155' }} colSpan={6}>
                              📍 {s.state} <span style={{ color: '#94a3b8', fontWeight: 500 }}>— {s.poCount} PO{s.poCount === 1 ? '' : 's'}</span>
                            </td>
                          </tr>
                          {s.locations.map(loc => (
                            <tr key={`${c.customer_code}-${loc.location_code}`} style={{ cursor: 'pointer', background: '#fff' }}
                                onClick={() => navigate(`/customers/${c.customer_code}/${loc.location_code}`)}>
                              <td style={bodyCell} />
                              <td style={{ ...bodyCell, paddingLeft: 48 }} colSpan={6}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                                  <span>
                                    🏙 {loc.city || <span style={{ color: '#94a3b8' }}>No city</span>}
                                    <span style={{ fontSize: 11, color: '#0a84ff', fontFamily: 'monospace', marginLeft: 8 }}>{loc.location_code}</span>
                                    <span style={{ color: '#94a3b8', marginLeft: 8 }}>— {loc.pos.length} PO{loc.pos.length === 1 ? '' : 's'}</span>
                                  </span>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                                    {/* Per-location renewal — this is the badge the user actually needs: which city/PO is due. */}
                                    <RenewalBadge status={nearestRenewal(loc.pos, renewedIds)} />
                                    <span style={{ color: '#0a84ff', fontWeight: 700 }}>›</span>
                                  </span>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      ))}
                      {/* Contacts panel — shown when customer row is expanded */}
                      {open && (
                        <tr>
                          <td style={bodyCell} />
                          <td style={{ ...bodyCell, paddingLeft: 24 }} colSpan={6}>
                            <ContactsPanel customerName={c.customer_name} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ---- PO Details (one customer + one city) — read-only cards ---- */}
        {paramLoc && !activeLocation && leads && (
          <div className="card" style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontStyle: 'italic' }}>
            Not found, or hidden by the current filters.
          </div>
        )}
        {activeLocation && (
          <>
            {(() => {
              const totalTcv = activeLocation.pos.reduce((s, l) => s + (parseFloat(l.potential_tcv_lakhs) || 0), 0);
              const totalAcv = activeLocation.pos.reduce((s, l) => s + (parseFloat(l.acv_lakhs) || 0), 0);
              const won = activeLocation.pos.filter(l => l.phase === 'PO Received').length;
              return (
                <div className="card" style={{ display: 'flex', gap: 24, padding: '12px 16px', marginBottom: 16, flexWrap: 'wrap' }}>
                  <div><div style={{ fontSize: 11, color: '#94a3b8' }}>POs</div><div style={{ fontSize: 18, fontWeight: 700 }}>{activeLocation.pos.length}</div></div>
                  <div><div style={{ fontSize: 11, color: '#94a3b8' }}>Won</div><div style={{ fontSize: 18, fontWeight: 700, color: '#059669' }}>{won}</div></div>
                  <div><div style={{ fontSize: 11, color: '#94a3b8' }}>Total TCV</div><div style={{ fontSize: 18, fontWeight: 700 }}>₹{totalTcv.toFixed(1)}L</div></div>
                  <div><div style={{ fontSize: 11, color: '#94a3b8' }}>Total ACV</div><div style={{ fontSize: 18, fontWeight: 700 }}>₹{totalAcv.toFixed(1)}L</div></div>
                </div>
              );
            })()}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {activeLocation.pos.map(l => <PoCard key={l.id} l={l} renewedIds={renewedIds} />)}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

// Read-only PO card — shared by the Customers PO-details view and the Partners drill-down.
function PoCard({ l, renewedIds }) {
  const srcName = l.channel_partner_name || l.kam_name || l.affiliate_name || null;
  const sourceLine = l.lead_source ? `${l.lead_source}${srcName ? ' · ' + srcName : ''}` : '—';
  const svcs = formatServices(l);
  const notes = stripHtml(l.additional_notes);
  const renewal = renewalStatus(l, renewedIds);
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, padding: '14px 16px', background: '#e8f2ff', borderBottom: '1px solid #c7d2fe' }}>
        <Stat label="BD" value={l.owner?.name || '—'} />
        <Stat label="PO Number" value={l.po_number || '—'} />
        <Stat label="Quantity" value={l.quantity || '—'} />
        <Stat label="TCV" value={l.potential_tcv_lakhs ? `₹${l.potential_tcv_lakhs}L` : '—'} />
        <Stat label="ACV" value={l.acv_lakhs ? `₹${l.acv_lakhs}L/yr` : '—'} />
        <Stat label="Phase" value={l.phase} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 24, rowGap: 8, padding: '14px 16px' }}>
        <Detail label="Lead Ref" value={l.lead_ref || '—'} mono />
        <Detail label="Lead Source" value={sourceLine} />
        <Detail label="State" value={l.state || '—'} />
        <Detail label="City" value={l.city || '—'} />
        <Detail label="PO Received Date" value={l.po_received_date ? fmtDate(l.po_received_date) : '—'} />
        <Detail label="Hardware Requested Date" value={l.device_requested_date ? fmtDate(l.device_requested_date) : '—'} />
        <Detail label="PO Period" value={(l.service_start_date || l.service_end_date)
          ? `${l.service_start_date ? fmtDate(l.service_start_date) : '—'} → ${l.service_end_date ? fmtDate(l.service_end_date) : '—'}`
          : '—'} full />
        {renewal && (
          <div style={{ gridColumn: '1 / -1', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#64748b', fontWeight: 600 }}>Renewal:</span>
            <RenewalBadge status={renewal} showOk />
          </div>
        )}
        {svcs && <Detail label="Services" value={svcs} full />}
        {l.lost_reason && l.phase === 'Lost' && <Detail label="Lost Reason" value={l.lost_reason} full />}
        {notes && <Detail label="Notes" value={notes} full />}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.3, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>{value}</div>
    </div>
  );
}

function Detail({ label, value, mono = false, full = false }) {
  return (
    <div style={{ gridColumn: full ? '1 / -1' : undefined, fontSize: 12 }}>
      <span style={{ color: '#64748b', fontWeight: 600 }}>{label}: </span>
      <span style={{ color: '#0f172a', fontFamily: mono ? 'monospace' : undefined }}>{value}</span>
    </div>
  );
}
