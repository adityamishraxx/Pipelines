# Sales CRM — Jioautify (STB Portal) Integration

**Branch:** `jioautify`
**Date:** 2026-07-10
**Scope:** Mount Sales CRM inside the Jio STB ("Jioautify") backend as a sub-app, replace password login with portal SSO in production, add full user (BD + PMO) management, and mirror user access to the central STB store (Sales CRM = module 22).

---

## 1. Summary

Sales CRM previously ran as a standalone app with email/password (admin/PMO) and BD-card logins. This branch makes it a **module of the Jio STB portal** while preserving standalone behaviour for local development. The runtime mode is decided entirely by `NODE_ENV`:

| Mode | `NODE_ENV` | How it runs | Auth |
|------|-----------|-------------|------|
| **Development** (standalone) | `development` | Own Express server on `:4000`, React at root `/` | Email/password + BD login |
| **Production** (mounted) | `production` | `require`d into the STB backend, mounted at `/sales_crm` | SSO from the portal only |

The guiding principle throughout: **nothing STB-specific runs in dev**, so the app still boots and works locally without the STB tree present.

---

## 2. Backend changes

### 2.1 App can be mounted as a sub-app — [backend/server.js](../backend/server.js)
- `.env` is now loaded by **absolute path** (`__dirname`) instead of a bare `dotenv.config()`. When mounted, `process.cwd()` is the STB root, so a bare call would miss Sales CRM's own DB creds / `JWT_SECRET`.
- The boot block (migrations + `app.listen`) now runs **only when the file is executed directly** (`require.main === module`). When `require`d by the STB backend it does not bind a port or block STB boot on a migration.
- `module.exports = app` exposes the Express app for mounting.
- In production, run migrations once during deploy with `npm run migrate` (no longer automatic).

### 2.2 Isolated DB config — [backend/config/database.js](../backend/config/database.js)
- Reads DB credentials from **this app's own parsed `.env`** (`dotenv…parsed`) by absolute path, **not** `process.env`. The STB has already populated `process.env` with its own `DB_*` vars, and dotenv does not override existing values — so reading `process.env.DB_NAME` would connect to the STB database instead of `sales_crm`.

### 2.3 User model — [backend/models/index.js](../backend/models/index.js)
- `email` uniqueness changed from **global** to **per business unit** (composite key `email_business_unit`). One corporate email may hold both a `signage` and a `jhes` account. NULL emails (BDs) are exempt.
- New nullable `mobile` column (`STRING(32)`). Nullable in DB so existing rows are valid; the app makes it mandatory in the add/edit modal.

### 2.4 Migrations (new)
- [002_email_unique_per_bu.sql](../backend/migrations/002_email_unique_per_bu.sql) — drops the global `email` unique index, adds composite `email_business_unit`.
- [003_add_user_mobile.sql](../backend/migrations/003_add_user_mobile.sql) — adds the `mobile` column.

### 2.5 Authentication — [backend/routes/auth.js](../backend/routes/auth.js)
- **Password auth is dev-only.** `/login`, `/bd-login`, and `/change-password` are now guarded by `passwordAuthDevOnly`, which returns **403** in production.
- **`POST /api/auth/sso`** (production-only) — the SSO bridge, mirroring JioTCM / Jio Inventory / Release Planner. The portal calls it with the logged-in user's email. The user must already exist as an **active, email-bearing** account (no auto-provisioning). Returns:
  - one account → `{ token, user }`
  - two accounts (signage + jhes) → `{ multiple: true, accounts: [...], ticket }`, where `ticket` is a short-lived (5 min) JWT naming only the email.
- **`POST /api/auth/sso/select`** (production-only) — redeems the chooser ticket:
  - `{ ticket }` → `{ accounts: [...] }` (to render the picker)
  - `{ ticket, business_unit }` → `{ token, user }` (after the user picks)
- **`POST /api/auth/logout`** — acknowledges the portal's best-effort logout call (auth is stateless JWT, so there is no server session to destroy).

### 2.6 User management + central sync — [backend/routes/users.js](../backend/routes/users.js)

**New / changed endpoints (all admin/PMO only):**
- `GET /api/users/manage` — full records (BD + PMO, including **disabled**) for a BU, with email/mobile, for the Settings page.
- `POST /api/users` — now creates **BD or PMO** with mandatory `{ name, email, mobile, role, business_unit }` (validated: valid email, exactly 10-digit mobile). Email unique per BU.
- `PUT /api/users/:id` — edit name/email/mobile/role. Cannot change **your own** role.
- `PUT /api/users/:id/active` — soft enable/disable. Cannot disable **your own** account.
- `DELETE /api/users/:id` — **permanent** delete (replaces the old soft-delete). Blocked for your own account and blocked when the user still owns leads (RESTRICT FK) — disable instead.

