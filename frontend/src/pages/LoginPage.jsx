import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login as apiLogin, getBusinessUnits, setupStatus, runSetup } from '../services/api';
import { useAuth } from '../context/AuthContext';

// Fallback presentation for the three original business units — used only if the live list from
// GET /api/business-units fails to load (e.g. the API is briefly unreachable). The API is the
// source of truth, so a business unit added later appears here with no code change.
const BU_FALLBACK = {
  signage:      { slug: 'signage',      name: 'Signage',      color: '#0a84ff', description: 'Digital Signage Solutions' },
  jhes:         { slug: 'jhes',         name: 'JHES',         color: '#ea580c', description: 'Jio Hospitality & Entertainment Services' },
  surveillance: { slug: 'surveillance', name: 'Surveillance', color: '#0891b2', description: 'Surveillance & Security Solutions' },
};
const FALLBACK_LIST = Object.values(BU_FALLBACK);

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, user, isAuthenticated, loading } = useAuth();

  // Steps: 'platform' → 'credentials' | 'ga-credentials'
  const [step, setStep]         = useState('platform');
  const [bu, setBu]             = useState(null);     // selected business unit
  const [identifier, setIdent]  = useState('');        // email or name
  const [password, setPassword] = useState('');
  const [setupName, setSetupName] = useState('');
  const [setupEmail, setSetupEmail] = useState('');
  const [setupPw, setSetupPw] = useState('');
  const [setupPw2, setSetupPw2] = useState('');
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState('');
  const [businessUnits, setBusinessUnits] = useState(null);  // live list from the API (null until loaded)

  // Already signed in? Go to the app.
  useEffect(() => {
    if (!loading && isAuthenticated && user) {
      navigate(localStorage.getItem('salescrm_console') === '1' ? '/settings' : '/leads', { replace: true });
    }
  }, [loading, isAuthenticated, user, navigate]);

  // First-run: if the install has no users yet, show the one-time Create-Admin setup screen.
  useEffect(() => {
    setupStatus().then(r => { if (r && r.needsSetup) setStep('setup'); }).catch(() => {});
  }, []);

  // Load the selectable business units (empty on a fresh install — no fallback businesses).
  useEffect(() => {
    getBusinessUnits('active')
      .then(list => setBusinessUnits(Array.isArray(list) ? list : []))
      .catch(() => setBusinessUnits([]));
  }, []);

  // The cards to render, and the presentation for the currently-selected slug.
  const buList = businessUnits || [];
  const buMeta = (slug) => (businessUnits || []).find(b => b.slug === slug) || BU_FALLBACK[slug] || { slug, name: slug, color: '#0a84ff', description: '' };

  const goBack = (target) => {
    setError(''); setPassword(''); setIdent('');
    if (target === 'platform') { setBu(null); setStep('platform'); }
    else setStep(target);
  };

  // ------ Credential submission ------
  const handleSetup = async (e) => {
    e.preventDefault();
    setError('');
    if (setupPw.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (setupPw !== setupPw2) { setError('Passwords do not match'); return; }
    setBusy(true);
    try {
      const data = await runSetup(setupName.trim(), setupEmail.trim(), setupPw);
      localStorage.removeItem('salescrm_console');
      login(data.token, data.user);
      navigate('/business-units', { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Could not create admin account');
    } finally { setBusy(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      if (step === 'ga-credentials') {
        // Global Admin login — straight to Admin Console (Settings)
        const data = await apiLogin(identifier, password, null, 'super_admin');
        if (!data.user.is_super_admin) {
          setError('This is not a Global Admin account.');
          return;
        }
        localStorage.setItem('salescrm_console', '1');
        login(data.token, data.user);
        navigate('/settings', { replace: true });
        return;
      }

      // Platform login — the backend determines the role from the credentials.
      // Clear the console flag: a business login enters the full app, not the admin console.
      localStorage.removeItem('salescrm_console');
      const data = await apiLogin(identifier, password, bu);
      login(data.token, data.user);
      navigate('/leads', { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };


  // ===========================================================================
  //  STEP 1: Platform selection — 3 business cards + Global Admin (top-right)
  // ===========================================================================
  // ===========================================================================
  //  STEP 0: First-run — create the Global Admin account (blank install only)
  // ===========================================================================
  if (step === 'setup') return (
    <div style={s.wrap}>
      <div style={s.card}>
        <img src={`${process.env.PUBLIC_URL}/pipelines-logo.png`} alt="Pipelines" style={{ display: 'block', margin: '0 auto 10px', width: 110, height: 'auto' }} />
        <h1 style={s.title}>Welcome to Pipelines</h1>
        <p style={s.sub}>Create your admin account to get started. You'll add your first business next.</p>
        <form onSubmit={handleSetup}>
          <label style={s.label}>Your name</label>
          <input type="text" value={setupName} onChange={e => setSetupName(e.target.value)} required autoFocus style={s.input} placeholder="Jane Doe" />
          <label style={s.label}>Email</label>
          <input type="email" value={setupEmail} onChange={e => setSetupEmail(e.target.value)} required style={s.input} placeholder="you@company.com" />
          <label style={s.label}>Password</label>
          <input type="password" value={setupPw} onChange={e => setSetupPw(e.target.value)} required style={s.input} placeholder="At least 6 characters" />
          <label style={s.label}>Confirm password</label>
          <input type="password" value={setupPw2} onChange={e => setSetupPw2(e.target.value)} required style={s.input} placeholder="Re-enter password" />
          {error && <div style={s.error}>{error}</div>}
          <button type="submit" disabled={busy || !setupName || !setupEmail || !setupPw} style={s.submit}>
            {busy ? 'Creating…' : 'Create admin account'}
          </button>
        </form>
      </div>
    </div>
  );

  if (step === 'platform') return (
    <div style={s.wrap}>
      <div style={{ ...s.card, position: 'relative' }}>
        {/* Global Admin — small button in the top-right corner, separate from the business cards */}
        <button type="button" onClick={() => { setStep('ga-credentials'); setError(''); }}
          title="Global Admin Login" style={s.adminLogin}>
          <span style={{ fontSize: 13 }}>🛡️</span> Global Admin
        </button>

        <img src={`${process.env.PUBLIC_URL}/pipelines-logo.png`} alt="Pipelines" style={{ display: 'block', margin: '0 auto 10px', width: 110, height: 'auto' }} />
        <h1 style={s.title}>Pipelines</h1>
        <p style={s.sub}>Select your business to continue</p>

        {buList.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '18px 8px', color: '#8e8e93', fontSize: 13 }}>
            No businesses yet. Sign in with <strong>Global Admin</strong> (top right) to add your first business.
          </div>
        ) : buList.map(b => (
          <button key={b.slug} onClick={() => { setBu(b.slug); setStep('credentials'); setError(''); }}
            style={{ ...s.buButton, borderColor: b.color }}>
            <div style={{ ...s.buIcon, background: b.color }}>{(b.name || b.slug || '?')[0]}</div>
            <div style={{ textAlign: 'left' }}>
              <div style={s.buName}>{b.name}</div>
              <div style={s.buDesc}>{b.description}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  // ===========================================================================
  //  STEP 2a: Global Admin credential form
  // ===========================================================================
  if (step === 'ga-credentials') return (
    <div style={s.wrap}>
      <div style={s.card}>
        <button onClick={() => goBack('platform')} style={s.back}>← Back</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ ...s.buIcon, background: '#7c3aed', width: 48, height: 48, fontSize: 20 }}>🛡️</div>
          <div>
            <h2 style={{ ...s.h2, margin: 0 }}>Global Admin</h2>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Cross-platform administration</div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <label style={s.label}>Email</label>
          <input type="email" value={identifier} onChange={e => setIdent(e.target.value)}
            required autoFocus style={s.input} placeholder="admin@company.com" />
          <label style={s.label}>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            required style={s.input} placeholder="••••••••" />
          {error && <div style={s.error}>{error}</div>}
          <button type="submit" disabled={busy || !identifier || !password} style={s.submit}>
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );

  // ===========================================================================
  //  STEP 2c: Business platform — credential form (email or name + password)
  //  The backend determines the user's role from the credentials. No role selection.
  // ===========================================================================
  return (
    <div style={s.wrap}>
      <div style={s.card}>
        <button onClick={() => goBack('platform')} style={s.back}>← Back</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ ...s.buIcon, background: buMeta(bu).color, width: 36, height: 36, fontSize: 14 }}>{(buMeta(bu).name || bu || '?')[0]}</div>
          <div>
            <h2 style={{ ...s.h2, margin: 0 }}>{buMeta(bu).name}</h2>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>{buMeta(bu).description}</div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <label style={s.label}>Email or Full Name</label>
          <input type="text" value={identifier} onChange={e => setIdent(e.target.value)}
            required autoFocus style={s.input}
            placeholder="your.email@company.com or Your Full Name" />
          <label style={s.label}>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            required style={s.input} placeholder="••••••••" />
          {error && <div style={s.error}>{error}</div>}
          <button type="submit" disabled={busy || !identifier || !password} style={s.submit}>
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

// Inline styles — matches the app convention (no CSS framework).
const s = {
  wrap:    { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(1100px 560px at 50% -8%, #e3eeff 0%, #f2f2f7 46%)', padding: 16, fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Inter, sans-serif' },
  card:    { background: 'rgba(255,255,255,0.92)', backdropFilter: 'saturate(180%) blur(20px)', WebkitBackdropFilter: 'saturate(180%) blur(20px)', borderRadius: 24, padding: 32, width: '100%', maxWidth: 430, boxShadow: '0 1px 1px rgba(0,0,0,0.04), 0 18px 50px rgba(17,12,46,0.14)', border: '1px solid rgba(255,255,255,0.7)' },
  title:   { fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 4px', color: '#1c1c1e' },
  h2:      { fontSize: 20, fontWeight: 700, margin: '0 0 4px', color: '#0f172a' },
  sub:     { fontSize: 13, color: '#64748b', margin: '0 0 24px' },
  buButton:{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: 14, borderRadius: 16, border: '1px solid #ececf1', background: '#fff', cursor: 'pointer', marginBottom: 10, boxShadow: '0 1px 2px rgba(0,0,0,0.03)', transition: 'all .15s' },
  buIcon:  { width: 40, height: 40, borderRadius: 10, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 },
  buName:  { fontSize: 14, fontWeight: 600, color: '#0f172a' },
  buDesc:  { fontSize: 12, color: '#94a3b8' },
  back:    { background: 'none', border: 'none', color: '#94a3b8', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 16 },
  label:   { fontSize: 12, fontWeight: 600, color: '#334155', display: 'block', marginBottom: 6, marginTop: 12 },
  input:   { width: '100%', padding: '10px 12px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  error:   { background: '#fee2e2', color: '#b91c1c', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginTop: 12 },
  submit:  { width: '100%', padding: 13, marginTop: 16, background: '#0a84ff', color: '#fff', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 8px rgba(10,132,255,0.35)' },
  adminLogin:{ position: 'absolute', top: 18, right: 18, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 13px', borderRadius: 999, border: '1.5px solid #e9d5ff', background: '#faf5ff', color: '#7c3aed', fontSize: 12, fontWeight: 700, cursor: 'pointer', lineHeight: 1 },
};
