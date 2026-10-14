import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { PrivateRoute, AdminRoute, ModuleRoute, BusinessUnitRoute } from './components/PrivateRoute';
import LoginPage from './pages/LoginPage';
import BusinessUnitsPage from './pages/BusinessUnitsPage';
import LeadsPage from './pages/LeadsPage';
import CustomersPage from './pages/CustomersPage';
import DashboardPage from './pages/DashboardPage';
import ForecastPage from './pages/ForecastPage';
import ActivityPage from './pages/ActivityPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import VocPage from './pages/VocPage';
import ActivitiesPage from './pages/ActivitiesPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import CampaignsPage from './pages/CampaignsPage';
import SsoSelectPage from './pages/SsoSelectPage';
import { GLOBAL_CSS } from './globalStyles';
import { BASE_PATH } from './env';

// === JIOAUTIFY INTEGRATION: capture the SSO hand-off SYNCHRONOUSLY at module load, BEFORE React
// Router renders. The STB ("Jioautify") portal opens Pipelines in one of two ways:
//   • /sales_crm?token=<jwt>&data=<user>  — single account: seed the token and land on /leads.
//   • /sales_crm?ssoTicket=<jwt>          — the email has two accounts (signage + jhes): stash the
//                                           chooser ticket and land on /sso-select, which renders
//                                           the account picker and redeems a token for the chosen BU.
// Doing this synchronously (not in a useEffect) means AuthProvider initialises already-logged-in on
// the first render, so the guard never bounces to /login and strips the query. Tokens/tickets are
// namespaced (salescrm_*) to avoid clobbering the portal's own 'Token'. Mirrors Jio Inventory. ===
(function captureSsoFromUrl() {
  if (!BASE_PATH || typeof window === 'undefined') return;
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const rawData = params.get('data'); // URLSearchParams already URI-decodes -> raw JSON string
    const ssoTicket = params.get('ssoTicket');
    if (token && rawData) {
      JSON.parse(rawData); // validate it is well-formed before storing
      localStorage.setItem('salescrm_token', token);
      window.history.replaceState({}, document.title, BASE_PATH + '/leads');
    } else if (ssoTicket) {
      sessionStorage.setItem('salescrm_sso_ticket', ssoTicket);
      window.history.replaceState({}, document.title, BASE_PATH + '/sso-select');
    }
  } catch (e) {
    console.error('[SSO] failed to capture token/data from URL:', e);
  }
})();

export default function App() {
  useEffect(() => {
    const handler = (e) => { if (e.target.type === 'number') e.target.blur(); };
    document.addEventListener('wheel', handler, { passive: true });
    return () => document.removeEventListener('wheel', handler);
  }, []);

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <AuthProvider>
        {/* === JIOAUTIFY INTEGRATION: served under /sales_crm by the STB backend in production; root
            in standalone dev. basename derives from NODE_ENV via env.js (build-time constant). === */}
        <BrowserRouter basename={BASE_PATH || '/'}>
          <Routes>
            {/* Public */}
            <Route path="/" element={<LoginPage />} />
            <Route path="/login" element={<LoginPage />} />
            {/* N3: Forecast is a regular in-platform module — no standalone login. */}
            <Route path="/forecast" element={<PrivateRoute><ModuleRoute module="forecast"><ForecastPage /></ModuleRoute></PrivateRoute>} />
            {/* === JIOAUTIFY INTEGRATION: SSO account chooser (prod handoff for emails with two BU
                accounts). Redeems the ticket stashed by captureSsoFromUrl, then bypasses login. === */}
            <Route path="/sso-select" element={<SsoSelectPage />} />

            {/* Authenticated — any role */}
            <Route path="/leads"            element={<PrivateRoute><ModuleRoute module="leads"><LeadsPage /></ModuleRoute></PrivateRoute>} />
            {/* Customers hierarchy — its own module gate. */}
            <Route path="/customers"                 element={<PrivateRoute><ModuleRoute module="customers"><CustomersPage /></ModuleRoute></PrivateRoute>} />
            <Route path="/customers/:code"           element={<PrivateRoute><ModuleRoute module="customers"><CustomersPage /></ModuleRoute></PrivateRoute>} />
            <Route path="/customers/:code/:loc"      element={<PrivateRoute><ModuleRoute module="customers"><CustomersPage /></ModuleRoute></PrivateRoute>} />
            <Route path="/dashboard"        element={<PrivateRoute><ModuleRoute module="dashboard"><DashboardPage /></ModuleRoute></PrivateRoute>} />
            {/* Global activity feed (J1). Not a per-module page — its own grant governs it
                (Business Admin / Global Admin by role, Manager if granted, Team Member never), so the
                page itself enforces that rather than the module guard. */}
            <Route path="/activity"         element={<PrivateRoute><ActivityPage /></PrivateRoute>} />
            {/* VOC (Voice of Customer) — module-gated per user and per BU. */}
            <Route path="/voc"              element={<PrivateRoute><ModuleRoute module="voc"><VocPage /></ModuleRoute></PrivateRoute>} />
            {/* Activities kanban — opt-in per business (config.modules.activities). ModuleRoute
                covers both the per-user permission and, via canView, the per-BU enablement. */}
            <Route path="/activities"       element={<PrivateRoute><ModuleRoute module="activities"><ActivitiesPage /></ModuleRoute></PrivateRoute>} />
            {/* Self-service password change is DEV-ONLY; production is SSO-only. */}
            <Route path="/change-password"  element={<PrivateRoute><ChangePasswordPage /></PrivateRoute>} />

            {/* Campaigns — module-gated per user and per BU. */}
            <Route path="/campaigns"        element={<PrivateRoute><ModuleRoute module="campaigns"><CampaignsPage /></ModuleRoute></PrivateRoute>} />
            {/* Reports — gated purely by the per-user module permission (like Leads/Dashboard), so a
                BD granted Reports access can open it, for every business (current and future). */}
            <Route path="/reports"          element={<PrivateRoute><ModuleRoute module="reports"><ReportsPage /></ModuleRoute></PrivateRoute>} />
            {/* Admin/PMO only */}
            <Route path="/settings"         element={<AdminRoute><SettingsPage /></AdminRoute>} />
            {/* Global Admin manages all business units; a Business Admin can reach the same page but
                sees only their own BU (scoped server-side) and can only Edit / Edit template. */}
            <Route path="/business-units"   element={<BusinessUnitRoute><BusinessUnitsPage /></BusinessUnitRoute>} />

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/leads" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </>
  );
}
