import axios from 'axios';
import { BASE_PATH } from '../env';

// One axios instance for the whole app. In dev, the CRA `proxy` in
// package.json forwards /api → the Express server. In prod, set
// REACT_APP_API_BASE if the API sits on a different origin.
//
// === JIOAUTIFY INTEGRATION: in production the app is served same-origin under /sales_crm by the
// STB backend, so its API lives at /sales_crm/api/... — .env.production sets REACT_APP_API_BASE to a
// relative /sales_crm base. In standalone dev REACT_APP_API_BASE is empty, so /api is used and the
// CRA proxy forwards it to the local Express server on :4000. ===
const api = axios.create({
  baseURL: (process.env.REACT_APP_API_BASE || '') + '/api',
});

// Request interceptor: attach Bearer token from localStorage.
// === JIOAUTIFY INTEGRATION: use a namespaced key (salescrm_token). The STB portal runs on the SAME
// origin, and its own JioTCM session lives under localStorage 'Token' — reusing that key here would
// clobber the portal's session. Mirrors Jio Inventory's jiovit_token / Release Planner's rp_token. ===
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('salescrm_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Response interceptor: bounce to /login on 401 (let 403 through so
// the UI can render a "not allowed" state). BASE_PATH keeps the redirect inside /sales_crm in prod.
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response && err.response.status === 401) {
      localStorage.removeItem('salescrm_token');
      if (!window.location.pathname.startsWith(BASE_PATH + '/login')) {
        window.location.href = BASE_PATH + '/login';
      }
    }
    return Promise.reject(err);
  }
);

// --------------------------------------------------------------------------
// Endpoints — named arrow functions grouped by resource. Pages import
// these; pages never call axios directly.
// --------------------------------------------------------------------------

// Auth — N1 unified login: { identifier, password, business_unit?, role? }
export const login          = (identifier, password, businessUnit, role) => api.post('/auth/login', { identifier, password, business_unit: businessUnit, role }).then(r => r.data);
// Legacy BD login (kept for backward compat; new LoginPage uses unified login)
export const bdLogin        = (userId, password)              => api.post('/auth/bd-login', { userId, password }).then(r => r.data);
export const getMe          = ()                              => api.get('/auth/me').then(r => r.data);
// N1: switch the signed-in Global Admin to their account on another platform, no re-login.
export const switchPlatform = (businessUnit)                  => api.post('/auth/switch-platform', { business_unit: businessUnit }).then(r => r.data);
export const changePassword = (currentPassword, newPassword)  => api.post('/auth/change-password', { currentPassword, newPassword }).then(r => r.data);
export const setupStatus    = ()                              => api.get('/auth/setup-status').then(r => r.data);
export const runSetup       = (name, email, password)         => api.post('/auth/setup', { name, email, password }).then(r => r.data);
export const factoryReset   = (confirmation)                 => api.post('/auth/factory-reset', { confirmation }).then(r => r.data);
// === JIOAUTIFY INTEGRATION: redeem an SSO chooser ticket. Called with just the ticket to list the
// email's accounts, then with a chosen business_unit to get a token. See routes/auth.js /sso/select. ===
export const ssoSelect      = (ticket, businessUnit)          => api.post('/auth/sso/select', { ticket, business_unit: businessUnit }).then(r => r.data);

