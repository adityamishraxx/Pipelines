import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import Layout from '../components/Layout';
import LeadForm from '../components/LeadForm';
import CustomLeadForm from '../components/CustomLeadForm';
import ActivityLogView from '../components/ActivityLogView';
import MultiSelect from '../components/MultiSelect';
import KanbanView from '../components/KanbanView';
import GlobalPosView from '../components/GlobalPosView';
import BulkUploadModal from '../components/BulkUploadModal';
import ExpansionPicker from '../components/ExpansionPicker';
import NotificationBell from '../components/NotificationBell';
import { parseServiceLines } from '../components/ServicesOffered';
import { useAuth } from '../context/AuthContext';
import { getLeads, getLead, deleteLead, updateLead, getBds, bulkUpdateLeads, getStageHistory, getDropdowns, getBusinessUnitConfig, getTat } from '../services/api';
import { PHASE_BADGE } from '../utils/constants';
import { fmtDate, isTATBreached, isOverdue, hasConfidence, confidenceTrend, buildRotMetrics, getRotState, stripHtml, primaryContact, formatOtherContacts, stageAging, renewalStatus, renewalLabel, RENEWAL_BAND_STYLE, buildRenewedSet } from '../utils/leadHelpers';
import { sortWithWonLast } from '../utils/leadPriority';
import { exportRowsToPdf } from '../utils/pdfExport';
import { writeFormattedSheet } from '../utils/excelExport';

// Compact date-range picker for the Follow-up filter. Single button opens a small popover
// with From + To date inputs. Shows the selected range as a short label on the button.
function FollowUpDatePicker({ from, to, onFromChange, onToChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  const hasRange = from || to;
  const shortLabel = hasRange
    ? `${from ? from.slice(5) : '…'} → ${to ? to.slice(5) : '…'}`
    : 'Follow-up';
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="input" onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', height: 30,
          padding: '5px 8px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
          borderColor: hasRange ? '#0a84ff' : '#cbd5e1', background: hasRange ? '#e8f2ff' : '#fff',
          color: hasRange ? '#0066d6' : '#334155' }}>
        📅 {shortLabel} <span style={{ fontSize: 10, color: '#64748b' }}>▾</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: '#fff',
          border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.08)',
          zIndex: 20, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 200 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#334155' }}>
            From
            <input type="date" className="input" style={{ width: '100%', fontSize: 11, marginTop: 2 }}
              value={from} onChange={e => onFromChange(e.target.value)} />
          </label>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#334155' }}>
            To
            <input type="date" className="input" style={{ width: '100%', fontSize: 11, marginTop: 2 }}
              value={to} min={from || undefined} onChange={e => onToChange(e.target.value)} />
          </label>
          {hasRange && (
            <button type="button" className="btn btn-sm" style={{ fontSize: 11, justifyContent: 'center' }}
              onClick={() => { onFromChange(''); onToChange(''); }}>Clear</button>
          )}
        </div>
      )}
    </div>
  );
}

const PHASES = ['New', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'PO Expected', 'PO Received', 'Lost', 'On Hold'];
const SOURCES = ['Channel Partner', 'KAM', 'Direct Sales', 'Lead Affiliate'];

// Confidence band of a lead (matches the Dashboard's Pipeline Confidence card).
const leadConfBand = (l) => {
  if (l.confidence_score === null || l.confidence_score === undefined) return null;
  const c = Number(l.confidence_score);
  return c >= 60 ? 'high' : c >= 30 ? 'medium' : 'low';
};

// Lead-scoring filter buckets (quartiles of the confidence %). Replaces the old Rating filter.
const SCORE_BANDS = ['0–25%', '25–50%', '50–75%', '75–100%'];
const scoreBandOf = (l) => {
  const n = Number(l.confidence_score);
  if (!Number.isFinite(n)) return null;   // unscored leads fall out when a band filter is active
  if (n < 25) return '0–25%';
  if (n < 50) return '25–50%';
  if (n < 75) return '50–75%';
  return '75–100%';
};

// Week-over-week confidence trend indicator shown beside the score.
function TrendArrow({ trend }) {
  if (trend === 'up')   return <span title="Up vs last week"   style={{ color: '#16a34a', fontSize: 12, fontWeight: 700 }}>▲</span>;
  if (trend === 'down') return <span title="Down vs last week" style={{ color: '#dc2626', fontSize: 12, fontWeight: 700 }}>▼</span>;
  if (trend === 'hold') return <span title="Frozen (On Hold)"  style={{ color: '#0ea5e9', fontSize: 12 }}>❄</span>;
  return <span title="No change vs last week" style={{ color: '#94a3b8', fontSize: 9 }}>●</span>;
}

