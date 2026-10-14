# Sales CRM — Complete Product Context Prompt

You are being given the full technical and functional context of a **Sales CRM application** so you can generate accurate, implementation-ready prompts for a coding AI (Claude Code) that will build features, fix bugs, and extend this system. Everything below describes the application as it exists today. When generating prompts, reference specific file paths, function names, component names, and architectural patterns described here so the coding AI can act precisely.

---

## 1. TECHNOLOGY STACK

| Layer | Tech | Version | Notes |
|---|---|---|---|
| Frontend | React (CRA) | 18 | Runs on port 3001 (`PORT=3001`) |
| Backend | Express + Sequelize | Express 4.19, Sequelize 6.37 | Runs on port 4000 |
| Database | MySQL | 8 | Driver: mysql2 |
| Auth | JWT (stateless) | jsonwebtoken 9.0 | 8h expiry, Bearer token |
| File Uploads | Multer | 1.4.5 | 20MB max, PDF/PNG/JPEG |
| Charts | Recharts | — | LineChart, BarChart, PieChart, etc. |
| Rich Text | ReactQuill | — | For notes fields |
| Excel | ExcelJS (template gen) + xlsx (parsing) + dynamic import | — | Bulk import/export |
| PDF | jsPDF + jspdf-autotable | — | Report export |
| Maps | @svg-maps/india | — | Geographic distribution |
| CSS | No framework — custom `GLOBAL_CSS` string injected via `<style>` tag | — | Inter font, indigo primary (#4f46e5), utility classes |
| Password Hashing | bcryptjs | — | |
| Environment | dotenv | — | `.env` file at backend root |

**Dev environment:** Windows 11, Git Bash + PowerShell. Frontend started with `$env:PORT = "3001"; npm start` (PowerShell). Backend started with `node server.js`. Code changes to backend need manual kill/restart.

**Production:** Mounted as sub-app under Jioautify STB portal at `/sales_crm`. SSO-only auth (no password login). Migrations run on boot via `backend/scripts/migrate.js`.

---

## 2. PROJECT STRUCTURE

```
Sales-CRM/
├── backend/
│   ├── server.js                    # Express app, route mounts, boot sequence
│   ├── config/database.js           # Sequelize MySQL connection
│   ├── middleware/
│   │   ├── auth.js                  # authenticate, authorize, adminOnly, requireModule, requireAnyModule
│   │   └── scope.js                 # leadScopeWhere (BU + owner filtering)
│   ├── models/index.js              # All Sequelize models + associations
│   ├── routes/
│   │   ├── auth.js                  # Login, SSO, logout, me, switch-platform, change-password
│   │   ├── users.js                 # CRUD users, permissions, super-admin grants
│   │   ├── leads.js                 # CRUD leads, bulk import, bulk update
│   │   ├── globalPos.js             # Chain (Global PO) management
│   │   ├── voc.js                   # Voice of Customer (surveillance only)
│   │   ├── activityLog.js           # Per-lead activity + global feed
│   │   ├── stageHistory.js          # Stage transitions
│   │   ├── settings.js              # Key/value settings
│   │   ├── sla.js                   # Per-stage TAT configuration
│   │   ├── dropdowns.js             # Dynamic dropdown options per BU
│   │   ├── uploads.js               # PO document file upload
│   │   ├── forecast.js              # Inventory pipeline (hardware lines)
│   │   ├── activities.js            # Task board (kanban) tabs + cards
│   │   └── businessUnits.js         # BU CRUD, wizard catalog, config, clone
│   ├── services/
│   │   ├── audit.js                 # Central audit logging to activity_log
│   │   ├── chainPool.js             # Global PO device-pool math
│   │   ├── fieldCatalog.js          # Field sections, types, modules, dashboards, reports catalogs
│   │   ├── leadCodes.js             # Customer code, location code, lead ref assignment
│   │   ├── permissions.js           # RBAC: roles, modules, levels, checks
│   │   ├── pricing.js               # TCV/ACV computation from service lines
│   │   ├── scoring.js               # Confidence score formula (pure, no DB)
│   │   └── scoringEngine.js         # DB-facing scoring: SLA maps, recompute, hold transitions
│   ├── migrations/                  # 42 SQL migration files (001–042)
│   └── scripts/
│       ├── migrate.js               # Run pending SQL migrations (tracks in schema_migrations table)
│       ├── seed.js                   # Seed initial users, settings, dropdowns
│       └── recompute.js             # One-shot confidence score recompute
├── frontend/
│   └── src/
│       ├── index.js                 # ReactDOM entry
│       ├── App.jsx                  # Routes, global CSS injection, SSO capture
│       ├── env.js                   # IS_PROD, BASE_PATH for production sub-mount
│       ├── globalStyles.js          # GLOBAL_CSS string (design tokens, utility classes)
│       ├── context/AuthContext.jsx   # Auth state, permissions, role checks
│       ├── services/api.js          # Axios instance, all API endpoint functions
│       ├── pages/                   # 13 page components
│       ├── components/              # 21 reusable components
│       └── utils/                   # 11 utility modules
```

---

## 3. DATABASE SCHEMA (Key Models)

### 3.1 Users (`users` table)
Core fields: `id`, `name`, `email`, `mobile`, `password_hash`, `role` (super_admin | business_admin | pmo | bd | forecast), `business_unit` (FK to business_units.slug), `active`, `forecast_access`, `module_permissions` (JSON), `super_admin_scope` (read | write | null), `activity_feed_access`, `sort_order`, `last_seen`.

Unique constraint: composite `(email, business_unit)` — same person can have accounts in multiple BUs.

### 3.2 Leads (`leads` table)
~70 columns. Key fields:
- **Identity:** `id`, `sr_no` (unique), `customer_code` (CUST-00001), `location_code` (3-letter: MUM, DEL), `lead_ref` (CUST-00001-MUM-01)
- **Account:** `customer_name`, `property_type`, `property_category`, `city`, `state`
- **Ownership:** `owner_id` (FK users), `business_unit` (FK business_units)
- **Source:** `lead_source`, `channel_partner_name`, `kam_name`, `affiliate_name`
- **Classification:** `new_or_renewal` (New/Renewal/Expansion), `renewed_from_lead_id`, `lead_temperature`, `competitor`
- **Commercials:** `quantity`, `potential_tcv_lakhs`, `acv_lakhs`, `contract_value_lakhs`, `contract_period_months`, `po_validity_months`, `tcv_manual`, `billing_cycle`, `payment_terms`
- **Pipeline:** `phase` (New/Qualified/Demo/Proposal/Negotiation/PO Expected/PO Received/Lost/On Hold), `phase_changed_at`, `next_followup_date`, `po_expected_date`
- **Confidence:** `confidence_score` (0-100), `confidence_prev`, `confidence_prev_at`, `confidence_computed_at`
- **On Hold:** `hold_frozen_confidence`, `hold_entered_at`, `hold_end_date`, `pre_hold_stage`
- **Dates:** `start_date`, `qualified_date`, `demo_date`, `proposal_date`, `negotiation_date`, `po_received_date`, `service_start_date` (PO Start), `service_end_date` (PO End)
- **Services:** `services_json` (TEXT, JSON array of service lines with hw/svc components)
- **PO:** `po_type` (individual/global), `global_po_id` (FK global_pos), `po_number`, `po_document_url`, `po_actual_value_lakhs`
- **SCM:** `sent_to_scm`, `sent_to_scm_at`, `sent_to_scm_by`, `sent_to_scm_lines` (JSON)
- **Legacy service flags:** `includes_platform`, `includes_cms`, etc. (8 boolean flags + rate/qty pairs — legacy, superseded by `services_json`)
- **Custom:** `custom_fields` (JSON — admin-defined fields from BU wizard)
- **Other:** `jhes_product`, `additional_notes` (rich text), `lost_reason`

### 3.3 Other Tables
- **lead_contacts:** `id`, `lead_id` (FK CASCADE), `name`, `phone`, `email`, `designation`
- **activity_log:** `id`, `lead_id`, `entity_type`, `entity_id`, `business_unit`, `user_name`, `user_id`, `user_email`, `action_type`, `field_changed`, `old_value`, `new_value`, `note`, `created_at`
- **stage_history:** `id`, `lead_id` (FK CASCADE), `from_stage`, `to_stage`, `changed_by`, `changed_at`, `notes`
- **global_pos:** `id`, `business_unit`, `chain_name`, `device_total`, `price_lakhs`, `expected_start_date`, `expected_end_date`
- **settings:** `key_name` (PK), `value` — stores `weekly_target_lakhs`, `bd_weekly_targets` (JSON)
- **sla_config:** `id`, `business_unit`, `stage`, `sla_days` — unique on (business_unit, stage)
- **dropdown_options:** `id`, `field_name`, `business_unit`, `value`, `sort_order`, `active` — soft-delete
- **business_units:** `id`, `slug` (unique), `name`, `description`, `color`, `status`, `owner_id`, `business_type`, `config` (JSON: formSchema, modules, workflow, dashboards, reports, services), `sort_order`
- **service_definitions:** `id`, `business_unit` (FK CASCADE), `slug`, `label`, `nature` (opex/capex), `hardware`, `category` (software/hardware/hardware_software), `sort_order`, `active`
- **vocs:** VOC tracking (surveillance BU only) — `voc_no`, `customer_name`, `product_solution`, `priority`, `status`, etc.
- **voc_activity:** Audit trail for VOC changes
- **activities:** Kanban task cards — `title`, `status` (to_do/in_progress/delayed/blocked/completed), `priority`, `owner_name`, `tab_id`, etc.
- **activity_tabs:** Tab containers for kanban boards per BU

---

## 4. AUTHENTICATION & AUTHORIZATION

### Auth Flow
- **Dev:** Username/email + password login at `/api/auth/login`. JWT issued with `{ id, role }`.
- **Prod:** SSO via Jioautify portal. `POST /api/auth/sso` with email → token (single account) or ticket (multi-account chooser). Password routes return 403 in production.
- Token in `Authorization: Bearer <token>` header. Verified by `authenticate` middleware which loads full user from DB.

### Role Hierarchy
| Role (DB) | Display Name | Scope |
|---|---|---|
| `super_admin` | Global Admin | Cross-platform when combined with `super_admin_scope` |
| `business_admin` | Business Admin | Full access to one BU |
| `pmo` | Manager | Operational admin, one BU |
| `bd` | Team Member | Sees/edits only own leads |
| `forecast` | (Deprecated) | Folded into BD + forecast permission |

### Per-Module Permissions
Stored in `users.module_permissions` (JSON). Five modules: `leads`, `dashboard`, `forecast`, `reports`, `activities`. Four levels: `none` < `read` < `edit` < `full`. Permissions narrow what the role allows, never widen.

### Cross-Platform Super Admin
`users.super_admin_scope`: `'write'` = full access everywhere, `'read'` = read-only everywhere. Synced across all user rows with same email. Enforced at HTTP method level (read-only blocks non-GET).

### Data Scoping (`middleware/scope.js`)
`leadScopeWhere(user)` returns `{ business_unit }` for admins, adds `{ owner_id }` for BDs. Super Admins are scoped to the BU they signed into.

---

## 5. FRONTEND ARCHITECTURE

### Routing (App.jsx, react-router-dom v6)
| Path | Guard | Page |
|---|---|---|
| `/login` | Public | LoginPage |
| `/leads` | PrivateRoute + ModuleRoute(leads) | LeadsPage |
| `/customers`, `/customers/:code/:loc` | PrivateRoute + ModuleRoute(leads) | CustomersPage |
| `/dashboard` | PrivateRoute + ModuleRoute(dashboard) | DashboardPage |
| `/forecast` | PrivateRoute + ModuleRoute(forecast) | ForecastPage |
| `/reports` | PrivateRoute + ModuleRoute(reports) | ReportsPage |
| `/activity` | PrivateRoute | ActivityPage (global feed) |
| `/voc` | PrivateRoute | VocPage |
| `/activities` | PrivateRoute + ModuleRoute(activities) | ActivitiesPage (kanban) |
| `/settings` | AdminRoute | SettingsPage |
| `/business-units` | BusinessUnitRoute | BusinessUnitsPage |
| `/change-password` | PrivateRoute (dev only) | ChangePasswordPage |
| `/sso-select` | Public | SsoSelectPage |

### Auth Context (`context/AuthContext.jsx`)
Exposes: `user`, `login/logout`, `isAdmin`, `isSuperAdmin`, `isBD`, `isBusinessAdmin`, `can(module, level)`, `canView/canEdit/canFull(module)`, `canAct` (false for read-only SA), `buModules`, `buHasModule`, `permissions`, `canSeeActivityFeed`.

### API Service (`services/api.js`)
Axios instance at `baseURL = '/api'`. Auto-attaches Bearer token. 401 → redirect to login. Groups: Auth, Business Units, Users, Leads, Global POs, Activities, VOC, Activity Log, Super Admins, Permissions, Forecast, Settings, SLA/TAT, Dropdowns, Uploads.

---

## 6. KEY PAGES — FUNCTIONAL DETAILS

### 6.1 LeadsPage (`pages/LeadsPage.jsx`)
The most complex page. Main lead management surface.
- **Views:** Table view (default) and Kanban view (KanbanView component)
- **Filters:** Search, Phase, Lead Scoring bands (0-25%, 25-50%, 50-75%, 75-100%), Source, Customer, BD (admin), Follow-up date range, Followup overdue checkbox, Confidence band, explicit ID set
- **Features:** Create/Edit lead (opens LeadForm or CustomLeadForm based on BU), Activity log tab, Delete with confirmation, Expansion/Renewal PO flow (ExpansionPicker), Bulk operations (reassign/phase change/delete), Excel export (.xlsx), PDF export, Deep-link from dashboard via query params (?filter=, ?phase=, ?bd=, ?source=, ?conf=, ?ids=), Renewal badges using `renewalStatus()`, Confidence trend arrows, Stage aging colored against TAT
- **Form selection:** Original 3 BUs (signage, jhes, surveillance) use `LeadForm`; wizard-built BUs use `CustomLeadForm`
- **Lead priority:** Uses `sortWithWonLast` — active leads sorted by Stage → Confidence → Chain → TCV, won leads appended at bottom

### 6.2 DashboardPage (`pages/DashboardPage.jsx`)
Three tabs: **Overview**, **Analytics**, **Inventory**.
- **Date filter:** All time, This week, This month, Quarterly, This year, Custom range — affects all metrics
- **BD filter:** Admin can filter by individual BD
- **Overview tab:** Overdue ticker (marquee), On-hold ticker, KPI cards (Open Pipeline, Won TCV, Hot Leads, Overdue Follow-Ups), Data quality warnings, Leads by phase chips, Pipeline Target with progress bar (per-BD breakdown for admins, editable weekly targets), Target vs Expected vs Won attainment, Renewal alerts
- **Analytics tab:** Pipeline by Phase (bar chart), Conversion Funnel (SVG trapezoid), Bottlenecks (avg days per stage), Lead Source Effectiveness table, Pipeline Confidence (avg score, band mix, losing confidence list), PO Received Trend (year-over-year line chart with count/tcv/acv/licenses metrics), Annual BD Performance, Geographic Distribution (IndiaMap SVG)
- **Inventory tab:** Inventory Trend (bar chart), Hardware Demand table
- **Pipeline Target scaling:** week=1x, month=days_in_month/7, quarter=13x, year=52x (NOT prorated by partial days)

### 6.3 CustomersPage (`pages/CustomersPage.jsx`)
Read-only customer hierarchy. Two views: **Customers** and **Partners**.
- **Customers view:** Table with expandable State → City tree. Each customer row shows: name, code, PO count, states, lifetime value, total qty, renewal due (nearest expiring PO badge), services offered. Click city row → PO detail cards.
- **Partners view:** Channel Partner → Customer → PO drill-down with won/open values.
- **Filters:** Search, Phase, Lead Scoring, Source, Customer, Renewal Due (Expired, Due ≤30d, Due 31-60d, Due 61-90d, Due >90d, Renewed), BD (admin), Followup overdue only
- **Renewal badges:** Uses `renewalStatus(lead, renewedIds)` based on `service_end_date` (PO End Date). Bands: expired (dark red), red (≤30d), amber (31-60d), yellow (61-90d), ok (>90d), renewed (green).

### 6.4 ForecastPage (`pages/ForecastPage.jsx`)
Inventory Pipeline — hardware units by month and item.
- KPI cards, Pivot table (units by month × hardware item), Hardware Load by State (collapsible), Detail table with customizable columns (ColumnPicker), per-column filters (ColumnFilter), "Sent to SCM" toggle per row, Won PO section
- Excel + PDF export with independent column selection

### 6.5 SettingsPage (`pages/SettingsPage.jsx`)
Admin console: User management (add/edit/disable/delete), role assignment, password reset, per-module permission editor (PermissionsModal), activity feed grant for Managers, Stage TAT editor, Super Admins panel.

### 6.6 BusinessUnitsPage (`pages/BusinessUnitsPage.jsx`)
Global Admin surface: BU cards with usage stats, create (quick add or guided BuWizard — 8 steps), edit, clone, status management, safe delete, template editor (BuTemplateEditor).

### 6.7 Other Pages
- **ReportsPage:** Custom reports with sidebar filters, two views (Pipeline/Customers), KPI summary, Excel + PDF export
- **ActivityPage:** Platform-wide audit feed, infinite scroll, filters by user/platform/type/date
- **VocPage:** Voice of Customer (surveillance only) — dashboard, table, create/edit modal, comments, Excel export
- **ActivitiesPage:** Multi-tab kanban board with drag-and-drop, 5 columns (To Do, In Progress, Delayed, Blocked, Completed)

---

## 7. KEY COMPONENTS

### Lead Forms
- **LeadForm** (`components/LeadForm.jsx`): Hardcoded for original 3 BUs. 50+ fields. Template-driven visibility (`fieldOn`, `sectionOn`). Custom fields injected via `renderExtras(sectionKey)`. ReactQuill for notes. PO document upload with delete. Billing Cycle and Payment Terms with "Others" transform (dropdown becomes text input with ✕ button when Others selected). Expansion/Renewal flow copies source lead fields.
- **CustomLeadForm** (`components/CustomLeadForm.jsx`): Schema-driven for wizard-built BUs. Renders sections/fields from `buConfig.formSchema`. Uses `FieldInput` for all field types. Same PO Type / Chain / Phase patterns.
- **SKIP set:** Both forms maintain a `SKIP` set of field slugs handled by dedicated UI blocks (e.g., `billing_cycle`, `payment_terms`) to prevent double-rendering from the generic custom-field injection.

### ServicesOffered (`components/ServicesOffered.jsx`)
Catalog-driven service line builder. Three categories (Hardware, Software/Services, Hardware+Software). Each line has components with nature (CAPEX/OPEX), frequency, rate, qty. Shows per-line TCV and totals.

### MultiSelect (`components/MultiSelect.jsx`)
Dropdown with checkbox list, count badge, clear button. Used throughout all filter bars.

### KanbanView (`components/KanbanView.jsx`)
9 columns (New through On Hold). HTML5 drag-and-drop for phase changes. Cards show customer, confidence chip, aging chip, owner, TCV.

### BuWizard (`components/BuWizard.jsx`)
8-step guided BU creation: Basics → Sales Fields → Services → Modules → Dashboards → Reports → Workflow → Review. Loads catalog from `getBuCatalog()`.

### BuTemplateEditor (`components/BuTemplateEditor.jsx`)
Edit existing BU template: field sections, service catalog, module toggles. Saves to `business_units.config`.

### IndiaMap (`components/IndiaMap.jsx`)
SVG choropleth of India. Metrics: Customers, Won POs, Won TCV, Quantity. State name normalization (50+ aliases).

---

## 8. KEY UTILITIES

### leadHelpers.js (`utils/leadHelpers.js`)
- `renewalStatus(lead, renewedIds)` — **THE** correct function for PO expiry. Uses `service_end_date`. Returns `{ days, band }`. Bands: expired/red/amber/yellow/ok/renewed.
- `buildRenewedSet(leads)` — Set of lead IDs that have been renewed (suppresses expiry warnings)
- `renewalLabel(status)` — Human-readable label
- `RENEWAL_BAND_STYLE` — Color objects per band
- `isOverdue(lead)` — Follow-up date overdue check
- `getPOExpiryDays(lead)` — **DEPRECATED, DO NOT USE** — old formula using `po_received_date + po_validity_months`
- `stageAging(lead, tatMap)` — Days in stage vs TAT target
- `confidenceTrend(lead)` — up/down/flat/hold
- `computeTcvLakhs/computeAcvLakhs` — Legacy TCV/ACV from service flags
- `stripHtml`, `fmtDate`, `primaryContact`, `formatOtherContacts`, etc.

### leadPriority.js (`utils/leadPriority.js`)
- `sortWithWonLast(leads)` — Active sorted by priority (Stage → Confidence → Chain → TCV), Won appended
- `partitionByPriority(leads)` — `{ active, won }`

### pricing.js (`utils/pricing.js`)
Frontend mirror of backend pricing. `computeServicesTotals(lines, contractMonths)` → `{ tcvLakhs, acvLakhs }`.

### bulkTemplate.js (`utils/bulkTemplate.js`)
- `downloadTemplate()` — Generates .xlsx template with dropdowns, validations, instructions sheet
- `parseUploadedFile()` — Parses uploaded .xlsx for bulk import
- Columns include: `PO_COLUMNS` (billing_cycle, payment_terms), `SKIP_CUSTOM_SLUGS`

### constants.js (`utils/constants.js`)
All enums: `STAGE_ORDER`, `PHASE_BADGE`, `TEMP_BADGE`, `LOST_REASONS`, `INDIAN_STATES`, `UNION_TERRITORIES`, `PROPERTY_TYPES`, `PROPERTY_CATEGORIES`, VOC constants, service definitions.

---

## 9. BACKEND SERVICES

### Field Catalog (`services/fieldCatalog.js`)
Single source of truth for BU wizard and Edit Template. 10 sections: account, location, source, classification, commercials, pipeline, contacts, po, dates, other. Each field: `{ slug, label, type, core, options }`. Also exports `FIELD_TYPES`, `MODULE_CATALOG`, `DASHBOARD_CATALOG`, `REPORT_CATALOG`.

### Confidence Scoring (`services/scoring.js` + `services/scoringEngine.js`)
- Formula: Base score per stage (New=5 → PO Received=95) minus cumulative SLA-breach deductions, floored at 2%. Lost=0. On Hold=frozen.
- `scoringEngine.js` handles DB reads/writes, SLA map loading, hold transitions, bulk recompute.
- Hourly recompute interval on server boot.

### Lead Codes (`services/leadCodes.js`)
- `assignLeadCodes(bu, customerName, city, state, tx)` → `{ customer_code, location_code, lead_ref }`
- Customer codes: `CUST-00001` format. Location codes: 3-letter city abbreviation (curated list of 30+ Indian cities).
- `backfillLeadCodes()` runs on boot for idempotent backfill.

### Permissions (`services/permissions.js`)
- `levelFor(user, module)` — effective permission level
- `hasLevel(user, module, minLevel)` — check
- `defaultPermissionsFor(user)` — role-derived defaults
- `moduleEnabledForBu(buConfig, moduleSlug)` — BU module enablement

### Pricing (`services/pricing.js`)
- `computeServicesTotals(lines, contractMonths)` → `{ tcvLakhs, acvLakhs }`
- Service line shape: `{ category, label, hw: { nature, frequency, rate, qty }, svc: { nature, frequency, rate, qty } }`

### Audit (`services/audit.js`)
- `record()` / `recordDiff()` — writes to activity_log. Never throws (swallowed errors).

---

## 10. MIGRATION SYSTEM

42 SQL files in `backend/migrations/` (001–042). Run by `scripts/migrate.js` which:
1. Creates `schema_migrations` tracking table if needed
2. Splits SQL on `;` — **NO semicolons in SQL comments** (the splitter doesn't handle them)
3. Runs each unexecuted migration in its own transaction
4. Runs on server boot in standalone mode

---

## 11. KEY BUSINESS RULES & PATTERNS

### Multi-Business-Unit Architecture
- Dynamic BU creation via wizard (BuWizard). Config stored in `business_units.config` JSON.
- Per-BU: form schema (sections/fields/custom fields), service catalog, module enablement, SLA TAT, dropdown options.
- Original 3 BUs (signage, jhes, surveillance) use hardcoded `LeadForm`; wizard-built use `CustomLeadForm`.
- Signage-specific features gated by `(user.business_unit || '').toLowerCase() === 'signage'`.

### Lead Lifecycle
New → Qualified → Demo → Proposal → Negotiation → PO Expected → PO Received (won). Also: Lost, On Hold.
- Phase changes tracked in `stage_history`
- All field changes tracked in `activity_log`
- Confidence score auto-computed and decays with SLA breaches
- On Hold freezes confidence, records `pre_hold_stage` for resume

### Expansion & Renewal Flow
- "Additional PO" (Expansion): picks a customer, copies static fields (account info), creates new lead
- "Renewal": picks a specific won PO, copies statics + services + deal size, sets `renewed_from_lead_id`
- `buildRenewedSet()` builds Set of renewed lead IDs to show "Renewed" badge instead of expiry warning

### PO Received Fields
When phase = "PO Received", additional fields appear: PO Number, PO Document upload, PO Start/End dates, Billing Cycle (Monthly/Quarterly/Semi-annually/Annually/Advance/Others), Payment Terms (100% Advance/7 Days Credit/15 Days Credit/30 Days Credit/45 Days Credit/Others).
- "Others" option transforms dropdown into text input with ✕ to revert
- PO document required for PO Received phase
- `billing_cycle` and `payment_terms` stored only when phase is PO Received (cleared otherwise)

### Pipeline Target
- Settings: `weekly_target_lakhs` (global), `bd_weekly_targets` (JSON, per-BD)
- Scaled by date filter: week=1x, month=days_in_month/7, quarter=13x, year=52x
- NOT prorated by partial periods

### Renewal/Expiry Tracking
- **Single source of truth:** `service_end_date` (PO End Date)
- **Correct function:** `renewalStatus(lead, renewedIds)` in `utils/leadHelpers.js`
- **DEPRECATED:** `getPOExpiryDays()` — old formula, DO NOT USE
- Bands: expired (<0 days), red (≤30d), amber (31-60d), yellow (61-90d), ok (>90d), renewed

### Excel Export & Bulk Import
- Export includes: all lead fields + billing_cycle + payment_terms
- Bulk import: template generated with `downloadTemplate()`, parsed with `parseUploadedFile()`, validated with dry-run, max 500 rows
- Template has dropdowns, validations, instructions sheet

---

## 12. API ENDPOINTS SUMMARY

### Auth (`/api/auth/`)
POST login, POST bd-login, POST sso, POST sso/select, POST logout, GET me, POST switch-platform, POST change-password

### Users (`/api/users/`)
GET (public list), GET /manage, GET /super-admins, GET /:id/permissions, POST (create), PUT /:id, PUT /:id/reset-password, PUT /:id/active, PUT /:id/forecast-access, PUT /:id/activity-feed-access, PUT /:id/permissions, PUT /:id/super-admin, DELETE /:id

### Leads (`/api/leads/`)
GET (list, scoped), GET /customers, GET /:id, POST (create), PUT /:id, PUT /bulk/update, DELETE /:id, POST /bulk (import)

### Global POs (`/api/global-pos/`)
GET (list), GET /:id, POST, PUT /:id, DELETE /:id

### Activities (`/api/activities/`)
GET /tabs, POST /tabs, PATCH /tabs/:id, DELETE /tabs/:id, GET (cards), POST, PATCH /:id, DELETE /:id

### VOC (`/api/voc/`)
GET, GET /stats, GET /:id, POST, PUT /:id, POST /:id/comment, DELETE /:id

### Other
GET /api/activity-log?lead_id=, GET /api/activity-log/feed, GET /api/activity-log/feed/filters, GET /api/stage-history, GET|PUT /api/settings, GET|PUT /api/sla, GET|POST|DELETE /api/dropdowns, POST /api/uploads/po/:leadId, GET|POST|PUT|DELETE /api/business-units, GET /api/forecast/devices, PATCH /api/forecast/devices/:id/sent-to-scm, GET /api/health

---

## 13. IMPORTANT CONSTRAINTS FOR PROMPT GENERATION

When generating prompts for the coding AI, include these constraints:

1. **Migration SQL:** No semicolons in SQL comments (migration splitter breaks). Each migration is a new numbered file (next: 043).
2. **Backend restart:** Backend runs `node server.js` — code changes need manual kill/restart. Migrations run on boot.
3. **Frontend port:** Must use `PORT=3001` (PowerShell: `$env:PORT = "3001"; npm start`).
4. **Field Catalog:** New lead fields that should appear in BU wizard/Edit Template must be added to `backend/services/fieldCatalog.js` FIELD_SECTIONS.
5. **SKIP set:** Fields with dedicated UI in LeadForm/CustomLeadForm must be added to the SKIP set to prevent double rendering.
6. **Bulk import/export:** New fields need entries in `utils/bulkTemplate.js` (PO_COLUMNS or appropriate section) and in LeadsPage Excel export.
7. **normalizePayload:** New lead fields must be added to `normalizePayload` in `backend/routes/leads.js` with appropriate phase-conditional logic.
8. **Model sync:** New DB columns need: migration file + model field in `backend/models/index.js`.
9. **Renewal logic:** Always use `renewalStatus()` with `service_end_date`. Never use `getPOExpiryDays()`.
10. **No CSS framework:** All styling is inline styles or utility classes from `globalStyles.js`.
11. **Charts:** Use Recharts library (already installed).
12. **Testing:** Must test actual UI in browser. Type checking alone doesn't verify feature correctness.
13. **Security:** User is extremely sensitive to bugs — this goes live for 6-15 businesses. Must trace every consumer for shared code changes.
14. **Signage gating:** Features specific to signage use `(user.business_unit || '').toLowerCase() === 'signage'`.

---

## 14. CURRENT STATE & RECENT CHANGES

### Recently Added Features
- PO Received Trend Analysis chart (year-over-year line chart, metrics: count/tcv/acv/licenses)
- Billing Cycle and Payment Terms fields (phase-conditional, with "Others" text input transform)
- PO document delete option
- Pipeline Target respects dashboard date-range filter
- Customer and BD filter dropdowns on Leads and Customers pages
- Renewal Due filter on Customers page (Expired, ≤30d, 31-60d, 61-90d, >90d, Renewed)
- PO expiry badge fix (unified to use `renewalStatus()` across all pages)

### Known Considerations
- SR numbers are stable DB IDs, not sequential row numbers — they appear non-sequential when filtered
- `getPOExpiryDays()` is dead code but still in codebase
- Original 3 BUs use LeadForm; all others use CustomLeadForm — changes to lead forms may need updates in both

---

## HOW TO USE THIS CONTEXT

When generating a prompt for the coding AI:
1. **Be specific:** Reference exact file paths, component names, function names from this document
2. **Include constraints:** Mention which files need changes (migration, model, route, form, export, field catalog, etc.)
3. **State the full flow:** "Add field X" means: migration → model → normalizePayload → LeadForm + CustomLeadForm → SKIP set → fieldCatalog → bulkTemplate → Excel export
4. **Mention testing:** Ask the AI to verify in browser, check all consuming pages
5. **Reference patterns:** Point to existing similar implementations (e.g., "follow the billing_cycle pattern")
