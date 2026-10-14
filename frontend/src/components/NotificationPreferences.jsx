import React, { useState, useEffect } from 'react';
import { getNotifPreferences, updateNotifPreferences } from '../services/api';

const RULE_GROUPS = [
  {
    label: 'Lead Events',
    rules: [
      { key: 'lead_phase_change', label: 'Phase changes' },
      { key: 'lead_reassigned', label: 'Lead reassignment' },
      { key: 'lead_created', label: 'New leads created' },
      { key: 'lead_lost', label: 'Leads marked Lost' },
      { key: 'lead_on_hold', label: 'Leads put On Hold' },
      { key: 'po_document_uploaded', label: 'PO document uploaded' },
    ],
  },
  {
    label: 'Renewal & Expiry',
    rules: [
      { key: 'renewal_due', label: 'Renewal due alerts' },
      { key: 'renewal_created', label: 'Renewal created' },
    ],
  },
  {
    label: 'Warnings & Reminders',
    rules: [
      { key: 'stale_lead', label: 'Stale lead warnings' },
      { key: 'stage_tat_breach', label: 'Stage TAT breach' },
      { key: 'followup_overdue', label: 'Followup overdue' },
      { key: 'hold_ending', label: 'Hold ending soon' },
    ],
  },
  {
    label: 'Tasks & Forecast',
    rules: [
      { key: 'task_status_change', label: 'Task status changes' },
      { key: 'task_assigned', label: 'Task assigned to you' },
      { key: 'confidence_drop', label: 'Confidence score drops' },
      { key: 'pipeline_below_target', label: 'Pipeline below target' },
    ],
  },
  {
    label: 'Mentions',
    rules: [
      { key: 'mention', label: 'Someone @mentions you' },
    ],
  },
];

export default function NotificationPreferences({ onClose }) {
  const [prefs, setPrefs] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getNotifPreferences().then(setPrefs).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const toggle = (key) => {
    setPrefs(prev => ({
      ...prev,
      [key]: { enabled: !(prev[key]?.enabled !== false) },
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await updateNotifPreferences(prefs);
      onClose();
    } catch {
      alert('Failed to save preferences.');
    }
    setSaving(false);
  };

  if (loading) return <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>Loading...</div>;

  return (
    <div style={{ padding: '0 16px 16px' }}>
      {RULE_GROUPS.map(g => (
        <div key={g.label} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: 6 }}>{g.label}</div>
          {g.rules.map(r => {
            const enabled = prefs[r.key]?.enabled !== false;
            return (
              <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
                <span style={{ fontSize: 13, color: '#334155' }}>{r.label}</span>
                <button
                  onClick={() => toggle(r.key)}
                  style={{
                    width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
                    background: enabled ? '#3b82f6' : '#cbd5e1',
                    position: 'relative', transition: 'background 0.2s',
                  }}
                >
                  <span style={{
                    position: 'absolute', top: 2,
                    left: enabled ? 18 : 2,
                    width: 16, height: 16, borderRadius: '50%', background: '#fff',
                    transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                  }} />
                </button>
              </div>
            );
          })}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
        <button onClick={onClose} style={{ padding: '6px 16px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
        <button onClick={save} disabled={saving} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}