// Business Units — the list powering the login and SSO account-chooser screens (and in-app BU
// config). Public (no auth): the login screen needs it before anyone is signed in. Pass a status
// (e.g. 'active') to filter; omit for all.
export const getBusinessUnits = (status)                     => api.get('/business-units', { params: status ? { status } : undefined }).then(r => r.data);
// Management (Global Admin only). getBusinessUnitsManage returns full rows + a usage summary.
export const getBusinessUnitsManage = ()                     => api.get('/business-units/manage').then(r => r.data);
export const getBusinessUnitUsage   = (slug)                 => api.get(`/business-units/${slug}/usage`).then(r => r.data);
export const createBusinessUnit     = (data)                 => api.post('/business-units', data).then(r => r.data);
export const updateBusinessUnit     = (slug, data)           => api.put(`/business-units/${slug}`, data).then(r => r.data);
// deleteBusinessUnit: pass confirm=<slug> to proceed once the safe-deletion check has passed.
export const deleteBusinessUnit     = (slug, confirm)        => api.delete(`/business-units/${slug}`, confirm ? { params: { confirm } } : undefined).then(r => r.data);
export const cloneBusinessUnit      = (slug, data)           => api.post(`/business-units/${slug}/clone`, data).then(r => r.data);
// Wizard catalog — the union of fields/services/modules (+ dashboard/report options) derived from
// the existing business units, used to seed the guided creation wizard.
export const getBuCatalog           = ()                     => api.get('/business-units/catalog').then(r => r.data);
// A single business unit's resolved config (form schema + services + modules). Any authenticated user
// may read their own business's config — the lead form renders from it.
export const getBusinessUnitConfig  = (slug)                 => api.get(`/business-units/${slug}/config`).then(r => r.data);

// Customer -> Location roll-up for the Customers tab inside Leads. Scoped by the backend to the
// caller's BU (and to their own leads for a BD), so no client-side scoping is needed.
export const getLeadCustomers       = ()                     => api.get('/leads/customers').then(r => r.data);

// Users / BDs
export const getBds         = (businessUnit)                  => api.get('/users', { params: { role: 'bd', business_unit: businessUnit } }).then(r => r.data);
// All active members of a business (any role) — used by the Task Board owner picker.
export const getBusinessMembers = (businessUnit)              => api.get('/users', { params: { business_unit: businessUnit } }).then(r => r.data);
export const resetBdPassword= (id, newPassword)               => api.put(`/users/${id}/reset-password`, { newPassword }).then(r => r.data);
// Full user management (admin only). getManagedUsers lists BD + PMO (including disabled) with
// email/mobile for the Settings page; addUser/updateUser take { name, email, mobile, role }
// (role: 'bd' | 'pmo'). setUserActive enable/disables (soft); deleteUser permanently removes.
export const getManagedUsers= (businessUnit)                  => api.get('/users/manage', { params: { business_unit: businessUnit } }).then(r => r.data);
export const addUser        = (businessUnit, data)            => api.post('/users', { ...data, business_unit: businessUnit }).then(r => r.data);
export const updateUser     = (id, data)                      => api.put(`/users/${id}`, data).then(r => r.data);
export const setUserActive  = (id, active)                    => api.put(`/users/${id}/active`, { active }).then(r => r.data);
export const setForecastAccess = (id, forecastAccess)         => api.put(`/users/${id}/forecast-access`, { forecast_access: forecastAccess }).then(r => r.data);
// J1: grant/revoke a Manager's platform-wide Activity feed (Global Admin / Business Admin only).
export const setActivityFeedAccess = (id, on)                 => api.put(`/users/${id}/activity-feed-access`, { activity_feed_access: on }).then(r => r.data);
// reassignTo: undefined (fails with 409 if the user owns leads), 'unassigned', or a target user id.
export const deleteUser     = (id, reassignTo)                => api.delete(`/users/${id}`, reassignTo ? { data: { reassign_to: reassignTo } } : undefined).then(r => r.data);

// Leads
export const getLeads       = (params)                        => api.get('/leads', { params }).then(r => r.data);
export const getLead        = (id)                            => api.get(`/leads/${id}`).then(r => r.data);
export const createLead     = (data)                          => api.post('/leads', data).then(r => r.data);
export const updateLead     = (id, data)                      => api.put(`/leads/${id}`, data).then(r => r.data);
export const deleteLead     = (id)                            => api.delete(`/leads/${id}`).then(r => r.data);
export const bulkUpdateLeads= (ids, patch)                    => api.put('/leads/bulk/update', { ids, ...patch }).then(r => r.data);
export const bulkImportLeads= (rows, businessUnit, dryRun=true)=> api.post('/leads/bulk', { rows, business_unit: businessUnit, dryRun }).then(r => r.data);

