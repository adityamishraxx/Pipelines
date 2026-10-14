import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ssoSelect, getBusinessUnits } from '../services/api';
import { useAuth } from '../context/AuthContext';

// === JIOAUTIFY INTEGRATION: SSO account chooser. Reached only in production, when the STB portal
// hands off an email that has more than one Pipelines account: the portal opens
// /sales_crm?ssoTicket=<jwt>, App.captureSsoFromUrl stashes the ticket in sessionStorage and routes
// here. We redeem the ticket to list the accounts, let the user pick a business unit, then exchange
// the ticket for a token for that account and land on /leads — bypassing the login page entirely. ===
// Fallback presentation, used only if the live list (GET /api/business-units) fails to load.
const BU_FALLBACK = {
  signage:      { name: 'Signage',      color: '#0a84ff', description: 'Digital Signage Solutions' },
  jhes:         { name: 'JHES',         color: '#ea580c', description: 'Jio Hospitality & Entertainment Services' },
  surveillance: { name: 'Surveillance', color: '#0891b2', description: 'Surveillance & Security Solutions' },
};

export default function SsoSelectPage() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [accounts, setAccounts] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [buBySlug, setBuBySlug] = useState({});  // slug -> { name, color, description } from the API

  const ticket = sessionStorage.getItem('salescrm_sso_ticket');

  // On mount, redeem the ticket for the list of accounts to choose from.
  useEffect(() => {
    if (!ticket) { navigate('/login', { replace: true }); return; }
    ssoSelect(ticket)
      .then((res) => {
        const list = (res && res.accounts) || [];
        // Defensive: if the ticket somehow resolves to a single account, log straight in.
        if (list.length === 1) return handlePick(list[0].business_unit);
        setAccounts(list);
      })
      .catch((err) => setError(err.response?.data?.message || 'SSO session expired. Open Pipelines from the portal again.'));
  }, []); // run once on mount; ticket/login/navigate are stable for this flow

  // Load business-unit presentation so the account cards show the right name/colour/description.
  useEffect(() => {
    getBusinessUnits()
      .then(list => setBuBySlug(Object.fromEntries((list || []).map(b => [b.slug, b]))))
      .catch(() => setBuBySlug({}));  // fall back to BU_FALLBACK below
  }, []);

  // Presentation for a slug: live list first, then the hardcoded fallback, then the raw slug.
  const buMeta = (slug) => buBySlug[slug] || BU_FALLBACK[slug] || { name: slug, color: '#0a84ff', description: '' };

  const handlePick = async (businessUnit) => {
    setBusy(true);
    setError('');
    try {
      const { token, user } = await ssoSelect(ticket, businessUnit);
      sessionStorage.removeItem('salescrm_sso_ticket');
      login(token, user);           // seeds salescrm_token + auth state
      navigate('/leads', { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Could not sign in to that account.');
      setBusy(false);
    }
  };

  return (
    <div style={s.wrap}>
      <div style={s.card}>
        <h1 style={s.title}>Pipelines</h1>
        <p style={s.sub}>Your email has more than one account — choose which to open</p>

        {error && <div style={s.error}>{error}</div>}

        {!accounts && !error && <p style={{ fontSize: 13, color: '#64748b' }}>Loading your accounts…</p>}

        {accounts && accounts.map((a) => {
          const m = buMeta(a.business_unit);
          return (
            <button
              key={a.business_unit}
              onClick={() => handlePick(a.business_unit)}
              disabled={busy}
              style={{ ...s.buButton, borderColor: m.color || '#e2e8f0', cursor: busy ? 'wait' : 'pointer' }}
            >
              <div style={{ ...s.buIcon, background: m.color || '#0a84ff' }}>
                {(m.name || a.business_unit || '?')[0]}
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={s.buName}>{m.name || a.business_unit}</div>
                <div style={s.buDesc}>{m.description || ''}{a.role ? ` · ${a.role.toUpperCase()}` : ''}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Inline styles — mirrors LoginPage.jsx convention (no CSS framework).
const s = {
  wrap:    { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', padding: 16, fontFamily: 'Inter, system-ui, sans-serif' },
  card:    { background: '#fff', borderRadius: 16, padding: 32, width: '100%', maxWidth: 400, boxShadow: '0 10px 30px rgba(0,0,0,0.08)', border: '1px solid #e2e8f0' },
  title:   { fontSize: 24, fontWeight: 700, margin: '0 0 4px', color: '#0f172a' },
  sub:     { fontSize: 13, color: '#64748b', margin: '0 0 24px' },
  buButton:{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: 14, borderRadius: 12, border: '2px solid #e2e8f0', background: '#fff', marginBottom: 10 },
  buIcon:  { width: 40, height: 40, borderRadius: 10, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 },
  buName:  { fontSize: 14, fontWeight: 600, color: '#0f172a' },
  buDesc:  { fontSize: 12, color: '#94a3b8' },
  error:   { background: '#fee2e2', color: '#b91c1c', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12 },
};
