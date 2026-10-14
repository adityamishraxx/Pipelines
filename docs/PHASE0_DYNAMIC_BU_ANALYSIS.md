# Phase 0 -- Dynamic Business Unit Architecture: Analysis & Plan

**Branch:** `dynamic-account-test`
**Date:** 2026-09-26
**Status:** AWAITING APPROVAL -- do not implement until approved

---

## 1. Complete Codebase Analysis

### Stack (verified against code)

- **Frontend:** React 18 SPA (CRA), react-router-dom v6, axios, Context API (AuthContext), Recharts, no CSS framework (globalStyles.js + inline styles)
- **Backend:** Node.js + Express 4, Sequelize 6 ORM, CommonJS modules
- **Database:** MySQL 8, schema managed by numbered SQL migration files (001-027), tracked in `schema_migrations` table. `sequelize.sync()` is **not** used anywhere.
- **Auth:** JWT-based, dev = password login, production = SSO via Jioautify portal

### Corrections to the prompt's description

1. **`users.role` ENUM** includes 5 values in the Sequelize model definition: `super_admin, business_admin, pmo, bd, forecast`. The `forecast` value is still in the ENUM even though migration 026 folded the last forecast account into `bd` -- the enum value was never dropped (consistent with the pattern in migration 024).

2. **The prompt lists `scripts/seed.js`** as containing BU string comparisons. No `seed.js` file exists in the repository. The seeding happens entirely inside migration files (013, 015, 016 for dropdown_options and sla_config).

3. **`vocs.business_unit`** is indeed `VARCHAR(32)` (not ENUM), but the route layer (`voc.js`) hardcodes `'surveillance'` in 7 places regardless, so the schema flexibility is unused.

4. **Not all tables use ENUM for business_unit.** Only 3 tables have true MySQL ENUMs:
   - `users.business_unit` -- ENUM('signage','jhes','surveillance')
   - `leads.business_unit` -- ENUM('signage','jhes','surveillance')
   - `global_pos.business_unit` -- ENUM('signage','jhes','surveillance')

   The other 4 tables already use plain VARCHAR(32):
   - `vocs.business_unit` -- VARCHAR(32) NOT NULL DEFAULT 'surveillance'
   - `dropdown_options.business_unit` -- VARCHAR(32) NULLABLE
   - `sla_config.business_unit` -- VARCHAR(32) NOT NULL
   - `activity_log.business_unit` -- VARCHAR(32) NULLABLE

   This means half the migration work is already done -- only 3 tables need ENUM-to-VARCHAR conversion.

---

## 2. Current Architecture Explained

### Data Model

**13 models** defined in `models/index.js`: User, Lead (90 columns), LeadContact, ActivityLog, StageHistory, Setting, DropdownOption, SlaConfig, GlobalPo, Voc, VocActivity, plus the implied `schema_migrations` table.

**Lead table structure (~90 columns):**
- ~30 core fields shared by ALL BUs: customer_name, owner_id, business_unit, city, state, lead_source, phase, dates, PO fields, confidence scoring fields, property_type/category, etc.
- ~25 service-specific columns used by Signage: includes_platform/cms/connectivity/display/amc/installation + their _rate/_qty pairs
- ~6 service-specific columns used by JHES: includes_iptv/jhes + _rate/_qty, jhes_product
- ~5 device-specific columns shared by Signage/JHES: includes_device, device_sku, device_cost_type, device_rate, device_qty, device_requested_date
- 1 JSON column used by Surveillance: services_json (array of {label, nature, rate, qty})

**Key structural finding:** No database constraint ties any "BU-specific" column to a particular business_unit value. The mapping is purely application-level (LeadForm.jsx branches + leads.js normalizePayload).

### Request Lifecycle

1. Frontend calls `services/api.js` (named arrow functions, axios interceptor adds `Authorization: Bearer <JWT>`)
2. Express router receives, `middleware/auth.js:authenticate` verifies JWT, loads User by id, stamps `last_seen`
3. Route-level guards: `authorize(roles)`, `adminOnly`, `requireModule(module, level)`, `requireAnyModule`
4. Business-unit scoping: `middleware/scope.js:leadScopeWhere(user)` forces `{ business_unit: user.business_unit }` on every lead query, plus `owner_id` restriction for `bd` role
5. Route handler processes, returns JSON
6. Frontend updates state via AuthContext + page-level state

### Auth/SSO Flow

- **Dev login** (`POST /auth/login`): `{ identifier, password, business_unit, role? }` -- fully parametric, no hardcoded BU strings. Three paths: GA login (role=super_admin), Platform login (business_unit set), Legacy (email only).
- **SSO** (`POST /auth/sso`): portal sends email, backend finds all active User rows with that email. If >1 (multi-BU), issues a 5-minute chooser ticket. If 1, returns token directly. `POST /auth/sso/select` redeems the ticket for a specific BU.
- **Platform switch** (`POST /auth/switch-platform`): authenticated user hops to sibling account (same email, different BU) without re-entering credentials.
- **`authUserPayload()`**: builds the response object including `permissions`, `can_see_activity_feed`, `is_super_admin`, `super_admin_scope`, `platforms` (list of BUs this email has accounts on).

### Permission Resolution (3-layer AND model)

1. **Role** (`users.role`): determines base capabilities (admin tier, team member)
2. **Module permissions** (`users.module_permissions` JSON): per-module level (none/read/edit/full). Can only NARROW what the role grants, never widen.
3. **Super Admin scope** (`users.super_admin_scope`): cross-platform additive grant (read/write). Does NOT enumerate BUs -- a BU created tomorrow is automatically in scope.

