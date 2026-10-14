import { STAGE_ORDER, INDIAN_STATES, UNION_TERRITORIES, LOST_REASONS, PROPERTY_TYPES, PROPERTY_CATEGORIES } from './constants';

// --- Column definitions ---

const LEAD_INFO_COLUMNS = [
  { header: 'Customer Name *', slug: 'customer_name' },
  { header: 'City', slug: 'city' },
  { header: 'State', slug: 'state' },
  { header: 'Lead Source', slug: 'lead_source' },
  { header: 'Source Name', slug: 'source_name' },
  { header: 'New or Renewal', slug: 'new_or_renewal' },
  { header: 'Lead Temperature', slug: 'lead_temperature' },
  { header: 'Competitor', slug: 'competitor' },
  { header: 'Property Type', slug: 'property_type' },
  { header: 'Property Category', slug: 'property_category' },
];

const DEAL_COLUMNS = [
  { header: 'Contract Period (Months)', slug: 'contract_period_months' },
  { header: 'TCV (Lakhs)', slug: 'tcv_lakhs' },
];

// Service columns are built from the business's own catalog (config.services), keyed by a stable
// slug the backend recognises: svc:<serviceSlug>:rate / :qty, and for Hardware + Software items a
// separate HW and SVC pair. Nature (OPEX/CAPEX) comes from the catalog default; frequency defaults
// to monthly on import (editable afterwards on the lead form).
function serviceColumns(config) {
  const svcs = (config && Array.isArray(config.services)) ? config.services : [];
  const cols = [];
  for (const s of svcs) {
    const cat = s.category || (s.hardware ? 'hardware' : 'software');
    const base = `svc:${s.slug}:`;
    if (cat === 'hardware_software') {
      cols.push(
        { header: `${s.label} — HW Rate`, slug: `${base}hw_rate` },
        { header: `${s.label} — HW Qty`,  slug: `${base}hw_qty` },
        { header: `${s.label} — SVC Rate`, slug: `${base}svc_rate` },
        { header: `${s.label} — SVC Qty`,  slug: `${base}svc_qty` },
      );
    } else {
      cols.push(
        { header: `${s.label} Rate`, slug: `${base}rate` },
        { header: `${s.label} Qty`,  slug: `${base}qty` },
      );
    }
  }
  return cols;
}

const HARDWARE_DATE_COLUMN = [
  { header: 'Hardware Requested Date', slug: 'device_requested_date' },
];

const PHASE_COLUMNS = [
  { header: 'Phase *', slug: 'phase' },
  { header: 'Next Follow-Up Date', slug: 'next_followup_date' },
  { header: 'PO Expected Date', slug: 'po_expected_date' },
  { header: 'Lost Reason', slug: 'lost_reason' },
  { header: 'Hold End Date', slug: 'hold_end_date' },
];

const PO_COLUMNS = [
  { header: 'PO Number', slug: 'po_number' },
  { header: 'PO Received Date', slug: 'po_received_date' },
  { header: 'PO Start Date', slug: 'service_start_date' },
  { header: 'PO End Date', slug: 'service_end_date' },
  { header: 'Billing Cycle', slug: 'billing_cycle' },
  { header: 'Payment Terms', slug: 'payment_terms' },
];

const NOTES_COLUMN = [
  { header: 'Additional Notes', slug: 'additional_notes' },
];

const OWNER_COLUMN = [
  { header: 'Lead Owner *', slug: 'owner_name' },
];

// Contact columns are template-driven: a field only carries a " *" (mandatory) marker when the
// Global Admin marked it mandatory in Edit Template — exactly the rule the backend enforces. By
// default (nothing marked) contacts are optional, so no asterisks appear. Contacts 2/3 are always
// optional extras.
function contactColumns(config) {
  const sec = (config && config.formSchema && Array.isArray(config.formSchema.sections))
    ? config.formSchema.sections.find(s => s.key === 'contacts') : null;
  const star = (slug) => ((sec && (sec.fields || []).find(f => f.slug === slug && f.mandatory)) ? ' *' : '');
  return [
    { header: `Contact 1 Name${star('contact_name')}`, slug: 'contact_1_name' },
    { header: `Contact 1 Email${star('contact_email')}`, slug: 'contact_1_email' },
    { header: `Contact 1 Phone${star('contact_phone')}`, slug: 'contact_1_phone' },
    { header: `Contact 1 Designation${star('contact_designation')}`, slug: 'contact_1_designation' },
    { header: 'Contact 2 Name', slug: 'contact_2_name' },
    { header: 'Contact 2 Email', slug: 'contact_2_email' },
    { header: 'Contact 2 Phone', slug: 'contact_2_phone' },
    { header: 'Contact 2 Designation', slug: 'contact_2_designation' },
    { header: 'Contact 3 Name', slug: 'contact_3_name' },
    { header: 'Contact 3 Email', slug: 'contact_3_email' },
    { header: 'Contact 3 Phone', slug: 'contact_3_phone' },
    { header: 'Contact 3 Designation', slug: 'contact_3_designation' },
  ];
}

