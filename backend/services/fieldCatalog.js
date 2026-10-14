// The union of lead-form fields across the existing business units, organised into SECTIONS for the
// BU creation wizard. Derived from the leads schema and the current lead form. `core: true` fields
// have a real leads column and are always available; the rest are optional per business unit. Custom
// fields the admin adds in the wizard live alongside these and store their VALUES in leads.custom_fields
// (JSON), so no schema change is ever needed to add a field. This centralises what was scattered
// across LeadForm.jsx / constants.js and becomes DB-backed field_definitions in a later phase.
//
// A field carries: slug, label, type, and (for select/checkbox) options. `core` marks fields with a
// dedicated leads column. Each section can be enabled/disabled and reordered per business unit.
const FIELD_SECTIONS = [
  { key: 'account', label: 'Account', fields: [
    { slug: 'customer_name',     label: 'Customer / Account Name',        type: 'text',   core: true },
    { slug: 'property_type',     label: 'Account Type',                   type: 'select', core: true, options: ['Chain', 'Standalone', 'Other'] },
    { slug: 'property_category', label: 'Account Category',               type: 'select', core: true, options: ['Hospital', 'Hotels', 'BFSI', 'Retail', 'Real Estate', 'Manufacturing', 'IT/ITES', 'Education', 'Bank', 'Corporate Office', 'Restaurants', 'Other'] },
  ] },
  { key: 'location', label: 'Location', fields: [
    { slug: 'city',  label: 'City',      type: 'text',   core: true },
    { slug: 'state', label: 'State / UT', type: 'select', core: true, options: ['(Indian States & Union Territories)'] },
  ] },
  { key: 'source', label: 'Source', fields: [
    { slug: 'lead_source',          label: 'Lead Source',    type: 'select', core: true, optionsFrom: 'dropdown:lead_source' },
    { slug: 'channel_partner_name', label: 'Channel Partner', type: 'text',  core: true },
    { slug: 'kam_name',             label: 'KAM',            type: 'text',   core: true },
    { slug: 'affiliate_name',       label: 'Affiliate',      type: 'text',   core: true },
  ] },
  { key: 'classification', label: 'Classification', fields: [
    { slug: 'new_or_renewal',   label: 'New / Renewal / Expansion', type: 'select', core: true, options: ['New', 'Renewal', 'Expansion'] },
    { slug: 'lead_temperature', label: 'Lead Temperature',          type: 'select', core: true, options: ['Hot', 'Warm', 'Cold'] },
    { slug: 'competitor',       label: 'Competitor',                type: 'text',   core: true },
  ] },
  { key: 'commercials', label: 'Commercials', fields: [
    { slug: 'quantity',              label: 'Quantity',              type: 'number',  core: true },
    { slug: 'potential_tcv_lakhs',   label: 'Potential TCV (Lakhs)', type: 'decimal', core: true },
    { slug: 'acv_lakhs',             label: 'ACV (Lakhs)',           type: 'decimal', core: true },
    { slug: 'contract_value_lakhs',  label: 'Contract Value (Lakhs)', type: 'decimal', core: true },
    { slug: 'contract_period_months', label: 'Contract Period (months)', type: 'number', core: true },
    { slug: 'po_validity_months',    label: 'PO Validity (months)',  type: 'number',  core: true },
  ] },
  { key: 'pipeline', label: 'Pipeline', fields: [
    { slug: 'phase',              label: 'Sales Stage',        type: 'select', core: true, options: ['New', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'PO Expected', 'PO Received'] },
    { slug: 'next_followup_date', label: 'Next Follow-up Date', type: 'date',  core: true },
    { slug: 'po_expected_date',   label: 'PO Expected Date',    type: 'date',  core: true },
  ] },
  // Contacts (POC): the repeatable contact sub-form on the lead. Name & Email are always required
  // and always shown (at least one POC is mandatory on every lead). Phone and Designation can be
  // toggled off or marked mandatory per business via Edit Template.
  { key: 'contacts', label: 'Contacts (POC)', fields: [
    { slug: 'contact_name',        label: 'Name',        type: 'text', core: true },
    { slug: 'contact_email',       label: 'Email',       type: 'text', core: true },
    { slug: 'contact_phone',       label: 'Phone',       type: 'text', core: true },
    { slug: 'contact_designation', label: 'Designation', type: 'text', core: true },
  ] },
  { key: 'po', label: 'PO', fields: [
    { slug: 'po_type',         label: 'PO Type',       type: 'select', core: true, options: ['Individual', 'Global'] },
    { slug: 'po_number',       label: 'PO Number',     type: 'text',   core: true },
    { slug: 'po_document_url', label: 'PO Document',   type: 'file',   core: true },
    { slug: 'billing_cycle',   label: 'Billing Cycle',  type: 'select', core: true, options: ['Monthly', 'Quarterly', 'Semi-annually', 'Annually', 'Advance', 'Others'] },
    { slug: 'payment_terms',   label: 'Payment Terms',  type: 'select', core: true, options: ['100% Advance', '7 Days Credit', '15 Days Credit', '30 Days Credit', '45 Days Credit', 'Others'] },
  ] },
  { key: 'dates', label: 'Dates', fields: [
    { slug: 'service_start_date', label: 'PO Start Date', type: 'date', core: true },
    { slug: 'service_end_date',   label: 'PO End Date',   type: 'date', core: true },
  ] },
  { key: 'other', label: 'Other', fields: [
    { slug: 'jhes_product',     label: 'Product (free text)', type: 'text',     core: true },
    { slug: 'additional_notes', label: 'Additional Notes',    type: 'textarea', core: true },
    { slug: 'lost_reason',      label: 'Lost Reason',         type: 'select',   core: true, options: ['Pricing', 'Competition', 'No Budget', 'No Decision', 'Timing', 'Product Fit', 'Other'] },
  ] },
];

