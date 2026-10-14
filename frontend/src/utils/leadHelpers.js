import { PHASE_DATE_MAP, TAT_DAYS, ALL_SERVICES } from './constants';

// Auto-calculated Total Contract Value, in lakhs (₹ / 100,000), from a lead/form's ticked services:
//   opex  → qty × rate × contract months   (recurring)
//   capex → qty × rate                      (one-time)
// The device line uses its per-lead cost type (form.device_cost_type, default capex). Returns ''
// when nothing is calculable (no services, or missing rate/qty), so callers can show a blank field.
// Mirror of computeTcvLakhs() in backend/routes/leads.js — keep the two formulas in sync.
// Split the ticked services into OPEX (recurring) and CAPEX (one-time) parts, both in lakhs.
// Mirror of computeTcvBreakdown() in backend/routes/leads.js — keep the two in sync.
export function computeTcvBreakdown(form) {
  const months = parseInt(form.contract_period_months, 10) || 0;
  let opex = 0, capex = 0;
  const add = (included, rate, qty, nature) => {
    if (!included) return;
    const r = parseFloat(rate) || 0;
    const q = parseInt(qty, 10) || 0;
    if (!r || !q) return;
    if (nature === 'opex') opex += r * q * months; else capex += r * q;
  };
  for (const svc of ALL_SERVICES) {
    add(form[`includes_${svc.key}`], form[`${svc.key}_rate`], form[`${svc.key}_qty`], svc.nature);
  }
  add(form.includes_device, form.device_rate, form.device_qty, form.device_cost_type === 'opex' ? 'opex' : 'capex');
  return { opexLakhs: opex / 100000, capexLakhs: capex / 100000 };
}

export function computeTcvLakhs(form) {
  const { opexLakhs, capexLakhs } = computeTcvBreakdown(form);
  const tcv = opexLakhs + capexLakhs;
  return tcv > 0 ? +tcv.toFixed(2) : '';
}

// The contract value used for PRIORITIZATION (see utils/leadPriority.js) — deliberately
// narrower than computeTcvLakhs: the JHES platform line plus the device line, with IPTV
// excluded. Always derived from the current rate/qty fields rather than the stored
// potential_tcv_lakhs, so the ranking can't be skewed by a stale or hand-typed total.
//
// Forecast rows arrive with this already derived server-side as `price_tcv_lakhs` (the
// forecast API withholds raw rates), so that value is used when present. Mirror of
// priceFields() in backend/routes/forecast.js — keep the two in sync.
export function priorityTcvLakhs(lead) {
  if (lead == null) return 0;
  const pre = parseFloat(lead.price_tcv_lakhs);
  if (Number.isFinite(pre)) return pre;

  const months = parseInt(lead.contract_period_months, 10) || 0;
  const line = (included, rate, qty, nature) => {
    if (!included) return 0;
    const r = parseFloat(rate) || 0;
    const q = parseInt(qty, 10) || 0;
    if (!r || !q) return 0;
    return (nature === 'opex' ? r * q * months : r * q) / 100000;
  };
  const jhes = line(lead.includes_jhes, lead.jhes_rate, lead.jhes_qty, 'opex');
  const device = line(lead.includes_device, lead.device_rate, lead.device_qty, lead.device_cost_type === 'opex' ? 'opex' : 'capex');
  const total = jhes + device;
  return total > 0 ? +total.toFixed(2) : 0;
}

// First-year Annual Contract Value in lakhs. OPEX is annualised across the contract term; CAPEX
// (one-time) is realised in full in year 1. For a hand-typed TCV (no service breakdown, e.g. JHES)
// the whole value is annualised evenly. Returns null when it can't be computed.
export function computeAcvLakhs(form, { manual, manualTcv } = {}) {
  const months = parseInt(form.contract_period_months, 10) || 0;
  const years = months ? months / 12 : 0;
  if (manual) {
    const tcv = parseFloat(manualTcv) || 0;
    if (!tcv || !years) return null;
    return +(tcv / years).toFixed(2);
  }
  const { opexLakhs, capexLakhs } = computeTcvBreakdown(form);
  if (opexLakhs + capexLakhs <= 0) return null;
  const opexPerYear = years ? opexLakhs / years : opexLakhs;
  return +(opexPerYear + capexLakhs).toFixed(2);
}

