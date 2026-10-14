import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getNotifications, getUnreadCount, markRead, markAllRead } from '../services/api';
import NotificationPreferences from './NotificationPreferences';

const POLL_MS = 60_000;

const SEVERITY_COLORS = {
  critical: { bg: '#fef2f2', border: '#fca5a5', dot: '#dc2626', label: 'Critical' },
  warning:  { bg: '#fffbeb', border: '#fcd34d', dot: '#f59e0b', label: 'Important' },
  info:     { bg: '#f0f9ff', border: '#93c5fd', dot: '#3b82f6', label: 'Info' },
  low:      { bg: '#e8f2ff', border: '#86efac', dot: '#22c55e', label: 'Low' },
};

const RULE_LABELS = {
  lead_phase_change: 'Phase Change',
  lead_reassigned: 'Lead Reassigned',
  lead_created: 'Lead Created',
  lead_lost: 'Lead Lost',
  lead_on_hold: 'Lead On Hold',
  po_document_uploaded: 'PO Document',
  renewal_due: 'Renewal Due',
  renewal_created: 'Renewal Created',
  stale_lead: 'Stale Lead',
  stage_tat_breach: 'TAT Breach',
  followup_overdue: 'Followup Overdue',
  hold_ending: 'Hold Ending',
  task_status_change: 'Task Update',
  confidence_drop: 'Confidence Drop',
  pipeline_below_target: 'Pipeline Alert',
  mention: 'Mention',
  task_assigned: 'Task Assigned',
};

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);

  const fetchCount = useCallback(async () => {
    try {
      const data = await getUnreadCount();
      setCount(data.count);
    } catch { /* silent */ }
  }, []);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getNotifications({ limit: 30 });
      setItems(data.notifications || []);
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchCount();
    const t = setInterval(fetchCount, POLL_MS);
    return () => clearInterval(t);
  }, [fetchCount]);

  useEffect(() => {
    if (open) fetchItems();
  }, [open, fetchItems]);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleMarkRead = async (id) => {
    try {
      await markRead(id);
      setItems(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
      setCount(c => Math.max(0, c - 1));
    } catch { /* silent */ }
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllRead();
      setItems(prev => prev.map(n => ({ ...n, is_read: true })));
      setCount(0);
    } catch { /* silent */ }
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', position: 'relative',
          fontSize: 20, padding: '4px 8px', color: '#64748b',
        }}
        title="Notifications"
      >
        🔔
        {count > 0 && (
          <span style={{
            position: 'absolute', top: 0, right: 2,
            background: '#ef4444', color: '#fff', borderRadius: '50%',
            fontSize: 11, fontWeight: 700, minWidth: 18, height: 18,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 4px', lineHeight: 1,
          }}>
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 999,
          width: 380, maxHeight: 480, background: '#fff',
          border: '1px solid #e2e8f0', borderRadius: 8,
          boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
          display: 'flex', flexDirection: 'column',
          marginTop: 4,
        }}>
          <div style={{
            padding: '12px 16px', borderBottom: '1px solid #e2e8f0',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>{showPrefs ? 'Preferences' : 'Notifications'}</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {!showPrefs && count > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  style={{
                    background: 'none', border: 'none', color: '#3b82f6',
                    cursor: 'pointer', fontSize: 13, fontWeight: 500,
                  }}
                >
                  Mark all read
                </button>
              )}
              <button
                onClick={() => setShowPrefs(p => !p)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 16, color: '#64748b', padding: '0 2px',
                }}
                title={showPrefs ? 'Back to notifications' : 'Notification settings'}
              >
                {showPrefs ? '←' : '⚙️'}
              </button>
            </div>
          </div>

          {showPrefs ? (
            <div style={{ overflowY: 'auto', flex: 1 }}>
              <NotificationPreferences onClose={() => setShowPrefs(false)} />
            </div>
          ) : (
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loading && !items.length && (
              <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
            )}
            {!loading && !items.length && (
              <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>No notifications yet</div>
            )}
            {items.map(n => {
              const sev = SEVERITY_COLORS[n.severity] || SEVERITY_COLORS.info;
              return (
                <div
                  key={n.id}
                  onClick={() => {
                    if (!n.is_read) handleMarkRead(n.id);
                    let path = n.link_path || (n.lead_id ? `/leads?lead=${n.lead_id}` : null);
                    if (path) {
                      const m = path.match(/^\/leads\/(\d+)$/);
                      if (m) path = `/leads?lead=${m[1]}`;
                      setOpen(false);
                      navigate(path, { replace: false, state: { ts: Date.now() } });
                    }
                  }}
                  style={{
                    padding: '10px 16px', borderBottom: '1px solid #f1f5f9',
                    cursor: 'pointer',
                    background: n.is_read ? '#fff' : sev.bg,
                    borderLeft: `3px solid ${n.is_read ? 'transparent' : sev.border}`,
                    transition: 'background 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span title={sev.label} style={{
                      width: 10, height: 10, borderRadius: '50%', background: sev.dot,
                      flexShrink: 0, marginTop: 4,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: n.is_read ? 400 : 600, color: '#1e293b', lineHeight: 1.3 }}>
                        {n.title}
                      </div>
                      {n.body && (
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, lineHeight: 1.3 }}>
                          {n.body}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center' }}>
                        <span style={{
                          fontSize: 10, padding: '1px 6px', borderRadius: 4,
                          background: '#f1f5f9', color: '#64748b', fontWeight: 500,
                        }}>
                          {RULE_LABELS[n.rule_key] || n.rule_key}
                        </span>
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>{timeAgo(n.createdAt || n.created_at)}</span>
                      </div>
                    </div>
                    {!n.is_read && (
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%', background: sev.dot,
                        flexShrink: 0, marginTop: 4,
                      }} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          )}
        </div>

      )}
    </div>
  );
}