// Flat view (kept for callers that don't care about sections).
const FIELD_CATALOG = FIELD_SECTIONS.flatMap(sec => sec.fields.map(f => ({ ...f, group: sec.label, section: sec.key })));

// The custom-field types the wizard offers when an admin adds a field to a section.
const FIELD_TYPES = [
  { value: 'text',      label: 'Text' },
  { value: 'textarea',  label: 'Text (multi-line)' },
  { value: 'number',    label: 'Number' },
  { value: 'decimal',   label: 'Decimal' },
  { value: 'date',      label: 'Date' },
  { value: 'select',    label: 'Dropdown', hasOptions: true },
  { value: 'checkbox',  label: 'Checkbox (yes/no)' },
  { value: 'multiselect', label: 'Multi-select', hasOptions: true },
];

// Process modules that can be enabled per business unit. Core ones cannot be turned off.
const MODULE_CATALOG = [
  { slug: 'leads',      label: 'Lead Management', core: true },
  { slug: 'dashboard',  label: 'Dashboard',       core: true },
  { slug: 'forecast',   label: 'Inventory Pipeline' },
  { slug: 'reports',    label: 'Reports' },
  { slug: 'voc',        label: 'Voice of Customer (VOC)', optIn: true },
  { slug: 'activities', label: 'Task Board (kanban)' },
  { slug: 'campaigns',  label: 'Campaigns', optIn: true },
  { slug: 'customers',  label: 'Customers & Contacts', optIn: true },
];

// Dashboard / report options offered by the wizard. Captured as the unit's settings for now; the
// per-BU dashboard/report engines that consume them are a later phase.
const DASHBOARD_CATALOG = ['Executive', 'Sales', 'Funnel', 'Revenue', 'Forecast', 'PMO', 'Delivery', 'Account', 'Product', 'Resource'];
const REPORT_CATALOG = ['Weekly', 'Monthly', 'Quarterly', 'Revenue', 'Forecast', 'Funnel', 'Sales Performance', 'Team Performance'];

module.exports = { FIELD_SECTIONS, FIELD_CATALOG, FIELD_TYPES, MODULE_CATALOG, DASHBOARD_CATALOG, REPORT_CATALOG };
