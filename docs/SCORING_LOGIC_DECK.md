# Sales CRM — Scoring Logic
### Presentation deck (slide-by-slide content)

> Source of truth: `backend/services/scoring.js` (formula) · `backend/services/scoringEngine.js` (engine) · `frontend/src/utils/leadHelpers.js` (priority score)

---

## Slide 1 — Two Scores, Two Jobs

| | **Lead Confidence Score** | **Lead Priority Score** |
|---|---|---|
| **Question it answers** | "How likely is this deal to close?" | "Which deal deserves attention first?" |
| **Range** | 0 – 95 % | 0 – 100 |
| **Driven by** | Stage reached + SLA discipline | Deal size, stage, deal type, momentum |
| **Computed** | Server-side, stored on the lead | Client-side, at render time |
| **Where it shows** | Lead badge, Kanban chip, Pipeline Confidence card | Lead-source performance comparison |

**Headline:** confidence measures *health of the deal*; priority measures *value of the deal*.

---

## Slide 2 — Lead Confidence Score: The Core Idea

**Three principles**

1. **Progress earns confidence** — every stage carries a fixed base weight.
2. **Silence destroys it** — miss a stage SLA and you lose exactly what advancing would have won.
3. **Nothing is manual** — the score recomputes itself; no one types a percentage.

> A lead is never "stable". It either moves forward or it decays.

---

## Slide 3 — Stage Base Weights (fixed, global)

| Stage | Base Confidence |
|---|---|
| New | 5 % |
| Qualified | 25 % |
| Demo | 40 % |
| Proposal | 48 % |
| Negotiation | 60 % |
| PO Expected | 75 % |
| **PO Received** | **95 %** |

- Identical across all three platforms (Signage / JHES / Surveillance) — one common yardstick.
- PO Received caps at 95 %, not 100 % — PO validity and execution risk remain.

---

## Slide 4 — The "Hourglass" Jump Values

The gain from advancing one stage — and the penalty for stalling in it.

| Transition | Jump |
|---|---|
| New → Qualified | 20 |
| Qualified → Demo | 15 |
| Demo → Proposal | 8 |
| Proposal → Negotiation | 12 |
| Negotiation → PO Expected | 15 |
| PO Expected → PO Received | 20 |

Sequence: **20 · 15 · 8 · 12 · 15 · 20** — wide at both ends, narrowest at Proposal.

**Why the shape:** qualifying a lead and landing the PO are the decisive moves. The Demo → Proposal step is largely administrative, so it is worth — and costs — the least.

**Design elegance:** the jump equals the base-weight gap. *The penalty for missing an SLA is precisely the confidence forfeited by not advancing.*

---

## Slide 5 — SLA / TAT Table (the only configurable input)

| Stage | Default TAT |
|---|---|
| New | 2 days |
| Qualified | 5 days |
| Demo | 7 days |
| Proposal | 7 days |
| Negotiation | 15 days |
| PO Expected | 7 days |
| | **43 days end-to-end** |

- Set **independently per platform** — Signage, JHES and Surveillance can each tune their own cycle.
- Editable by **Business Admin / PMO** only; validated to 1–365 days.
- Base weights and jumps are **not** editable — they are code constants, so the score stays comparable across the business.
- Saving a new TAT triggers an immediate recompute of every lead on that platform.

---

## Slide 6 — The Decay Mechanism (step function)

**Clock:** `d` = days since the lead's last activity. Any save, update or stage change resets `d` to 0.

**Checkpoints:** starting at the current stage, the SLAs of the *following* stages are chained:

```
T1 = SLA(current stage)
T2 = T1 + SLA(next stage)
T3 = T2 + SLA(stage after next)   ... and so on
```

**Rule:** every checkpoint crossed subtracts that stage's jump value.

```
Confidence = Base(current stage) − Σ jumps for every checkpoint crossed
```

Floored at **2 %** — a decayed-but-alive lead stays visually distinct from a Lost lead at 0 %.

**In plain English:** a lead that has sat idle long enough for the *next* stage's SLA to have elapsed too is treated as having lost that stage's worth of confidence as well. Neglect compounds.

---

## Slide 7 — Worked Example: A Lead Stuck in "Qualified"

Base 25 % · Qualified SLA 5d · Demo 7d · Proposal 7d

| Days idle | Checkpoint crossed | Deduction | Confidence |
|---|---|---|---|
| 0 – 4 | — (within SLA) | — | **25 %** |
| 5 – 11 | T1 = 5d (Qualified SLA) | −15 | **10 %** |
| 12 – 18 | T2 = 12d (+ Demo SLA) | −8 | **2 %** |
| 19 + | T3 = 19d (+ Proposal SLA) | −12 | **2 %** (floor) |

**Talking point:** a Qualified lead left untouched for under a week loses **60 % of its confidence**. The decay is deliberately steep and early — it forces the follow-up.

---

## Slide 8 — Special States

| State | Behaviour | Rationale |
|---|---|---|
| **Lost** | Hard override → **0 %** | Stage and timing become irrelevant |
| **PO Received** | Locked at **95 %**, no decay | Terminal — nothing left to chase |
| **On Hold** | **Frozen** at the value on entry | A genuine customer-side pause shouldn't be punished |
| **Resume from Hold** | Restarts at the stage base weight | Clean slate, fresh SLA clock |