// Additional Notes is stored as rich-text HTML (react-quill). Strip tags for
// plain-text contexts (Excel/PDF cells) so exports don't show raw markup.
export function stripHtml(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent || div.innerText || '').trim();
}

// --- Contact (POC) helpers for exports --------------------------------------------------------
// A lead can have several POCs (lead.contacts); the first is treated as the primary. These render
// them for Excel so single-contact leads (the common case) read cleanly in dedicated columns while
// multi-contact leads keep every contact rather than silently dropping the extras.

// The primary contact's fields as a { name, phone, email, designation } object, blanks when absent.
export function primaryContact(lead) {
  const c = (lead && Array.isArray(lead.contacts) && lead.contacts[0]) || {};
  return {
    name: c.name || '',
    phone: c.phone || '',
    email: c.email || '',
    designation: c.designation || '',
  };
}

// One contact as a compact single-cell string: "Name (Designation) · phone · email".
export function formatContact(c) {
  if (!c) return '';
  const bits = [];
  if (c.name) bits.push(c.designation ? `${c.name} (${c.designation})` : c.name);
  if (c.phone) bits.push(c.phone);
  if (c.email) bits.push(c.email);
  return bits.join(' · ');
}

// Every POC on the lead, one per line — for a single "All Contacts" export cell.
export function formatAllContacts(lead) {
  const list = (lead && Array.isArray(lead.contacts)) ? lead.contacts : [];
  return list.map(formatContact).filter(Boolean).join('\n');
}

// Contacts after the primary, one per line — populated only when a lead has more than one POC, so
// the dedicated primary-contact columns stay the everyday view.
export function formatOtherContacts(lead) {
  const list = (lead && Array.isArray(lead.contacts)) ? lead.contacts.slice(1) : [];
  return list.map(formatContact).filter(Boolean).join('\n');
}

