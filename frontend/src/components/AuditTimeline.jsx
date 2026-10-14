import React, { useEffect, useState } from 'react';
import { getChangeLog } from '../services/api';

function formatFieldName(name) {
  if (!name) return '';
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth}mo ago`;
  return `${Math.floor(diffMonth / 12)}y ago`;
}

export default function AuditTimeline({ entityType, entityId }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!entityType || !entityId) { setLoading(false); return; }
    setLoading(true);
    getChangeLog(entityType, entityId)
      .then((data) => {
        const list = Array.isArray(data) ? data : (data.entries || data.changes || []);
        // Sort newest first
        list.sort((a, b) => new Date(b.created_at || b.createdAt) - new Date(a.created_at || a.createdAt));
        setEntries(list);
      })
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [entityType, entityId]);

  if (loading) {
    return <div style={{ padding: 16, color: '#94a3b8', fontSize: 13 }}>Loading history...</div>;
  }

  if (entries.length === 0) {
    return <div style={{ padding: 16, color: '#94a3b8', fontSize: 13, fontStyle: 'italic' }}>No changes recorded yet</div>;
  }

  return (
    <div style={{ position: 'relative', paddingLeft: 24 }}>
      {/* Vertical timeline line */}
      <div style={{
        position: 'absolute', left: 8, top: 6, bottom: 6,
        width: 2, background: '#e2e8f0',
      }} />

      {entries.map((entry, i) => {
        const ts = entry.created_at || entry.createdAt || entry.timestamp;
        return (
          <div key={entry.id || i} style={{ position: 'relative', paddingBottom: 20 }}>
            {/* Timeline dot */}
            <div style={{
              position: 'absolute', left: -20, top: 4,
              width: 10, height: 10, borderRadius: '50%',
              background: '#0a84ff', border: '2px solid #fff',
              boxShadow: '0 0 0 2px #e2e8f0',
            }} />

            <div style={{ fontSize: 13 }}>
              <div style={{ fontWeight: 600, color: '#334155', marginBottom: 2 }}>
                {formatFieldName(entry.field_name || entry.field)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12 }}>
                <span style={{ textDecoration: 'line-through', color: '#94a3b8' }}>
                  {entry.old_value ?? entry.oldValue ?? '(empty)'}
                </span>
                <span style={{ color: '#64748b' }}>{'→'}</span>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>
                  {entry.new_value ?? entry.newValue ?? '(empty)'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: 11, color: '#94a3b8' }}>
                <span>{entry.changed_by_name || entry.changed_by || entry.user_name || 'System'}</span>
                <span>{'·'}</span>
                <span title={ts}>{timeAgo(ts)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