**On Hold guard-rails**

- Confidence, entry timestamp and pre-hold stage are all captured at freeze.
- A default 60-day hold end-date is set if none is given.
- All held leads appear on a dedicated dashboard ticker — freezing is visible, not a hiding place.

---

## Slide 9 — Bands & Week-over-Week Trend

**Confidence bands** (drive badge colour and list filtering)

| Band | Range | Colour |
|---|---|---|
| High | ≥ 60 % | Green |
| Medium | 30 – 59 % | Amber |
| Low | < 30 % | Grey |

**Trend indicator** — current score vs. a baseline that rolls forward every 7 days

| Mark | Meaning |
|---|---|
| ▲ | Improved vs. last week |
| ▼ | Declined vs. last week |
| ● | No change |
| ❄ | Frozen (On Hold) |

This turns a static number into **direction of travel** — the dashboard surfaces "leads losing confidence this week" as a standing action list.

---

## Slide 10 — Fully Automated Refresh

| Trigger | Scope | Effect |
|---|---|---|
| **Lead saved / stage changed** | That lead | Recompute + reset the decay clock |
| **Hourly scheduled job** | Every lead | Apply time-based decay |
| **TAT changed in Settings** | Every lead on that platform | Immediate recompute |
| **`npm run recompute` (cron)** | Every lead | Production batch job |

**Zero manual intervention.** No user can set, nudge or override a confidence score — it is derived entirely from stage and SLA behaviour. That is what makes it usable in a review meeting.

---

## Slide 11 — Lead Priority Score (0–100)

A separate weighted score used to rank and compare lead quality.

| Component | Weight | Scoring |
|---|---|---|
| **Deal Size** | 40 % | Top 20 % by TCV → 100 · Middle 60 % → 60 · Bottom 20 % → 30 |
| **Phase** | 30 % | PO Received 100 · PO Expected 90 · Negotiation 85 · Proposal 70 · Demo 55 · Qualified 40 · New 20 · On Hold 15 |
| **Deal Type** | 15 % | Renewal / Expansion → 90 · New → 60 |
| **Recency / Momentum** | 15 % | Base 60 · overdue follow-up −20 · PO expected within 30 days +15 |

```
Score = (DealSize × 0.40) + (Phase × 0.30) + (DealType × 0.15) + (Recency × 0.15)
```

- Deal size is **percentile-ranked against the live pipeline** — every lead is judged against the same population, not a hard-coded rupee threshold.
- Lost leads are excluded entirely (no score).
- Currently powers the **Lead Source performance** comparison — average score by Channel Partner / KAM / Direct Sales.

---

## Slide 12 — Why This Design Holds Up

| Property | How it is achieved |
|---|---|
| **Objective** | Fully derived — no manual entry, no sales optimism |
| **Comparable** | Weights are global constants across all platforms |
| **Locally tunable** | Each platform owns its own TAT windows |
| **Governed** | TAT edits restricted to Business Admin / PMO, range-validated |
| **Actionable** | Bands + trend arrows convert the score into a daily worklist |
| **Verified** | Formula is a pure, DB-free module with a full unit-test suite |

**Closing line:** the score isn't a forecast to argue about — it is a mirror of how the pipeline is actually being worked.

---
---

# Appendix A — Formal Definition

For a lead at stage `Sᵢ` with `d` = days since last activity:

```
              ⎧ 0                                        if phase = Lost
              ⎪ frozen_value                             if phase = On Hold
Confidence =  ⎨ Base(Sᵢ)                                 if phase = PO Received
              ⎪
              ⎩ max( FLOOR, Base(Sᵢ) − Σ Jump(Sᵢ₊ₖ) )    otherwise
                                       k : d ≥ Tₖ

where   Tₖ = Σ SLA(Sᵢ₊ⱼ)   for j = 0..k
        FLOOR = 2
```

Deductions accumulate over the **contiguous prefix** of crossed checkpoints and stop at PO Expected (PO Received is terminal and carries no SLA).

---

# Appendix B — Data Model

**On each lead**

| Column | Purpose |
|---|---|
| `last_activity_at` | Anchor for the decay clock |
| `confidence_score` | Current computed % |
| `confidence_prev` | ~1-week-ago baseline (trend arrow) |
| `confidence_prev_at` | When the baseline was last rolled |
| `confidence_computed_at` | Last recompute timestamp |
| `hold_frozen_confidence` | Value captured at hold entry |
| `hold_entered_at` / `hold_end_date` | Hold window |
| `pre_hold_stage` | Stage to restore on resume |

**Config table** — `sla_config` : `(business_unit, stage) → sla_days`, unique per pair, seeded with the default table for all three platforms.

---

# Appendix C — Suggested Visual for Slides 6–7

A descending step-chart: x-axis = days idle, y-axis = confidence %.

```
 25% ┤━━━━━━┓
     │      ┃
 10% ┤      ┗━━━━━━━━━┓
     │                ┃
  2% ┤                ┗━━━━━━━━━━━━━━━━━━━  (floor)
     └──┬───┬─────────┬─────────┬──────────
        0   5        12        19   days idle
            ▲         ▲         ▲
        Qualified   + Demo   + Proposal
        SLA breach   SLA        SLA
```

The staircase is the most persuasive visual in the deck — it shows decay is **not** a gentle linear slide but a series of cliffs, each tied to a named SLA breach.