export function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
export function fmtMonthYear(d) {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}
export function daysBetween(a, b) {
  const ms = new Date(b).setHours(0,0,0,0) - new Date(a).setHours(0,0,0,0);
  return Math.round(ms / 86400000);
}
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function addDaysStr(dateStr, days) {
  const [y,m,d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}

export function isTATBreached(lead) {
  if (['PO Expected', 'PO Received', 'Lost', 'On Hold'].includes(lead.phase)) return false;
  const dateKey = PHASE_DATE_MAP[lead.phase];
  const dateStr = lead.phase_changed_at || (dateKey ? lead[dateKey] : null) || lead.createdAt;
  if (!dateStr) return false;
  return daysBetween(dateStr, new Date()) > TAT_DAYS;
}

// Days the lead has sat in its CURRENT phase (since the last phase change, else since creation).
export function daysInStage(lead) {
  const dateStr = lead.phase_changed_at || lead.createdAt;
  if (!dateStr) return null;
  return Math.max(0, daysBetween(dateStr, new Date()));
}

// Aging of a lead relative to its stage's TAT target. tatMap = { [stage]: tat_days }.
// Returns { days, target, level } with level 'ok' | 'warn' | 'over' | null:
//   ok   = within the stage target (green)
//   warn = past the target, up to 2x (amber)
//   over = more than 2x the target (red)
//   null = no aging (closed/paused phases) or no target configured for the stage (neutral)
// Closed/terminal phases (PO Received, Lost) and the paused On Hold phase carry no aging.
export function stageAging(lead, tatMap) {
  if (['PO Received', 'Lost', 'On Hold'].includes(lead.phase)) return { days: null, target: null, level: null };
  const days = daysInStage(lead);
  if (days === null) return { days: null, target: null, level: null };
  const target = (tatMap && tatMap[lead.phase] != null) ? Number(tatMap[lead.phase]) : null;
  let level = null;
  if (target != null) level = days > target * 2 ? 'over' : days > target ? 'warn' : 'ok';
  return { days, target, level };
}

// Renewal radar, keyed on PO End Date (service_end_date) for WON POs (phase PO Received).
// Build a Set of lead IDs that have been renewed (some other lead points to them via renewed_from_lead_id).
// Pass this set into renewalStatus so renewed POs show "Renewed" instead of expiry warnings.
export function buildRenewedSet(leads) {
  const s = new Set();
  for (const l of leads) if (l.renewed_from_lead_id) s.add(l.renewed_from_lead_id);
  return s;
}

// Returns { days, band } or null (not a won PO, or no PO End Date). `days` is signed: positive =
// days until expiry, negative = days since it lapsed. Bands drive the traffic-light colours:
//   renewed (PO has been renewed — stop nagging)
//   expired (<0) · red (≤30 / 1mo) · amber (≤60 / 2mo) · yellow (≤90 / 3mo) · ok (>90, far out)
export function renewalStatus(lead, renewedIds) {
  if (lead.phase !== 'PO Received') return null;
  // If this PO has already been renewed, short-circuit — no expiry warning needed.
  if (renewedIds && renewedIds.has(lead.id)) return { days: null, band: 'renewed' };
  const end = lead.service_end_date;
  if (!end) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const endD = new Date(end); endD.setHours(0, 0, 0, 0);
  if (isNaN(endD.getTime())) return null;
  const days = Math.round((endD - today) / 86400000);
  let band;
  if (days < 0) band = 'expired';
  else if (days <= 30) band = 'red';
  else if (days <= 60) band = 'amber';
  else if (days <= 90) band = 'yellow';
  else band = 'ok';
  return { days, band };
}

// Colours for each renewal band (yellow → amber → red → dark-red Expired; ok = neutral; renewed = green).
export const RENEWAL_BAND_STYLE = {
  yellow:  { bg: '#fef08a', fg: '#854d0e', border: '#fde047' },
  amber:   { bg: '#fdba74', fg: '#9a3412', border: '#fb923c' },
  red:     { bg: '#fca5a5', fg: '#991b1b', border: '#f87171' },
  expired: { bg: '#7f1d1d', fg: '#ffffff', border: '#7f1d1d' },
  ok:      { bg: '#f1f5f9', fg: '#64748b', border: '#e2e8f0' },
  renewed: { bg: '#dcfce7', fg: '#0a84ff', border: '#86efac' },
};

// Human label for a renewal status badge, e.g. "Due in 47d" / "Expired 12d ago" / "Renewed".
export function renewalLabel(status) {
  if (!status) return '';
  if (status.band === 'renewed') return 'Renewed';
  if (status.band === 'expired') return `Expired ${Math.abs(status.days)}d ago`;
  return `Due in ${status.days}d`;
}

export function isOverdue(lead) {
  if (!lead.next_followup_date) return false;
  if (['Lost', 'PO Received', 'On Hold'].includes(lead.phase)) return false;
  return new Date(lead.next_followup_date) < new Date();
}

export function getPOExpiryDays(lead) {
  if (!lead.po_received_date || !lead.po_validity_months) return null;
  const expiry = new Date(lead.po_received_date);
  expiry.setMonth(expiry.getMonth() + lead.po_validity_months);
  return daysBetween(new Date(), expiry);
}

// --- Lead Confidence Score (server-computed; see backend/services/scoring.js) -----------------
// The confidence % lives on the lead as `confidence_score` (current) and `confidence_prev`
// (~1-week-ago baseline). These helpers format it and derive the week-over-week trend arrow.
export function hasConfidence(lead) {
  return lead && lead.confidence_score !== null && lead.confidence_score !== undefined;
}
// 'up' | 'down' | 'flat' — current vs the weekly baseline. On Hold reads as 'hold' (frozen).
export function confidenceTrend(lead) {
  if (!lead || lead.phase === 'On Hold') return 'hold';
  const cur = lead.confidence_score, prev = lead.confidence_prev;
  if (cur === null || cur === undefined || prev === null || prev === undefined) return 'flat';
  const c = Number(cur), p = Number(prev);
  if (c > p + 0.01) return 'up';
  if (c < p - 0.01) return 'down';
  return 'flat';
}

// Phase → progression score (30% weight). Lost is excluded from scoring entirely.
const PHASE_SCORE = {
  'PO Received': 100, 'PO Expected': 90, Negotiation: 85, Proposal: 70,
  Demo: 55, Qualified: 40, New: 20, 'On Hold': 15,
};

// Deal-size percentile cut-offs (20th / 80th) of Potential TCV across all non-Lost leads in the
// pipeline. Pass the result to calcLeadScore so every lead is ranked against the same population.
export function dealSizeThresholds(leads) {
  const tcvs = leads
    .filter(l => l.phase !== 'Lost')
    .map(l => parseFloat(l.potential_tcv_lakhs) || 0)
    .sort((a, b) => a - b);
  const n = tcvs.length;
  if (!n) return { p20: 0, p80: 0, n: 0 };
  const at = (p) => tcvs[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))];
  return { p20: at(0.2), p80: at(0.8), n };
}