// Global POs (chains) — reference-only chain records with derived device-pool status. getGlobalPos
// lists chains (each with { status: {consumed, remaining, exceeded} }); getGlobalPo adds contributors.
export const getGlobalPos   = ()                              => api.get('/global-pos').then(r => r.data);
export const getGlobalPo    = (id)                            => api.get(`/global-pos/${id}`).then(r => r.data);
export const createGlobalPo = (data)                          => api.post('/global-pos', data).then(r => r.data);
export const updateGlobalPo = (id, data)                      => api.put(`/global-pos/${id}`, data).then(r => r.data);
export const deleteGlobalPo = (id)                            => api.delete(`/global-pos/${id}`).then(r => r.data);

// Activities — multi-tab kanban board (opt-in per BU via config.modules.activities). Access limited
// to Manager / Business Admin / Global Admin via server-side role guard + default permissions.
export const getActivityTabs   = ()                            => api.get('/activities/tabs').then(r => r.data);
export const createActivityTab = (label)                       => api.post('/activities/tabs', { label }).then(r => r.data);
export const renameActivityTab = (id, label)                   => api.patch(`/activities/tabs/${id}`, { label }).then(r => r.data);
export const deleteActivityTab = (id)                          => api.delete(`/activities/tabs/${id}`).then(r => r.data);

export const getActivities   = ()                              => api.get('/activities').then(r => r.data);
export const createActivity  = (data)                          => api.post('/activities', data).then(r => r.data);
export const updateActivity  = (id, data)                      => api.patch(`/activities/${id}`, data).then(r => r.data);
export const deleteActivity  = (id)                            => api.delete(`/activities/${id}`).then(r => r.data);

// VOC (Voice of Customer) — Surveillance business only.
export const getVocs        = (params)                        => api.get('/voc', { params }).then(r => r.data);
export const getVocStats    = ()                              => api.get('/voc/stats').then(r => r.data);
export const getVoc         = (id)                            => api.get(`/voc/${id}`).then(r => r.data);
export const createVoc      = (data)                          => api.post('/voc', data).then(r => r.data);
export const updateVoc      = (id, data)                      => api.put(`/voc/${id}`, data).then(r => r.data);
export const addVocComment  = (id, note)                      => api.post(`/voc/${id}/comment`, { note }).then(r => r.data);
export const deleteVoc      = (id)                            => api.delete(`/voc/${id}`).then(r => r.data);

// Activity log / stage history
export const getActivityLog = (leadId)                        => api.get('/activity-log', { params: { lead_id: leadId } }).then(r => r.data);
// Global cross-user feed — params: { limit, before, user, platform, type, from, to }
export const getActivityFeed = (params)                       => api.get('/activity-log/feed', { params }).then(r => r.data);
export const getActivityFilters = ()                          => api.get('/activity-log/feed/filters').then(r => r.data);
export const getStageHistory= ()                              => api.get('/stage-history').then(r => r.data);

// Cross-platform Super Admin grant. Super Admins only — managed in its own Settings section.
export const getSuperAdmins = ()                             => api.get('/users/super-admins').then(r => r.data);
export const setSuperAdmin  = (id, scope)                    => api.put(`/users/${id}/super-admin`, { scope }).then(r => r.data);
// Super Admin grant history now comes from the unified activity feed rather than a separate store,
// so it is the same record the global Activity pane shows.
export const getSuperAdminAudit = ()                         => api.get('/activity-log/feed', { params: { type: 'permissions', limit: 50 } })
  .then(r => (r.data.entries || []).filter(e => e.action === 'super_admin_change'));

// Per-module access levels (RBAC). Admin tier only — see backend/services/permissions.js.
export const getUserPermissions = (id)                       => api.get(`/users/${id}/permissions`).then(r => r.data);
export const updateUserPermissions = (id, permissions)       => api.put(`/users/${id}/permissions`, { permissions }).then(r => r.data);

// Forecast (login-gated: admin tier, 'forecast' accounts, or a granted user)
export const getForecastDevices = ()                          => api.get('/forecast/devices').then(r => r.data);
// Manual 'Sent to SCM' handoff marker. Writable by anyone who can see the dashboard row.
export const setSentToScm = (id, sent, lineSlug)              => api.patch(`/forecast/devices/${id}/sent-to-scm`, { sent_to_scm: sent, line_slug: lineSlug }).then(r => r.data);

