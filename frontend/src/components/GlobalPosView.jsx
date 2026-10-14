import React, { useEffect, useState } from 'react';
import { getGlobalPos, getGlobalPo, updateGlobalPo } from '../services/api';
import { fmtDate } from '../utils/leadHelpers';
import MentionTextarea from './MentionTextarea';

// Chains (Global POs) browser: a list of chains with live device-pool status, and a per-chain detail
// showing original/consumed/remaining-or-overage plus the contributing won Individual POs. All figures
// are derived from current lead states, so they reflect any PO Received the moment it happens.
export default function GlobalPosView({ onClose }) {
  const [chains, setChains] = useState(null);
  const [detail, setDetail] = useState(null);

  useEffect(() => { getGlobalPos().then(setChains).catch(() => setChains([])); }, []);
  const openDetail = (id) => getGlobalPo(id).then(setDetail).catch(() => setDetail(null));

  const handleStatusChange = async (e, chainId) => {
    e.stopPropagation();
    const newStatus = e.target.value;
    try {
      await updateGlobalPo(chainId, { status: newStatus });
      setChains(prev => prev.map(c => c.id === chainId ? { ...c, status: newStatus } : c));
    } catch { /* silent */ }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 780 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span style={{ fontWeight: 700, fontSize: 15 }}>{detail ? `Chain — ${detail.chain_name}` : 'Global POs (Chains)'}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {detail && <button className="btn btn-sm" onClick={() => setDetail(null)}>← All chains</button>}
            <button className="btn btn-sm" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="modal-body">
          {detail ? <ChainDetail detail={detail} onBack={() => setDetail(null)} />
            : chains === null ? <p style={{ color: '#94a3b8' }}>Loading…</p>
            : chains.length === 0 ? <p style={{ color: '#94a3b8', fontSize: 13 }}>No chains yet. Create one via <b>New Lead → PO Type → Global PO</b>.</p>
            : (
              <table className="data-table" style={{ width: '100%' }}>
                <thead><tr><th>Chain</th><th>Status</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Consumed</th><th>Pool Status</th></tr></thead>
                <tbody>
                  {chains.map(c => (
                    <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(c.id)}>
                      <td style={{ fontWeight: 600 }}>{c.chain_name}<div style={{ fontSize: 11, color: '#94a3b8' }}>{c.device_type && <span style={{ background: '#f1f5f9', borderRadius: 4, padding: '1px 5px', marginRight: 6, fontSize: 10, fontWeight: 600, color: '#475569' }}>{c.device_type}</span>}{c.linked_count} linked PO(s)</div></td>
                      <td>
                        <select
                          value={c.status || 'New'}
                          onClick={e => e.stopPropagation()}
                          onChange={e => handleStatusChange(e, c.id)}
                          style={{ fontSize: 12, padding: '3px 6px', borderRadius: 4, border: '1px solid #cbd5e1', cursor: 'pointer' }}
                        >
                          <option value="New">New</option>
                          <option value="Under Discussion">Under Discussion</option>
                          <option value="Contract Received">Contract Received</option>
                        </select>
                      </td>
                      <td style={{ textAlign: 'right' }}>{c.device_total}</td>
                      <td style={{ textAlign: 'right' }}>{c.poolStatus?.consumed ?? 0}</td>
                      <td><StatusBadge s={c.poolStatus} total={c.device_total} /></td>
                    </tr>
                  ))}
                </tbody>
                {(() => {
                  const totQty = chains.reduce((s, c) => s + (Number(c.device_total) || 0), 0);
                  const totCon = chains.reduce((s, c) => s + (Number(c.poolStatus?.consumed) || 0), 0);
                  const totRem = totQty - totCon;
                  return (
                    <tfoot>
                      <tr style={{ borderTop: '2px solid #cbd5e1', background: '#f8fafc' }}>
                        <td style={{ fontWeight: 700 }}>Total · {chains.length} chain{chains.length === 1 ? '' : 's'}</td>
                        <td />
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{totQty}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{totCon}</td>
                        <td>{totRem < 0
                          ? <span className="badge badge-red">Exceeded by {Math.abs(totRem)}</span>
                          : <span className="badge badge-green">{totRem} of {totQty} left</span>}</td>
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ s, total }) {
  if (!s) return null;
  if (s.exceeded) return <span className="badge badge-red">Exceeded by {Math.abs(s.remaining)}</span>;
  return <span className="badge badge-green">{s.remaining} of {total} left</span>;
}

function Stat({ label, value, color }) {
  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || '#0f172a' }}>{value}</div>
    </div>
  );
}

function ChainDetail({ detail, onBack }) {
  const s = detail.poolStatus || {};
  const [notes, setNotes] = useState(detail.notes || '');
  const [saving, setSaving] = useState(false);
  const dirty = notes !== (detail.notes || '');

  const saveNotes = async () => {
    setSaving(true);
    try {
      await updateGlobalPo(detail.id, { notes });
      if (onBack) onBack();
    } catch { /* silent */ }
    setSaving(false);
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14 }}>
        <Stat label="Original total" value={detail.device_total} />
        <Stat label="Consumed (won)" value={s.consumed ?? 0} />
        {s.exceeded
          ? <Stat label="Overage" value={`+${Math.abs(s.remaining)}`} color="#dc2626" />
          : <Stat label="Remaining" value={s.remaining} color="#16a34a" />}
      </div>
      {s.exceeded && (
        <p style={{ fontSize: 12, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 10px', marginBottom: 14 }}>
          ⚠ Cumulative wins exceed the original chain total of {detail.device_total} devices. Wins are never blocked — the overage is shown for visibility only.
        </p>
      )}
      <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 4px' }}>
        Type: <span style={{ color: '#334155', fontWeight: 600 }}>{detail.device_type || 'Hardware'}</span> · Price: {detail.price_lakhs ? `₹${detail.price_lakhs}L` : '—'} · Expected {detail.expected_start_date ? fmtDate(detail.expected_start_date) : '—'} → {detail.expected_end_date ? fmtDate(detail.expected_end_date) : '—'}
      </p>
      <p className="section-title" style={{ marginTop: 16 }}>Contributing Individual POs (won)</p>
      {(!detail.contributors || detail.contributors.length === 0) ? (
        <p style={{ fontSize: 13, color: '#94a3b8' }}>No properties won yet — the pool updates automatically the moment a linked Individual PO reaches PO Received.</p>
      ) : (
        <table className="data-table" style={{ width: '100%' }}>
          <thead><tr><th>Property</th><th style={{ textAlign: 'right' }}>Devices Won</th><th>Date Won</th></tr></thead>
          <tbody>
            {detail.contributors.map(c => (
              <tr key={c.id}><td>{c.customer_name}</td><td style={{ textAlign: 'right' }}>{c.devices}</td><td>{c.won_date ? fmtDate(c.won_date) : '—'}</td></tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="section-title" style={{ marginTop: 20 }}>Notes</p>
      <MentionTextarea
        value={notes}
        onChange={setNotes}
        placeholder="Add notes about this chain… Use @Name to mention someone"
        style={{
          width: '100%', minHeight: 80, padding: '8px 10px', fontSize: 13, lineHeight: 1.5,
          border: '1px solid #e2e8f0', borderRadius: 8, resize: 'vertical',
          fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
        <button
          className="btn btn-sm btn-primary"
          onClick={saveNotes}
          disabled={!dirty || saving}
          style={{ opacity: !dirty ? 0.5 : 1 }}
        >
          {saving ? 'Saving...' : 'Save Notes'}
        </button>
      </div>
    </div>
  );
}