`services/permissions.js` resolves this: `effectivePermissions(user)` returns the AND of role defaults and module overrides. `canSeeActivityFeed(user)` is role-driven (GA/BA auto, PMO needs grant, BD never).

### Migration Runner (`scripts/migrate.js`)

- Reads `.sql` files from `backend/migrations/`, sorts lexicographically (zero-padded 3-digit prefix = chronological order)
- Splits SQL on literal semicolons -- comments must NOT contain semicolons
- Each migration runs inside a Sequelize transaction (though MySQL DDL implicitly commits, so this is best-effort)
- Tracks applied migrations in `schema_migrations(filename, applied_at)`
- No rollback/down migrations. No dry-run mode.

### Frontend State and Routing

- `AuthContext.jsx` provides: user, permissions, role flags (isAdmin, isSuperAdmin, isConsoleOnly, isCrossPlatform), permission helpers (canView, canEdit, canFull, canSeeActivityFeed)
- `PrivateRoute` / `AdminRoute` / `ModuleRoute` / `ForecastRoute` gate routes
- `Sidebar.jsx` builds nav from role + permissions + BU (VOC gated on `=== 'surveillance'`)
- `LoginPage.jsx` renders 3 hardcoded business cards + Global Admin button
- `LeadForm.jsx` (~870 lines) branches on `isJHES` / `isSurveillance` for services, TCV calc, device handling, lead affiliate

---

## 3. Every File That Needs Modification

### Backend -- Hardcoded BU Logic (MUST change)

| File | Line(s) | What's hardcoded | Why it must change |
|------|---------|-----------------|-------------------|
| `models/index.js` | 20, 52, 221 | ENUM('signage','jhes','surveillance') on users, leads, global_pos | Adding a BU requires DDL |
| `routes/leads.js` | 158 | `body.business_unit === 'surveillance'` (isSurveillance flag) | TCV calc branch by BU |
| `routes/leads.js` | 198 | `business_unit: body.business_unit \|\| 'signage'` | Signage as hardcoded default |
| `routes/leads.js` | 256 | `body.business_unit === 'jhes' && body.includes_device` | JHES device_qty zero exception |
| `routes/leads.js` | 261 | `body.business_unit === 'jhes' ? (body.jhes_product ...) : null` | JHES-only field |
| `routes/leads.js` | 262 | `isSurveillance ? JSON.stringify(survServices) : null` | Surveillance services_json |
| `routes/leads.js` | 310-317 | `payload.business_unit !== 'jhes'` + hardcoded `'jhes'` in query | Lead Affiliate auto-add is JHES-only |
| `routes/leads.js` | 55-64 | `TCV_SERVICES` array with JHES-only comments | Service catalogue per BU |
| `routes/leads.js` | 98-115 | `computeSurveillanceBreakdown()` / `cleanSurveillanceServices()` | Surveillance-only TCV functions |
| `routes/voc.js` | 16, 34, 150, 168, 183, 208, 224 | 7x hardcoded `'surveillance'` | Entire module locked to one BU |
| `services/scoringEngine.js` | 12 | `BUSINESSES = ['signage','jhes','surveillance']` | Hardcoded BU list for SLA maps |
| `routes/sla.js` | 39, 52 | Validates BU against imported `BUSINESSES` | Rejects unknown BUs with 400 |
| `routes/forecast.js` | 30-37 | `priceFields()` assumes flat JHES columns | Silently wrong for Surveillance/JSON-services BUs |

### Backend -- Already Parametric (no code change needed)

- `routes/auth.js` -- fully parametric (all BU values from request/DB)
- `routes/globalPos.js` -- scopes by `req.user.business_unit` dynamically
- `routes/dropdowns.js` -- `targetBu()` pattern, fully parametric
- `middleware/scope.js` -- `leadScopeWhere()` uses `user.business_unit` dynamically
- `middleware/auth.js` -- role-based only, no BU awareness
- `services/permissions.js` -- role/module-based, explicitly designed to be BU-count-agnostic
- `services/scoring.js` -- pure functions, BU injected by caller
- `services/chainPool.js` -- no BU awareness
- `services/audit.js` -- takes businessUnit as parameter

### Frontend -- Hardcoded BU Logic (MUST change)

