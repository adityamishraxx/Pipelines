// ---------------------------------------------------------------------------
// Forecast Dashboard — the single column registry shared by the on-screen detail
// table, the Excel export and the PDF export. Adding a column here makes it
// available everywhere, so the view and the exports can never drift apart.
//
// Each column declares how to render itself in both contexts:
//   cell(l)  → string for the on-screen table and the PDF (dashes for blanks)
//   excel(l) → the value written to the .xlsx cell (a real Number where numeric,
//              so Excel can sum/sort it rather than treating it as text)
//
// `locked: true` marks a column that can never be deselected — without at least
// the property name and its stage a forecast row is unidentifiable (and an empty
// table is unusable). The picker renders these checked and disabled.
// ---------------------------------------------------------------------------
import { fmtDate, fmtMonthYear } from './leadHelpers';

export const forecastUnits = (l) => l.hw_qty ?? l.device_qty ?? l.quantity ?? 0;

// Normalise any date-ish value to 'YYYY-MM-DD' for comparison, or '' when absent.
// Date inputs emit this format, so filters compare as plain strings.
const isoDate = (v) => {
  if (!v) return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const dash = (v) => (v === null || v === undefined || v === '') ? '—' : String(v);
// Money columns are stored in lakhs. Blank (not 0) when there is nothing priced,
// so an unpriced row reads as "no data" rather than "free".
const lakhCell = (v) => { const n = num(v); return n ? n.toFixed(2) : '—'; };
const lakhExcel = (v) => { const n = num(v); return n || ''; };

// Every column also declares how it filters:
//   filter      — the control type: 'text' | 'multi' | 'number' | 'date'
//   filterValue — the raw comparable value (NOT the formatted cell), so filtering
//                 works on the underlying data rather than on display strings.
export const FORECAST_COLUMNS = [
  // --- Identity (locked) ---
  { key: 'customer_name', label: 'Customer / Property', locked: true, default: true,
    cell: (l) => dash(l.customer_name), excel: (l) => l.customer_name || '',
    filter: 'text', filterValue: (l) => l.customer_name || '' },
  { key: 'phase', label: 'Stage', locked: true, default: true,
    cell: (l) => dash(l.phase), excel: (l) => l.phase || '',
    filter: 'multi', filterValue: (l) => l.phase || '' },

  // --- Location & ownership ---
  { key: 'city', label: 'City', default: true,
    cell: (l) => dash(l.city), excel: (l) => l.city || '',
    filter: 'multi', filterValue: (l) => l.city || '' },
  { key: 'state', label: 'State', default: true,
    cell: (l) => dash(l.state), excel: (l) => l.state || '',
    filter: 'multi', filterValue: (l) => l.state || '' },
  { key: 'business_unit', label: 'BU', default: true,
    cell: (l) => (l.business_unit || '').toUpperCase() || '—', excel: (l) => (l.business_unit || '').toUpperCase(),
    filter: 'multi', filterValue: (l) => (l.business_unit || '').toUpperCase() },
  { key: 'owner', label: 'BD', default: true,
    cell: (l) => l.owner?.name?.split(' ')[0] || '—', excel: (l) => l.owner?.name || '',
    filter: 'multi', filterValue: (l) => l.owner?.name || '' },

  // --- Hardware ---
  { key: 'hw_service', label: 'Hardware Item', default: true,
    cell: (l) => l.hw_service || 'Unspecified', excel: (l) => l.hw_service || 'Unspecified',
    filter: 'multi', filterValue: (l) => l.hw_service || 'Unspecified' },
  { key: 'units', label: 'Units', align: 'right', default: true,
    cell: (l) => String(forecastUnits(l)), excel: (l) => forecastUnits(l),
    filter: 'number', filterValue: (l) => forecastUnits(l) },

  // --- Dates ---
  { key: 'device_requested_date', label: 'Hardware Requested', default: true,
    cell: (l) => l.device_requested_date ? fmtDate(l.device_requested_date) : '—',
    excel: (l) => l.device_requested_date ? fmtDate(l.device_requested_date) : '',
    filter: 'date', filterValue: (l) => isoDate(l.device_requested_date) },
  { key: 'po_expected_date', label: 'PO Expected', default: true,
    cell: (l) => l.po_expected_date ? fmtMonthYear(l.po_expected_date) : 'Unscheduled',
    excel: (l) => l.po_expected_date ? fmtMonthYear(l.po_expected_date) : 'Unscheduled',
    filter: 'date', filterValue: (l) => isoDate(l.po_expected_date) },

  // --- Commercials (opt-in; derived server-side, see backend/routes/forecast.js) ---
  { key: 'price_tcv_lakhs', label: 'Service Cost (₹L)', align: 'right',
    cell: (l) => lakhCell(l.price_tcv_lakhs), excel: (l) => lakhExcel(l.price_tcv_lakhs),
    filter: 'number', filterValue: (l) => num(l.price_tcv_lakhs) },
  { key: 'potential_tcv_lakhs', label: 'Lead TCV (₹L)', align: 'right',
    cell: (l) => lakhCell(l.potential_tcv_lakhs), excel: (l) => lakhExcel(l.potential_tcv_lakhs),
    filter: 'number', filterValue: (l) => num(l.potential_tcv_lakhs) },
  { key: 'contract_period_months', label: 'Contract (months)', align: 'right',
    cell: (l) => dash(l.contract_period_months), excel: (l) => num(l.contract_period_months) ?? '',
    filter: 'number', filterValue: (l) => num(l.contract_period_months) },

  // --- Handoff tracking ---
  // Rendered as an interactive checkbox in the detail table (see renderRow in ForecastPage);
  // `cell` here is the text form used by the PDF export. filterValue is the word shown in the
  // filter list, so a user can pick Sent, Pending, or leave it off for all.
  { key: 'sent_to_scm', label: 'Sent to SCM', default: true, interactive: true,
    cell: (l) => (l.sent_to_scm ? 'Yes' : 'No'),
    excel: (l) => (l.sent_to_scm ? 'Yes' : 'No'),
    filter: 'multi', filterValue: (l) => (l.sent_to_scm ? 'Sent' : 'Pending') },

  // --- Classification ---
  { key: 'property_category', label: 'Property Category',
    cell: (l) => dash(l.property_category), excel: (l) => l.property_category || '',
    filter: 'multi', filterValue: (l) => l.property_category || '' },
  { key: 'new_or_renewal', label: 'Deal Type',
    cell: (l) => dash(l.new_or_renewal), excel: (l) => l.new_or_renewal || '',
    filter: 'multi', filterValue: (l) => l.new_or_renewal || '' },
  { key: 'confidence_score', label: 'Confidence %', align: 'right',
    cell: (l) => { const n = num(l.confidence_score); return n === null ? '—' : `${Math.round(n)}%`; },
    excel: (l) => { const n = num(l.confidence_score); return n === null ? '' : Math.round(n); },
    filter: 'number', filterValue: (l) => num(l.confidence_score) },
];

export const LOCKED_KEYS = FORECAST_COLUMNS.filter(c => c.locked).map(c => c.key);
export const DEFAULT_FORECAST_KEYS = FORECAST_COLUMNS.filter(c => c.default).map(c => c.key);

// Normalise a stored/selected key list: drop keys that no longer exist (the registry
// changed since the preference was saved), force the locked ones back in, and return
// them in registry order so the table layout is stable however they were clicked.
const KEY_MIGRATIONS = { device_sku: 'hw_service', iptv_price_lakhs: null };

export function normalizeColumnKeys(keys) {
  const migrated = (Array.isArray(keys) ? keys : []).map(k => KEY_MIGRATIONS.hasOwnProperty(k) ? KEY_MIGRATIONS[k] : k).filter(Boolean);
  const wanted = new Set([...migrated, ...LOCKED_KEYS]);
  return FORECAST_COLUMNS.filter(c => wanted.has(c.key)).map(c => c.key);
}

// The column objects for a set of keys, in registry order.
export function resolveColumns(keys) {
  const set = new Set(normalizeColumnKeys(keys));
  return FORECAST_COLUMNS.filter(c => set.has(c.key));
}

// ---------------------------------------------------------------------------
// Column filters
//
// Filter state is a flat map { [columnKey]: filterObject }, shaped by filter type:
//   text   → { q: 'taj' }
//   multi  → { values: ['Demo', 'Proposal'] }
//   number → { min: '10', max: '' }
//   date   → { from: '2026-01-01', to: '' }
//
// The map is keyed by column, NOT by visible column, and matchesFilters() walks the
// filter map rather than the visible set — so hiding a column keeps its filter
// applied, and re-showing it brings the control back with the value intact.
// ---------------------------------------------------------------------------
export const emptyFilterFor = (type) => {
  switch (type) {
    case 'text': return { q: '' };
    case 'multi': return { values: [] };
    case 'number': return { min: '', max: '' };
    case 'date': return { from: '', to: '' };
    default: return null;
  }
};

// Is this filter actually narrowing anything? An all-blank filter is inert.
export function isFilterActive(type, f) {
  if (!f) return false;
  switch (type) {
    case 'text': return !!(f.q && f.q.trim());
    case 'multi': return Array.isArray(f.values) && f.values.length > 0;
    case 'number': return f.min !== '' || f.max !== '';
    case 'date': return !!(f.from || f.to);
    default: return false;
  }
}

// Only the entries that are actually narrowing, so callers can count/label them.
export function activeFilterKeys(filters) {
  return FORECAST_COLUMNS.filter(c => isFilterActive(c.filter, filters?.[c.key])).map(c => c.key);
}

// AND across every active column filter. A row must satisfy all of them.
export function matchesFilters(lead, filters) {
  if (!filters) return true;
  for (const col of FORECAST_COLUMNS) {
    const f = filters[col.key];
    if (!isFilterActive(col.filter, f)) continue;
    const v = col.filterValue(lead);
    switch (col.filter) {
      case 'text':
        if (!String(v ?? '').toLowerCase().includes(f.q.trim().toLowerCase())) return false;
        break;
      case 'multi':
        if (!f.values.includes(String(v ?? ''))) return false;
        break;
      case 'number': {
        // A row with no value can't sit inside a numeric range.
        if (v === null || v === undefined || v === '') return false;
        const n = Number(v);
        if (!Number.isFinite(n)) return false;
        if (f.min !== '' && n < Number(f.min)) return false;
        if (f.max !== '' && n > Number(f.max)) return false;
        break;
      }
      case 'date': {
        // Undated rows (e.g. "Unscheduled" PO dates) fall outside any range.
        if (!v) return false;
        if (f.from && v < f.from) return false;
        if (f.to && v > f.to) return false;
        break;
      }
      default: break;
    }
  }
  return true;
}

// Distinct values present in the data for a multi-select column, so the options
// offered always reflect what's actually there. Blanks collapse to one '—' entry.
export function optionsForColumn(col, leads) {
  const seen = new Set();
  for (const l of leads) seen.add(String(col.filterValue(l) ?? ''));
  return [...seen].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
}