export default function LeadsPage() {
  const { user, isAdmin, canEdit, canFull, canAct } = useAuth();
  // Custom (wizard-built) businesses render a schema-driven lead form from their template; the three
  // originals keep their hand-built LeadForm unchanged.
  const isCustomBusiness = !['signage', 'jhes', 'surveillance'].includes(user.business_unit);
  // Create and delete are Full-Access capabilities. Chains is module-level configuration, which
  // Edit deliberately excludes. Bulk update mutates records, so it needs Edit.
  // canAct is false for a Read-only Super Admin, who sees no action affordance on any platform.
  const leadsCanEdit = canAct && canEdit('leads');
  const leadsCanFull = canAct && canFull('leads');
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const [leads, setLeads] = useState([]);
  const [stageHistory, setStageHistory] = useState([]);
  const [bds, setBds] = useState([]);
  const [dropdowns, setDropdowns] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterPhases, setFilterPhases] = useState([]);
  const [filterTemps, setFilterTemps] = useState([]);      // kept for the Dashboard "hot" deep-link
  const [filterScores, setFilterScores] = useState([]);    // Lead Scoring bands (replaces Rating in the bar)
  const [filterSources, setFilterSources] = useState([]);
  const [filterBDs, setFilterBDs] = useState([]);
  const [filterCustomers, setFilterCustomers] = useState([]);
  const [filterOverdue, setFilterOverdue] = useState(false);
  const [filterFollowFrom, setFilterFollowFrom] = useState('');  // Next Follow-up date range filter
  const [filterFollowTo, setFilterFollowTo] = useState('');
  const [filterConf, setFilterConf] = useState('');   // '' | 'high' | 'medium' | 'low' (from the Dashboard)
  const [filterIds, setFilterIds] = useState([]);     // explicit lead-id set (from Dashboard drill-downs)
  const [idsLabel, setIdsLabel] = useState('');       // human label for the id-set chip
  const [view, setView] = useState('table');
  const [showForm, setShowForm] = useState(false);
  const [editLead, setEditLead] = useState(null);
  // Expansion flow: picker modal + the "source" lead (fetched full, with contacts) whose static
  // fields prefill the new lead. Reset together with the form.
  const [showExpansionPicker, setShowExpansionPicker] = useState(false);
  const [expansionFrom, setExpansionFrom] = useState(null);
  const [expansionMode, setExpansionMode] = useState(null); // 'additional' | 'renewal'
  const [tab, setTab] = useState('form');
  const [deleteId, setDeleteId] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkAction, setBulkAction] = useState(null);
  const [bulkValue, setBulkValue] = useState('');
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [cameFromDashboard, setCameFromDashboard] = useState(false);
  const [showChains, setShowChains] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [buConfig, setBuConfig] = useState(null);
  const [tatMap, setTatMap] = useState({});                 // { phase: tat_days } for aging colour

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [ld, sh] = await Promise.all([getLeads(), getStageHistory()]);
    setLeads(ld); setStageHistory(sh);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => { getBds(user.business_unit).then(setBds); }, [user.business_unit]);
  useEffect(() => { getBusinessUnitConfig(user.business_unit).then(setBuConfig).catch(() => {}); }, [user.business_unit]);
  // Per-stage TAT days (SLA target), used to colour the Aging column against each stage's own target.
  useEffect(() => {
    getTat(user.business_unit)
      .then(r => { const m = {}; for (const s of (r?.stages || [])) m[s.stage] = Number(s.tat_days); setTatMap(m); })
      .catch(() => setTatMap({}));
  }, [user.business_unit]);
  useEffect(() => { getDropdowns().then(setDropdowns).catch(() => {}); }, []);

  // Pre-filter from dashboard KPI/phase-chip clicks
  useEffect(() => {
    const f = searchParams.get('filter');
    const phase = searchParams.get('phase');
    const bd = searchParams.get('bd');
    const source = searchParams.get('source');
    const conf = searchParams.get('conf');
    const ids = searchParams.get('ids');
    if (!f && !phase && !bd && !source && !conf && !ids) return;
    setCameFromDashboard(true);
    if (f === 'hot') setFilterTemps(['Hot']);
    else if (f === 'won') setFilterPhases(['PO Received']);
    else if (f === 'overdue') setFilterOverdue(true);
    else if (f === 'active') setFilterPhases(['New', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'PO Expected']);
    if (phase) setFilterPhases(phase.split(','));
    if (source) setFilterSources(source.split(','));
    if (bd && isAdmin) setFilterBDs([bd]);
    if (conf) setFilterConf(conf);
    if (ids) { setFilterIds(ids.split(',').filter(Boolean)); setIdsLabel(searchParams.get('idslabel') || 'Selected leads'); }
  }, [searchParams, isAdmin]);

  // Deep link from the Forecast dashboard (?lead=<id>&from=forecast): open that lead's detail
  // straight away, and offer a way back. The forecast's column selection is persisted client-side,
  // so returning there restores the view the user left.
  const deepLinkId = searchParams.get('lead');
  const cameFromForecast = searchParams.get('from') === 'forecast';
  const cameFromActivity = searchParams.get('from') === 'activity';
  const [deepLinkError, setDeepLinkError] = useState('');
  const navTs = location.state?.ts;
  useEffect(() => {
    if (!deepLinkId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const full = await getLead(deepLinkId);
        if (cancelled) return;
        setTab('form'); setEditLead(full); setShowForm(true);
      } catch {
        if (!cancelled) setDeepLinkError('That lead could not be opened — it may belong to another team member.');
      }
    })();
    return () => { cancelled = true; };
  }, [deepLinkId, navTs]);

  const { lastEntry: rotLastEntry, teamAvg: rotTeamAvg } = useMemo(() => buildRotMetrics(stageHistory), [stageHistory]);
  const renewedIds = useMemo(() => buildRenewedSet(leads), [leads]);

  // Ranked with the shared prioritization order (stage → confidence → chain → TCV), with
  // won leads pushed to the very end — see utils/leadPriority.js. Re-derived per render, so
  // the list always reflects current scores rather than the server's sr_no ordering.
  const filtered = useMemo(() => sortWithWonLast(leads.filter(l => {
    const s = search.toLowerCase();
    const matchSearch = !s || [l.customer_name, l.city, l.state, l.lead_source, l.competitor, l.device_sku, l.lead_ref, l.customer_code]
      .some(f => f?.toLowerCase().includes(s));
    // Next follow-up date range filter
    const followOk = (() => {
      if (!filterFollowFrom && !filterFollowTo) return true;
      if (!l.next_followup_date) return false;
      if (filterFollowFrom && l.next_followup_date < filterFollowFrom) return false;
      if (filterFollowTo && l.next_followup_date > filterFollowTo) return false;
      return true;
    })();
    return matchSearch
      && (!filterPhases.length || filterPhases.includes(l.phase))
      && (!filterTemps.length || filterTemps.includes(l.lead_temperature))
      && (!filterScores.length || filterScores.includes(scoreBandOf(l)))
      && (!filterSources.length || filterSources.includes(l.lead_source))
      && (!filterBDs.length || filterBDs.includes(l.owner?.name))
      && (!filterCustomers.length || filterCustomers.includes(l.customer_name))
      && (!filterOverdue || isOverdue(l))
      && followOk
      && (!filterConf || leadConfBand(l) === filterConf)
      && (!filterIds.length || filterIds.includes(String(l.id)));
  })), [leads, search, filterPhases, filterTemps, filterScores, filterSources, filterBDs, filterCustomers, filterOverdue, filterFollowFrom, filterFollowTo, filterConf, filterIds]);

  const openCount = filtered.filter(l => !['Lost', 'On Hold', 'PO Received'].includes(l.phase)).length;

  const openNew = () => { setEditLead(null); setExpansionFrom(null); setExpansionMode(null); setTab('form'); setShowForm(true); };

  // + Additional PO flow: user picks a source PO (and mode) in the modal → we fetch the full source
  // lead (with contacts) → open the lead form prefilled. mode 'additional' copies statics only;
  // 'renewal' copies statics + services + deal size and links the new lead to the source PO.
  const openExpansionFrom = async (sourceLead, mode) => {
    try {
      const full = await getLead(sourceLead.id);
      setExpansionFrom(full);
      setExpansionMode(mode || 'additional');
      setEditLead(null);
      setShowExpansionPicker(false);
      setTab('form');
      setShowForm(true);
    } catch {
      setDeepLinkError('Could not load that customer’s details.');
      setShowExpansionPicker(false);
    }
  };
  // Fetch the FULL lead (the list row from GET /leads omits contacts, stage history, etc.) so the
  // edit form shows the saved POC contacts instead of an empty section.
  const openEdit = async (l) => {
    setTab('form');
    const full = await getLead(l.id).catch(() => l);
    setEditLead(full);
    setShowForm(true);
  };
  const closeForm = () => {
    setShowForm(false); setEditLead(null); setExpansionFrom(null); setExpansionMode(null);
    if (searchParams.get('lead')) {
      searchParams.delete('lead');
      setSearchParams(searchParams, { replace: true });
    }
  };
  const onSaved = () => { closeForm(); fetchAll(); };

  const handlePhaseChangeKanban = async (leadId, newPhase) => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead || lead.phase === newPhase) return;
    // Resend the lead's existing Services Offered lines so the backend re-persists them unchanged —
    // omitting `services` would make the server treat it as an empty list and wipe them (and zero TCV).
    await updateLead(leadId, {
      customer_name: lead.customer_name, owner_id: lead.owner_id, business_unit: lead.business_unit,
      lead_source: lead.lead_source, channel_partner_name: lead.channel_partner_name, kam_name: lead.kam_name,
      new_or_renewal: lead.new_or_renewal, lead_temperature: lead.lead_temperature, competitor: lead.competitor,
      potential_tcv_lakhs: lead.potential_tcv_lakhs, tcv_manual: lead.tcv_manual, contract_period_months: lead.contract_period_months,
      po_validity_months: lead.po_validity_months, phase: newPhase, phase_date: undefined,
      services: parseServiceLines(lead.services_json),
      device_requested_date: lead.device_requested_date,
      additional_notes: lead.additional_notes,
    });
    fetchAll();
  };

  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const selectAll = () => setSelectedIds(new Set(filtered.map(l => l.id)));
  const clearSelect = () => setSelectedIds(new Set());

  const executeBulk = async () => {
    if (!bulkValue || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    if (bulkAction === 'reassign') await bulkUpdateLeads(ids, { owner_id: bulkValue });
    else if (bulkAction === 'phase') await bulkUpdateLeads(ids, { phase: bulkValue });
    setBulkAction(null); setBulkValue(''); clearSelect(); fetchAll();
  };

  const executeBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    setBulkDeleting(true);
    try {
      await Promise.all(ids.map(id => deleteLead(id)));
    } finally {
      setBulkDeleting(false);
      setConfirmBulkDelete(false);
      clearSelect();
      fetchAll();
    }
  };

  // True when every currently-filtered lead is selected (drives the header select-all checkbox).
  const allSelected = filtered.length > 0 && filtered.every(l => selectedIds.has(l.id));
  const toggleSelectAll = () => { if (allSelected) clearSelect(); else selectAll(); };

  const exportExcel = async () => {
    const toExport = selectedIds.size > 0 ? filtered.filter(l => selectedIds.has(l.id)) : filtered;
    const XLSX = await import('xlsx');

    // Services Offered is now one unified JSON list for every business (services_json). Render it as a
    // single readable column rather than per-service columns, so a mixed export stays consistent.
    const FREQ_SHORT = { monthly: 'mo', quarterly: 'qtr', semi_annual: 'half-yr', annual: 'yr' };
    const fmtComp = (c) => c ? `₹${c.rate ?? 0}×${c.qty ?? 0} ${c.nature === 'opex' ? `opex/${FREQ_SHORT[c.frequency] || c.frequency}` : 'capex'}` : '';
    const formatServiceLines = (l) => {
      let lines = [];
      try { lines = l.services_json ? JSON.parse(l.services_json) : []; } catch {}
      return lines.map(line => {
        const parts = [];
        if (line.hw) parts.push(`HW ${line.hw.sku ? line.hw.sku + ' ' : ''}${fmtComp(line.hw)}`);
        if (line.svc) parts.push(`SVC ${fmtComp(line.svc)}`);
        return `${line.label} [${line.category}]: ${parts.join(', ')}`;
      }).join(' | ');
    };

    const rows = toExport.map(l => {
      const poc = primaryContact(l);
      const row = {
        'Sr No': l.sr_no, 'Lead Ref': l.lead_ref || '', 'Customer Code': l.customer_code || '',
        'Business Unit': (l.business_unit || '').toUpperCase(), 'Customer': l.customer_name,
        'City': l.city || '', 'State': l.state || '', 'Lead Owner': l.owner?.name || '',
        // Contact / POC details (primary contact; any additional POCs listed in "Other Contacts").
        'Contact Name': poc.name, 'Contact Phone': poc.phone, 'Contact Email': poc.email, 'Contact Designation': poc.designation,
        'Other Contacts': formatOtherContacts(l),
        'Lead Source': l.lead_source, 'Channel Partner': l.channel_partner_name || '', 'KAM Name': l.kam_name || '', 'Affiliate Name': l.affiliate_name || '',
        'New/Renewal': l.new_or_renewal, 'Lead Rating': l.lead_temperature, 'Competitor': l.competitor || '',
        'Quantity (Total)': l.quantity, 'Potential TCV (L)': l.potential_tcv_lakhs, 'Contract Period (Mo)': l.contract_period_months,
        'PO Validity (Mo)': l.po_validity_months || '', 'ACV (L/yr)': l.acv_lakhs, 'Contract Value (L)': l.contract_value_lakhs || '',
        'Phase': l.phase, 'Confidence %': l.confidence_score ?? '', 'Next Follow-Up': l.next_followup_date || '', 'PO Expected Date': l.po_expected_date || '',
        'PO Start': l.service_start_date || '', 'PO End': l.service_end_date || '',
        'Billing Cycle': l.billing_cycle || '', 'Payment Terms': l.payment_terms || '',
      };

      // Unified Services Offered summary + the hardware-expected date.
      row['Services Offered'] = formatServiceLines(l);
      row['Hardware Requested Date'] = l.device_requested_date || '';
      row['Actual PO Value (L)'] = l.po_actual_value_lakhs || '';
      row['Lost Reason'] = l.lost_reason || '';
      row['Additional Notes'] = stripHtml(l.additional_notes);
      row['Created At'] = l.createdAt ? fmtDate(l.createdAt) : '';
      return row;
    });
    writeFormattedSheet(XLSX, rows, 'Leads', `Sales_CRM_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // PDF export shows a curated, readable column set (not all 30+ Excel columns —
  // full detail belongs in Excel; PDF is for a quick printable summary).
  const exportPdf = () => {
    const toExport = selectedIds.size > 0 ? filtered.filter(l => selectedIds.has(l.id)) : filtered;
    if (!toExport.length) return;
    exportRowsToPdf({
      title: 'Pipelines — Leads',
      subtitle: `${toExport.length} lead${toExport.length > 1 ? 's' : ''} · generated ${fmtDate(new Date())}`,
      tables: [{
        columns: ['Sr', 'Customer', 'BD', 'Phase', 'Rating', 'TCV (₹L)', 'Conf %', 'Source', 'Next Follow-Up'],
        rows: toExport.map(l => [
          l.sr_no, l.customer_name, l.owner?.name?.split(' ')[0] || '', l.phase, l.lead_temperature,
          l.potential_tcv_lakhs, hasConfidence(l) ? `${Math.round(Number(l.confidence_score))}%` : '—', l.lead_source,
          ['On Hold', 'Lost', 'PO Received'].includes(l.phase) ? '—' : (l.next_followup_date ? fmtDate(l.next_followup_date) : '—'),
        ]),
      }],
      filename: `Sales_CRM_${new Date().toISOString().slice(0, 10)}.pdf`,
    });
  };

  const bdNames = bds.map(b => b.name);
  const customerNames = useMemo(() => [...new Set(leads.map(l => l.customer_name).filter(Boolean))].sort(), [leads]);
  // Filter options come from the per-business dropdowns, unioned with any values present in the data.
  const sourceOpts = [...new Set([...(dropdowns.lead_source || SOURCES), ...leads.map(l => l.lead_source).filter(Boolean)])];

  return (
    <Layout>
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {cameFromDashboard && <button className="btn btn-sm" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => { const dtab = searchParams.get('dtab'); navigate(dtab ? `/dashboard?tab=${dtab}` : '/dashboard'); }}>← Dashboard</button>}
          {cameFromForecast && <button className="btn btn-sm" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => navigate('/forecast')}>← Inventory</button>}
          {cameFromActivity && <button className="btn btn-sm" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => navigate('/activity')}>← Activity</button>}
          <div>
            <h1 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Leads</h1>
            <p style={{ margin: '1px 0 0', fontSize: 11, color: '#64748b' }}>{openCount} active · {filtered.length} total</p>
          </div>
          <NotificationBell />
        </div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          {leadsCanFull && <button className="btn btn-sm" style={{ fontSize: 11, padding: '8px 12px' }} onClick={() => setShowChains(true)}>🏢 Chains</button>}
          <button className="btn btn-sm" style={{ fontSize: 11, padding: '8px 12px' }} onClick={exportExcel}>Export Excel</button>
          <button className="btn btn-sm" style={{ fontSize: 11, padding: '8px 12px' }} onClick={exportPdf}>Export PDF</button>
          <div style={{ display: 'flex', border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
            <button className="btn btn-sm" style={{ border: 'none', borderRadius: 0, fontSize: 11, padding: '8px 12px', background: view === 'table' ? '#e8f2ff' : '#fff' }} onClick={() => setView('table')}>Table</button>
            <button className="btn btn-sm" style={{ border: 'none', borderRadius: 0, fontSize: 11, padding: '8px 12px', background: view === 'kanban' ? '#e8f2ff' : '#fff' }} onClick={() => setView('kanban')}>Kanban</button>
          </div>
          <button className="btn btn-sm" style={{ fontSize: 11, padding: '8px 12px' }} title="View customers and their POs by city" onClick={() => navigate('/customers')}>👥 Customers</button>
          {isAdmin && <button className="btn btn-sm" style={{ fontSize: 11, padding: '8px 12px' }} onClick={() => setShowBulkUpload(true)}>⬆ Bulk Import</button>}
          {leadsCanFull && <button className="btn btn-sm btn-primary" style={{ fontSize: 11, padding: '8px 14px' }} onClick={openNew}>+ New Lead</button>}
          {leadsCanFull && <button className="btn btn-sm" style={{ fontSize: 11, padding: '8px 14px', background: '#f1f5f9', color: '#0066d6', borderColor: '#c7d2fe' }} onClick={() => setShowExpansionPicker(true)}>+ Additional PO</button>}
        </div>
      </div>

      <div style={{ padding: 20 }}>
        {deepLinkError && (
          <div style={{ marginBottom: 16, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 10, padding: '10px 14px', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <span>{deepLinkError}</span>
            <button className="btn btn-sm" onClick={() => setDeepLinkError('')}>Dismiss</button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'nowrap', alignItems: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '6px 10px' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#334155', whiteSpace: 'nowrap' }}>Filters</span>
          <input className="input" style={{ width: 160, height: 30, fontSize: 11, padding: '4px 8px' }} placeholder="Search customer, city…" value={search} onChange={e => setSearch(e.target.value)} />
          <MultiSelect label="Phase" options={PHASES} selected={filterPhases} onChange={setFilterPhases} />
          <MultiSelect label="Scoring" options={SCORE_BANDS} selected={filterScores} onChange={setFilterScores} />
          <MultiSelect label="Source" options={sourceOpts} selected={filterSources} onChange={setFilterSources} />
          <MultiSelect label="Customer" options={customerNames} selected={filterCustomers} onChange={setFilterCustomers} />
          {isAdmin && <MultiSelect label="BD" options={bdNames} selected={filterBDs} onChange={setFilterBDs} />}
          {/* Follow-up date range — single button with dropdown */}
          <FollowUpDatePicker from={filterFollowFrom} to={filterFollowTo}
            onFromChange={setFilterFollowFrom} onToChange={setFilterFollowTo} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#334155', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={filterOverdue} onChange={e => setFilterOverdue(e.target.checked)} /> Followup overdue
          </label>
          {/* Rating has no bar control anymore, but the Dashboard "Hot leads" KPI still deep-links to
              it — surface it as a dismissible chip so the user can see and clear that filter. */}
          {filterTemps.length > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 999, padding: '4px 10px', color: '#9a3412' }}>
              Rating: {filterTemps.join(', ')}
              <button type="button" onClick={() => setFilterTemps([])} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#c2410c', fontWeight: 700, padding: 0 }}>✕</button>
            </span>
          )}
          {filterConf && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, background: '#e8f2ff', border: '1px solid #c7d2fe', borderRadius: 999, padding: '4px 10px', color: '#0066d6' }}>
              Confidence: {filterConf === 'high' ? 'High ≥60' : filterConf === 'medium' ? 'Medium 30–59' : 'Low <30'}
              <button type="button" onClick={() => setFilterConf('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#0a84ff', fontWeight: 700, padding: 0 }}>✕</button>
            </span>
          )}
          {filterIds.length > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 999, padding: '4px 10px', color: '#065f46' }}>
              {idsLabel} ({filterIds.length})
              <button type="button" onClick={() => { setFilterIds([]); setIdsLabel(''); }} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#059669', fontWeight: 700, padding: 0 }}>✕</button>
            </span>
          )}
        </div>

        {isAdmin && selectedIds.size > 0 && (
          <div className="card-sm" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, background: '#e8f2ff', borderColor: '#c7d2fe' }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>{selectedIds.size} selected</span>
            <button className="btn btn-sm" onClick={() => { setBulkAction('reassign'); setBulkValue(''); }}>Reassign</button>
            <button className="btn btn-sm" onClick={() => { setBulkAction('phase'); setBulkValue(''); }}>Change Phase</button>
            {bulkAction && (
              <>
                <select className="input" style={{ width: 160 }} value={bulkValue} onChange={e => setBulkValue(e.target.value)}>
                  <option value="">Select…</option>
                  {(bulkAction === 'reassign' ? bds.map(b => ({ id: b.id, label: b.name })) : PHASES.map(p => ({ id: p, label: p })))
                    .map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
                <button className="btn btn-sm btn-primary" onClick={executeBulk}>Apply</button>
              </>
            )}
            {leadsCanFull && <button className="btn btn-sm btn-danger" onClick={() => setConfirmBulkDelete(true)}>Delete</button>}
            <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={clearSelect}>Clear</button>
          </div>
        )}

        {loading ? <p style={{ color: '#94a3b8' }}>Loading…</p> : view === 'kanban' ? (
          <KanbanView leads={filtered} onOpen={openEdit} onPhaseChange={handlePhaseChangeKanban} tatMap={tatMap} />
        ) : (
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  {isAdmin && (
                    <th onClick={e => e.stopPropagation()} style={{ width: 32 }}>
                      <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                        title={allSelected ? 'Deselect all' : `Select all ${filtered.length}`} />
                    </th>
                  )}
                  <th>Sr</th><th>Customer</th>{isAdmin && <th>BD</th>}<th>Phase</th>
                  <th title="Days in current stage (coloured vs this stage's TAT target)">Aging</th>
                  <th>Location</th>
                  <th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>TCV (₹L)</th><th>Scoring</th><th>Next Follow-Up</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l, idx) => {
                  const tatBad = isTATBreached(l);
                  const overdue = isOverdue(l);
                  const poRenewal = renewalStatus(l, renewedIds);
                  const showExpiry = poRenewal && poRenewal.band !== 'ok' && poRenewal.band !== 'renewed';
                  const rot = getRotState(l, rotLastEntry, rotTeamAvg);
                  const isClosed = ['On Hold', 'Lost', 'PO Received'].includes(l.phase);
                  const isLost = l.phase === 'Lost';
                  const conf = hasConfidence(l) ? Number(l.confidence_score) : null;
                  return (
                    <tr key={l.id} onClick={() => openEdit(l)} style={{ background: isLost ? '#f1f5f9' : (tatBad ? '#fef2f2' : undefined), color: isLost ? '#94a3b8' : undefined, opacity: isLost ? 0.75 : 1 }}>
                      {isAdmin && <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={selectedIds.has(l.id)} onChange={() => toggleSelect(l.id)} /></td>}
                      <td style={{ color: '#94a3b8' }}>{idx + 1}</td>
                      <td>
                        <p style={{ fontWeight: 700, margin: 0 }}>{l.customer_name}</p>
                        {l.lead_ref && <p style={{ fontSize: 10, fontFamily: 'monospace', color: '#0a84ff', margin: '1px 0 0' }}>{l.lead_ref}</p>}
                        <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>
                          {l.new_or_renewal} · {l.lead_source}
                          {/* Surface the specific partner/KAM/affiliate name when the lead source needs one.
                              Keeps the row compact but adds the "who brought this in" context. */}
                          {l.lead_source === 'Channel Partner' && l.channel_partner_name && <> · <span style={{ color: '#0066d6', fontWeight: 600 }}>{l.channel_partner_name}</span></>}
                          {l.lead_source === 'KAM' && l.kam_name && <> · <span style={{ color: '#0066d6', fontWeight: 600 }}>{l.kam_name}</span></>}
                          {l.lead_source === 'Lead Affiliate' && l.affiliate_name && <> · <span style={{ color: '#0066d6', fontWeight: 600 }}>{l.affiliate_name}</span></>}
                        </p>
                        {showExpiry && (() => {
                          const s = RENEWAL_BAND_STYLE[poRenewal.band] || RENEWAL_BAND_STYLE.ok;
                          return (
                            <span style={{ display: 'inline-block', marginTop: 4, marginRight: 4, background: s.bg, color: s.fg, border: `1px solid ${s.border}`, borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                              {renewalLabel(poRenewal)}
                            </span>
                          );
                        })()}
                        {rot && (
                          <span className={`badge ${rot.severity === 'red' ? 'badge-red' : 'badge-amber'}`} style={{ marginTop: 4 }}>
                            🥀 Stuck {rot.ageDays}d
                          </span>
                        )}
                      </td>
                      {isAdmin && <td>{l.owner?.name?.split(' ')[0]}</td>}
                      <td><span className={`badge ${PHASE_BADGE[l.phase]}`}>{l.phase}</span></td>
                      <td>
                        {(() => {
                          const a = stageAging(l, tatMap);
                          if (a.days === null) return <span style={{ color: '#cbd5e1' }}>—</span>;
                          const color = a.level === 'over' ? '#dc2626' : a.level === 'warn' ? '#b45309' : a.level === 'ok' ? '#059669' : '#64748b';
                          const bg    = a.level === 'over' ? '#fef2f2' : a.level === 'warn' ? '#fffbeb' : a.level === 'ok' ? '#ecfdf5' : '#f8fafc';
                          const tip   = a.target != null ? `${a.days}d in ${l.phase} · target ${a.target}d` : `${a.days}d in ${l.phase} · no target set`;
                          return <span className="badge" style={{ background: bg, color, border: `1px solid ${color}22`, fontWeight: 700 }} title={tip}>{a.days}d</span>;
                        })()}
                      </td>
                      <td>{l.state || <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                      <td style={{ textAlign: 'right' }}>{l.quantity || <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>₹{l.potential_tcv_lakhs}</td>
                      <td>
                        {conf === null ? <span style={{ color: '#cbd5e1', fontStyle: 'italic' }}>—</span> : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span className={`badge ${conf >= 60 ? 'badge-green' : conf >= 30 ? 'badge-amber' : 'badge-gray'}`} style={{ minWidth: 46, justifyContent: 'center' }} title="Win-confidence score">{Math.round(conf)}%</span>
                            <TrendArrow trend={confidenceTrend(l)} />
                          </span>
                        )}
                      </td>
                      <td>
                        {isClosed ? <span style={{ color: '#cbd5e1', fontStyle: 'italic' }}>—</span> :
                          l.next_followup_date ? <span style={{ color: overdue ? '#dc2626' : '#334155', fontWeight: overdue ? 700 : 400 }}>{overdue && '⚠ '}{fmtDate(l.next_followup_date)}</span> :
                          <span style={{ color: '#cbd5e1' }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && <tr><td colSpan={isAdmin ? 11 : 9} style={{ textAlign: 'center', color: '#94a3b8', padding: 40 }}>No leads match your filters.</td></tr>}
              </tbody>
            </table>
            {isAdmin && filtered.length > 0 && (
              <div style={{ padding: 10 }}>
                {leadsCanEdit && <button className="btn btn-sm" onClick={selectAll}>Select all ({filtered.length})</button>}
              </div>
            )}
          </div>
        )}
      </div>

      {showForm && (
        // Deliberately NO close-on-backdrop-click here: a stray click outside must not discard a
        // half-filled lead. Only the ✕ or Cancel button closes the form.
        <div className="modal-overlay">
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', gap: 4 }}>
                <span className={`tab ${tab === 'form' ? 'active' : ''}`} onClick={() => setTab('form')}>{editLead ? `Edit Lead${editLead.lead_ref ? ` · ${editLead.lead_ref}` : ''}` : (expansionFrom ? `${expansionMode === 'renewal' ? 'Renewal' : 'Additional PO'} · ${expansionFrom.customer_name}` : 'New Lead')}</span>
                {editLead && <span className={`tab ${tab === 'activity' ? 'active' : ''}`} onClick={() => setTab('activity')}>Activity</span>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {editLead && isAdmin && leadsCanFull && <button className="btn btn-sm btn-danger" onClick={() => setDeleteId(editLead.id)}>Delete</button>}
                <button className="btn btn-sm" onClick={closeForm}>✕</button>
              </div>
            </div>
            <div className="modal-body">
              {tab === 'form'
                ? (isCustomBusiness
                    ? <CustomLeadForm lead={editLead} onSave={onSaved} onCancel={closeForm} buConfig={buConfig} expansionFrom={expansionFrom} expansionMode={expansionMode} />
                    : <LeadForm lead={editLead} onSave={onSaved} onCancel={closeForm} buConfig={buConfig} expansionFrom={expansionFrom} expansionMode={expansionMode} />)
                : <ActivityLogView leadId={editLead.id} />}
            </div>
          </div>
        </div>
      )}

      {showChains && <GlobalPosView onClose={() => setShowChains(false)} />}

      {showExpansionPicker && (
        <ExpansionPicker leads={leads} onPick={openExpansionFrom} onClose={() => setShowExpansionPicker(false)} />
      )}

      {showBulkUpload && (
        <BulkUploadModal
          businessUnit={user.business_unit}
          config={buConfig}
          onClose={() => setShowBulkUpload(false)}
          onImported={fetchAll}
        />
      )}

      {deleteId && (
        <div className="modal-overlay" onClick={() => setDeleteId(null)}>
          <div className="modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div className="modal-body">
              <p style={{ fontWeight: 700, marginBottom: 8 }}>Delete this lead?</p>
              <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>This permanently removes the lead, its contacts, and its activity history. This cannot be undone.</p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn" onClick={() => setDeleteId(null)}>Cancel</button>
                <button className="btn btn-danger" onClick={async () => { await deleteLead(deleteId); setDeleteId(null); closeForm(); fetchAll(); }}>Delete</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmBulkDelete && (
        <div className="modal-overlay" onClick={() => !bulkDeleting && setConfirmBulkDelete(false)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-body">
              <p style={{ fontWeight: 700, marginBottom: 8 }}>Delete {selectedIds.size} lead{selectedIds.size > 1 ? 's' : ''}?</p>
              <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>This permanently removes the selected lead{selectedIds.size > 1 ? 's' : ''}, their contacts, and their activity history. This cannot be undone.</p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn" disabled={bulkDeleting} onClick={() => setConfirmBulkDelete(false)}>Cancel</button>
                <button className="btn btn-danger" disabled={bulkDeleting} onClick={executeBulkDelete}>{bulkDeleting ? 'Deleting…' : `Delete ${selectedIds.size}`}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
