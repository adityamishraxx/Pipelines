import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getMe } from '../services/api';
import { meets } from '../utils/permissions';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Global Admin console-only session: logged in via the "Global Admin" button → goes straight to
  // Admin Console (Settings) to manage users, roles, and access across all businesses.
  const [consoleMode, setConsoleMode] = useState(() => localStorage.getItem('salescrm_console') === '1');

  // On mount, if a token exists, hydrate the user via /api/auth/me.
  // === JIOAUTIFY INTEGRATION: token is namespaced as salescrm_token to avoid clobbering the STB
  // portal's own 'Token' (JioTCM) on the shared origin. Mirrors Jio Inventory / Release Planner. ===
  useEffect(() => {
    const token = localStorage.getItem('salescrm_token');
    if (!token) { setLoading(false); return; }
    getMe()
      .then(setUser)
      .catch(() => { localStorage.removeItem('salescrm_token'); setUser(null); })
      .finally(() => setLoading(false));
  }, []);

  // Per-module permissions must take effect WITHOUT the user re-logging in. They live on the user
  // row (never in the JWT), so the server already honours a change on the very next request; this
  // re-poll is what makes the UI follow. Refreshing on window focus covers the realistic case —
  // an admin changes access and tells the person — and the interval catches an idle open tab.
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    const refresh = () => {
      if (!localStorage.getItem('salescrm_token')) return;
      getMe()
        .then(fresh => { if (!cancelled) setUser(fresh); })
        .catch(() => { /* transient failure — keep the current view, next poll retries */ });
    };
    // Safety net: if whatever set this user didn't carry a permission map, fetch one straight away
    // rather than leaving the app to believe they have no modules until the next poll.
    if (!user.permissions) refresh();
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    const timer = setInterval(refresh, 60000);
    return () => { cancelled = true; window.removeEventListener('focus', onFocus); clearInterval(timer); };
    // Re-arm only when the identity changes, not on every permission refresh.
  }, [user?.id]);

  const login = useCallback((token, u) => {
    localStorage.setItem('salescrm_token', token);
    setConsoleMode(localStorage.getItem('salescrm_console') === '1');
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('salescrm_token');
    localStorage.removeItem('salescrm_console');
    setConsoleMode(false);
    // Also clear the portal's own session key so a shared-origin STB portal login is signed out too.
    localStorage.removeItem('token');
    setUser(null);
  }, []);

  // Permission predicates
  const isAuthenticated = !!user;
  // Admin tier — reaches Settings, Reports, bulk actions.
  const ADMIN_TIER      = ['super_admin', 'business_admin', 'pmo'];
  const isAdmin         = user && ADMIN_TIER.includes(user.role);
  // --- Cross-platform Super Admin (migration 021) -----------------------------------------
  // A GRANT held alongside the platform role, so it is additive: a Signage PMO can also be a
  // Super Admin without losing their platform role. Spans every platform automatically.
  const superAdminScope   = user?.super_admin_scope || null;      // null | 'read' | 'write'
  const isCrossPlatform   = !!user?.is_super_admin;
  const isReadOnlyAdmin   = superAdminScope === 'read';
  // A Read-only Super Admin makes no changes anywhere — every action affordance is hidden.
  // `canAct` is the single question pages ask before rendering an edit/delete/toggle control.
  const canAct            = !isReadOnlyAdmin;
  // Legacy flag: the role value OR the new grant. Kept so existing checks keep working.
  const isSuperAdmin    = !!(user && (user.role === 'super_admin' || user.is_super_admin));
  // Console-only session: GA logged in via the Global Admin button → sees only Admin Console
  // (user management, role grants, access config). Business-scoped logins clear this flag.
  const isConsoleOnly   = !!(consoleMode && user && (user.role === 'super_admin' || user.is_super_admin));
  const isBusinessAdmin = user && user.role === 'business_admin';
  const isBD            = user && user.role === 'bd';
  // N3: forecast role removed — Forecast is a regular in-platform module now.
  const isForecastOnly  = false;
  // Full user management (assign PMO/BD/Forecast, and — for super_admin — Business Admins across
  // businesses). A PMO can still add BDs; that's handled per-action, not by this flag.
  const canManageUsers  = user && (user.role === 'super_admin' || user.role === 'business_admin');
  // Who can add/remove lead-form dropdown options (device SKUs, sources, partners, ratings, …): the
  // admin tier including PMO. Non-super roles are scoped to their own business by the API.
  const canManageDropdowns = user && (user.role === 'super_admin' || user.role === 'business_admin' || user.role === 'pmo');
  // Forecast access now comes from the per-module level (Settings -> Access), seeded from the
  // legacy forecast_access flag by migration 020. Kept as a named flag because several components
  // still read it, but it is no longer a separate switch.
  const canForecast     = meets(user?.permissions, 'forecast', 'read');

  // --- Per-module access levels (second dimension alongside role and business_unit) -------------
  // The server resolves these and returns them on /api/auth/me; role-derived defaults are filled in
  // there, so an empty map here means genuinely no access rather than "not configured".
  const permissions = user?.permissions || {};
  // Per-BU module enablement map (business_units.config.modules), resolved server-side and returned
  // on /auth/me. When the map is present it's authoritative; when it's absent (older responses) we
  // treat every module as enabled and defer to the per-user permission below.
  const buModules = user?.bu_modules || null;
  const buHasModule = useCallback((module) => (buModules ? buModules[module] !== false : true), [buModules]);
  // can('leads', 'edit') — at least that level in that module AND the module is enabled for this BU.
  const can = useCallback((module, minLevel = 'read') => buHasModule(module) && meets(user?.permissions, module, minLevel), [user, buHasModule]);
  // Convenience wrappers for the three questions pages actually ask.
  const canView = useCallback((module) => buHasModule(module) && meets(user?.permissions, module, 'read'), [user, buHasModule]);
  const canEdit = useCallback((module) => buHasModule(module) && meets(user?.permissions, module, 'edit'), [user, buHasModule]);
  const canFull = useCallback((module) => buHasModule(module) && meets(user?.permissions, module, 'full'), [user, buHasModule]);
  // Who may open the permission editor. Server-side this is the same admin tier that already
  // manages users, so it grants nothing new.
  const canManagePermissions = !!user?.can_manage_permissions;
  // Platform-wide Activity feed visibility (J1): Business Admin / Global Admin by role, a Manager
  // only if granted, a Team Member never. Resolved server-side; the client just reads the boolean.
  const canSeeActivityFeed = !!user?.can_see_activity_feed;

  const value = {
    user, loading, login, logout, isAuthenticated, isAdmin, isSuperAdmin, isConsoleOnly,
    isBusinessAdmin, isBD, isForecastOnly, canManageUsers, canManageDropdowns, canForecast,
    permissions, can, canView, canEdit, canFull, canManagePermissions,
    superAdminScope, isCrossPlatform, isReadOnlyAdmin, canAct, canSeeActivityFeed,
    buModules, buHasModule,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
