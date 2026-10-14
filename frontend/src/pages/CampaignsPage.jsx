import React, { useEffect, useState, useMemo } from 'react';
import Layout from '../components/Layout';
import { getCampaigns, createCampaign, updateCampaign, deleteCampaign } from '../services/api';

const STATUS_STYLES = {
  active:    { bg: '#dcfce7', fg: '#0a84ff' },
  completed: { bg: '#dbeafe', fg: '#1e40af' },
  planned:   { bg: '#fef3c7', fg: '#92400e' },
};

const emptyCampaign = {
  name: '', description: '', start_date: '', end_date: '',
  budget_lakhs: '', status: 'planned',
};

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | 'new' | campaign id
  const [form, setForm] = useState(emptyCampaign);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    getCampaigns()
      .then(data => setCampaigns(Array.isArray(data) ? data : (data.campaigns || [])))
      .catch(() => setCampaigns([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const startNew = () => {
    setEditing('new');
    setForm({ ...emptyCampaign });
    setError('');
  };

  const startEdit = (c) => {
    setEditing(c.id);
    setForm({
      name: c.name || '',
      description: c.description || '',
      start_date: c.start_date || '',
      end_date: c.end_date || '',
      budget_lakhs: c.budget_lakhs ?? '',
      status: c.status || 'planned',
    });
    setError('');
  };

  const cancel = () => { setEditing(null); setForm(emptyCampaign); setError(''); };

  const save = async () => {
    if (!form.name.trim()) { setError('Campaign name is required.'); return; }
    setSaving(true);
    setError('');
    try {
      if (editing === 'new') {
        await createCampaign(form);
      } else {
        await updateCampaign(editing, form);
      }
      cancel();
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Could not save campaign.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this campaign? This cannot be undone.')) return;
    try {
      await deleteCampaign(id);
      load();
    } catch (e) {
      alert(e.response?.data?.message || 'Could not delete campaign.');
    }
  };

  // Summary stats
  const stats = useMemo(() => {
    const total = campaigns.length;
    const active = campaigns.filter(c => c.status === 'active').length;
    const totalBudget = campaigns.reduce((s, c) => s + (parseFloat(c.budget_lakhs) || 0), 0);
    const totalRevenue = campaigns.reduce((s, c) => s + (parseFloat(c.revenue_lakhs) || 0), 0);
    return { total, active, totalBudget, totalRevenue };
  }, [campaigns]);

  return (
    <Layout>
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Campaigns</h1>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>{campaigns.length} campaign{campaigns.length === 1 ? '' : 's'}</p>
        </div>
        {editing === null && (
          <button className="btn btn-primary" onClick={startNew}>+ New Campaign</button>
        )}
      </div>

      <div style={{ padding: 20 }}>
        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          <div className="kpi-card">
            <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Total Campaigns</p>
            <p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0' }}>{stats.total}</p>
          </div>
          <div className="kpi-card">
            <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Active Campaigns</p>
            <p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0', color: '#059669' }}>{stats.active}</p>
          </div>
          <div className="kpi-card">
            <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Total Budget</p>
            <p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0' }}>{'₹'}{stats.totalBudget.toFixed(1)}L</p>
          </div>
          <div className="kpi-card">
            <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Total Revenue</p>
            <p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0', color: '#059669' }}>{'₹'}{stats.totalRevenue.toFixed(1)}L</p>
          </div>
        </div>

        {/* Inline form */}
        {editing !== null && (
          <div className="card" style={{ marginBottom: 20, padding: 20 }}>
            <p style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', margin: '0 0 14px' }}>
              {editing === 'new' ? 'New Campaign' : 'Edit Campaign'}
            </p>
            {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 12 }}>{error}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div>
                <label className="field-label">Name *</label>
                <input className="input" value={form.name} onChange={e => setF('name', e.target.value)} placeholder="Campaign name" />
              </div>
              <div>
                <label className="field-label">Status</label>
                <select className="input" value={form.status} onChange={e => setF('status', e.target.value)}>
                  <option value="planned">Planned</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
              <div>
                <label className="field-label">Budget ({'₹'} Lakhs)</label>
                <input className="input" type="number" step="0.01" min="0" value={form.budget_lakhs} onChange={e => setF('budget_lakhs', e.target.value)} />
              </div>
              <div>
                <label className="field-label">Start Date</label>
                <input className="input" type="date" value={form.start_date} onChange={e => setF('start_date', e.target.value)} />
              </div>
              <div>
                <label className="field-label">End Date</label>
                <input className="input" type="date" value={form.end_date} onChange={e => setF('end_date', e.target.value)} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label className="field-label">Description</label>
                <textarea className="input" rows={2} value={form.description} onChange={e => setF('description', e.target.value)} placeholder="Campaign description" style={{ resize: 'vertical' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="btn" onClick={cancel}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        )}

        {/* Table */}
        {loading && <p style={{ color: '#94a3b8' }}>Loading...</p>}

        {!loading && campaigns.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontStyle: 'italic' }}>
            No campaigns yet. Click "+ New Campaign" to create one.
          </div>
        )}

        {!loading && campaigns.length > 0 && (
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Start Date</th>
                  <th>End Date</th>
                  <th style={{ textAlign: 'right' }}>Budget ({'₹'}L)</th>
                  <th style={{ textAlign: 'right' }}>Leads</th>
                  <th style={{ textAlign: 'right' }}>Won</th>
                  <th style={{ textAlign: 'right' }}>Revenue ({'₹'}L)</th>
                  <th style={{ textAlign: 'right' }}>ROI</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map(c => {
                  const st = STATUS_STYLES[c.status] || STATUS_STYLES.planned;
                  const budget = parseFloat(c.budget_lakhs) || 0;
                  const revenue = parseFloat(c.revenue_lakhs) || 0;
                  const roi = budget > 0 ? (((revenue - budget) / budget) * 100).toFixed(0) : '—';
                  return (
                    <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => startEdit(c)}>
                      <td style={{ fontWeight: 600 }}>{c.name}</td>
                      <td>
                        <span style={{ background: st.bg, color: st.fg, padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                          {c.status}
                        </span>
                      </td>
                      <td>{c.start_date || '—'}</td>
                      <td>{c.end_date || '—'}</td>
                      <td style={{ textAlign: 'right' }}>{budget ? `${'₹'}${budget.toFixed(1)}` : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{c.lead_count ?? c.leads_count ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>{c.won_count ?? '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{revenue ? `${'₹'}${revenue.toFixed(1)}` : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{roi !== '—' ? `${roi}%` : '—'}</td>
                      <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                        <button className="btn btn-sm btn-danger" style={{ fontSize: 11 }} onClick={() => remove(c.id)}>Delete</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
