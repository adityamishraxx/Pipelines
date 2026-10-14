export const BU_CONFIG = {
  signage:      { label: 'Signage',      color: '#4f46e5', description: 'Digital Signage Solutions' },
  jhes:         { label: 'JHES',         color: '#ea580c', description: 'Jio Hospitality & Entertainment Services' },
  surveillance: { label: 'Surveillance', color: '#0891b2', description: 'Surveillance & Security Solutions' },
};

// Surveillance service catalogue. Each service can be offered as OPEX (recurring) and/or CAPEX
// (one-time) — the form lists each one under both. Mirror of the surveillance TCV calc in
// backend/routes/leads.js (computeSurveillanceBreakdown).
export const SURVEILLANCE_ITEMS = [
  'JioSecure Platform', 'Jio Bridge Device', 'JioSecure Cloud Storage', 'Continuous Recording',
  'Event Based Recording', 'Jio Cameras', 'JioSecure Analytics Suite', 'JSL Platform', 'JSL Devices',
  'JSL Cloud Storage', 'Jio Smart Shop (Shutter Kit)', 'Jio Smart Shop Subscription',
];

export const PHASE_DATE_MAP = {
  New: 'start_date', Qualified: 'qualified_date', Demo: 'demo_date',
  Proposal: 'proposal_date', Negotiation: 'negotiation_date', 'PO Received': 'po_received_date',
};

export const STAGE_ORDER = ['New', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'PO Expected', 'PO Received', 'Lost', 'On Hold'];

export const STAGE_WIN_PCT = {
  New: 5, Qualified: 15, Demo: 30, Proposal: 45, Negotiation: 60,
  'PO Expected': 80, 'PO Received': 100, Lost: 0, 'On Hold': 0,
};

export const PHASE_BADGE = {
  New: 'badge-gray', Qualified: 'badge-purple', Demo: 'badge-amber', Proposal: 'badge-blue',
  Negotiation: 'badge-orange', 'PO Expected': 'badge-teal', 'PO Received': 'badge-green',
  Lost: 'badge-red', 'On Hold': 'badge-gray',
};

export const TEMP_BADGE = { Hot: 'badge-red', Warm: 'badge-amber', Cold: 'badge-blue' };

export const DEVICE_SKU_MAP = {
  MCM3000: 'Media Player', JSB210: 'Media Player', J100: 'Media Player', C2Av2: 'Media Player', M2S: 'Dongle',
};

// Signage services offered on a lead, with the cost nature that drives the TCV auto-calc.
//   opex  → recurring: billed monthly over the contract term (qty × rate × contract months)
//   capex → one-time:  qty × rate
// The `device` line is handled separately in the form because its nature is chosen per-lead by
// the BD (see device_cost_type). Mirror of TCV_SERVICES in backend/routes/leads.js — keep in sync.
// All column-based services (drives the TCV auto-calc). Each business shows a subset in its form:
//   Signage → platform / cms / connectivity / amc / display / installation (+ Device)
//   JHES    → jhes / iptv (+ Device)
// The device line is handled separately in the form (its cost nature is per-lead). Mirror of
// TCV_SERVICES in backend/routes/leads.js — keep in sync.
export const ALL_SERVICES = [
  { key: 'platform',     label: 'Platform',     nature: 'opex' },
  { key: 'cms',          label: 'CMS',          nature: 'opex' },
  { key: 'connectivity', label: 'Connectivity', nature: 'opex' },
  { key: 'amc',          label: 'AMC (Annual Maintenance Charge)', nature: 'opex' },
  { key: 'iptv',         label: 'IPTV',         nature: 'opex' },
  { key: 'jhes',         label: 'JHES',         nature: 'opex' },
  { key: 'display',      label: 'Display',      nature: 'capex' },
  { key: 'installation', label: 'Installation Charge (one-time)',  nature: 'capex' },
];
const svcByKey = (...keys) => ALL_SERVICES.filter(s => keys.includes(s.key));
export const SIGNAGE_SERVICES = svcByKey('platform', 'cms', 'connectivity', 'amc', 'display', 'installation');
export const JHES_SERVICES    = svcByKey('jhes', 'iptv');

export const LOST_REASONS = ['Pricing', 'Competition', 'No Budget', 'No Decision', 'Timing', 'Product Fit', 'Other'];
export const TAT_DAYS = 14;

// Human-readable role labels (roles are stored lowercase/snake_case).
export const ROLE_LABEL = {
  super_admin: 'Global Admin', business_admin: 'Business Admin', pmo: 'Manager', bd: 'Business Development', forecast: 'Inventory Pipeline',
};

// Indian States and Union Territories. Most CRMs present these in one "State / UT" dropdown, grouped
// so the 8 UTs are distinguishable from the 28 states — that's the approach used here.
export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];
export const UNION_TERRITORIES = [
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
  'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];

// --- Account Mix (all businesses) ---
export const PROPERTY_TYPES = ['Chain', 'Standalone', 'Other'];
export const PROPERTY_CATEGORIES = [
  'Hospital', 'Hotels', 'BFSI', 'Retail', 'Real Estate', 'Manufacturing',
  'IT/ITES', 'Education', 'Bank', 'Corporate Office', 'Restaurants', 'Other',
];

// --- VOC (Voice of Customer) — Surveillance only ---
export const VOC_SEGMENTS = ['Enterprise', 'SMB', 'Government', 'Residential', 'Other'];
export const VOC_PRODUCTS = ['Camera', 'VMS', 'Cloud Storage', 'Analytics', 'NVR', 'Other'];
export const VOC_TYPES = ['Feature Gap', 'Configuration Mismatch', 'Integration Requirement', 'Performance Issue', 'Enhancement Request', 'Commercial Gap', 'Other'];
export const VOC_IMPACTS = ['Deal Blocker', 'Deal Delay', 'Competitive Gap', 'Nice to Have'];
export const VOC_PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
export const VOC_STATUSES = ['New', 'Under Review', 'Accepted', 'Planned', 'In Development', 'Released', 'Rejected', 'Closed'];
export const VOC_OPEN_STATUSES = ['New', 'Under Review', 'Accepted', 'Planned', 'In Development'];
// Status badge colours.
export const VOC_STATUS_BADGE = {
  New: 'badge-blue', 'Under Review': 'badge-amber', Accepted: 'badge-purple', Planned: 'badge-purple',
  'In Development': 'badge-amber', Released: 'badge-green', Rejected: 'badge-red', Closed: 'badge-gray',
};
export const VOC_PRIORITY_BADGE = { Critical: 'badge-red', High: 'badge-amber', Medium: 'badge-blue', Low: 'badge-gray' };
