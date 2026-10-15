<div align="center">

# Pipelines

### The sales CRM your whole company can run on — from the first lead to the final PO.

*Multi-business. Beautifully simple. Yours to brand, deploy, and own.*

</div>

---

## Why Pipelines

Most CRMs are either too heavy (months of setup, a consultant on speed-dial) or too light (a glorified
contact list). **Pipelines sits exactly in the middle**: powerful enough to run real, multi-stage B2B
sales across several business lines — yet clean enough that a new rep is productive on day one.

It was built by an operator who lived the problem: scattered spreadsheets, "where is this deal?" status
calls, forecasts that were out of date the moment they were made. Pipelines replaces all of that with a
single, opinionated source of truth for your revenue.

> You open it. You create your first business. You start selling. That's the whole onboarding.

---

## What you get

| | |
|---|---|
| **🧭 A real sales pipeline** | Every opportunity flows through clear stages — New → Qualified → Demo → Proposal → Negotiation → PO Received — with drag-and-drop Kanban and a sortable table view. |
| **🤖 Lead Confidence Scoring** | Each deal gets a live health score that decays when it goes quiet and reacts to stage SLAs — so your team always knows which deals are slipping, *before* they're lost. |
| **🏢 Multiple businesses, one login** | Run Signage, Services, Surveillance — or any lines you define — as separate businesses, each with its own team, services, and pipeline, under one roof. |
| **👥 Roles that fit your org** | Global Admin, Business Admin, Manager, and Business Development, with per-module access control. People see exactly what they should. |
| **📦 Inventory Pipeline** | Hardware and device demand rolls up automatically from won deals, so supply chain sees what's coming. |
| **📣 Campaigns & ROI** | Tie leads to campaigns and see spend-vs-revenue ROI without a spreadsheet. |
| **🗣️ Voice of Customer** | Capture feature gaps and competitive intel straight from the field into your product roadmap. |
| **📊 Dashboards & reports** | Funnels, conversion, BD performance, source analysis, monthly trends — and one-click Excel / PDF export. |
| **✅ Activity & task boards, @mentions, notifications** | Keep follow-ups, tasks, and nudges in the flow of work. |
| **🔁 Bulk import & customer hierarchy** | Onboard existing data fast; see every customer, location, and PO in one tree. |

---

## Built to be *yours*

- **Brandable from day one.** Ships as a clean slate — no sample companies, no dummy data. Your name,
  your businesses, your pipeline.
- **Self-serve setup.** The first person to open the app creates the admin account. No installer, no
  config files to hand-edit.
- **Full control.** The Global Admin adds businesses and people and sets or resets anyone's password.
- **Factory reset built in.** One guarded button returns the product to a pristine, just-installed state
  — perfect for re-deploying for a new customer or starting over.

---

## Built on a modern, boring-in-the-best-way stack

Pipelines is a clean three-tier app you can host **for free** and scale when you need to:

- **Frontend** — React (SPA), deploys to **Vercel** in a click.
- **Backend** — Node.js + Express REST API, deploys to **Render**.
- **Database** — **PostgreSQL** (we recommend **Supabase** — free tier, instant, fully managed).

No vendor lock-in, no proprietary runtime. Standard Postgres, standard Node, standard React. Your data
is yours, in a database you control, and the whole thing runs on infrastructure you can read the bill for.

**Secure by default:** JWT authentication, bcrypt-hashed passwords, role-based access throughout, and
secrets kept in environment variables — never in the code.

---

## Go live in an afternoon

1. **Database** — create a free Supabase project. → see `SUPABASE_SETUP.md`
2. **Backend** — deploy to Render (one blueprint file included). → see `DEPLOYMENT.md`
3. **Frontend** — deploy to Vercel (config included). → see `DEPLOYMENT.md`

Prefer to try it on your laptop first? `RUN_LOCALLY.md` has you up and running in minutes.

---

## Repository layout

```
backend/    Express + Sequelize REST API (PostgreSQL)
frontend/   React single-page app
docs/        Product & architecture notes
SUPABASE_SETUP.md   DEPLOYMENT.md   RUN_LOCALLY.md
```

---

<div align="center">

**Pipelines** — stop managing spreadsheets. Start closing pipeline.

</div>