// Weighted lead score (0–100). Returns null for Lost leads (caller greys the row, shows no score).
//   Deal Size 40%  — Top 20% by TCV → 100, Middle 60% → 60, Bottom 20% → 30
//   Phase     30%  — see PHASE_SCORE
//   Deal Type 15%  — Renewal/Expansion → 90, New → 60
//   Recency   15%  — base 60; overdue follow-up −20; PO expected within 30 days +15; clamped 0–100
export function calcLeadScore(lead, thresholds) {
  if (lead.phase === 'Lost') return null;

  // Deal Size (40%). Needs enough spread to rank meaningfully; otherwise everyone is "middle".
  const tcv = parseFloat(lead.potential_tcv_lakhs) || 0;
  let dealSize = 60;
  if (thresholds && thresholds.n >= 3 && thresholds.p80 > thresholds.p20) {
    if (tcv >= thresholds.p80) dealSize = 100;
    else if (tcv <= thresholds.p20) dealSize = 30;
    else dealSize = 60;
  }

  // Phase (30%)
  const phase = PHASE_SCORE[lead.phase] ?? 20;

  // Deal Type (15%) — Renewal and Expansion are existing-customer growth → 90; New → 60.
  const dealType = (lead.new_or_renewal === 'Renewal' || lead.new_or_renewal === 'Expansion') ? 90 : 60;

  // Recency / Momentum (15%)
  let recency = 60;
  if (lead.next_followup_date && new Date(lead.next_followup_date) < new Date()) recency -= 20;
  if (lead.po_expected_date) {
    const d = daysBetween(new Date(), lead.po_expected_date);
    if (d >= 0 && d <= 30) recency += 15;
  }
  recency = Math.min(100, Math.max(0, recency));

  const score = dealSize * 0.40 + phase * 0.30 + dealType * 0.15 + recency * 0.15;
  return Math.round(Math.min(100, Math.max(0, score)));
}

// Build stage-age + team-average lookup from raw stage_history rows.
export function buildRotMetrics(history) {
  const byLead = {};
  for (const sh of history) (byLead[sh.lead_id] ||= []).push(sh);
  const stageDurations = {};
  const lastEntry = {};
  for (const [leadId, list] of Object.entries(byLead)) {
    const sorted = [...list].sort((a,b) => new Date(a.changed_at) - new Date(b.changed_at));
    lastEntry[leadId] = sorted[sorted.length - 1];
    for (let i = 0; i < sorted.length - 1; i++) {
      const stage = sorted[i].to_stage;
      const days = daysBetween(sorted[i].changed_at, sorted[i+1].changed_at);
      if (days >= 0) (stageDurations[stage] ||= []).push(days);
    }
  }
  const teamAvg = {};
  for (const stage of Object.keys(stageDurations)) {
    const arr = stageDurations[stage];
    teamAvg[stage] = arr.length ? Math.round(arr.reduce((s,d) => s+d, 0) / arr.length) : null;
  }
  return { lastEntry, teamAvg, stageDurations };
}

export function getRotState(lead, lastEntry, teamAvg) {
  if (['PO Received', 'Lost', 'On Hold'].includes(lead.phase)) return null;
  const entry = lastEntry[lead.id];
  const since = entry ? new Date(entry.changed_at) : new Date(lead.phase_changed_at || lead.createdAt);
  const ageDays = daysBetween(since, new Date());
  const avg = teamAvg[lead.phase];
  const threshold = avg && avg > 0 ? avg * 2 : 30;
  if (ageDays < threshold) return null;
  return { ageDays, threshold, severity: ageDays >= threshold * 1.5 ? 'red' : 'amber' };
}
