import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getForecastDevices, setSentToScm } from '../services/api';
import { fmtDate, fmtMonthYear, primaryContact, formatOtherContacts } from '../utils/leadHelpers';
import { exportRowsToPdf } from '../utils/pdfExport';
import ColumnPicker, { useColumnPreference } from '../components/ColumnPicker';
import ColumnFilter from '../components/ColumnFilter';
import usePersistedState from '../utils/usePersistedState';
import { sortWithWonLast, partitionByPriority } from '../utils/leadPriority';
import { rollupByState, rollupTotal, deviceOnlyQty, INSTALL_STAGES } from '../utils/geographyRollup';
import {
  FORECAST_COLUMNS, DEFAULT_FORECAST_KEYS, resolveColumns, forecastUnits,
  matchesFilters, activeFilterKeys, emptyFilterFor,
} from '../utils/forecastColumns';

const monthKey = (d) => d ? new Date(d).toISOString().slice(0, 7) : 'unscheduled';
const monthLabel = (k) => k === 'unscheduled' ? 'Unscheduled' : fmtMonthYear(k + '-01');

export default function ForecastPage() {
  const navigate = useNavigate();
  const { isForecastOnly, isAdmin, logout, user, canEdit, canView, canAct } = useAuth();
  // Read-only on Forecast can look but not tick Sent to SCM.
  const forecastCanEdit = canAct && canEdit('forecast');
  // Cross-module: opening a lead needs Leads access. Without it the rows simply aren't
  // clickable — the dashboard stays fully usable rather than erroring on a click.
  const canOpenLeadsModule = canView('leads');
  const buName = (user?.business_unit || '').toUpperCase();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  // Forecast is scoped server-side to the caller's business unit, so there's no cross-business filter.
  const [bu] = useState('all');

  useEffect(() => { getForecastDevices().then(setLeads).catch(() => {}).finally(() => setLoading(false)); }, []);

  // 'Sent to SCM' is a manual, shared marker — no automation reads or resets it. Updated
  // optimistically so the checkbox responds instantly, then reconciled with the server's
  // authoritative timestamp/author (or rolled back if the call fails). Tracked per HARDWARE LINE:
  // one lead with two hardware services shows up as two rows and each row has its own SCM flag, so
  // busy-state and the state update are keyed by _row_id rather than the shared lead id.
  const [scmBusy, setScmBusy] = useState(() => new Set());
  const toggleSentToScm = async (row, next) => {
    const rowId = row._row_id;
    const slug = row.hw_slug;
    if (!rowId || !slug) return;
    const prev = { sent_to_scm: row.sent_to_scm, sent_to_scm_at: row.sent_to_scm_at, sent_to_scm_by: row.sent_to_scm_by };
    const patch = (fields) => setLeads(ls => ls.map(l => (l._row_id === rowId ? { ...l, ...fields } : l)));
    setScmBusy(s => new Set(s).add(rowId));
    patch({ sent_to_scm: next, sent_to_scm_at: next ? new Date().toISOString() : null, sent_to_scm_by: next ? (user?.name || '') : null });
    try {
      const saved = await setSentToScm(row.id, next, slug);
      patch({ sent_to_scm: saved.sent_to_scm, sent_to_scm_at: saved.sent_to_scm_at, sent_to_scm_by: saved.sent_to_scm_by });
    } catch {
      patch(prev);
      window.alert('Could not update "Sent to SCM". Please try again.');
    } finally {
      setScmBusy(s => { const n = new Set(s); n.delete(rowId); return n; });
    }
  };

  // Ranked by the shared prioritization order (stage → confidence → chain → TCV);
  // see utils/leadPriority.js. Re-derived on every render, so the ranking always
  // reflects current confidence scores and a freshly computed TCV.
  const allLeads = useMemo(
    () => sortWithWonLast(leads.filter(l => bu === 'all' || l.business_unit === bu)),
    [leads, bu],
  );
  const units = forecastUnits;

  // Column selection for the detail table and for the Excel export are deliberately
  // separate preferences (same picker component, different storage key), so a user can
  // study a wide set on screen while exporting a narrower one. Keyed per user id so a
  // shared machine doesn't leak one person's layout to the next.
  const prefScope = user?.id ?? 'anon';
  const [viewKeys, setViewKeys] = useColumnPreference(`salescrm_forecast_cols_view_${prefScope}`, DEFAULT_FORECAST_KEYS);
  const [excelKeys, setExcelKeys] = useColumnPreference(`salescrm_forecast_cols_excel_${prefScope}`, DEFAULT_FORECAST_KEYS);
  const viewColumns = useMemo(() => resolveColumns(viewKeys), [viewKeys]);
  const excelColumns = useMemo(() => resolveColumns(excelKeys), [excelKeys]);

  // Column filters, keyed by column — NOT by visible column. Hiding a column therefore
  // keeps its filter in force, and re-showing it brings the control back already set.
  // Persisted alongside the column choice so returning from a lead restores the view intact.
  const [filters, setFilters] = usePersistedState(`salescrm_forecast_filters_${prefScope}`, {});
  const activeKeys = useMemo(() => activeFilterKeys(filters), [filters]);
  const tableTopRef = useRef(null);
  const setFilter = (key, next) => {
    setFilters(prev => ({ ...prev, [key]: next }));
    // Applying a filter makes the previous scroll position meaningless — go back to the
    // top of the results. (There is no pagination on this table; this is its equivalent.)
    tableTopRef.current?.scrollIntoView({ block: 'nearest' });
  };
  const clearAllFilters = () => setFilters({});

  // Everything downstream — KPIs, the month/SKU pivot, the detail rows and both exports —
  // reads the filtered set, so every number on screen agrees with the rows you can see.
  const deviceLeads = useMemo(() => allLeads.filter(l => matchesFilters(l, filters)), [allLeads, filters]);

  // PO Received is already won, so it leaves the ranked list and gets its own section at
  // the very end of the dashboard. `activeLeads` is what the prioritized table shows.
  const { active: activeLeads, won: wonLeads } = useMemo(() => partitionByPriority(deviceLeads), [deviceLeads]);

  // State-wise installation load. Built from the filtered set so it agrees with the rest of
  // the dashboard, then narrowed to the committed stages (PO Expected onward).
  const stateRollup = useMemo(() => rollupByState(deviceLeads, { stages: INSTALL_STAGES }), [deviceLeads]);
  const stateRollupTotal = useMemo(() => rollupTotal(stateRollup), [stateRollup]);
  const [expandedStates, setExpandedStates] = useState(() => new Set());
  const toggleState = (s) => setExpandedStates(prev => {
    const next = new Set(prev);
    if (next.has(s)) next.delete(s); else next.add(s);
    return next;
  });

  // Can this user actually open the lead behind a row? The forecast deliberately spans the whole
  // business unit, but lead access is narrower: a 'forecast' account has none at all, and a BD may
  // only read their own rows (GET /api/leads/:id 403s otherwise). Mirroring that here keeps rows
  // from advertising a click that would dead-end.
  const canOpenLead = (l) => canOpenLeadsModule && !isForecastOnly && (isAdmin || l.owner_id === user?.id);

  // Row click → that lead's detail. `from=forecast` tells the Leads page to offer a way back here;
  // the forecast's own column selection is already persisted, so returning restores it.
  const openLead = (e, l) => {
    // Never hijack a click that landed on a control inside the row (checkboxes, links, future
    // inline-edit widgets) — those own their own behaviour.
    if (e.target.closest('button, a, input, select, textarea, label')) return;
    if (!canOpenLead(l)) return;
    navigate(`/leads?lead=${l.id}&from=forecast`);
  };

  // One detail row — shared by the prioritized table and the won (PO Received) section
  // below it, so both stay identical in columns, affordances and behaviour.
  const renderRow = (l) => {
    const clickable = canOpenLead(l);
    return (
      <tr
        key={l._row_id || l.id}
        onClick={(e) => openLead(e, l)}
        onKeyDown={(e) => { if (clickable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openLead(e, l); } }}
        tabIndex={clickable ? 0 : undefined}
        role={clickable ? 'link' : undefined}
        title={clickable ? 'Open this lead'
          : !canOpenLeadsModule ? 'You do not have access to the Leads module'
          : isForecastOnly ? 'Forecast accounts cannot open lead records'
          : 'This lead belongs to another BD'}
        style={clickable ? { cursor: 'pointer' } : undefined}
        onMouseEnter={(e) => { if (clickable) e.currentTarget.style.background = '#f8fafc'; }}
        onMouseLeave={(e) => { if (clickable) e.currentTarget.style.background = ''; }}
      >
        {viewColumns.map(c => (
          <td key={c.key} style={c.align === 'right' ? { textAlign: 'right', fontWeight: c.key === 'units' ? 700 : 400 } : undefined}>
            {c.key === 'sent_to_scm' ? (
              // Interactive rather than text. The row's click handler already ignores clicks
              // that land on an input, so ticking this never navigates to the lead.
              <label
                title={l.sent_to_scm
                  ? `Sent to SCM${l.sent_to_scm_by ? ` by ${l.sent_to_scm_by}` : ''}${l.sent_to_scm_at ? ` on ${fmtDate(l.sent_to_scm_at)}` : ''}`
                  : 'Not yet sent to SCM'}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: !forecastCanEdit ? 'not-allowed' : scmBusy.has(l._row_id) ? 'wait' : 'pointer' }}
              >
                <input
                  type="checkbox"
                  checked={!!l.sent_to_scm}
                  disabled={scmBusy.has(l._row_id) || !forecastCanEdit}
                  onChange={(e) => toggleSentToScm(l, e.target.checked)}
                  style={{ cursor: 'inherit' }}
                />
                <span style={{ fontSize: 11, color: l.sent_to_scm ? '#0a84ff' : '#94a3b8', fontWeight: l.sent_to_scm ? 700 : 400 }}>
                  {l.sent_to_scm ? 'Sent' : 'Pending'}
                </span>
              </label>
            ) : c.cell(l)}
          </td>
        ))}
      </tr>
    );
  };

  const skus = useMemo(() => [...new Set(deviceLeads.map(l => l.hw_service || 'Unspecified'))].sort(), [deviceLeads]);
  const months = useMemo(() => {
    const m = [...new Set(deviceLeads.map(l => monthKey(l.po_expected_date)))];
    return m.sort((a, b) => a === 'unscheduled' ? 1 : b === 'unscheduled' ? -1 : a.localeCompare(b));
  }, [deviceLeads]);

  const pivot = useMemo(() => {
    const grid = {};
    months.forEach(m => { grid[m] = {}; skus.forEach(s => grid[m][s] = 0); });
    deviceLeads.forEach(l => { grid[monthKey(l.po_expected_date)][l.hw_service || 'Unspecified'] += units(l); });
    return grid;
  }, [deviceLeads, months, skus]);

  const skuTotal = (s) => deviceLeads.filter(l => (l.hw_service || 'Unspecified') === s).reduce((sum, l) => sum + units(l), 0);
  const monthTotal = (m) => skus.reduce((sum, s) => sum + (pivot[m]?.[s] || 0), 0);
  const grandTotal = deviceLeads.reduce((sum, l) => sum + units(l), 0);

  const exportExcel = async () => {
    if (!deviceLeads.length) return;
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const pivotRows = months.map(m => {
      const row = { Month: monthLabel(m) };
      skus.forEach(s => row[s] = pivot[m][s]);
      row.Total = monthTotal(m);
      return row;
    });
    const totalsRow = { Month: 'TOTAL' };
    skus.forEach(s => totalsRow[s] = skuTotal(s));
    totalsRow.Total = grandTotal;
    pivotRows.push(totalsRow);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pivotRows), 'Units by Month & Item');

    // Detail sheet follows the user's Excel column selection (independent of the on-screen set),
    // then always appends the POC contact columns — contacts are requested in every export, so they
    // ride along regardless of which other columns are picked. They come back blank for a dedicated
    // forecast-only account, which the API withholds contacts from.
    const detailRows = deviceLeads.map(l => {
      const row = {};
      for (const col of excelColumns) row[col.label] = col.excel(l);
      const poc = primaryContact(l);
      row['Contact Name'] = poc.name;
      row['Contact Phone'] = poc.phone;
      row['Contact Email'] = poc.email;
      row['Contact Designation'] = poc.designation;
      row['Other Contacts'] = formatOtherContacts(l);
      return row;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), 'Detail');
    XLSX.writeFile(wb, `Inventory_Pipeline_${buName || 'PIPELINE'}_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const exportPdf = () => {
    if (!deviceLeads.length) return;
    exportRowsToPdf({
      title: 'Pipelines — Inventory Pipeline',
      subtitle: `${buName} · ${grandTotal} total units · generated ${fmtDate(new Date())}`,
      tables: [
        {
          heading: 'Units by Month & Hardware Item',
          columns: ['Month', ...skus, 'Total'],
          rows: [
            ...months.map(m => [monthLabel(m), ...skus.map(s => pivot[m][s] || 0), monthTotal(m)]),
            ['TOTAL', ...skus.map(s => skuTotal(s)), grandTotal],
          ],
        },
        {
          // The PDF prints what's on screen, so it follows the view's column selection.
          heading: 'Hardware Demand — Detail',
          columns: viewColumns.map(c => c.label),
          rows: deviceLeads.map(l => viewColumns.map(c => c.cell(l))),
        },
      ],
      filename: `Inventory_Pipeline_${buName || 'PIPELINE'}_${new Date().toISOString().slice(0,10)}.pdf`,
    });
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-sm" onClick={() => isForecastOnly ? logout() : navigate('/leads')}>{isForecastOnly ? 'Sign out' : '← Back'}</button>
          <div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Inventory Pipeline</h1>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>Hardware units expected — by month &amp; item · prioritized by stage, confidence, chain, then TCV</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {deviceLeads.length > 0 && (
            <>
              {/* Same picker component as the table's, with its own independent selection. */}
              <ColumnPicker
                label="Excel columns"
                columns={FORECAST_COLUMNS}
                value={excelKeys}
                onChange={setExcelKeys}
                defaultKeys={DEFAULT_FORECAST_KEYS}
              />
              <button className="btn btn-success" onClick={exportExcel}>Export Excel</button>
              <button className="btn" onClick={exportPdf}>Export PDF</button>
            </>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Gated on the UNFILTERED set: if filters exclude everything the table must stay on
            screen, or the user loses the controls needed to clear them. */}
        {loading ? <p style={{ color: '#94a3b8' }}>Loading…</p> : allLeads.length === 0 ? (
          <p style={{ color: '#94a3b8', textAlign: 'center', padding: 40 }}>No hardware items found — check that services are flagged as HW in the BU template.</p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              <div className="kpi-card"><p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Total Units in Pipeline</p><p style={{ fontSize: 22, fontWeight: 700, margin: '4px 0 0' }}>{grandTotal.toLocaleString()}</p></div>
              <div className="kpi-card"><p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Hardware Lines</p><p style={{ fontSize: 22, fontWeight: 700, margin: '4px 0 0' }}>{deviceLeads.length}</p></div>
              <div className="kpi-card"><p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Hardware Types</p><p style={{ fontSize: 22, fontWeight: 700, margin: '4px 0 0' }}>{skus.length}</p></div>
              <div className="kpi-card"><p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Won Units</p><p style={{ fontSize: 22, fontWeight: 700, margin: '4px 0 0', color: '#059669' }}>{deviceLeads.filter(l => l.phase === 'PO Received').reduce((s,l) => s + units(l), 0).toLocaleString()}</p></div>
            </div>

            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9' }}>
                <p style={{ fontWeight: 700, fontSize: 14, margin: 0 }}>Units by Month & Hardware Item</p>
              </div>
              <table className="data-table">
                <thead><tr><th>Month</th>{skus.map(s => <th key={s} style={{ textAlign: 'right' }}>{s}</th>)}<th style={{ textAlign: 'right' }}>Total</th></tr></thead>
                <tbody>
                  {months.map(m => (
                    <tr key={m}><td>{monthLabel(m)}</td>{skus.map(s => <td key={s} style={{ textAlign: 'right' }}>{pivot[m][s] || '—'}</td>)}<td style={{ textAlign: 'right', fontWeight: 700 }}>{monthTotal(m)}</td></tr>
                  ))}
                  <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                    <td>TOTAL</td>{skus.map(s => <td key={s} style={{ textAlign: 'right' }}>{skuTotal(s)}</td>)}<td style={{ textAlign: 'right' }}>{grandTotal}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Geography rollup — regional installation load. Counts only the confirmed
                physical-device portion (device_qty), and groups on each property's own
                state so a chain spanning states lands in the right buckets. */}
            <div className="card" style={{ padding: 0 }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <p style={{ fontWeight: 700, fontSize: 14, margin: 0 }}>Hardware Load by State</p>
                <span style={{ fontSize: 12, color: '#64748b' }}>
                  {stateRollupTotal.toLocaleString()} unit{stateRollupTotal === 1 ? '' : 's'} across {stateRollup.length} {stateRollup.length === 1 ? 'state' : 'states'} · {INSTALL_STAGES.join(' + ')} only
                </span>
              </div>
              {stateRollup.length === 0 ? (
                <p style={{ color: '#94a3b8', textAlign: 'center', padding: 28, margin: 0, fontSize: 13 }}>
                  No committed hardware yet — nothing at {INSTALL_STAGES.join(' or ')}{activeKeys.length ? ' matching the current filters' : ''}.
                </p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ whiteSpace: 'nowrap' }}>State / Geography</th>
                        <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Properties</th>
                        <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Units</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stateRollup.map(row => {
                        const open = expandedStates.has(row.state);
                        const unspecified = row.state === 'Unspecified';
                        return (
                          <React.Fragment key={row.state}>
                            <tr
                              onClick={() => toggleState(row.state)}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleState(row.state); } }}
                              tabIndex={0}
                              role="button"
                              aria-expanded={open}
                              title={open ? 'Hide contributing properties' : 'Show contributing properties'}
                              style={{ cursor: 'pointer' }}
                            >
                              <td style={{ fontWeight: 600 }}>
                                <span style={{ display: 'inline-block', width: 14, color: '#94a3b8' }}>{open ? '▾' : '▸'}</span>
                                <span style={unspecified ? { color: '#b45309' } : undefined}>{row.state}</span>
                                {unspecified && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 400, color: '#94a3b8' }}>no state recorded</span>}
                              </td>
                              <td style={{ textAlign: 'right' }}>{row.propertyCount}</td>
                              <td style={{ textAlign: 'right', fontWeight: 700 }}>{row.totalQty.toLocaleString()}</td>
                            </tr>
                            {open && row.leads.map(l => (
                              <tr key={`${row.state}-${l._row_id || l.id}`} style={{ background: '#f8fafc' }}>
                                <td style={{ paddingLeft: 34, fontSize: 12 }}>
                                  {l.customer_name}
                                  {l.hw_service && <span style={{ color: '#0a84ff', fontWeight: 600 }}>{` · ${l.hw_service}`}</span>}
                                  <span style={{ color: '#94a3b8' }}>{l.city ? ` · ${l.city}` : ''} · {l.phase}</span>
                                </td>
                                <td />
                                <td style={{ textAlign: 'right', fontSize: 12 }}>{deviceOnlyQty(l).toLocaleString()}</td>
                              </tr>
                            ))}
                          </React.Fragment>
                        );
                      })}
                      <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                        <td>TOTAL</td>
                        <td style={{ textAlign: 'right' }}>{stateRollup.reduce((s, r) => s + r.propertyCount, 0)}</td>
                        <td style={{ textAlign: 'right' }}>{stateRollupTotal.toLocaleString()}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Only the table scrolls horizontally — the header must stay outside that overflow
                context, or it would clip the column picker's popover. */}
            <div className="card" style={{ padding: 0 }}>
              <div ref={tableTopRef} style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <p style={{ fontWeight: 700, fontSize: 14, margin: 0 }}>Hardware Demand — Detail</p>
                  <span style={{ fontSize: 12, color: '#64748b' }}>
                    {activeKeys.length ? `${deviceLeads.length} of ${allLeads.length} rows` : `${allLeads.length} rows`}
                  </span>
                </div>
                <ColumnPicker
                  label="Customize columns"
                  columns={FORECAST_COLUMNS}
                  value={viewKeys}
                  onChange={setViewKeys}
                  defaultKeys={DEFAULT_FORECAST_KEYS}
                />
              </div>
              {/* Active-filter summary: names every filter in force — including ones whose
                  column is currently hidden — with a one-click clear for each and for all. */}
              {activeKeys.length > 0 && (
                <div style={{ padding: '10px 18px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>Filters:</span>
                  {activeKeys.map(k => {
                    const col = FORECAST_COLUMNS.find(c => c.key === k);
                    const hidden = !viewKeys.includes(k);
                    return (
                      <span key={k} title={hidden ? `${col.label} is filtered but currently hidden` : undefined}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#e0e7ff', color: '#0066d6', borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                        {col.label}{hidden && <span style={{ fontWeight: 400, opacity: 0.75 }}>(hidden)</span>}
                        <button type="button" onClick={() => setFilter(k, emptyFilterFor(col.filter))}
                          aria-label={`Clear ${col.label} filter`}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#0066d6', fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
                      </span>
                    );
                  })}
                  <button type="button" className="btn btn-sm" onClick={clearAllFilters}>Clear all</button>
                </div>
              )}

              <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>{viewColumns.map(c => (
                    <th key={c.key} style={c.align === 'right' ? { textAlign: 'right', whiteSpace: 'nowrap' } : { whiteSpace: 'nowrap' }}>
                      {c.label}
                      <ColumnFilter column={c} value={filters[c.key]} onChange={(next) => setFilter(c.key, next)} leads={allLeads} />
                    </th>
                  ))}</tr>
                </thead>
                <tbody>
                  {activeLeads.length === 0 && (
                    <tr>
                      <td colSpan={viewColumns.length} style={{ textAlign: 'center', color: '#94a3b8', padding: 28 }}>
                        {activeKeys.length ? (
                          <>No rows match the current filters.{' '}
                            <button type="button" className="btn btn-sm" onClick={clearAllFilters}>Clear all filters</button></>
                        ) : 'No active opportunities — everything here is already won.'}
                      </td>
                    </tr>
                  )}
                  {activeLeads.map(renderRow)}
                </tbody>
              </table>
              </div>
            </div>

            {/* Won deals sit outside the ranked list entirely — they're closed, so they
                don't compete for attention with active opportunities. Last section on the page. */}
            {wonLeads.length > 0 && (
              <div className="card" style={{ padding: 0, opacity: 0.92 }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <p style={{ fontWeight: 700, fontSize: 14, margin: 0, color: '#0a84ff' }}>Won — PO Received</p>
                  <span style={{ fontSize: 12, color: '#64748b' }}>
                    {wonLeads.length} deal{wonLeads.length === 1 ? '' : 's'} · {wonLeads.reduce((s, l) => s + units(l), 0).toLocaleString()} units · excluded from the prioritized ranking above
                  </span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>{viewColumns.map(c => (
                        <th key={c.key} style={c.align === 'right' ? { textAlign: 'right', whiteSpace: 'nowrap' } : { whiteSpace: 'nowrap' }}>{c.label}</th>
                      ))}</tr>
                    </thead>
                    <tbody>{wonLeads.map(renderRow)}</tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