// Settings
export const getSettings    = ()                              => api.get('/settings').then(r => r.data);
export const setSetting     = (key, value)                    => api.put(`/settings/${key}`, { value }).then(r => r.data);

// Stage TAT config (PMO / Business Admin) — per-platform TAT days-per-stage for the confidence engine.
// getTat returns { business_unit, stages: [{ stage, tat_days, weight }] }; updateTat takes { stage: days }.
export const getTat         = (businessUnit)                  => api.get('/sla', { params: { business_unit: businessUnit } }).then(r => r.data);
export const updateTat      = (businessUnit, tats)            => api.put('/sla', { business_unit: businessUnit, tats }).then(r => r.data);

// Dropdowns (per-business). getDropdowns returns { field_name: [values] } for the caller's business.
export const getDropdowns          = ()                       => api.get('/dropdowns').then(r => r.data);
// Management (Super/Business Admin): full option rows (id + value) for one field, add, and remove.
export const getDropdownsManage    = (fieldName)              => api.get('/dropdowns/manage', { params: { field_name: fieldName } }).then(r => r.data);
export const addDropdownOption     = (fieldName, value)       => api.post('/dropdowns', { field_name: fieldName, value }).then(r => r.data);
export const removeDropdownOption  = (id)                     => api.delete(`/dropdowns/${id}`).then(r => r.data);

// Uploads
export const uploadPoDocument = (leadId, file) => {
  const form = new FormData();
  form.append('file', file);
  return api.post(`/uploads/po/${leadId}`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
};

export const fileUrl = (path) => {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return (process.env.REACT_APP_API_BASE || '') + path;
};

// Notifications
export const getNotifications       = (params)     => api.get('/notifications', { params }).then(r => r.data);
export const getUnreadCount         = ()           => api.get('/notifications/unread-count').then(r => r.data);
export const markRead               = (id)         => api.patch(`/notifications/${id}/read`).then(r => r.data);
export const markAllRead            = ()           => api.post('/notifications/read-all').then(r => r.data);
export const getNotifPreferences    = ()           => api.get('/notifications/preferences').then(r => r.data);
export const updateNotifPreferences = (prefs)      => api.put('/notifications/preferences', prefs).then(r => r.data);

// Global Search
export const globalSearch = (q) => api.get('/search', { params: { q } }).then(r => r.data);

// Contacts
export const getContacts       = (customerName) => api.get('/contacts', { params: customerName ? { customer_name: customerName } : {} }).then(r => r.data);
export const createContact     = (data)         => api.post('/contacts', data).then(r => r.data);
export const updateContact     = (id, data)     => api.put(`/contacts/${id}`, data).then(r => r.data);
export const deleteContact     = (id)           => api.delete(`/contacts/${id}`).then(r => r.data);

// Campaigns
export const getCampaigns      = ()             => api.get('/campaigns').then(r => r.data);
export const createCampaign    = (data)         => api.post('/campaigns', data).then(r => r.data);
export const updateCampaign    = (id, data)     => api.put(`/campaigns/${id}`, data).then(r => r.data);
export const deleteCampaign    = (id)           => api.delete(`/campaigns/${id}`).then(r => r.data);

// Change Log (Audit Trail)
export const getChangeLog      = (entityType, entityId) => api.get('/change-log', { params: { entity_type: entityType, entity_id: entityId } }).then(r => r.data);

// Reports
export const getReportBdPerformance = (params) => api.get('/reports/bd-performance', { params }).then(r => r.data);
export const getReportSourceAnalysis = (params) => api.get('/reports/source-analysis', { params }).then(r => r.data);
export const getReportMonthlyTrend  = (params) => api.get('/reports/monthly-trend', { params }).then(r => r.data);
export const getReportCampaignRoi   = (params) => api.get('/reports/campaign-roi', { params }).then(r => r.data);

export default api;
