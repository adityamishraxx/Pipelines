import React, { useState } from 'react';
import Layout from '../components/Layout';
import { changePassword } from '../services/api';

export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMsg('');
    if (newPassword.length < 6) return setMsg('New password must be at least 6 characters.');
    if (newPassword !== confirm) return setMsg('Passwords do not match.');
    setBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      setMsg('Password updated successfully!');
      setCurrentPassword(''); setNewPassword(''); setConfirm('');
    } catch (err) {
      setMsg(err.response?.data?.message || 'Error updating password');
    } finally { setBusy(false); }
  };

  return (
    <Layout>
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '16px 24px' }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Change Password</h1>
      </div>
      <div style={{ maxWidth: 420, margin: '0 auto', padding: '24px 20px' }}>
        <div className="card">
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label className="field-label">Current Password</label>
              <input type="password" className="input" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
            </div>
            <div>
              <label className="field-label">New Password</label>
              <input type="password" className="input" required minLength={6} value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Minimum 6 characters" />
            </div>
            <div>
              <label className="field-label">Confirm New Password</label>
              <input type="password" className="input" required value={confirm} onChange={e => setConfirm(e.target.value)} />
            </div>
            {msg && <p style={{ fontSize: 13, color: msg.includes('success') ? '#059669' : '#dc2626' }}>{msg}</p>}
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Updating…' : 'Update Password'}</button>
          </form>
        </div>
      </div>
    </Layout>
  );
}
