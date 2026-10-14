// ---------------------------------------------------------------------------
// Per-module access levels — client mirror of backend/services/permissions.js.
// Keep the two in sync.
//
// The backend is the enforcement point; everything here is UX. Hiding a nav item
// or disabling a button stops a user stumbling into something they can't do, but
// the server re-checks every request, so nothing security-relevant rests on this.
// ---------------------------------------------------------------------------

// Settings is deliberately NOT a module: it stays role-gated to the admin tier.
export const MODULES = ['leads', 'dashboard', 'forecast', 'reports', 'activities', 'voc', 'campaigns', 'customers'];

export const MODULE_LABELS = {
  leads: 'Leads',
  dashboard: 'Dashboard',
  forecast: 'Inventory Pipeline',
  reports: 'Reports',
  activities: 'Task Board',
  voc: 'Voice of Customer',
  campaigns: 'Campaigns',
  customers: 'Customers',
};

export const LEVELS = ['none', 'read', 'edit', 'full'];

export const LEVEL_LABELS = {
  none: 'No Access',
  read: 'Read-only',
  edit: 'Edit',
  full: 'Full Access',
};

export const LEVEL_HINTS = {
  none: 'Hidden from navigation entirely',
  read: 'Can view, cannot change anything',
  edit: 'Can view and modify existing records',
  full: 'Can view, edit, create and delete',
};

export const RANK = { none: 0, read: 1, edit: 2, full: 3 };

export const PATH_MODULE = {
  '/leads': 'leads',
  '/dashboard': 'dashboard',
  '/forecast': 'forecast',
  '/reports': 'reports',
  '/activities': 'activities',
  '/voc': 'voc',
  '/campaigns': 'campaigns',
  '/customers': 'customers',
};

// Does this permission map meet at least `minLevel` for `module`? A module missing
// from the map counts as 'none', so a newly added module is denied until granted.
export function meets(permissions, module, minLevel = 'read') {
  const have = RANK[permissions?.[module]] ?? 0;
  return have >= (RANK[minLevel] ?? 99);
}