| File | Line(s) | What's hardcoded |
|------|---------|-----------------|
| `utils/constants.js` | 1-5 | `BU_CONFIG` with 3 BUs |
| `utils/constants.js` | 10-14 | `SURVEILLANCE_ITEMS` (12 catalogue items) |
| `utils/constants.js` | 50-62 | `ALL_SERVICES`, `SIGNAGE_SERVICES`, `JHES_SERVICES` |
| `utils/constants.js` | 36-38 | `DEVICE_SKU_MAP` |
| `pages/LoginPage.jsx` | 7-9 | Duplicate BU_LABEL/BU_COLOR/BU_DESC (copy #2) |
| `pages/LoginPage.jsx` | 92 | `['signage','jhes','surveillance'].map(...)` literal array |
| `pages/SsoSelectPage.jsx` | 11-13 | Duplicate BU_LABEL/BU_COLOR/BU_DESC (copy #3) |
| `components/LeadForm.jsx` | 68-69 | `isJHES = user.business_unit === 'jhes'`, `isSurveillance = ...` |
| `components/LeadForm.jsx` | 192-227 | Three-way TCV/ACV calculation fork |
| `components/LeadForm.jsx` | 494-522 | Lead Affiliate: JHES managed dropdown vs. free text |
| `components/LeadForm.jsx` | 548-678 | Services Offered: 3-way render (Surveillance items / JHES services / Signage services) |
| `components/Sidebar.jsx` | 46 | `BU_CONFIG.signage` as fallback |
| `components/Sidebar.jsx` | 57 | `user.business_unit === 'surveillance'` for VOC nav |
| `pages/LeadsPage.jsx` | 157-172 | Kanban payload misses surveillance fields (existing bug) |
| `pages/LeadsPage.jsx` | 196-217 | `SERVICE_GROUPS` with hardcoded BU keys |
| `pages/ReportsPage.jsx` | 13-14 | Signage-only SERVICES/SERVICE_KEY (existing gap) |
| `pages/VocPage.jsx` | 49 | `user.business_unit === 'surveillance'` gate |
| `pages/VocPage.jsx` | 72 | `getBds('surveillance')` hardcoded literal |
| `pages/SettingsPage.jsx` | 12 | Duplicate ROLE_LABEL (missing forecast key vs constants.js) |

### Frontend -- Already Parametric (no/minimal changes)

- `context/AuthContext.jsx` -- no BU branching at all
- `services/api.js` -- pure passthrough layer
- `utils/forecastColumns.js` -- no BU branching
- `pages/ForecastPage.jsx` -- no BU branching
- `pages/DashboardPage.jsx` -- no BU branching

---

## 4. Database Changes Required

### 4.1 New Tables

#### `business_units` -- replaces the ENUM

```sql
CREATE TABLE business_units (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  slug        VARCHAR(32) NOT NULL UNIQUE,
  name        VARCHAR(128) NOT NULL,
  description VARCHAR(512),
  color       VARCHAR(32) NOT NULL DEFAULT '#6366f1',
  status      ENUM('active','disabled','archived') NOT NULL DEFAULT 'active',
  owner_id    INT DEFAULT NULL,
  business_type VARCHAR(64),
  config      JSON,                    -- catch-all for BU-level settings (branding, features)
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_bu_status (status),
  CONSTRAINT fk_bu_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Seeded with 3 rows: `(slug='signage', name='Signage', ...)`, `(slug='jhes', ...)`, `(slug='surveillance', ...)`.

#### `field_definitions` -- master field registry

```sql
CREATE TABLE field_definitions (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  slug         VARCHAR(64) NOT NULL UNIQUE,  -- e.g. 'customer_name', 'includes_platform', 'surveillance_services'
  label        VARCHAR(128) NOT NULL,        -- human-readable: 'Customer Name', 'Platform Service'
  field_type   VARCHAR(32) NOT NULL,         -- text, number, decimal, date, boolean, enum, json, dropdown
  category     VARCHAR(64) NOT NULL DEFAULT 'general', -- 'core', 'service', 'device', 'financial', 'dates', 'custom'
  is_core      TINYINT(1) NOT NULL DEFAULT 0, -- core fields exist on the leads table as real columns
  db_column    VARCHAR(64) DEFAULT NULL,     -- maps to leads.{column} for core fields; NULL for custom fields
  default_config JSON,                       -- { defaultValue, validationRules, dropdownSource, ... }
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Seeded by introspecting existing leads columns and the current per-BU form definitions.

#### `business_unit_fields` -- per-BU field config

```sql
CREATE TABLE business_unit_fields (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  business_unit_slug  VARCHAR(32) NOT NULL,
  field_definition_id INT NOT NULL,
  enabled             TINYINT(1) NOT NULL DEFAULT 1,
  mandatory           TINYINT(1) NOT NULL DEFAULT 0,
  sort_order          INT NOT NULL DEFAULT 0,
  config_overrides    JSON,   -- { label, placeholder, validation, dropdownSource, ... }
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_bu_field (business_unit_slug, field_definition_id),
  KEY idx_buf_bu (business_unit_slug),
  CONSTRAINT fk_buf_bu FOREIGN KEY (business_unit_slug) REFERENCES business_units(slug) ON UPDATE CASCADE,
  CONSTRAINT fk_buf_field FOREIGN KEY (field_definition_id) REFERENCES field_definitions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### `module_definitions` and `business_unit_modules`

```sql
CREATE TABLE module_definitions (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  slug        VARCHAR(32) NOT NULL UNIQUE,  -- 'leads', 'dashboard', 'forecast', 'reports', 'voc', ...
  label       VARCHAR(64) NOT NULL,
  description VARCHAR(255),
  is_core     TINYINT(1) NOT NULL DEFAULT 0, -- core modules (leads, dashboard) can't be disabled
  route_path  VARCHAR(64),                   -- '/leads', '/voc', etc.
  nav_icon    VARCHAR(8),                    -- emoji icon for sidebar
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE business_unit_modules (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  business_unit_slug  VARCHAR(32) NOT NULL,
  module_definition_id INT NOT NULL,
  enabled             TINYINT(1) NOT NULL DEFAULT 1,
  config              JSON,   -- module-specific config overrides
  UNIQUE KEY uniq_bu_mod (business_unit_slug, module_definition_id),
  CONSTRAINT fk_bum_bu FOREIGN KEY (business_unit_slug) REFERENCES business_units(slug) ON UPDATE CASCADE,
  CONSTRAINT fk_bum_mod FOREIGN KEY (module_definition_id) REFERENCES module_definitions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### `service_definitions` -- replaces hardcoded TCV_SERVICES / SURVEILLANCE_ITEMS / SIGNAGE_SERVICES

```sql
CREATE TABLE service_definitions (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  business_unit_slug  VARCHAR(32) NOT NULL,
  slug                VARCHAR(64) NOT NULL,     -- 'platform', 'cms', 'jiosecure_platform', etc.
  label               VARCHAR(128) NOT NULL,
  nature              ENUM('opex','capex') NOT NULL,
  sort_order          INT NOT NULL DEFAULT 0,
  active              TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uniq_bu_svc (business_unit_slug, slug),
  CONSTRAINT fk_svc_bu FOREIGN KEY (business_unit_slug) REFERENCES business_units(slug) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Seeded from: SIGNAGE_SERVICES (6 services), JHES_SERVICES (2 services), SURVEILLANCE_ITEMS (12 items), plus shared Device.

### 4.2 ENUM-to-VARCHAR Migration Strategy

**Approach:** ALTER the 3 ENUM columns to VARCHAR(32), add FK to `business_units(slug)`.

```sql
-- Step 1: Create business_units table and seed
INSERT INTO business_units (slug, name, description, color, status, sort_order)
VALUES
  ('signage', 'Signage', 'Digital Signage Solutions', '#4f46e5', 'active', 1),
  ('jhes', 'JHES', 'Jio Hospitality & Entertainment Services', '#ea580c', 'active', 2),
  ('surveillance', 'Surveillance', 'Surveillance & Security Solutions', '#0891b2', 'active', 3);

-- Step 2: ALTER ENUMs to VARCHAR (MySQL preserves existing string values)
ALTER TABLE users MODIFY COLUMN business_unit VARCHAR(32) NOT NULL DEFAULT 'signage';
ALTER TABLE leads MODIFY COLUMN business_unit VARCHAR(32) NOT NULL DEFAULT 'signage';
ALTER TABLE global_pos MODIFY COLUMN business_unit VARCHAR(32) NOT NULL DEFAULT 'signage';

-- Step 3: Add FK constraints
ALTER TABLE users ADD CONSTRAINT fk_users_bu FOREIGN KEY (business_unit)
  REFERENCES business_units(slug) ON UPDATE CASCADE;
ALTER TABLE leads ADD CONSTRAINT fk_leads_bu FOREIGN KEY (business_unit)
  REFERENCES business_units(slug) ON UPDATE CASCADE;
ALTER TABLE global_pos ADD CONSTRAINT fk_gpos_bu FOREIGN KEY (business_unit)
  REFERENCES business_units(slug) ON UPDATE CASCADE;
```

**Why VARCHAR slug FK instead of INTEGER FK:**
- Zero data migration -- existing 'signage'/'jhes'/'surveillance' values are already the slugs
- Queries remain readable without joins (`WHERE business_unit = 'signage'`)
- `leadScopeWhere()` continues to work unchanged
- 4 other tables already use VARCHAR(32) for business_unit; this makes all 7 consistent
- FK on VARCHAR(32) has negligible performance difference for <100 BU rows

**Rollback plan:** `ALTER TABLE ... MODIFY COLUMN business_unit ENUM(...)` (MySQL can convert VARCHAR back to ENUM if all values are valid enum members). Drop FK constraints first.

**Backfill plan:** None needed -- existing string values match the new slugs exactly.

### 4.3 Custom Field Value Strategy

**THE DESIGN DECISION: How to store BU-specific field values that don't map to an existing leads column.**

Three options with explicit tradeoffs:

#### Option A: EAV (Entity-Attribute-Value)

```sql
CREATE TABLE lead_field_values (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  lead_id         INT NOT NULL,
  field_def_id    INT NOT NULL,
  value_text      TEXT,
  value_number    DECIMAL(14,2),
  value_date      DATE,
  value_boolean   TINYINT(1),
  UNIQUE KEY uniq_lead_field (lead_id, field_def_id),
  CONSTRAINT fk_lfv_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_lfv_field FOREIGN KEY (field_def_id) REFERENCES field_definitions(id)
);
```

| Criterion | Rating | Detail |
|-----------|--------|--------|
| Query/filter | Poor | Multi-field WHERE requires N self-joins; `WHERE field=A AND value=X AND field=B AND value=Y` becomes 2 joins |
| Excel/PDF export | Poor | Pivot query or app-level assembly per row; O(fields x leads) query |
| Indexing | Fair | Can index (lead_id, field_def_id, value_*), but compound conditions across fields still need self-joins |
| Reporting/aggregation | Poor | GROUP BY on a custom field requires subquery + conditional aggregation |
| Migration cost | Excellent | Zero DDL for new fields -- just INSERT a field_definition row |
| Scalability | Excellent | Unlimited fields, constant schema |

#### Option B: JSON Column

```sql
ALTER TABLE leads ADD COLUMN custom_fields JSON DEFAULT NULL;
-- Existing BU-specific columns remain for backward compatibility during migration
-- New BU fields go into custom_fields: {"my_field": "value", "another": 42}
```

| Criterion | Rating | Detail |
|-----------|--------|--------|
| Query/filter | Good | `WHERE JSON_EXTRACT(custom_fields, '$.my_field') = 'X'`; MySQL 8 supports functional indexes on JSON expressions |
| Excel/PDF export | Good | `JSON_EXTRACT` or app-level `JSON.parse` per row; simpler than EAV pivot |
| Indexing | Good | Virtual generated columns + B-tree index for frequently-queried fields; ad-hoc fields unindexed but still queryable |
| Reporting/aggregation | Fair | `JSON_EXTRACT` in GROUP BY works but is verbose; generated columns simplify |
| Migration cost | Excellent | Zero DDL for new fields |
| Scalability | Very Good | Unlimited fields; ~1MB practical JSON document limit per row (far more than any lead needs) |

#### Option C: Keep Widening the Table (status quo for Signage/JHES; Surveillance already uses JSON)

| Criterion | Rating | Detail |
|-----------|--------|--------|
| Query/filter | Excellent | Standard SQL, fully indexable |
| Excel/PDF export | Excellent | Direct SELECT |
| Indexing | Excellent | Standard B-tree |
| Reporting/aggregation | Excellent | Standard GROUP BY |
| Migration cost | Terrible | Every new field = new migration + deployment + DDL |
| Scalability | Terrible | MySQL row size limit (~65KB), table grows indefinitely, most columns NULL |

### Recommendation: Option B (JSON Column) -- Hybrid Approach

**Keep the ~30 core columns** as real database columns (customer_name, phase, city, state, dates, financial totals, confidence scoring, PO fields). These are shared by every BU and are frequently filtered/sorted/aggregated.

**Consolidate all service-related fields** into a universal `leads.services JSON` column, following the pattern Surveillance already uses with `services_json`:
```json
[
  {"key": "platform", "label": "Platform", "nature": "opex", "rate": 100, "qty": 2, "enabled": true},
  {"key": "cms", "label": "CMS", "nature": "opex", "rate": 50, "qty": 1, "enabled": true}
]
```

This eliminates the `computeTcvBreakdown` vs. `computeSurveillanceBreakdown` fork -- one universal function iterates the JSON array and sums opex/capex. The `service_definitions` table tells each BU what services are available; the lead's `services` JSON records which were selected and their values.

**Add `leads.custom_fields JSON`** for truly BU-specific non-service fields (like JHES's `jhes_product`). The `field_definitions` + `business_unit_fields` metadata tables drive what goes here per BU.

**The existing per-service columns** (`includes_platform`, `platform_rate`, `platform_qty`, etc.) remain in the schema for backward compatibility. A data migration populates the new `services` JSON from them for existing leads. New leads write to `services` JSON only. The old columns are deprecated but never dropped (avoids a destructive ALTER on a production table with data).

**Why not EAV:** The N-way self-join problem is a showstopper for this app's filtering and export patterns. The leads list page already supports multi-field filters; each added EAV field would add a JOIN, degrading query time linearly.

**Why not keep widening:** The prompt correctly identifies this as the core structural problem. Every new BU would require DDL, and the table is already at ~90 columns.

### 4.4 Indexes

```sql
-- business_units
CREATE UNIQUE INDEX idx_bu_slug ON business_units(slug);  -- already in CREATE TABLE above
CREATE INDEX idx_bu_status ON business_units(status);

-- field_definitions
CREATE UNIQUE INDEX idx_fd_slug ON field_definitions(slug);

-- business_unit_fields
CREATE INDEX idx_buf_bu ON business_unit_fields(business_unit_slug);

-- service_definitions
CREATE INDEX idx_svc_bu ON service_definitions(business_unit_slug);

-- leads (new)
-- For frequently-filtered custom fields, add generated columns:
-- ALTER TABLE leads ADD COLUMN _cf_myfield VARCHAR(255) GENERATED ALWAYS AS
--   (JSON_UNQUOTE(JSON_EXTRACT(custom_fields, '$.myfield'))) VIRTUAL;
-- CREATE INDEX idx_leads_cf_myfield ON leads(_cf_myfield);
```

### 4.5 Migration File Plan

All new migrations follow the existing convention: numbered SQL files, semicolons only as statement terminators.

```
028_create_business_units.sql        -- business_units table + seed 3 rows
029_enum_to_varchar.sql              -- ALTER 3 ENUM columns to VARCHAR(32) + add FKs
030_field_definitions.sql            -- field_definitions + business_unit_fields tables + seed from existing schema
031_module_definitions.sql           -- module_definitions + business_unit_modules tables + seed
032_service_definitions.sql          -- service_definitions table + seed from existing service lists
033_leads_services_json.sql          -- ADD leads.services JSON + leads.custom_fields JSON
034_backfill_leads_services.sql      -- Populate services JSON from existing per-service columns
035_bu_config_endpoint_support.sql   -- Any additional config/metadata tables needed
```

Each migration is independently applicable and the app continues working between any two adjacent migrations (no "all or nothing" across the set).

---

## 5. Frontend Changes Required

### 5.1 New Pages/Components

| Component | Purpose |
|-----------|---------|
| `pages/BusinessUnitsPage.jsx` | BU management: list, create, edit, disable, archive, delete, clone |
| `components/BuWizard.jsx` | Step-by-step BU creation wizard (8 steps, resumable) |
| `components/BuWizardStep*.jsx` | One component per wizard step (BasicInfo, Fields, Modules, Dashboards, Reports, Roles, Workflows, Review) |
| `components/MetadataFormRenderer.jsx` | Generic form renderer driven by field_definitions + business_unit_fields metadata |
| `components/ServiceEditor.jsx` | Universal services-offered editor (replaces the 3-way fork in LeadForm) |

### 5.2 How utils/constants.js Gets Dismantled

**Phase 1 (immediate):** Keep `constants.js` intact. Add a new `GET /api/business-units` endpoint and `GET /api/business-units/:slug/config` endpoint. Frontend fetches BU list from API for login/SSO pages. `BU_CONFIG` becomes a fallback only.

**Phase 2:** `AuthContext.jsx` hydrates a `buConfig` object at login from the config endpoint. All consumers switch from `BU_CONFIG[slug]` to `buConfig`. The 3 duplicate copies (LoginPage, SsoSelectPage, constants.js) are replaced by a single API-driven source.

**Phase 3:** `ALL_SERVICES`, `SIGNAGE_SERVICES`, `JHES_SERVICES`, `SURVEILLANCE_ITEMS` are replaced by `service_definitions` fetched from the API. `LeadForm.jsx` renders services from metadata, not from constants.

**Import chain:** Any file currently importing from `constants.js` continues to work at every phase. Deprecated constants are kept with JSDoc `@deprecated` markers until no consumers remain.

### 5.3 Metadata-Driven Form Renderer

Replaces `isJHES` / `isSurveillance` branching in `LeadForm.jsx`:

```
API: GET /api/business-units/:slug/config
  -> { fields: [...], services: [...], modules: [...], dropdowns: {...} }

MetadataFormRenderer receives:
  - fieldDefs: the BU's enabled fields with their config
  - serviceDefs: the BU's service catalogue
  - formData: current lead values
  - onChange: update handler

Renders:
  - Core fields (from fieldDefs where category='core')
  - Service section (from serviceDefs -- universal rate/qty/nature editor)
  - Device section (if any service has type='device')
  - Custom fields (from fieldDefs where is_core=false)
```

`LeadForm.jsx` becomes a thin wrapper: load metadata, pass to `MetadataFormRenderer`, handle submit. The ~870 lines shrink to ~200.

### 5.4 AuthContext Changes

```js
// New state
const [buConfig, setBuConfig] = useState(null);  // fetched at login from /api/business-units/:slug/config

// In login():
const config = await getBuConfig(user.business_unit);
setBuConfig(config);

// Exposed:
value = { ...existing, buConfig };
```

Consumers: `Sidebar` reads `buConfig.modules` for nav items (replaces the hardcoded VOC check). `LeadForm` reads `buConfig.fields` + `buConfig.services`. `LoginPage`/`SsoSelectPage` fetch the BU list from a separate lightweight endpoint (`GET /api/business-units?status=active`).

### 5.5 Dynamic Navigation

`Sidebar.jsx` currently hardcodes the VOC nav item for surveillance. With `business_unit_modules`, it becomes:

```jsx
// Replace:
...(user.business_unit === 'surveillance' ? [{ path: '/voc', label: 'VOC' }] : []),

// With:
...(buConfig?.modules?.filter(m => m.enabled).map(m => ({
  path: m.route_path, label: m.label, disabled: !canView(m.slug)
})) || []),
```

Module-level permissions (`canView`) still gate visibility. The module_definitions table adds the route_path and nav_icon metadata.

---

## 6. API Changes Required

### 6.1 New Endpoints

```
GET    /api/business-units                    -- list all BUs (status filter, public for login page)
GET    /api/business-units/:slug              -- single BU detail
GET    /api/business-units/:slug/config       -- full metadata bundle (fields, services, modules, dropdowns)
POST   /api/business-units                    -- create BU (super_admin write only)
PUT    /api/business-units/:slug              -- update BU (super_admin write only)
DELETE /api/business-units/:slug              -- disable/archive/delete (super_admin write only)
POST   /api/business-units/:slug/clone        -- clone BU config (super_admin write only)

GET    /api/field-definitions                 -- master field registry (for wizard introspection)
GET    /api/service-definitions/:bu_slug      -- service catalogue for a BU
POST   /api/service-definitions/:bu_slug      -- add service to BU catalogue
PUT    /api/service-definitions/:id           -- update service definition
DELETE /api/service-definitions/:id           -- remove service from catalogue

GET    /api/module-definitions                -- master module registry
```

### 6.2 Changed Contracts

| Endpoint | Change | Backward Compat |
|----------|--------|-----------------|
| `GET /api/auth/me` | Add `bu_config` to response (or keep it a separate fetch) | Existing fields unchanged |
| `POST /api/leads` | Accept `services` JSON alongside legacy per-service columns | Both paths supported; if `services` JSON present, it takes precedence |
| `PUT /api/leads/:id` | Same as POST | Same |
| `GET /api/dropdowns` | No change needed (already parametric by business_unit) | Unchanged |
| `GET /api/sla` | Validate BU against `business_units` table instead of hardcoded `BUSINESSES` | Any active BU now accepted |

### 6.3 The Config Bundle Endpoint

`GET /api/business-units/:slug/config` returns:

```json
{
  "slug": "signage",
  "name": "Signage",
  "color": "#4f46e5",
  "description": "Digital Signage Solutions",
  "fields": [
    { "slug": "customer_name", "label": "Customer Name", "type": "text", "category": "core",
      "enabled": true, "mandatory": true, "sortOrder": 1 },
    { "slug": "includes_platform", "label": "Platform", "type": "service_toggle", "category": "service",
      "enabled": true, "mandatory": false, "sortOrder": 20 }
  ],
  "services": [
    { "slug": "platform", "label": "Platform", "nature": "opex", "sortOrder": 1 },
    { "slug": "cms", "label": "CMS", "nature": "opex", "sortOrder": 2 }
  ],
  "modules": [
    { "slug": "leads", "label": "Leads", "routePath": "/leads", "icon": "clipboard", "enabled": true },
    { "slug": "voc", "label": "VOC", "routePath": "/voc", "icon": "speech", "enabled": false }
  ],
  "dropdowns": {
    "channel_partner": ["Mindlabz", "Star Hub", ...],
    "device_sku": ["MCM3000", "JSB210", ...]
  }
}
```

Cached client-side in `AuthContext`. Invalidated on BU config change (admin action) or window focus.

---

## 7. RBAC/Permission Changes Required

### Preserving the Three-Layer AND Model

The existing permission system is already well-designed for this change:

1. **Role** (`users.role`) -- unchanged. The 5 roles (super_admin, business_admin, pmo, bd, forecast) remain global concepts.
2. **Module permissions** (`users.module_permissions` JSON) -- the MODULES list in `services/permissions.js` currently has 4 entries (`leads, dashboard, forecast, reports`). With `module_definitions`, this becomes data-driven. But the narrowing invariant is preserved: a module permission can only narrow what the role grants.
3. **Super Admin scope** -- unchanged. `super_admin_scope` does NOT enumerate BUs, so a new BU is automatically in scope.

### What Changes

- `services/permissions.js:MODULES` -- currently `['leads','dashboard','forecast','reports']`. Must become dynamic, read from `module_definitions` where `is_core=true` or enabled for the user's BU. The `effectivePermissions()` function must handle modules that exist for some BUs but not others.
- `services/permissions.js:defaultPermissionsFor(user)` -- currently returns hardcoded defaults per role. Must handle dynamic modules: if a module doesn't exist for this BU, the effective permission is `none` regardless of role.
- **Per-BU custom roles** (Requirement 6 from the prompt) -- this is where I need to push back.

### Design Decision: Per-BU Custom Roles

The prompt asks for custom roles per BU (Step 6 of the wizard). I recommend **against** per-BU custom roles at this stage, for these reasons:

1. **The existing model works:** Role determines capability tier (admin/operational/team). Module permissions determine per-module access level. This is a clean separation. Custom roles would mean a user in BU-A as "Product Manager" has different base capabilities than a user in BU-B as "Delivery Manager" -- but both are really just PMO-tier users with different module permission maps.

2. **What the user actually wants** is better served by: keeping the 4 role tiers (super_admin, business_admin, pmo, bd) + custom module permission templates per BU. A "Product Manager" is a PMO with a specific module permission preset. This is achievable without schema changes to the role system.

3. **Adding real custom roles** would require: a `role_definitions` table, changing `users.role` from ENUM to VARCHAR, updating every `role === 'pmo'` check across the codebase (~30 occurrences), and redesigning the permission AND logic. This is high-risk for low incremental value.

**Recommendation:** Keep the 4 role tiers. Add a `permission_templates` table for named presets (e.g., "Product Manager = PMO + {leads:full, dashboard:read, forecast:none, reports:read}"). The wizard's "User Roles" step creates templates, not new role tiers.

---

## 8. Risks and Dependencies

### Data-Loss Risks

| Risk | Mitigation |
|------|-----------|
| ENUM-to-VARCHAR ALTER on production | MySQL preserves string values on MODIFY COLUMN. Test on a copy first. The migration is reversible (VARCHAR back to ENUM). |
| services JSON backfill misses edge cases | Run backfill in a transaction; compare old vs. new TCV calculations for every lead afterward (automated verification query). |
| Deleting a BU orphans rows | Deletion requires safe-deletion validation (check all related tables). Block if data exists; offer Archive instead. |

### Performance Regressions

| Concern | Assessment |
|---------|-----------|
| VARCHAR FK vs. ENUM for business_unit | Negligible -- VARCHAR(32) FK lookup on a <100 row table is effectively free. B-tree index on VARCHAR is only marginally larger than on a 1-byte ENUM. |
| JSON_EXTRACT queries on custom_fields | Only an issue if a custom field is frequently filtered. Solution: generated column + index for hot fields. For the initial migration, all frequently-filtered fields remain as real columns. |
| Config endpoint adds a round-trip at login | One additional GET, cacheable. The response is ~2KB. Fetched once at login, refreshed on focus (same pattern as /auth/me). |

### Export/Reporting Breakage

| Issue | Fix |
|-------|-----|
| `ReportsPage.jsx` hardcodes signage-only SERVICES | Already broken for JHES/Surveillance today. The metadata-driven approach fixes this: export iterates the BU's field_definitions to build columns. |
| `LeadsPage.jsx` export hardcodes SERVICE_GROUPS | Same fix: build SERVICE_GROUPS from the BU's service_definitions. |
| `LeadsPage.jsx` Kanban drag drops surveillance services | Existing bug. Fix: payload builder reads all populated fields from the lead object, not a hardcoded list. |

### SSO Breakage

No risk. The SSO flow (`/auth/sso`, `/auth/sso/select`) is already fully parametric -- it queries Users by email, returns all BU accounts found, and the chooser works with whatever BUs exist. Adding a 4th BU requires zero changes to the SSO code path.

### Seed Script

No `scripts/seed.js` exists. Seeding is done via migration files. New BUs created via the wizard will INSERT their own seed data (dropdown_options, sla_config, service_definitions) as part of the creation transaction -- not via migration files.

### In-Flight Sessions / Stale JWTs

JWTs carry only `{ id, role }` (no BU, no permissions). The BU comes from the User row, which is re-queried on every `authenticate` call. So a BU config change takes effect on the next request with zero JWT invalidation needed. The frontend's existing focus-poll on `/auth/me` picks up permission changes within 60 seconds.

### The Migration Runner's Semicolon Split

All new migration files must follow the existing convention: no semicolons in comments. Already validated by the existing 27 migrations.

---

## 9. Phased Implementation Plan

### Phase 1: Business Units Table + ENUM Migration (Foundation)
**Goal:** Replace hardcoded ENUMs with a data-driven `business_units` table. Zero behavior change.

- Migration 028: Create `business_units` table, seed 3 rows
- Migration 029: ALTER ENUM columns to VARCHAR(32), add FKs
- Backend: `scoringEngine.js` reads BU list from DB instead of hardcoded `BUSINESSES`
- Backend: `sla.js` validates against DB instead of `BUSINESSES`
- Backend: `models/index.js` changes ENUM to STRING(32) in Sequelize model definitions
- Frontend: LoginPage/SsoSelectPage fetch BU list from `GET /api/business-units` instead of hardcoded arrays
- **Verification:** All existing tests pass. Login flow works with API-driven BU list. SLA config works. Leads CRUD unchanged. SSO unchanged.
- **Revert:** Drop FKs, ALTER VARCHAR back to ENUM, drop `business_units` table.

### Phase 2: BU Management CRUD + Safe Deletion
**Goal:** Admin UI for creating, editing, disabling, archiving, and deleting Business Units.

- `BusinessUnitsPage.jsx`: list, add, edit, status change
- Backend CRUD endpoints with safe-deletion validation
- Clone endpoint (copies config, not data)
- Settings page integration (new tab for Global Admin)
- **Verification:** Can create a 4th BU via UI. Can disable/archive. Delete blocked when data exists. Clone works.
- **Revert:** Remove the page and endpoints. `business_units` table stays (Phase 1).

### Phase 3: Field & Service Metadata
**Goal:** Move field definitions and service catalogues from code to database.

- Migration 030-032: `field_definitions`, `business_unit_fields`, `service_definitions` tables, seeded from existing schema
- `GET /api/business-units/:slug/config` endpoint
- Backend: `normalizePayload()` in leads.js reads service_definitions instead of hardcoded TCV_SERVICES
- Backend: universal TCV calculation from services JSON (replaces the 2-way fork)
- **Verification:** Existing Signage/JHES/Surveillance leads save correctly with metadata-driven normalization. TCV calculations match exactly.
- **Revert:** Remove new tables and endpoint. leads.js reverts to hardcoded logic.

### Phase 4: Metadata-Driven Frontend
**Goal:** Replace hardcoded form branches with a generic renderer.

- `MetadataFormRenderer.jsx`: renders lead form from field+service metadata
- `ServiceEditor.jsx`: universal services editor (replaces 3-way fork)
- `LeadForm.jsx` refactored to use MetadataFormRenderer
- `AuthContext.jsx` hydrates `buConfig` at login
- `Sidebar.jsx` builds nav from `buConfig.modules`
- Export (LeadsPage, ReportsPage) builds columns from metadata
- Kanban payload builder reads fields dynamically (fixes existing surveillance bug)
- **Verification:** Lead form renders correctly for all 3 BUs from metadata. Export includes correct service columns per BU. Kanban drag preserves all fields.
- **Revert:** LeadForm reverts to hardcoded branches (MetadataFormRenderer is additive).

### Phase 5: Module Metadata + VOC Generalization
**Goal:** Make modules data-driven. Generalize VOC beyond surveillance.

- Migration 031: `module_definitions`, `business_unit_modules` tables
- `voc.js` reads BU from user instead of hardcoded 'surveillance'
- `permissions.js:MODULES` becomes dynamic
- `Sidebar.jsx` renders modules from `business_unit_modules`
- `VocPage.jsx` removes `=== 'surveillance'` gate
- **Verification:** VOC can be enabled for any BU via config. A new BU created with VOC enabled shows the VOC nav and page.
- **Revert:** `voc.js` reverts to hardcoded gate. MODULES reverts to static array.

### Phase 6: BU Creation Wizard
**Goal:** The full 8-step wizard for creating a new BU from scratch or from a template.

- `BuWizard.jsx` + step components
- Wizard introspects existing BUs to discover available options
- Draft save/resume
- Final review with diff-style preview
- **Verification:** A non-technical admin can create a fully functional new BU via the wizard. The new BU immediately appears in login, leads, dashboard, forecast, reports -- with zero code changes.
- **Revert:** Remove wizard. BU creation falls back to direct CRUD (Phase 2).

### Phase 7: Cleanup & Documentation
**Goal:** Remove deprecated constants, update docs, add test coverage.

- Remove `constants.js` deprecated exports (BU_CONFIG, service arrays)
- Remove `LeadForm.jsx` BU branches (now dead code)
- Add tests: BU CRUD, safe deletion, cloning, scoping isolation, permission composition
- Update README.md
- Create `docs/DYNAMIC_BU_ARCHITECTURE.md`

---

## Design Decisions -- RESOLVED (2026-09-26)

1. **Custom field storage: JSON column.** Keep ~30 core fields as real columns; consolidate service/custom fields into `leads.services` + `leads.custom_fields` JSON. See Section 4.3.

2. **Per-BU custom roles: 4 role tiers + permission templates.** No change to `users.role` ENUM or the permission AND core. Named presets (e.g. "Product Manager") map to a tier + module map. See Section 7.

3. **BU reference column: VARCHAR slug FK** to `business_units(slug)`. No integer-FK data migration. See Section 4.2.

4. **Existing per-service columns: deprecate-and-freeze.** They stay in the schema; new code ignores them once the services JSON is proven. No destructive ALTER. See Section 4.3.

5. **Build scope: Core first.** Make today's 3 BUs fully dynamic (BU table, fields, services, modules, metadata form, wizard steps 1-3 + review, clone). Defer the dashboard configurator, report builder, and approval-workflow engine (wizard steps 4-7) to follow-up phases -- they are net-new subsystems, not refactors.

---

**Awaiting explicit go-ahead to begin Phase 1 implementation.**
