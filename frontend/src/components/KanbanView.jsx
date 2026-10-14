import React, { useState } from 'react';
import { PHASE_BADGE } from '../utils/constants';
import { hasConfidence, confidenceTrend, stageAging } from '../utils/leadHelpers';
import { sortByPriority } from '../utils/leadPriority';

// Small confidence chip for a Kanban card: coloured by score band with a week-over-week trend mark.
function ConfChip({ lead }) {
  if (!hasConfidence(lead)) return null;
  const c = Math.round(Number(lead.confidence_score));
  const t = confidenceTrend(lead);
  const bg = c >= 60 ? '#dcfce7' : c >= 30 ? '#fef3c7' : '#f1f5f9';
  const fg = c >= 60 ? '#0a84ff' : c >= 30 ? '#92400e' : '#475569';
  const mark = t === 'up' ? <span style={{ color: '#16a34a' }}>▲</span>
    : t === 'down' ? <span style={{ color: '#dc2626' }}>▼</span>
    : t === 'hold' ? <span style={{ color: '#0ea5e9' }}>❄</span>
    : <span style={{ color: '#94a3b8', fontSize: 8 }}>●</span>;
  return (
    <span title="Win-confidence score" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: bg, color: fg, borderRadius: 999, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>
      {c}% {mark}
    </span>
  );
}

// Small aging chip for a Kanban card: days-in-stage coloured against the stage's TAT target.
// Hidden for closed/paused phases (where stageAging returns null).
function AgingChip({ lead, tatMap }) {
  const a = stageAging(lead, tatMap || {});
  if (a.days === null) return null;
  const color = a.level === 'over' ? '#dc2626' : a.level === 'warn' ? '#b45309' : a.level === 'ok' ? '#059669' : '#64748b';
  const bg    = a.level === 'over' ? '#fef2f2' : a.level === 'warn' ? '#fffbeb' : a.level === 'ok' ? '#ecfdf5' : '#f1f5f9';
  const tip   = a.target != null ? `${a.days}d in ${lead.phase} · target ${a.target}d` : `${a.days}d in ${lead.phase} · no target set`;
  return (
    <span title={tip} style={{ background: bg, color, border: `1px solid ${color}22`, borderRadius: 999, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>
      {a.days}d
    </span>
  );
}

const COLUMNS = ['New', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'PO Expected', 'PO Received', 'Lost', 'On Hold'];

// Per-column tint + accent so every column is clearly distinguishable and never renders low-contrast
// (light) text on a white background. Card text stays dark on white for readability.
const COLUMN_STYLE = {
  New:           { bg: '#f1f5f9', accent: '#64748b' },
  Qualified:     { bg: '#f5f3ff', accent: '#7c3aed' },
  Demo:          { bg: '#fffbeb', accent: '#b45309' },
  Proposal:      { bg: '#eff6ff', accent: '#1d4ed8' },
  Negotiation:   { bg: '#fff7ed', accent: '#c2410c' },
  'PO Expected': { bg: '#f0fdfa', accent: '#0f766e' },
  'PO Received': { bg: '#e8f2ff', accent: '#0a84ff' },
  Lost:          { bg: '#fef2f2', accent: '#b91c1c' },
  'On Hold':     { bg: '#f1f5f9', accent: '#64748b' },
};

export default function KanbanView({ leads, onOpen, onPhaseChange, tatMap }) {
  const [dragId, setDragId] = useState(null);
  const [overCol, setOverCol] = useState(null);

  return (
    <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12 }}>
      {COLUMNS.map(col => {
        // Cards within a column follow the shared prioritization order (confidence → chain
        // → TCV; stage is constant inside a column). See utils/leadPriority.js.
        const items = sortByPriority(leads.filter(l => l.phase === col));
        const cs = COLUMN_STYLE[col] || { bg: '#f1f5f9', accent: '#64748b' };
        const isOver = overCol === col;
        return (
          <div
            key={col}
            onDragOver={e => { e.preventDefault(); setOverCol(col); }}
            onDragLeave={() => setOverCol(o => o === col ? null : o)}
            onDrop={e => {
              e.preventDefault();
              if (dragId) onPhaseChange(dragId, col);
              setDragId(null); setOverCol(null);
            }}
            style={{
              minWidth: 230, flexShrink: 0,
              background: isOver ? '#e0e7ff' : cs.bg,
              border: isOver ? '2px dashed #0a84ff' : '1px solid #e2e8f0',
              borderTop: `3px solid ${cs.accent}`,
              borderRadius: 12, padding: 10,
            }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span className={`badge ${PHASE_BADGE[col]}`}>{col}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: cs.accent }}>{items.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 48 }}>
              {items.map(l => {
                // Left-edge tint by aging level, so a red card jumps out of the column at a glance.
                const ageLvl = stageAging(l, tatMap || {}).level;
                const leftEdge = ageLvl === 'over' ? '#dc2626' : ageLvl === 'warn' ? '#b45309' : ageLvl === 'ok' ? '#059669' : '#e2e8f0';
                return (
                  <div
                    key={l.id}
                    draggable
                    onDragStart={() => setDragId(l.id)}
                    onClick={() => onOpen(l)}
                    style={{
                      cursor: 'grab', background: '#fff', border: '1px solid #e2e8f0', borderLeft: `3px solid ${leftEdge}`, borderRadius: 10,
                      padding: 10, boxShadow: '0 1px 2px rgba(15,23,42,.06)',
                    }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                      <p style={{ fontSize: 12, fontWeight: 700, margin: '0 0 4px', color: '#0f172a' }}>{l.customer_name}</p>
                      <span style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>
                        <AgingChip lead={l} tatMap={tatMap} />
                        <ConfChip lead={l} />
                      </span>
                    </div>
                    <p style={{ fontSize: 11, color: '#64748b', margin: 0 }}>{l.owner?.name?.split(' ')[0]} · ₹{l.potential_tcv_lakhs}L</p>
                  </div>
                );
              })}
              {items.length === 0 && (
                <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', padding: '12px 0', fontStyle: 'italic' }}>
                  Drop here
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
