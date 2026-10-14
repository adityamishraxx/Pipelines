import React, { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import Layout from '../components/Layout';
import MultiSelect from '../components/MultiSelect';
import { useAuth } from '../context/AuthContext';
import { getLeads, getBds, getDropdowns, getBusinessUnitConfig, getReportBdPerformance, getReportSourceAnalysis, getReportMonthlyTrend, getReportCampaignRoi } from '../services/api';
import { fmtDate, fmtMonthYear } from '../utils/leadHelpers';
import { exportRowsToPdf } from '../utils/pdfExport';
import { writeFormattedSheet } from '../utils/excelExport';

const CHART_COLORS = ['#0a84ff', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#64748b'];

const PHASES = ['New', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'PO Expected', 'PO Received', 'Lost', 'On Hold'];
const SOURCES = ['Channel Partner', 'KAM', 'Direct Sales', 'Lead Affiliate'];
const RENEWALS = ['New', 'Renewal', 'Expansion'];

export default function ReportsPage() {
  const { user } = useAuth();
  const [allLeads, setAllLeads] = useState([]);
  const [bds, setBds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [ran, setRan] = useState(false);
  const [view, setView] = useState('pipeline');   // 'pipeline' | 'customers' | 'bd-performance' | 'source-analysis' | 'monthly-trend' | 'campaign-roi'
  const [reportData, setReportData] = useState(null); // data from new report endpoints

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selBDs, setSelBDs] = useState([]);
  const [selPhases, setSelPhases] = useState([]);
  const [selSources, setSelSources] = useState([]);
  const [selRenewals, setSelRenewals] = useState([]);
  const [selServices, setSelServices] = useState([]);
  const [selStates, setSelStates] = useState([]);
  const [selPOMonths, setSelPOMonths] = useState([]);

  const [buConfig, setBuConfig] = useState(null);
  const [dropdowns, setDropdowns] = useState({});
  useEffect(() => { getBds(user.business_unit).then(setBds); }, [user.business_unit]);
  useEffect(() => { getBusinessUnitConfig(user.business_unit).then(setBuConfig).catch(() => {}); }, [user.business_unit]);
  useEffect(() => { getDropdowns().then(setDropdowns).catch(() => {}); }, []);

  // Service filter options come straight from this business's catalog (every BU now stores its lines
  // in services_json, so the filter matches by catalog label against each lead's lines).
  const serviceOptions = useMemo(() => {
    if (!buConfig?.services) return [];
    return buConfig.services.filter(s => s.active !== false).map(s => s.label);
  }, [buConfig]);
  const sourceOpts  = [...new Set([...(dropdowns.lead_source || SOURCES), ...allLeads.map(l => l.lead_source).filter(Boolean)])];
  const renewalOpts = [...new Set([...(dropdowns.new_or_renewal || RENEWALS), ...allLeads.map(l => l.new_or_renewal).filter(Boolean)])];

  const availableStates = useMemo(() => [...new Set(allLeads.map(l => l.state).filter(Boolean))].sort(), [allLeads]);
  const poMonths = useMemo(() => {
    const now = new Date(); const set = new Set();
    for (let i = -12; i <= 12; i++) { const d = new Date(now.getFullYear(), now.getMonth() + i, 1); set.add(fmtMonthYear(d)); }
    return [...set];
  }, []);

  const runReport = async () => {
    setLoading(true);
    setReportData(null);
    try {
      if (view === 'bd-performance') {
        const data = await getReportBdPerformance({ from: dateFrom || undefined, to: dateTo || undefined });
        setReportData(data);
      } else if (view === 'source-analysis') {
        const data = await getReportSourceAnalysis({ from: dateFrom || undefined, to: dateTo || undefined });
        setReportData(data);
      } else if (view === 'monthly-trend') {
        const data = await getReportMonthlyTrend({ months: 12 });
        setReportData(data);
      } else if (view === 'campaign-roi') {
        const data = await getReportCampaignRoi({ from: dateFrom || undefined, to: dateTo || undefined });
        setReportData(data);
      } else {
        const data = await getLeads({ business_unit: user.business_unit });
        setAllLeads(data);
      }
    } catch (e) {
      console.error('Report error:', e);
    }
    setLoading(false); setRan(true);
  };

  const filtered = useMemo(() => allLeads.filter(l => {
    if (dateFrom && new Date(l.createdAt) < new Date(dateFrom)) return false;
    if (dateTo && new Date(l.createdAt) > new Date(dateTo + 'T23:59:59')) return false;
    if (selBDs.length && !selBDs.includes(l.owner?.name)) return false;
    if (selPhases.length && !selPhases.includes(l.phase)) return false;
    if (selSources.length && !selSources.includes(l.lead_source)) return false;
    if (selRenewals.length && !selRenewals.includes(l.new_or_renewal)) return false;
    if (selStates.length && !selStates.includes(l.state)) return false;
    if (selServices.length) {
      let svcLabels;
      try { svcLabels = new Set((JSON.parse(l.services_json || '[]')).map(s => s.label)); } catch { svcLabels = new Set(); }
      if (!selServices.every(s => svcLabels.has(s))) return false;
    }
    if (selPOMonths.length) {
      if (!l.po_expected_date || !selPOMonths.includes(fmtMonthYear(l.po_expected_date))) return false;
    }
    return true;
  }), [allLeads, dateFrom, dateTo, selBDs, selPhases, selSources, selRenewals, selStates, selServices, selPOMonths]);

  const totalTCV = filtered.reduce((s, l) => s + (parseFloat(l.potential_tcv_lakhs) || 0), 0);
  const wonLeads = filtered.filter(l => l.phase === 'PO Received');
  const wonTCV = wonLeads.reduce((s, l) => s + (parseFloat(l.po_actual_value_lakhs) || parseFloat(l.potential_tcv_lakhs) || 0), 0);

  const activeFilterCount = [selBDs, selPhases, selSources, selRenewals, selStates, selServices, selPOMonths].reduce((s,a) => s + a.length, 0) + (dateFrom?1:0) + (dateTo?1:0);
  const clearAll = () => { setDateFrom(''); setDateTo(''); setSelBDs([]); setSelPhases([]); setSelSources([]); setSelRenewals([]); setSelStates([]); setSelServices([]); setSelPOMonths([]); };

  // Primary (first) contact on a lead — used by the Customer Details view.
  const pc = (l) => (Array.isArray(l.contacts) && l.contacts[0]) || {};

  const exportExcel = async () => {
    if (!filtered.length) return;
    const XLSX = await import('xlsx');
    const rows = view === 'customers'
      ? filtered.map(l => ({
          Customer: l.customer_name, 'Business Unit': (l.business_unit || '').toUpperCase(),
          City: l.city || '', State: l.state || '', Owner: l.owner?.name || '',
          'Contact Name': pc(l).name || '', Phone: pc(l).phone || '', Email: pc(l).email || '', Designation: pc(l).designation || '',
        }))
      : filtered.map(l => ({
          'Sr No': l.sr_no, 'Business Unit': (l.business_unit || '').toUpperCase(), Customer: l.customer_name,
          State: l.state || '', BD: l.owner?.name || '', 'Lead Source': l.lead_source, 'KAM Name': l.kam_name || '',
          'New/Renewal': l.new_or_renewal, 'TCV (₹L)': l.potential_tcv_lakhs, 'PO Expected': l.po_expected_date ? fmtMonthYear(l.po_expected_date) : '',
          Phase: l.phase, 'Created At': fmtDate(l.createdAt),
        }));
    writeFormattedSheet(XLSX, rows, view === 'customers' ? 'Customers' : 'Report', `CRM_${view === 'customers' ? 'Customers' : 'Report'}_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const exportPdf = () => {
    if (!filtered.length) return;
    const table = view === 'customers'
      ? {
          columns: ['Customer', 'Business', 'City', 'State', 'Owner', 'Contact', 'Phone', 'Email', 'Designation'],
          rows: filtered.map(l => [l.customer_name, (l.business_unit || '').toUpperCase(), l.city || '—', l.state || '—', l.owner?.name || '', pc(l).name || '—', pc(l).phone || '—', pc(l).email || '—', pc(l).designation || '—']),
        }
      : {
          columns: ['Sr', 'Customer', 'State', 'BD', 'Phase', 'New/Renewal', 'TCV (₹L)', 'PO Expected', 'Source', 'Created'],
          rows: filtered.map(l => [l.sr_no, l.customer_name, l.state || '—', l.owner?.name?.split(' ')[0] || '', l.phase, l.new_or_renewal, l.potential_tcv_lakhs, l.po_expected_date ? fmtMonthYear(l.po_expected_date) : '—', l.lead_source, fmtDate(l.createdAt)]),
        };
    exportRowsToPdf({
      title: view === 'customers' ? 'Pipelines — Customer Details' : 'Pipelines — Custom Report',
      subtitle: `${filtered.length} record${filtered.length > 1 ? 's' : ''} · generated ${fmtDate(new Date())}`,
      tables: [table],
      filename: `CRM_${view === 'customers' ? 'Customers' : 'Report'}_${new Date().toISOString().slice(0,10)}.pdf`,
    });
  };

  return (
    <Layout>
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Custom Reports</h1>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>{activeFilterCount > 0 ? `${activeFilterCount} filters active` : 'Filter leads and export to Excel'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={runReport} disabled={loading}>{loading ? 'Running…' : 'Run Report'}</button>
          {ran && filtered.length > 0 && <button className="btn btn-success" onClick={exportExcel}>Export Excel ({filtered.length})</button>}
          {ran && filtered.length > 0 && <button className="btn" onClick={exportPdf}>Export PDF</button>}
        </div>
      </div>

      <div style={{ display: 'flex' }}>
        <div style={{ width: 240, flexShrink: 0, background: '#fff', borderRight: '1px solid #e2e8f0', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label className="field-label" style={{ marginBottom: 6 }}>Report View</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[{ key: 'pipeline', label: 'Pipeline' }, { key: 'customers', label: 'Customer Details' }, { key: 'bd-performance', label: 'BD Performance' }, { key: 'source-analysis', label: 'Source Analysis' }, { key: 'monthly-trend', label: 'Monthly Trend' }, { key: 'campaign-roi', label: 'Campaign ROI' }].map(v => (
                <button key={v.key} type="button" onClick={() => setView(v.key)}
                  style={{ border: view === v.key ? '1.5px solid #0a84ff' : '1.5px solid #e2e8f0', borderRadius: 8,
                    padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
                    background: view === v.key ? '#e8f2ff' : '#fff', color: view === v.key ? '#0a84ff' : '#64748b' }}>
                  {v.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 14 }}>
            <label className="field-label">Date Range (Created)</label>
            <input type="date" className="input" style={{ marginBottom: 6 }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            <input type="date" className="input" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
          <MultiSelect label="BD" options={bds.map(b => b.name)} selected={selBDs} onChange={setSelBDs} width={200} />
          <MultiSelect label="Phase" options={PHASES} selected={selPhases} onChange={setSelPhases} width={200} />
          <MultiSelect label="Lead Source" options={sourceOpts} selected={selSources} onChange={setSelSources} width={200} />
          <MultiSelect label="New/Renewal" options={renewalOpts} selected={selRenewals} onChange={setSelRenewals} width={200} />
          <MultiSelect label="Services" options={serviceOptions} selected={selServices} onChange={setSelServices} width={200} />
          {availableStates.length > 0 && <MultiSelect label="State" options={availableStates} selected={selStates} onChange={setSelStates} width={200} />}
          <MultiSelect label="PO Expected Month" options={poMonths} selected={selPOMonths} onChange={setSelPOMonths} width={200} />
          {activeFilterCount > 0 && <button className="btn btn-sm btn-danger" onClick={clearAll}>✕ Clear all</button>}
        </div>

        <div style={{ flex: 1, padding: 20 }}>
          {!ran ? (
            <p style={{ textAlign: 'center', color: '#94a3b8', padding: 60 }}>Set your filters and click Run Report.</p>
          ) : (
            <>
              {/* KPI cards — context-sensitive per view */}
              {(view === 'pipeline' || view === 'customers') && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
                  <div className="kpi-card"><p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Total Leads</p><p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0' }}>{filtered.length}</p></div>
                  <div className="kpi-card"><p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Total TCV</p><p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0' }}>{'₹'}{totalTCV.toFixed(1)}L</p></div>
                  <div className="kpi-card"><p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Won Leads</p><p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0', color: '#059669' }}>{wonLeads.length}</p></div>
                  <div className="kpi-card"><p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Won TCV</p><p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0', color: '#059669' }}>{'₹'}{wonTCV.toFixed(1)}L</p></div>
                </div>
              )}

              {view === 'bd-performance' && reportData && (() => {
                const rows = Array.isArray(reportData) ? reportData : (reportData.rows || reportData.data || []);
                const totalBds = rows.length;
                const totalLeads = rows.reduce((s, r) => s + (r.total_leads || 0), 0);
                const wonLeadsCount = rows.reduce((s, r) => s + (r.won || 0), 0);
                const avgConv = totalLeads > 0 ? ((wonLeadsCount / totalLeads) * 100).toFixed(1) : '0';
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
                    <div className="kpi-card"><p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Total BDs</p><p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0' }}>{totalBds}</p></div>
                    <div className="kpi-card"><p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Total Leads</p><p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0' }}>{totalLeads}</p></div>
                    <div className="kpi-card"><p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Won Leads</p><p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0', color: '#059669' }}>{wonLeadsCount}</p></div>
                    <div className="kpi-card"><p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Avg Conversion</p><p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0' }}>{avgConv}%</p></div>
                  </div>
                );
              })()}

              {view === 'source-analysis' && reportData && (() => {
                const rows = Array.isArray(reportData) ? reportData : (reportData.rows || reportData.data || []);
                const totalSources = rows.length;
                const totalLeads = rows.reduce((s, r) => s + (r.total_leads || 0), 0);
                const topSource = rows.length > 0 ? rows.reduce((a, b) => (b.total_leads || 0) > (a.total_leads || 0) ? b : a).source || '—' : '—';
                const totalWon = rows.reduce((s, r) => s + (r.won || 0), 0);
                const conv = totalLeads > 0 ? ((totalWon / totalLeads) * 100).toFixed(1) : '0';
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
                    <div className="kpi-card"><p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Total Sources</p><p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0' }}>{totalSources}</p></div>
                    <div className="kpi-card"><p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Total Leads</p><p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0' }}>{totalLeads}</p></div>
                    <div className="kpi-card"><p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Top Source</p><p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0' }}>{topSource}</p></div>
                    <div className="kpi-card"><p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Conversion</p><p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0' }}>{conv}%</p></div>
                  </div>
                );
              })()}

              {view === 'monthly-trend' && reportData && (() => {
                const rows = Array.isArray(reportData) ? reportData : (reportData.rows || reportData.data || []);
                const totalNew = rows.reduce((s, r) => s + (r.new_leads || r.new_count || 0), 0);
                const totalWon = rows.reduce((s, r) => s + (r.won || r.won_count || 0), 0);
                const totalNewTcv = rows.reduce((s, r) => s + (parseFloat(r.new_tcv) || 0), 0);
                const totalWonTcv = rows.reduce((s, r) => s + (parseFloat(r.won_tcv) || 0), 0);
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
                    <div className="kpi-card"><p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Total New</p><p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0' }}>{totalNew}</p></div>
                    <div className="kpi-card"><p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Total Won</p><p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0', color: '#059669' }}>{totalWon}</p></div>
                    <div className="kpi-card"><p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>New TCV</p><p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0' }}>{'₹'}{totalNewTcv.toFixed(1)}L</p></div>
                    <div className="kpi-card"><p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Won TCV</p><p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0', color: '#059669' }}>{'₹'}{totalWonTcv.toFixed(1)}L</p></div>
                  </div>
                );
              })()}

              {view === 'campaign-roi' && reportData && (() => {
                const rows = Array.isArray(reportData) ? reportData : (reportData.rows || reportData.data || []);
                const totalCampaigns = rows.length;
                const totalBudget = rows.reduce((s, r) => s + (parseFloat(r.budget) || parseFloat(r.budget_lakhs) || 0), 0);
                const totalRevenue = rows.reduce((s, r) => s + (parseFloat(r.revenue) || parseFloat(r.revenue_lakhs) || 0), 0);
                const avgRoi = totalBudget > 0 ? (((totalRevenue - totalBudget) / totalBudget) * 100).toFixed(0) : '0';
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
                    <div className="kpi-card"><p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Campaigns</p><p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0' }}>{totalCampaigns}</p></div>
                    <div className="kpi-card"><p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Total Budget</p><p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0' }}>{'₹'}{totalBudget.toFixed(1)}L</p></div>
                    <div className="kpi-card"><p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Total Revenue</p><p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0', color: '#059669' }}>{'₹'}{totalRevenue.toFixed(1)}L</p></div>
                    <div className="kpi-card"><p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Avg ROI</p><p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0' }}>{avgRoi}%</p></div>
                  </div>
                );
              })()}

              {/* Existing Pipeline / Customer Details tables */}
              {(view === 'pipeline' || view === 'customers') && (
              <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                {view === 'pipeline' ? (
                  <table className="data-table">
                    <thead><tr><th>Sr</th><th>Customer</th><th>State</th><th>BD</th><th>Phase</th><th>New/Renewal</th><th style={{textAlign:'right'}}>TCV ({'₹'}L)</th><th>PO Expected</th><th>Source</th><th>Created</th></tr></thead>
                    <tbody>
                      {filtered.map(l => (
                        <tr key={l.id}>
                          <td>{l.sr_no}</td><td>{l.customer_name}</td><td>{l.state || '—'}</td><td>{l.owner?.name?.split(' ')[0]}</td>
                          <td>{l.phase}</td><td>{l.new_or_renewal}</td><td style={{textAlign:'right', fontWeight:700}}>{'₹'}{l.potential_tcv_lakhs}</td>
                          <td>{l.po_expected_date ? fmtMonthYear(l.po_expected_date) : '—'}</td><td>{l.lead_source}</td><td>{fmtDate(l.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="data-table">
                    <thead><tr><th>Customer</th><th>Business</th><th>City</th><th>State</th><th>Owner</th><th>Contact</th><th>Phone</th><th>Email</th><th>Designation</th></tr></thead>
                    <tbody>
                      {filtered.map(l => (
                        <tr key={l.id}>
                          <td>{l.customer_name}</td><td>{(l.business_unit || '').toUpperCase()}</td><td>{l.city || '—'}</td><td>{l.state || '—'}</td>
                          <td>{l.owner?.name || '—'}</td><td>{pc(l).name || '—'}</td><td>{pc(l).phone || '—'}</td><td>{pc(l).email || '—'}</td><td>{pc(l).designation || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              )}

              {/* BD Performance Report */}
              {view === 'bd-performance' && reportData && (() => {
                const rows = Array.isArray(reportData) ? reportData : (reportData.rows || reportData.data || []);
                return (
                  <>
                    {rows.length > 0 && (
                      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
                        <p style={{ fontWeight: 700, fontSize: 14, margin: '0 0 12px', color: '#334155' }}>Won vs Total Leads per BD</p>
                        <ResponsiveContainer width="100%" height={300}>
                          <BarChart data={rows}>
                            <XAxis dataKey="bd_name" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Legend />
                            <Bar dataKey="total_leads" name="Total" fill={CHART_COLORS[0]} />
                            <Bar dataKey="won" name="Won" fill={CHART_COLORS[2]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                      <table className="data-table">
                        <thead><tr><th>BD Name</th><th style={{textAlign:'right'}}>Total Leads</th><th style={{textAlign:'right'}}>Active</th><th style={{textAlign:'right'}}>Won</th><th style={{textAlign:'right'}}>Lost</th><th style={{textAlign:'right'}}>Total TCV ({'₹'}L)</th><th style={{textAlign:'right'}}>Won TCV ({'₹'}L)</th><th style={{textAlign:'right'}}>Conv Rate (%)</th></tr></thead>
                        <tbody>
                          {rows.map((r, i) => {
                            const conv = (r.total_leads || 0) > 0 ? (((r.won || 0) / r.total_leads) * 100).toFixed(1) : '0';
                            return (
                              <tr key={i}>
                                <td style={{ fontWeight: 600 }}>{r.bd_name}</td>
                                <td style={{ textAlign: 'right' }}>{r.total_leads}</td>
                                <td style={{ textAlign: 'right' }}>{r.active ?? '—'}</td>
                                <td style={{ textAlign: 'right', color: '#059669', fontWeight: 700 }}>{r.won}</td>
                                <td style={{ textAlign: 'right', color: '#dc2626' }}>{r.lost ?? '—'}</td>
                                <td style={{ textAlign: 'right' }}>{'₹'}{parseFloat(r.total_tcv || 0).toFixed(1)}</td>
                                <td style={{ textAlign: 'right', fontWeight: 700 }}>{'₹'}{parseFloat(r.won_tcv || 0).toFixed(1)}</td>
                                <td style={{ textAlign: 'right' }}>{conv}%</td>
                              </tr>
                            );
                          })}
                          {rows.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: '#94a3b8', padding: 30 }}>No data</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </>
                );
              })()}

              {/* Source Analysis Report */}
              {view === 'source-analysis' && reportData && (() => {
                const rows = Array.isArray(reportData) ? reportData : (reportData.rows || reportData.data || []);
                const pieData = rows.map(r => ({ name: r.source, value: r.total_leads || 0 }));
                return (
                  <>
                    {rows.length > 0 && (
                      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
                        <p style={{ fontWeight: 700, fontSize: 14, margin: '0 0 12px', color: '#334155' }}>Leads by Source</p>
                        <ResponsiveContainer width="100%" height={300}>
                          <PieChart>
                            <Pie data={pieData} cx="50%" cy="50%" outerRadius={100} dataKey="value" nameKey="name" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                              {pieData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                            </Pie>
                            <Tooltip />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                      <table className="data-table">
                        <thead><tr><th>Source</th><th style={{textAlign:'right'}}>Total Leads</th><th style={{textAlign:'right'}}>Won</th><th style={{textAlign:'right'}}>TCV ({'₹'}L)</th><th style={{textAlign:'right'}}>Won TCV ({'₹'}L)</th><th style={{textAlign:'right'}}>Conv Rate (%)</th></tr></thead>
                        <tbody>
                          {rows.map((r, i) => {
                            const conv = (r.total_leads || 0) > 0 ? (((r.won || 0) / r.total_leads) * 100).toFixed(1) : '0';
                            return (
                              <tr key={i}>
                                <td style={{ fontWeight: 600 }}>{r.source}</td>
                                <td style={{ textAlign: 'right' }}>{r.total_leads}</td>
                                <td style={{ textAlign: 'right', color: '#059669', fontWeight: 700 }}>{r.won}</td>
                                <td style={{ textAlign: 'right' }}>{'₹'}{parseFloat(r.tcv || r.total_tcv || 0).toFixed(1)}</td>
                                <td style={{ textAlign: 'right', fontWeight: 700 }}>{'₹'}{parseFloat(r.won_tcv || 0).toFixed(1)}</td>
                                <td style={{ textAlign: 'right' }}>{conv}%</td>
                              </tr>
                            );
                          })}
                          {rows.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: '#94a3b8', padding: 30 }}>No data</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </>
                );
              })()}

              {/* Monthly Trend Report */}
              {view === 'monthly-trend' && reportData && (() => {
                const rows = Array.isArray(reportData) ? reportData : (reportData.rows || reportData.data || []);
                return (
                  <>
                    {rows.length > 0 && (
                      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
                        <p style={{ fontWeight: 700, fontSize: 14, margin: '0 0 12px', color: '#334155' }}>New vs Won Trend</p>
                        <ResponsiveContainer width="100%" height={300}>
                          <LineChart data={rows}>
                            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Legend />
                            <Line type="monotone" dataKey={rows[0]?.new_leads !== undefined ? 'new_leads' : 'new_count'} name="New" stroke={CHART_COLORS[0]} strokeWidth={2} />
                            <Line type="monotone" dataKey={rows[0]?.won !== undefined ? 'won' : 'won_count'} name="Won" stroke={CHART_COLORS[2]} strokeWidth={2} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                      <table className="data-table">
                        <thead><tr><th>Month</th><th style={{textAlign:'right'}}>New</th><th style={{textAlign:'right'}}>Won</th><th style={{textAlign:'right'}}>Lost</th><th style={{textAlign:'right'}}>New TCV ({'₹'}L)</th><th style={{textAlign:'right'}}>Won TCV ({'₹'}L)</th></tr></thead>
                        <tbody>
                          {rows.map((r, i) => (
                            <tr key={i}>
                              <td style={{ fontWeight: 600 }}>{r.month}</td>
                              <td style={{ textAlign: 'right' }}>{r.new_leads ?? r.new_count ?? '—'}</td>
                              <td style={{ textAlign: 'right', color: '#059669', fontWeight: 700 }}>{r.won ?? r.won_count ?? '—'}</td>
                              <td style={{ textAlign: 'right', color: '#dc2626' }}>{r.lost ?? r.lost_count ?? '—'}</td>
                              <td style={{ textAlign: 'right' }}>{'₹'}{parseFloat(r.new_tcv || 0).toFixed(1)}</td>
                              <td style={{ textAlign: 'right', fontWeight: 700 }}>{'₹'}{parseFloat(r.won_tcv || 0).toFixed(1)}</td>
                            </tr>
                          ))}
                          {rows.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: '#94a3b8', padding: 30 }}>No data</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </>
                );
              })()}

              {/* Campaign ROI Report */}
              {view === 'campaign-roi' && reportData && (() => {
                const rows = Array.isArray(reportData) ? reportData : (reportData.rows || reportData.data || []);
                const chartData = rows.map(r => {
                  const budget = parseFloat(r.budget) || parseFloat(r.budget_lakhs) || 0;
                  const revenue = parseFloat(r.revenue) || parseFloat(r.revenue_lakhs) || 0;
                  return { name: r.campaign || r.name, roi: budget > 0 ? (((revenue - budget) / budget) * 100) : 0 };
                });
                return (
                  <>
                    {rows.length > 0 && (
                      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
                        <p style={{ fontWeight: 700, fontSize: 14, margin: '0 0 12px', color: '#334155' }}>ROI per Campaign</p>
                        <ResponsiveContainer width="100%" height={300}>
                          <BarChart data={chartData}>
                            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} unit="%" />
                            <Tooltip formatter={(v) => `${v.toFixed(0)}%`} />
                            <Bar dataKey="roi" name="ROI" fill={CHART_COLORS[0]}>
                              {chartData.map((entry, i) => <Cell key={i} fill={entry.roi >= 0 ? CHART_COLORS[2] : CHART_COLORS[4]} />)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                      <table className="data-table">
                        <thead><tr><th>Campaign</th><th style={{textAlign:'right'}}>Budget ({'₹'}L)</th><th style={{textAlign:'right'}}>Leads</th><th style={{textAlign:'right'}}>Won</th><th style={{textAlign:'right'}}>Revenue ({'₹'}L)</th><th style={{textAlign:'right'}}>ROI</th></tr></thead>
                        <tbody>
                          {rows.map((r, i) => {
                            const budget = parseFloat(r.budget) || parseFloat(r.budget_lakhs) || 0;
                            const revenue = parseFloat(r.revenue) || parseFloat(r.revenue_lakhs) || 0;
                            const roi = budget > 0 ? (((revenue - budget) / budget) * 100).toFixed(0) : '—';
                            return (
                              <tr key={i}>
                                <td style={{ fontWeight: 600 }}>{r.campaign || r.name}</td>
                                <td style={{ textAlign: 'right' }}>{'₹'}{budget.toFixed(1)}</td>
                                <td style={{ textAlign: 'right' }}>{r.leads ?? r.lead_count ?? '—'}</td>
                                <td style={{ textAlign: 'right', color: '#059669', fontWeight: 700 }}>{r.won ?? r.won_count ?? '—'}</td>
                                <td style={{ textAlign: 'right', fontWeight: 700 }}>{'₹'}{revenue.toFixed(1)}</td>
                                <td style={{ textAlign: 'right' }}>{roi !== '—' ? `${roi}%` : '—'}</td>
                              </tr>
                            );
                          })}
                          {rows.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: '#94a3b8', padding: 30 }}>No data</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </>
                );
              })()}
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
