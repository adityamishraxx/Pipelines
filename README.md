# Geo Sales CRM — Enterprise Sales Intelligence Platform

> A full-featured, self-hosted CRM built for B2B sales teams that need pipeline visibility, team accountability, and data-driven decision making — without the complexity or cost of Salesforce.

[![Frontend](https://img.shields.io/badge/Frontend-React_18.3-61DAFB?logo=react)](#tech-stack--dependencies)
[![Backend](https://img.shields.io/badge/Backend-Express_4.19-000000?logo=express)](#tech-stack--dependencies)
[![Database](https://img.shields.io/badge/Database-MySQL_8-4479A1?logo=mysql)](#tech-stack--dependencies)
[![ORM](https://img.shields.io/badge/ORM-Sequelize_6-52B0E7?logo=sequelize)](#tech-stack--dependencies)
[![Status](https://img.shields.io/badge/Status-Production_Ready-brightgreen)](#)

---

## Why Geo Sales CRM?

Most CRMs are either too simple (spreadsheets with a login page) or too complex (6-month Salesforce implementations). Geo Sales CRM sits in the sweet spot:

- **Deploy in hours, not months** — self-hosted, no vendor lock-in, no per-seat pricing
- **Multi-business from day one** — one instance serves unlimited business units, each with its own pipeline, team, and configuration
- **Built for how B2B sales actually works** — phase-based pipelines, follow-up tracking, renewal management, and team leaderboards
- **Enterprise-grade access control** — role-based permissions down to the module and field level, with full audit trail
- **Zero external services** — no Redis, no Elasticsearch, no message queues, no cloud dependencies. One Node process + one MySQL database = full CRM

---

## Platform Capabilities

### Core Modules

| Module | What It Does |
|--------|-------------|
| **Lead Management** | Full lifecycle from New to PO Received. Table + Kanban views, 40+ configurable fields, bulk import (500 rows/batch), Excel/PDF export, deep-linking |
| **Dashboard & Analytics** | Real-time KPIs, conversion funnel, BD leaderboard, pipeline targets, stage aging, geographic heatmap (India), PO trends, renewal alerts |
| **Task Board** | Multi-tab Kanban boards per business unit. Cards with priority, owner, status tracking, and threaded notes |
| **Smart Reports** | 6 report types with configurable filters: Pipeline, Customer Details, BD Performance, Source Analysis, Monthly Trend, Campaign ROI. Interactive charts + Excel/PDF export |
| **Notification Engine** | 16 rule-based triggers with 4 severity levels (Critical, Warning, Info, Low). Configurable per-user preferences. Actionable click-to-navigate. Scheduled sweeps for time-based alerts |
| **Customer Directory** | Customer hierarchy with State → City drill-down. Multi-contact management (Decision Maker, Technical POC, Procurement, Finance, Operations). Renewal tracking with urgency badges |
| **Campaign Tracking** | Create campaigns, link leads, track ROI. Budget vs. revenue analysis with automated attribution |
| **Inventory Pipeline** | Hardware/service line tracking per lead. Sent-to-SCM workflow. Configurable columns with geographic rollup |
| **VOC (Voice of Customer)** | Capture customer feedback by category. Reviewer workflow for product teams. Business impact and revenue impact scoring |
| **Global POS / Chains** | Chain-level device pool management. Live consumed/remaining/exceeded tracking derived from linked POs |

### Platform Features

| Feature | Details |
|---------|---------|
| **Multi-Business Architecture** | Unlimited business units on one instance. Each BU gets its own pipeline, team, field schema, service catalog, SLA config, and module enablement |
| **Role-Based Access Control** | 4 roles (Global Admin, Business Admin, Manager, Team Member) × 6 modules × 4 permission levels (None, Read, Edit, Full). Per-user, per-module granularity |
| **SSO Integration** | Production SSO via portal handoff. Multi-account chooser for users spanning BUs. Dev-mode password auth with bcryptjs |
| **Confidence Scoring** | Formula-based lead scoring: stage weight + SLA decay + floor. Per-BU SLA configuration. Automatic scheduled recomputation with trend tracking |
| **Global Search** | Cross-module search bar. Type a name, find it across leads, chains, VOC, and tasks instantly |
| **Audit Trail** | Field-level change history on every lead update. Who changed what, when, from what value to what value. Timeline view in the lead form |
| **@Mention System** | Tag teammates in any notes field with `@Name`. Optional follow-up date parsing. Auto-creates actionable notification for the mentioned user |
| **Bulk Operations** | Import up to 500 leads per batch with dry-run validation (xlsx). Bulk reassign owners. Bulk phase changes |
| **Export Everywhere** | Excel (formatted, multi-sheet via exceljs) and PDF (jspdf + jspdf-autotable) export on Leads, Reports, Forecast, and Customer pages |
| **Renewal Management** | Automatic PO expiry tracking with color-coded urgency bands (OK, Due, Overdue, Expired, Renewed). Dashboard alerts |
| **Rich Text Notes** | react-quill powered rich text editor for lead notes, activity descriptions, and VOC entries |
| **Geographic Analytics** | India SVG choropleth heatmap (@svg-maps/india) on the dashboard. State-level pipeline rollup in forecast |

---

## MVP Features (Minimum Viable Product)

These are the core capabilities that make Geo Sales CRM a functional pipeline tool from day one:

| # | Feature | Description |
|---|---------|-------------|
| 1 | **Lead CRUD + Pipeline** | Create, edit, delete leads. 9-phase pipeline (New → Qualified → Demo → Proposal → Negotiation → PO Expected → PO Received, Lost, On Hold). Table + Kanban views |
| 2 | **User Management + Auth** | JWT authentication (jsonwebtoken + bcryptjs), 4 roles, team member isolation (BDs see only their own leads) |
| 3 | **Dashboard KPIs** | Total leads, active pipeline, won deals, conversion rate, pipeline value — with interactive recharts visualizations |
| 4 | **Basic Reporting** | Filter leads by date, BD, phase, source. Export to Excel (exceljs) or PDF (jspdf) |
| 5 | **Follow-up Tracking** | Next follow-up dates with overdue alerts and aging indicators (date-fns for date math) |
| 6 | **Activity Log** | Every change to a lead recorded with who, what, when |

> With just these 6 features, a sales team of 5–50 can replace their spreadsheets and start tracking pipeline on day one.

---

## MSP Features (Minimum Sellable Product)

These are the differentiators that make Geo Sales CRM worth paying for:

| # | Feature | Business Value |
|---|---------|---------------|
| 1 | **Multi-Business Architecture** | One deployment, unlimited business units. Each configures its own fields, services, and workflows. No per-BU infrastructure cost |
| 2 | **Confidence Scoring Engine** | Automated lead scoring based on stage progression and SLA adherence. Removes guesswork from pipeline forecasting |
| 3 | **Smart Reports with Charts** | BD Performance, Source Analysis, Monthly Trends, Campaign ROI — with interactive recharts bar, line, and pie charts. Managers get insights, not just data |
| 4 | **Notification Engine (16 Rules)** | Proactive alerts: stale leads, SLA breaches, follow-up overdue, confidence drops, pipeline below target, renewals due. Priority color-coded (red/amber/blue/green) |
| 5 | **Campaign ROI Tracking** | Link leads to marketing campaigns. Auto-calculate cost per lead, conversion rate, and ROI. Justify marketing spend with data |
| 6 | **Audit Trail** | Field-level change history with timeline UI. Required for compliance, invaluable for dispute resolution |
| 7 | **Customer Contact Directory** | Multi-contact per account with roles (Decision Maker, Technical POC, Procurement, Finance, Operations). Know who to call, not just which company |
| 8 | **Global Search** | One search bar to find anything across all modules. Reduces time-to-information from minutes to seconds |
| 9 | **@Mention Collaboration** | Tag teammates in notes across any module. Creates actionable notifications. Replaces "I sent you an email about that lead" |
| 10 | **Renewal & Expansion Tracking** | Automatic PO expiry monitoring. Renewal pipeline separate from new business. Prevents revenue leakage |
| 11 | **Task Board (Multi-Tab Kanban)** | Internal follow-up management beyond lead status. Track calls, visits, escalations. Per-BU boards |
| 12 | **Bulk Import + Validation** | Upload 500 leads at once with dry-run validation (xlsx parser). Auto-generate customer codes and location codes. Migrate from spreadsheets in minutes |
| 13 | **Granular RBAC** | 6 modules × 4 permission levels per user. Module-level enablement per BU. Defense-in-depth (server-enforced, not UI-only) |
| 14 | **Geographic Analytics** | India SVG choropleth heatmap (@svg-maps/india) on the dashboard. State-level pipeline rollup in forecast |
| 15 | **SSO-Ready** | Production SSO integration with portal handoff. Multi-account support for users across BUs. Zero-friction login |

---

## Tech Stack & Dependencies

### Backend (8 dependencies + 1 dev)

| Package | Version | Purpose |
|---------|---------|---------|
| **express** | ^4.19.2 | HTTP framework — routing, middleware, JSON parsing |
| **sequelize** | ^6.37.3 | ORM — models, migrations, associations, transactions |
| **mysql2** | ^3.11.0 | MySQL driver (Sequelize adapter) |
| **jsonwebtoken** | ^9.0.2 | JWT-based session authentication |
| **bcryptjs** | ^2.4.3 | Password hashing (dev-mode auth & SSO fallback) |
| **cors** | ^2.8.5 | Cross-origin request handling (dev proxy & production) |
| **dotenv** | ^16.4.5 | Environment variable management (.env files) |
| **multer** | ^1.4.5-lts.1 | File upload handling (PO documents, bulk import CSVs) |
| **nodemon** | ^3.1.4 | *(dev only)* Auto-restart on file changes |

### Frontend (13 dependencies)

| Package | Version | Purpose |
|---------|---------|---------|
| **react** | ^18.3.1 | UI component framework |
| **react-dom** | ^18.3.1 | DOM rendering engine |
| **react-router-dom** | ^6.26.1 | Client-side routing, deep-linking, URL search params |
| **react-scripts** | 5.0.1 | CRA build toolchain (Webpack, Babel, ESLint) |
| **axios** | ^1.7.2 | HTTP client — 60+ API functions with JWT interceptor |
| **recharts** | ^2.12.7 | Charting — bar, line, pie, area charts for reports & dashboard |
| **exceljs** | ^4.4.0 | Excel export — formatted workbooks with styling, multi-sheet |
| **jspdf** | ^2.5.2 | PDF generation — report & lead exports |
| **jspdf-autotable** | ^3.8.4 | PDF table formatting plugin for jsPDF |
| **xlsx** | ^0.18.5 | Excel/CSV parsing — bulk import file reading & validation |
| **date-fns** | ^3.6.0 | Date utilities — formatting, difference, relative time |
| **react-quill** | ^2.0.0 | Rich text editor — notes, descriptions, VOC entries |
| **@svg-maps/india** | ^2.0.0 | India SVG map data — geographic heatmap on dashboard |

### Infrastructure Requirements

| Component | Requirement |
|-----------|------------|
| **Runtime** | Node.js 18+ |
| **Database** | MySQL 8+ |
| **Process Manager** | PM2 (recommended) or systemd |
| **Reverse Proxy** | nginx (recommended) |
| **External Cloud Services** | **None required** |

---

## Architecture

```
                    ┌─────────────────┐
                    │   nginx / LB    │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
     ┌────────▼────────┐          ┌────────▼────────┐
     │  React 18 SPA    │          │  Express 4 API   │
     │  react-scripts    │          │  Port 4000       │
     │  Port 3001 (dev)  │   /api   │                  │
     │                   │ ──────► │  jsonwebtoken     │
     │  recharts         │          │  sequelize        │
     │  exceljs / jspdf  │          │  multer           │
     │  react-quill      │          │  bcryptjs         │
     │  axios            │          │  cors / dotenv    │
     └──────────────────┘          └────────┬─────────┘
                                            │
                                   ┌────────▼──────────┐
                                   │  MySQL 8 (mysql2)  │
                                   │  22 tables         │
                                   │  52 migrations     │
                                   └───────────────────┘
```

### Data Model (Key Tables)

| Table | Purpose | Typical Scale |
|-------|---------|--------------|
| `users` | Team members across all BUs | 10–500 |
| `leads` | Sales pipeline | 100–50,000 |
| `business_units` | Multi-tenant configuration | 5–50 |
| `activities` | Task board cards | 50–5,000 |
| `notifications` | Alert history | 500–100,000 |
| `change_log` | Audit trail | 1,000–500,000 |
| `contacts` | Customer contacts | 100–10,000 |
| `campaigns` | Marketing campaigns | 10–200 |
| `global_pos` | Chain/PO management | 10–500 |
| `vocs` | Voice of customer entries | 10–1,000 |

---

## Quick Start

### Prerequisites
- **Node.js** 18+
- **MySQL** 8+

### 1. Database
```sql
CREATE DATABASE geo_sales_crm CHARACTER SET utf8mb4;
```

### 2. Backend
```bash
cd backend
cp .env.example .env       # edit DB credentials + JWT_SECRET
npm install                 # installs: express, sequelize, mysql2, jsonwebtoken, bcryptjs, cors, dotenv, multer
npm run seed               # runs 52 SQL migrations + creates admin user
npm run dev                # starts API on http://localhost:4000 (nodemon auto-restart)
```

Health check: `curl http://localhost:4000/api/health`

### 3. Frontend
```bash
cd frontend
npm install                 # installs: react, axios, recharts, exceljs, jspdf, xlsx, react-quill, date-fns, @svg-maps/india
npm start                  # starts dev server on http://localhost:3001 (proxies /api → :4000)
```

Open `http://localhost:3001` and sign in.

> **Windows note:** if `npm start` fails with `options.allowedHosts[0] should be a non-empty string`, run:
> `$env:HOST='localhost'; $env:DANGEROUSLY_DISABLE_HOST_CHECK='true'; npm start`

### Environment Variables (backend/.env)

| Variable | Purpose |
|----------|---------|
| `DB_HOST` | MySQL host (default: `localhost`) |
| `DB_PORT` | MySQL port (default: `3306`) |
| `DB_NAME` | Database name |
| `DB_USER` | MySQL user |
| `DB_PASSWORD` | MySQL password |
| `PORT` | API port (default: `4000`) |
| `JWT_SECRET` | **Must change in production** — long random string |
| `JWT_EXPIRES_IN` | Session length (default: `8h`) |
| `UPLOAD_DIR` | PO document storage path (default: `uploads/`) |
| `SEED_ADMIN_EMAIL` | Initial admin email (used once by `npm run seed`) |
| `SEED_ADMIN_PASSWORD` | Initial admin password |
| `SEED_ADMIN_NAME` | Initial admin display name |
| `SEED_ADMIN_BU` | Initial admin business unit slug |

The frontend needs no `.env` in production when served from the same nginx origin as the API — relative `/api` calls just work. If frontend and backend are on different domains, set `REACT_APP_API_BASE` at build time.

---

## Production Deployment

### Build Frontend
```bash
cd frontend
npm run build              # creates optimized static build in build/
```

### Process Manager (PM2)
```bash
npm install -g pm2
cd backend
pm2 start server.js --name geo-sales-crm
pm2 save && pm2 startup    # survives reboots
```

Or as a **systemd** unit:
```ini
[Unit]
Description=Geo Sales CRM API
After=network.target mysql.service

[Service]
WorkingDirectory=/opt/geo-sales-crm/backend
ExecStart=/usr/bin/node server.js
Restart=always
EnvironmentFile=/opt/geo-sales-crm/backend/.env
User=www-data

[Install]
WantedBy=multi-user.target
```

### nginx Configuration
```nginx
server {
    listen 80;
    server_name crm.yourcompany.com;

    # React SPA (production build)
    root /opt/geo-sales-crm/frontend/build;
    index index.html;

    location / {
        try_files $uri /index.html;   # SPA fallback for react-router-dom
    }

    # API proxy → Express
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Uploaded PO documents (multer)
    location /uploads/ {
        proxy_pass http://127.0.0.1:4000;
    }

    client_max_body_size 25m;
}
```

Add TLS: `certbot --nginx -d crm.yourcompany.com`

### Database Backups
```bash
# Nightly backup (add to crontab)
mysqldump -u root geo_sales_crm | gzip > /backups/geo_sales_crm_$(date +%Y%m%d).sql.gz
```

---

## Adapting for Your Business

Geo Sales CRM is designed to be business-agnostic. Here's how to make it yours:

### 1. Create Your Business Unit
Log in as Global Admin → Business Units → **+ New Business Unit**. The wizard lets you:
- Name your business and set a brand color
- Choose which modules to enable (Leads, Dashboard, Reports, Task Board, VOC, Forecast)
- Define your field schema (which fields appear on the lead form)
- Configure your service catalog (what you sell)
- Set SLA targets per pipeline stage

### 2. Add Your Team
Settings → Users → **Add User**. Assign roles:
- **Global Admin** — full access to everything, can create business units
- **Business Admin** — full access within their BU
- **Manager (PMO)** — manages pipeline and team, cross-BD visibility
- **Team Member (BD)** — sees only their own leads (server-enforced isolation)

### 3. Configure Pipeline
The default 9-stage pipeline works for most B2B businesses:

```
New → Qualified → Demo → Proposal → Negotiation → PO Expected → PO Received
                                                                ↘ Lost
                                                                ↘ On Hold
```

### 4. Set Targets & SLAs
Settings → configure weekly/monthly pipeline targets per BD. SLA → set expected days per stage (powers confidence scoring and breach alerts).

### 5. Import Existing Data
Leads → **Bulk Import** → download XLSX template → fill in → upload. Dry-run validates before committing. Supports up to 500 rows per batch. The xlsx parser handles Excel and CSV formats.

---

## Who Is This For?

| Industry | Use Case |
|----------|----------|
| **IT Services & Solutions** | Track hardware + software deals through procurement cycles |
| **Security & Surveillance** | Manage device installations, chain-level PO pools, renewal tracking |
| **Manufacturing** | Pipeline management for B2B equipment sales with inventory forecasting |
| **Professional Services** | Consulting engagement tracking with multi-contact account management |
| **Real Estate (Commercial)** | Property deal pipeline with location-based analytics |
| **Telecom / ISPs** | Service subscription sales with renewal and SLA management |
| **Any B2B Sales Team** | Replace spreadsheets with a real pipeline tool — deploy in hours, not months |

---

## Project Structure

```
Geo-Sales-CRM/
├── backend/
│   ├── server.js                  # Express app entry point + route mounting
│   ├── package.json               # 8 deps: express, sequelize, mysql2, jsonwebtoken, bcryptjs, cors, dotenv, multer
│   ├── config/database.js         # Sequelize instance (mysql2 driver, dotenv config)
│   ├── models/index.js            # 14 Sequelize models + associations
│   ├── middleware/                 # JWT auth (jsonwebtoken), RBAC, module gates
│   ├── migrations/                # 52 versioned SQL files (schema source of truth)
│   ├── routes/                    # 15 route modules
│   │   ├── auth.js                # Login, SSO, profile, password (jsonwebtoken + bcryptjs)
│   │   ├── leads.js               # Lead CRUD, bulk import (multer + xlsx), export
│   │   ├── activities.js          # Task board tabs + cards
│   │   ├── notifications.js       # Bell, preferences, mark-read
│   │   ├── campaigns.js           # Campaign CRUD + ROI stats
│   │   ├── contacts.js            # Customer contact directory
│   │   ├── search.js              # Cross-module global search
│   │   ├── reports.js             # 6 smart report endpoints
│   │   ├── changeLog.js           # Audit trail API
│   │   ├── forecast.js            # Inventory pipeline
│   │   ├── globalPos.js           # Chain/PO management
│   │   ├── voc.js                 # Voice of customer
│   │   └── ...                    # users, settings, dropdowns, sla, uploads
│   ├── services/
│   │   ├── scoringEngine.js       # Confidence scoring formula
│   │   ├── mentions.js            # @mention parser + notifier
│   │   ├── auditTrail.js          # Field-level diff engine
│   │   ├── pricing.js             # TCV/ACV calculation
│   │   ├── leadCodes.js           # Auto-generated customer/location codes
│   │   ├── permissions.js         # RBAC engine
│   │   └── notifications/         # Dispatcher, scheduler, 16 rule types
│   ├── scripts/
│   │   ├── migrate.js             # SQL migration runner (tracks in schema_migrations)
│   │   ├── seed.js                # Initial data seeder (bcryptjs password hashing)
│   │   └── recompute.js           # Batch confidence score recalculation
│   └── uploads/                   # PO documents (multer destination, gitignored)
│
└── frontend/
    ├── package.json               # 13 deps: react, react-router-dom, axios, recharts, exceljs, jspdf, xlsx, date-fns, react-quill, @svg-maps/india
    └── src/
        ├── App.jsx                # react-router-dom v6 routes + route guards
        ├── context/AuthContext.jsx # Auth state + permission helpers (JWT from localStorage)
        ├── services/api.js        # 60+ API functions (one axios instance with JWT interceptor)
        ├── components/
        │   ├── Layout.jsx         # Sidebar + Global Search header
        │   ├── Sidebar.jsx        # Navigation + platform switcher
        │   ├── LeadForm.jsx       # 40+ field lead form
        │   ├── CustomLeadForm.jsx # Schema-driven form for custom BUs
        │   ├── KanbanView.jsx     # Drag-and-drop pipeline board
        │   ├── NotificationBell.jsx # Priority-colored notification center
        │   ├── GlobalSearch.jsx   # Cross-module search (axios + 300ms debounce)
        │   ├── AuditTimeline.jsx  # Field-level change history (date-fns relative time)
        │   ├── MentionTextarea.jsx # @mention-enabled text input
        │   ├── IndiaMap.jsx       # Geographic heatmap (@svg-maps/india)
        │   └── ...                # 15+ components
        ├── pages/
        │   ├── LeadsPage.jsx      # Pipeline — Table + Kanban (react-router-dom deep-linking)
        │   ├── DashboardPage.jsx  # Analytics & KPIs (recharts bar/line/pie/area)
        │   ├── ReportsPage.jsx    # 6 smart reports (recharts + exceljs + jspdf)
        │   ├── ActivitiesPage.jsx # Task Board
        │   ├── CampaignsPage.jsx  # Campaign management
        │   ├── CustomersPage.jsx  # Customer directory + contacts
        │   ├── ForecastPage.jsx   # Inventory pipeline (exceljs + jspdf export)
        │   ├── VocPage.jsx        # Voice of customer (react-quill rich text)
        │   └── ...                # Settings, Login, Admin
        └── utils/                 # Helpers, constants, export utilities (exceljs, jspdf-autotable)
```

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Database tables | 22 |
| SQL migrations | 52 |
| API endpoints | 60+ |
| Frontend components | 25+ |
| Backend dependencies | 8 production + 1 dev |
| Frontend dependencies | 13 |
| Notification rule types | 16 |
| Report types | 6 |
| Supported roles | 4 |
| Permission modules | 6 |
| Lead form fields | 40+ |
| External cloud services required | **0** |

---

## Roadmap

| Priority | Feature | Status |
|----------|---------|--------|
| Planned | Email integration (track sends, templates, sequences) | Designed |
| Planned | Quotation/Proposal PDF generation from lead data | Designed |
| Planned | Mobile responsive / PWA | Planned |
| Planned | Workflow automation (rule engine for auto-actions) | Planned |
| Planned | WhatsApp / SMS integration | Planned |
| Future | AI-powered insights (predictive scoring, next-best-action) | Roadmap |
| Future | ERP / Accounting integration (SAP, Tally) | Roadmap |
| Future | Customer self-service portal | Roadmap |
| Future | Multi-currency & localization | Roadmap |
| Future | Offline mode for field sales | Roadmap |

---

**Built for teams that sell. Deployed where you control it. Scales with your business.**

*Geo Sales CRM — Enterprise Sales Intelligence Platform*
