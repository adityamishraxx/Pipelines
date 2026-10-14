import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { switchPlatform } from '../services/api';
import { BU_CONFIG, ROLE_LABEL } from '../utils/constants';

const NAV_ICONS = {
  leads: '📋', dashboard: '📊', forecast: '🚚', reports: '📁', campaigns: '📢', customers: '👥', activity: '🕒', settings: '⚙️', 'change-password': '🔒', voc: '🗣️', 'business-units': '🏢', activities: '📌',
};

export default function Sidebar() {
  const { user, login, logout, isAdmin, isSuperAdmin, isCrossPlatform, isConsoleOnly, canView, canSeeActivityFeed, buHasModule } = useAuth();
  const [switching, setSwitching] = useState(false);

  // N1: hop to another platform's account in the same session. We swap the token via login(), then
  // hard-reload — a platform switch changes every page's data (leads, dashboard, forecast, activity)
  // and the user's permissions, so a reload re-fetches everything cleanly under the new account
  // rather than trying to invalidate each mounted page's state individually.
  const onSwitchPlatform = async (bu) => {
    if (bu === user.business_unit || switching) return;
    setSwitching(true);
    try {
      const data = await switchPlatform(bu);
      login(data.token, data.user);          // updates the stored token
      window.location.reload();              // re-bootstraps the whole app under the new platform
    } catch {
      window.alert('Could not switch platform. Please try again.');
      setSwitching(false);
    }
  };
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === '1');
  const [logoHover, setLogoHover] = useState(false);

  if (!user) return null;

  const toggle = () => {
    setCollapsed(c => {
      localStorage.setItem('sidebarCollapsed', c ? '0' : '1');
      return !c;
    });
  };

  const bu = BU_CONFIG[user.business_unit] || BU_CONFIG.signage;
  // Console-only (Global Admin via the Admin button): shows ONLY the Admin Console — no business
  // pages. Business logins get the full operational nav for their platform.
  const navItems = isConsoleOnly
    ? [
        { path: '/settings', label: 'Admin Console' },
        { path: '/business-units', label: 'Business Units' },
        { path: '/change-password', label: 'Password' },
      ]
    : [
        { path: '/leads',     label: 'Leads',     disabled: !canView('leads') },
        { path: '/dashboard', label: 'Dashboard', disabled: !canView('dashboard') },
        ...(buHasModule('voc') ? [{ path: '/voc', label: 'VOC', disabled: !canView('voc') }] : []),
        ...(buHasModule('customers') ? [{ path: '/customers', label: 'Customers', disabled: !canView('customers') }] : []),
        { path: '/forecast',  label: 'Inventory Pipeline',  disabled: !canView('forecast') },
        { path: '/reports',   label: 'Reports',   disabled: !canView('reports') },
        ...(buHasModule('campaigns') ? [{ path: '/campaigns', label: 'Campaigns', disabled: !canView('campaigns') }] : []),
        // Activities kanban — only shown when the BU has enabled it (Surveillance by default,
        // Signage/JHES only if a Global Admin turns it on via Edit Template). Suppressing the entry
        // when the BU disables it keeps other businesses' nav uncluttered.
        ...(buHasModule('activities') ? [{ path: '/activities', label: 'Task Board', disabled: !canView('activities') }] : []),
        ...(canSeeActivityFeed ? [{ path: '/activity', label: 'Activity' }] : []),
        ...(isAdmin ? [{ path: '/settings', label: isSuperAdmin ? 'Admin Console' : 'Settings' }] : []),
        // Global Admin (cross-platform) can manage every business unit. A Business Admin reaches the
        // same page but it's scoped server-side to only their OWN BU, so the nav label is singular.
        ...(isSuperAdmin
          ? [{ path: '/business-units', label: 'Business Units' }]
          : (user.role === 'business_admin'
              ? [{ path: '/business-units', label: 'Business Unit' }]
              : [])),
        { path: '/change-password', label: 'Password' },
      ];

  const WAVE_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='220' height='170' viewBox='0 0 220 170' preserveAspectRatio='none'><defs><linearGradient id='w' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#2f6bff' stop-opacity='0'/><stop offset='1' stop-color='#2f6bff' stop-opacity='0.55'/></linearGradient></defs><path d='M0,95 C55,60 150,150 220,95 L220,170 L0,170 Z' fill='url(#w)'/><path d='M0,125 C70,100 150,165 220,120 L220,170 L0,170 Z' fill='#3b82f6' fill-opacity='0.28'/></svg>";
  const SIDEBAR_BG = `url("data:image/svg+xml,${encodeURIComponent(WAVE_SVG)}") center bottom / 100% auto no-repeat, linear-gradient(180deg, #13295c 0%, #0c1733 100%)`;

  return (
    <aside style={{
      width: collapsed ? 64 : 220, flexShrink: 0, background: SIDEBAR_BG, color: '#cbd5e1',
      display: 'flex', flexDirection: 'column', height: '100vh', transition: 'width .15s',
    }}>
      {/* Logo → the app's main entry page ("Select your business to continue"). That screen is the
          pre-login landing, so reaching it ends the current session (same as Sign out): in standalone
          dev it lands on the business-selection screen; in production it returns to the Jioautify
          portal. Works for every role and both business units. */}
      <button
        type="button"
        onClick={logout}
        onMouseEnter={() => setLogoHover(true)}
        onMouseLeave={() => setLogoHover(false)}
        title="Back to main page (business selection)"
        style={{
          height: 56, padding: '0 16px', boxSizing: 'border-box', borderBottom: '1px solid rgba(255,255,255,0.08)', borderTop: 'none', borderLeft: 'none', borderRight: 'none',
          display: 'flex', alignItems: 'center', gap: 10, width: '100%', cursor: 'pointer', textAlign: 'left',
          background: logoHover ? 'rgba(255,255,255,0.06)' : 'transparent', transition: 'background .12s',
        }}>
        <div style={{
          width: 34, height: 34, borderRadius: 8, flexShrink: 0, overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {/* Jio logo from public/pipelines-logo.png. Falls back to the BU colour tile if the asset is missing. */}
          <img
            src={`${process.env.PUBLIC_URL}/pipelines-logo.png`}
            alt="Pipelines"
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.parentNode.style.background = bu.color; }}
          />
        </div>
        {!collapsed && <div style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>Pipelines</div>}
      </button>

      <nav style={{ flex: 1, padding: '12px 8px', overflowY: 'auto' }}>
        {navItems.map(item => {
          const active = location.pathname === item.path;
          // A greyed (No Access) module is muted and shows a lock, but stays clickable — clicking it
          // lands on the module's access message (rendered by ModuleRoute), which is the required
          // feedback rather than a dead, unclickable item.
          const disabled = !!item.disabled;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              title={collapsed ? item.label : (disabled ? `${item.label} — no access` : undefined)}
              style={{
                width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 10px', marginBottom: 4, borderRadius: 8, border: 'none', cursor: 'pointer',
                background: active ? (disabled ? 'rgba(255,255,255,0.08)' : '#0a84ff') : 'transparent',
                color: disabled ? 'rgba(255,255,255,0.35)' : (active ? '#fff' : '#cbd5e1'),
                fontSize: 13, fontWeight: 600, opacity: disabled ? 0.7 : 1,
              }}>
              <span>{NAV_ICONS[item.path.slice(1)] || '•'}</span>
              {!collapsed && <span style={{ flex: 1 }}>{item.label}</span>}
              {!collapsed && disabled && <span style={{ fontSize: 11 }}>🔒</span>}
            </button>
          );
        })}
      </nav>

      <div style={{ padding: 12, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        {/* Platform switcher: ONLY for Global Admins (isCrossPlatform). Business Admin, Manager,
            and Team Member see only their own business — no switcher, even if their email happens
            to exist on another platform under a different role. */}
        {!collapsed && !isConsoleOnly && isCrossPlatform && Array.isArray(user.platforms) && user.platforms.length > 1 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: 'rgba(255,255,255,0.55)', marginBottom: 4 }}>PLATFORM</div>
            <select
              value={user.business_unit}
              disabled={switching}
              onChange={(e) => onSwitchPlatform(e.target.value)}
              style={{
                width: '100%', padding: '7px 8px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                background: 'rgba(255,255,255,0.08)', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.16)', cursor: 'pointer',
              }}>
              {user.platforms.map(bu => (
                <option key={bu} value={bu}>{(BU_CONFIG[bu] || {}).label || bu}</option>
              ))}
            </select>
          </div>
        )}
        {!collapsed && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{user.name}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>{isSuperAdmin ? 'Global Admin' : (ROLE_LABEL[user.role] || user.role)}{(isSuperAdmin || isConsoleOnly) ? ' · All businesses' : ` · ${bu.label}`}</div>
          </div>
        )}
        {/* Returns to the main page (business selection). Reaching the pre-login landing ends the
            session, so this uses the same action as sign-out — just labelled "Back". */}
        <button onClick={logout} className="btn btn-sm" style={{ width: '100%', justifyContent: 'center', background: 'rgba(255,255,255,0.1)', borderColor: 'rgba(255,255,255,0.18)', color: '#fff' }}>
          {collapsed ? '←' : '← Back'}
        </button>
        <button onClick={toggle} className="btn btn-sm" style={{ width: '100%', justifyContent: 'center', marginTop: 6, background: 'transparent', borderColor: 'rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.6)' }}>
          {collapsed ? '»' : '« Collapse'}
        </button>
      </div>
    </aside>
  );
}