const SKIP_CUSTOM_SLUGS = new Set([
  'phase', 'next_followup_date', 'po_expected_date', 'lost_reason', 'po_type',
  'po_document_url', 'channel_partner_name', 'kam_name', 'affiliate_name',
  'customer_name', 'city', 'state', 'lead_source', 'new_or_renewal',
  'lead_temperature', 'competitor', 'property_type', 'property_category',
  'quantity', 'potential_tcv_lakhs', 'acv_lakhs', 'contract_value_lakhs',
  'contract_period_months', 'po_validity_months', 'po_number',
  'additional_notes', 'jhes_product', 'service_start_date', 'service_end_date',
  'billing_cycle', 'payment_terms',
]);

export function getTemplateColumns(businessUnit, config) {
  // Services come from this business's own catalog now — the same for every business (originals and
  // custom) — so the template always matches what the Global Admin defined in Edit Template.
  const cols = [
    ...LEAD_INFO_COLUMNS,
    ...DEAL_COLUMNS,
    ...serviceColumns(config),
    ...HARDWARE_DATE_COLUMN,
    ...PHASE_COLUMNS,
    ...PO_COLUMNS,
    ...NOTES_COLUMN,
    ...OWNER_COLUMN,
    ...contactColumns(config),
  ];

  // Custom fields apply to any business (added via Edit Template).
  if (config && config.formSchema && Array.isArray(config.formSchema.sections)) {
    for (const sec of config.formSchema.sections) {
      if (!sec.enabled) continue;
      for (const f of sec.fields) {
        if (!f.enabled || f.core || SKIP_CUSTOM_SLUGS.has(f.slug)) continue;
        cols.push({ header: f.label, slug: `custom_${f.slug}`, custom: true });
      }
    }
  }

  return cols;
}

const DROPDOWN_MAP = {
  lead_source:      ['Channel Partner', 'KAM', 'Direct Sales', 'Lead Affiliate'],
  // Expansion is only created through the UI's dedicated "+ Expansion" flow, so the bulk-import
  // dropdown stays at New / Renewal. Backend still accepts "Expansion" if someone types it manually.
  new_or_renewal:   ['New', 'Renewal'],
  lead_temperature: ['Hot', 'Warm', 'Cold'],
  property_type:    PROPERTY_TYPES,
  property_category: PROPERTY_CATEGORIES,
  phase:            STAGE_ORDER,
  lost_reason:      LOST_REASONS,
  device_cost_type: ['capex', 'opex'],
};

const ALL_STATES = [...INDIAN_STATES, ...UNION_TERRITORIES];
const MAX_DATA_ROW = 501;