**Central STB store sync (`module_code` 22) — production only:**
- On create/edit/disable/delete, the change is mirrored to the central Jio STB store (`userlogin` + `AccessControl`) **before** the local write; the local write is skipped if the central update fails. Mirrors Jio Inventory (20) and Release Planner (21).
- **Cross-BU aggregation:** because the central store tracks access by **email only**, but Sales CRM may have two rows per email (one per BU), the central state is computed as the **union** across all rows sharing the email:
  - `module_access = 'true'` if active in **any** BU;
  - `module_admin = 'true'` if a PMO in **any** BU where still active.
  - This prevents an operation in one BU from wrongly revoking access the user still holds via the other BU.
- The STB registration router is `require`d in-process only in production; skipped in dev.

### 2.7 Env example — [backend/.env.example](../backend/.env.example)
- Documents `NODE_ENV`: `production` enables mounting + jioautify sync; `development` for standalone runs.

---

## 3. Frontend changes

### 3.1 Build-time mode flag (new) — [frontend/src/env.js](../frontend/src/env.js)
- `IS_PROD = process.env.NODE_ENV === 'production'` and `BASE_PATH = IS_PROD ? '/sales_crm' : ''`.
- **Build-time constant** — only `npm run build` produces a production bundle. A dev bundle must never be served under `/sales_crm`.

### 3.2 Base path + SSO capture — [frontend/src/App.jsx](../frontend/src/App.jsx)
- `BrowserRouter` uses `basename={BASE_PATH || '/'}`.
- `captureSsoFromUrl()` runs **synchronously at module load** (before Router renders) to handle the portal hand-off:
  - `?token=<jwt>&data=<user>` → store token, go to `/leads`.
  - `?ssoTicket=<jwt>` → stash ticket in sessionStorage, go to `/sso-select`.
  - Doing this synchronously means `AuthProvider` initialises already-logged-in, so the route guard never bounces to `/login` and strips the query.
- New `/sso-select` route. `/change-password` route is **dev-only**.

### 3.3 SSO account chooser (new) — [frontend/src/pages/SsoSelectPage.jsx](../frontend/src/pages/SsoSelectPage.jsx)
- Redeems the stashed ticket, lists the email's accounts, lets the user pick a business unit, exchanges the ticket for a token, and lands on `/leads` — bypassing the login page.

### 3.4 Namespaced token + logout — [frontend/src/context/AuthContext.jsx](../frontend/src/context/AuthContext.jsx)
- localStorage key changed from `Token` to **`salescrm_token`** to avoid clobbering the portal's own `Token` (JioTCM) on the shared origin.
- On logout in production: alerts the user and `window.close()` (returns control to the portal); in dev, falls back to the login route.

### 3.5 API client — [frontend/src/services/api.js](../frontend/src/services/api.js)
- Reads `salescrm_token`; 401 redirect respects `BASE_PATH` (stays inside `/sales_crm`).
- New API helpers: `ssoSelect`, `getManagedUsers`, `addUser`, `updateUser`, `setUserActive`, `deleteUser` (replacing `addBd` / `removeBd`).

### 3.6 Login page — [frontend/src/pages/LoginPage.jsx](../frontend/src/pages/LoginPage.jsx)
- In production, hides the password/BD login flow and shows a "open from the portal" notice, while keeping the public **Forecast Dashboard** reachable.

### 3.7 Settings page — [frontend/src/pages/SettingsPage.jsx](../frontend/src/pages/SettingsPage.jsx)
- Rebuilt "Manage BDs" into **Manage Users** (BD + PMO): a new Add/Edit modal (name, email, mobile, role), Enable/Disable, and permanent Delete. Disabled users are shown greyed with a badge.
- Password reset UI is **dev-only** and only for active BDs. Self-service "Change Password" hidden in production.

### 3.8 Sidebar — [frontend/src/components/Sidebar.jsx](../frontend/src/components/Sidebar.jsx)
- "Password" nav item hidden in production (SSO-only).

### 3.9 Build config
- [frontend/package.json](../frontend/package.json) — `homepage: "/sales_crm"` so built assets resolve to `/sales_crm/static/...`.
- [frontend/.env.production](../frontend/.env.production) (new) — `REACT_APP_API_BASE=/sales_crm` (relative, same-origin) so the API resolves to `/sales_crm/api/...` on any host.

---

## 4. Deployment notes

1. **Migrations:** run `npm run migrate` in the backend once per deploy (migrations 002 and 003 are required).
2. **Backend:** `require` `backend/server.js` from the STB backend and mount its exported app at `/sales_crm`. Ensure Sales CRM's own `.env` sits next to `server.js` with `NODE_ENV=production`, its DB creds, and `JWT_SECRET`.
3. **Frontend:** always deploy a `npm run build` output (never a dev bundle) so `BASE_PATH` / `IS_PROD` resolve correctly.
4. **Module code:** Sales CRM is STB `module_code` 22; the `AccessControl.Sales_CRM` column must exist. Override with `STB_MODULE_CODE` if the allocated id differs.
5. **Users:** no auto-provisioning — admins must create accounts (with email) in Settings before those users can SSO in. BD accounts (no email) use BD login and are not portal SSO users.