export async function downloadTemplate(businessUnit, config, users) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const columns = getTemplateColumns(businessUnit, config);
  const ownerNames = users.map(u => u.name).filter(Boolean);
  // Whether the template marks a contact field mandatory (drives the Instructions wording).
  const contactsSecForInstr = (config && config.formSchema && Array.isArray(config.formSchema.sections))
    ? config.formSchema.sections.find(s => s.key === 'contacts') : null;
  const contactsMandatory = !!(contactsSecForInstr && (contactsSecForInstr.fields || [])
    .find(f => (f.slug === 'contact_name' || f.slug === 'contact_email') && f.mandatory));

  // ---- Lookups sheet (hidden) — holds long lists referenced by the (non-restrictive) dropdowns ----
  const lookupSheet = wb.addWorksheet('Lookups', { state: 'veryHidden' });
  const lookupLists = [];

  const addLookupList = (label, values) => {
    const colIdx = lookupLists.length + 1;
    lookupSheet.getCell(1, colIdx).value = label;
    values.forEach((v, i) => { lookupSheet.getCell(i + 2, colIdx).value = v; });
    const colLetter = lookupSheet.getColumn(colIdx).letter;
    const ref = `Lookups!$${colLetter}$2:$${colLetter}$${values.length + 1}`;
    lookupLists.push({ ref });
    return ref;
  };

  const stateRef = addLookupList('States', ALL_STATES);
  const ownerRef = ownerNames.length > 0 ? addLookupList('Owners', ownerNames) : null;

  // ---- Lead Data sheet ----
  const dataSheet = wb.addWorksheet('Lead Data');

  const headerRow = dataSheet.addRow(columns.map(c => c.header));
  headerRow.eachCell(cell => {
    cell.font = { bold: true, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF94A3B8' } } };
  });

  columns.forEach((col, idx) => {
    const colNum = idx + 1;
    dataSheet.getColumn(colNum).width = Math.max(col.header.length + 2, 18);

    let formulae = null;
    let values = DROPDOWN_MAP[col.slug];
    if (col.slug.startsWith('includes_')) values = ['Yes', 'No'];

    if (values) {
      const inline = values.join(',');
      if (inline.length <= 250) {
        formulae = [`"${inline}"`];
      } else {
        const ref = addLookupList(col.slug, values);
        formulae = [ref];
      }
    } else if (col.slug === 'state') {
      formulae = [stateRef];
    } else if (col.slug === 'owner_name' && ownerRef) {
      formulae = [ownerRef];
    }

    if (!formulae) return;

    // Keep the dropdown for convenience, but DO NOT restrict input: showErrorMessage:false means
    // Excel never warns or blocks when a user types a value outside the list — free entry is allowed.
    const validation = {
      type: 'list',
      allowBlank: true,
      formulae,
      showErrorMessage: false,
    };

    for (let r = 2; r <= MAX_DATA_ROW; r++) {
      dataSheet.getCell(r, colNum).dataValidation = validation;
    }
  });

  // ---- Instructions sheet ----
  const instrSheet = wb.addWorksheet('Instructions');
  instrSheet.getColumn(1).width = 34;
  instrSheet.getColumn(2).width = 90;

  const bu = (businessUnit || '').toLowerCase();
  const instrRows = [
    ['Bulk Lead Import — Instructions', ''],
    [`Business Unit: ${businessUnit.toUpperCase()}`, ''],
    [],
    ['Column', 'Valid Values / Format'],
    ['Customer Name *', 'Required. Text.'],
    ['City', 'Text.'],
    ['State', ALL_STATES.join(', ')],
    ['Lead Source', 'Channel Partner, KAM, Direct Sales, Lead Affiliate (dropdown)'],
    ['Source Name', 'If Lead Source is Channel Partner / KAM / Lead Affiliate, enter the name here.'],
    ['New or Renewal', 'New, Renewal, Expansion (dropdown)'],
    ['Lead Temperature', 'Hot, Warm, Cold (dropdown)'],
    ['Competitor', 'Text.'],
    ['Property Type', PROPERTY_TYPES.join(', ') + ' (dropdown)'],
    ['Property Category', PROPERTY_CATEGORIES.join(', ') + ' (dropdown)'],
    ['Contract Period (Months)', 'Number. Required for auto TCV calculation.'],
    ['TCV (Lakhs)', 'Number. If blank AND service rates are provided, TCV is auto-calculated.'],
  ];

  const catSvcs = (config && Array.isArray(config.services)) ? config.services : [];
  if (catSvcs.length) {
    instrRows.push(
      [],
      ['— SERVICES OFFERED —', 'Rate + Qty columns per catalog item. Leave both blank to skip an item.'],
      ...catSvcs.map(s => {
        const cat = s.category || (s.hardware ? 'hardware' : 'software');
        const flow = (cat === 'hardware' || cat === 'hardware_software') ? ' (flows to Inventory Pipeline)' : '';
        const cols = cat === 'hardware_software' ? 'HW Rate / HW Qty + SVC Rate / SVC Qty' : 'Rate / Qty';
        return [`${s.label}`, `${cat.replace('_', ' + ')}${flow}. Columns: ${cols}. Default ${s.nature ? s.nature.toUpperCase() : 'OPEX'} (monthly for OPEX).`];
      }),
      ['Hardware Requested Date', 'YYYY-MM-DD. When the hardware is expected — for the Inventory Pipeline.'],
    );
  }

  instrRows.push(
    [],
    ['— PHASE & TIMELINE —', ''],
    ['Phase *', `Required (dropdown). ${STAGE_ORDER.join(', ')}`],
    ['Next Follow-Up Date', 'YYYY-MM-DD. Leave blank for Lost / PO Received.'],
    ['PO Expected Date', 'YYYY-MM-DD.'],
    ['Lost Reason', `Required if Phase is Lost (dropdown). ${LOST_REASONS.join(', ')}`],
    ['Hold End Date', 'YYYY-MM-DD. For On Hold leads — when to resume.'],
    [],
    ['— PO RECEIVED FIELDS —', ''],
    ['PO Number', 'Text.'],
    ['PO Received Date', 'YYYY-MM-DD. The date the PO was actually received. IMPORTANT for PO Received leads — this is the date used for weekly/monthly/quarterly performance. If left blank, the lead is counted on the import date instead.'],
    ['PO Start Date', 'YYYY-MM-DD. When the PO/service delivery begins.'],
    ['PO End Date', 'YYYY-MM-DD. When the PO/service contract ends.'],
    [],
    ['— OWNER & CONTACTS —', ''],
    ['Lead Owner *', `Required (dropdown). The salesperson/BD who will OWN each lead — the import assigns the lead to that user. Pick from the list. Must match an active user in this business. Available: ${ownerNames.join(', ')}`],
    (contactsMandatory
      ? ['Contact 1 Name / Email *', 'Required — at least one contact with both Name and Email.']
      : ['Contact 1 Name / Email', 'Optional. If you fill a contact Name you must also fill its Email (and vice-versa).']),
    ['Contact 2/3', 'Optional additional contacts, same format.'],
    [],
    ['Notes', ''],
    ['- Columns with a ▼ dropdown arrow have predefined values — click the cell to select.', ''],
    ['- Dates must be in YYYY-MM-DD format (e.g., 2026-09-28).', ''],
    ['- Yes/No columns accept: Yes, No (case-insensitive).', ''],
    ['- Maximum 500 rows per upload.', ''],
    ['- Do not rename or reorder columns in the Lead Data sheet.', ''],
    ['- TCV auto-calc: if you fill in service rates + qty + contract period, TCV is computed. Otherwise enter TCV manually.', ''],
  );

  instrRows.forEach(row => {
    if (row.length === 0) { instrSheet.addRow([]); }
    else { instrSheet.addRow(row); }
  });

  instrSheet.getRow(1).font = { bold: true, size: 13 };
  instrSheet.getRow(4).font = { bold: true };

  // ---- Download ----
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Bulk_Import_Template_${businessUnit.toUpperCase()}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function parseUploadedFile(XLSX, file, businessUnit, config) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
        // Read the "Lead Data" sheet specifically — the template also ships a hidden "Lookups" sheet
        // (first in the workbook) and an "Instructions" sheet, so SheetNames[0] is NOT the data sheet.
        const dataSheetName = wb.SheetNames.includes('Lead Data')
          ? 'Lead Data'
          : (wb.SheetNames.find(n => !['Lookups', 'Instructions'].includes(n)) || wb.SheetNames[0]);
        const sheet = wb.Sheets[dataSheetName];
        const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        if (raw.length === 0) { reject(new Error('No data rows found.')); return; }

        const allCols = getTemplateColumns(businessUnit, config);
        const headerMap = {};
        allCols.forEach(c => { headerMap[c.header] = c.slug; });

        const rows = raw.map(r => {
          const mapped = {};
          for (const [header, value] of Object.entries(r)) {
            const cleanHeader = header.trim();
            const slug = headerMap[cleanHeader];
            if (slug) {
              mapped[slug] = formatCellValue(value);
            } else {
              if (!mapped._extraFields) mapped._extraFields = {};
              mapped._extraFields[cleanHeader] = formatCellValue(value);
            }
          }
          return mapped;
        }).filter(r => r.customer_name || r.owner_name || r.phase);

        resolve(rows);
      } catch (err) {
        reject(new Error('Could not parse the file. Make sure it is a valid .xlsx file.'));
      }
    };
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsArrayBuffer(file);
  });
}

function formatCellValue(v) {
  if (v instanceof Date) {
    const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, '0'), d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'number') return String(v);
  return typeof v === 'string' ? v.trim() : String(v ?? '');
}

export function parseBool(v) {
  if (!v) return false;
  const s = String(v).trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === '1';
}
