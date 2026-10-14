import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { createLead, updateLead, uploadPoDocument, fileUrl, getBds, getDropdowns, getGlobalPos, createGlobalPo, getCampaigns } from '../services/api';
import { LOST_REASONS, INDIAN_STATES, UNION_TERRITORIES, PROPERTY_TYPES, PROPERTY_CATEGORIES } from '../utils/constants';
import { todayStr, addDaysStr, computeAcvLakhs, hasConfidence, confidenceTrend } from '../utils/leadHelpers';
import DropdownManager from './DropdownManager';
import { FieldInput } from './CustomLeadForm';
import MentionTextarea from './MentionTextarea';
import ServicesOffered, { parseServiceLines } from './ServicesOffered';
import { computeServicesTotals } from '../utils/pricing';
import AuditTimeline from './AuditTimeline';


const PHASES = ['New', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'PO Expected', 'PO Received', 'Lost', 'On Hold'];
const SOURCES = ['Channel Partner', 'KAM', 'Direct Sales', 'Lead Affiliate'];
// "Expansion" is kept server-side (and in the ENUM) but is NOT a manual choice in the regular New
// New / Renewal is auto-tagged, not picked: a plain new lead is "New"; the "+ Additional PO" header
// flow creates "Expansion" (Additional) and "Renewal" leads, prefilled from an existing customer.
const RATINGS = ['Hot', 'Warm', 'Cold'];

const emptyForm = {
  property_type: '', property_category: '',
  customer_name: '', owner_id: '', city: '', state: '', lead_source: '', channel_partner_name: '', kam_name: '', affiliate_name: '',
  new_or_renewal: '', lead_temperature: '', competitor: '',
  includes_platform: false, platform_rate: '', platform_qty: '',
  includes_cms: false, cms_rate: '', cms_qty: '',
  includes_connectivity: false, connectivity_rate: '', connectivity_qty: '',
  includes_amc: false, amc_rate: '', amc_qty: '',
  includes_iptv: false, iptv_rate: '', iptv_qty: '',
  includes_jhes: false, jhes_rate: '', jhes_qty: '',
  includes_display: false, display_rate: '', display_qty: '',
  includes_installation: false, installation_rate: '', installation_qty: '',
  includes_device: false, device_sku: '', device_cost_type: 'capex', device_rate: '', device_qty: '', device_requested_date: '',
  jhes_product: '',
  potential_tcv_lakhs: '', tcv_manual: false, contract_period_months: '', po_validity_months: '',
  global_po_id: '',
  phase: 'New', next_followup_date: '', po_expected_date: '', lost_reason: '', po_actual_value_lakhs: '',
  service_start_date: '', service_end_date: '',
  billing_cycle: '', payment_terms: '',
  hold_end_date: '', po_number: '',
  campaign_id: '',
  additional_notes: '',
};

// Confidence badge colour band by score.
const confBand = (c) => c >= 60 ? { bg: '#dcfce7', fg: '#0a84ff' } : c >= 30 ? { bg: '#fef3c7', fg: '#92400e' } : { bg: '#f1f5f9', fg: '#475569' };

function Field({ label, children, required }) {
  return (
    <div>
      <label className="field-label">{label}{required && ' *'}</label>
      {children}
    </div>
  );
}

export default function LeadForm({ lead, onSave, onCancel, buConfig, expansionFrom = null, expansionMode = 'additional' }) {
  const { user, isAdmin, isBD, canManageDropdowns, canEdit, canFull, canAct } = useAuth();
  // Per-module levels: Edit can change existing leads, Full can also create. Read-only opens the
  // form purely to view — a disabled fieldset covers every input at once, so no control is missed.
  const leadsReadOnly = !canAct || !canEdit('leads');
  // 'Manage' opens the dropdown-option editors: module-level configuration, which Edit excludes.
  const showManage = canAct && canManageDropdowns && canFull('leads');
  const isJHES = user.business_unit === 'jhes';
  // Admin-defined custom fields added via Edit Template. The three originals render a hardcoded form,
  // so their core fields never come from the schema — but any custom field (custom + enabled) does,
  // and its value is stored in the lead's custom_fields JSON. Each field carries the template's
  // section key/label so it can be rendered INSIDE the matching hardcoded section (e.g. a "district"
  // field added to Location renders next to City), rather than piled at the bottom.
  const customFields = React.useMemo(() => {
    const secs = buConfig?.formSchema?.sections || [];
    return secs.flatMap(sec => (sec.fields || [])
      .filter(f => f.custom && f.enabled !== false)
      .map(f => ({ ...f, _section: sec.key, _sectionLabel: sec.label })));
  }, [buConfig]);
  // Group custom fields by their template section key so we can inject them at the right spot.
  const customBySection = React.useMemo(() => {
    const m = new Map();
    for (const f of customFields) {
      if (!m.has(f._section)) m.set(f._section, []);
      m.get(f._section).push(f);
    }
    return m;
  }, [customFields]);
  // Whether the PO Type chooser (Individual vs Global PO) + chain mapping are shown. Driven by the
  // template's PO section / po_type field: unchecking it in Edit Template hides both, matching
  // CustomLeadForm. Defaults to shown when the BU has no saved schema yet (or no PO section in it).
  const poTypeEnabled = React.useMemo(() => {
    const secs = buConfig?.formSchema?.sections;
    if (!Array.isArray(secs)) return true;
    const po = secs.find(s => s.key === 'po');
    if (!po) return true;
    if (po.enabled === false) return false;
    const field = (po.fields || []).find(f => f.slug === 'po_type');
    return field ? field.enabled !== false : true;
  }, [buConfig]);
  // Account Mix fields follow the template too: unchecking "Account Type" or "Account Category" in
  // Edit Template hides the matching dropdown in the lead form. Defaults to shown when the BU has no
  // saved schema yet (or no Account section in it). The whole section hides if the Account section is
  // off or BOTH fields are off AND there are no custom Account fields.
  const fieldEnabled = React.useCallback((sectionKey, fieldSlug) => {
    const secs = buConfig?.formSchema?.sections;
    if (!Array.isArray(secs)) return true;
    const sec = secs.find(s => s.key === sectionKey);
    if (!sec) return true;
    if (sec.enabled === false) return false;
    const field = (sec.fields || []).find(f => f.slug === fieldSlug);
    return field ? field.enabled !== false : true;
  }, [buConfig]);
  // Short helpers used throughout the form: fieldOn(key, slug) and sectionOn(key, slugs).
  // A section is shown only if its template section is on AND at least one of its built-in fields
  // is on, OR a custom field was added into it. Keeps us from rendering a titled, empty block.
  const fieldOn = fieldEnabled;
  const sectionOn = React.useCallback((sectionKey, slugs) => {
    const secs = buConfig?.formSchema?.sections;
    if (!Array.isArray(secs)) return true;
    const sec = secs.find(s => s.key === sectionKey);
    if (!sec) return true;
    if (sec.enabled === false) return false;
    for (const s of slugs) if (fieldOn(sectionKey, s)) return true;
    return (customBySection.get(sectionKey) || []).length > 0;
  }, [buConfig, fieldOn, customBySection]);
  const propertyTypeEnabled     = fieldOn('account', 'property_type');
  const propertyCategoryEnabled = fieldOn('account', 'property_category');
  const accountSectionEnabled   = sectionOn('account', ['property_type', 'property_category']);
  // Field mandatory-ness is driven by the template (Edit Template → "mark mandatory"). Only Customer
  // Name and Phase are ALWAYS mandatory for every business; every other field is required only if the
  // Global Admin marked it so. Structural Lead Owner stays required (a lead needs an owner).
  const mandatoryOf = React.useMemo(() => {
    const m = {};
    for (const sec of (buConfig?.formSchema?.sections || [])) for (const f of (sec.fields || [])) m[f.slug] = !!f.mandatory;
    return m;
  }, [buConfig]);
  const ALWAYS_REQUIRED = new Set(['customer_name', 'phase', 'owner_id']);
  const req = (slug) => ALWAYS_REQUIRED.has(slug) || !!mandatoryOf[slug];

  // Contacts (POC) config. Phone & Designation can be hidden per business; Name/Email/Phone/Designation
  // are each required only if marked mandatory in the template (nothing is forced). Defaults to
  // shown/optional when the template has no contacts section yet.
  const contactCfg = React.useMemo(() => {
    const sec = (buConfig?.formSchema?.sections || []).find(s => s.key === 'contacts');
    const f = (slug) => sec && sec.fields ? sec.fields.find(x => x.slug === slug) : null;
    const p = f('contact_phone'), d = f('contact_designation'), n = f('contact_name'), e = f('contact_email');
    return {
      showPhone: p ? p.enabled !== false : true, phoneReq: p ? !!p.mandatory : false,
      showDesig: d ? d.enabled !== false : true, desigReq: d ? !!d.mandatory : false,
      nameReq: n ? !!n.mandatory : false, emailReq: e ? !!e.mandatory : false,
    };
  }, [buConfig]);

  const [form, setForm] = useState(emptyForm);
  const [custom, setCustom] = useState({});
  const setC = (slug, v) => setCustom(c => ({ ...c, [slug]: v }));
  const [lines, setLines] = useState([]);   // Services Offered line list (services_json shape)
  const [contacts, setContacts] = useState([]);
  const [bds, setBds] = useState([]);
  const [dropdowns, setDropdowns] = useState({});              // per-business dropdown options
  const [cpOther, setCpOther] = useState(false);               // "Other — enter a new name" selected
  const [affOther, setAffOther] = useState(false);             // Lead Affiliate "Other" (JHES only)
  const [ptOther, setPtOther] = useState(false);               // Property Type "Other" → manual entry
  const [pcOther, setPcOther] = useState(false);               // Property Category "Other" → manual entry
  const channelPartners = dropdowns.channel_partner || [];
  const affiliates = dropdowns.lead_affiliate || [];
  const sourceOpts  = (dropdowns.lead_source && dropdowns.lead_source.length)         ? dropdowns.lead_source      : SOURCES;
  const ratingOpts  = (dropdowns.lead_temperature && dropdowns.lead_temperature.length) ? dropdowns.lead_temperature : RATINGS;
  const [phaseChanged, setPhaseChanged] = useState(false);
  const [phaseDate, setPhaseDate] = useState(todayStr());
  const [poFile, setPoFile] = useState(null);
  const [existingPoUrl, setExistingPoUrl] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [lostOther, setLostOther] = useState('');
  // Global vs Individual PO. Only chosen at creation; an existing lead is always an Individual PO.
  const [poType, setPoType] = useState('individual');
  const [chains, setChains] = useState([]);                 // Global POs (chains) for linkage
  const [linkToChain, setLinkToChain] = useState(false);    // Individual: property belongs to a chain
  const [campaigns, setCampaigns] = useState([]);            // Campaigns for linkage
  const emptyGlobal = { chain_name: '', device_total: '', device_type: '', price_lakhs: '', expected_start_date: '', expected_end_date: '' };
  const [globalForm, setGlobalForm] = useState(emptyGlobal);
  const setGlobal = (k, v) => setGlobalForm(f => ({ ...f, [k]: v }));

  useEffect(() => { getBds(user.business_unit).then(setBds).catch(() => {}); }, [user.business_unit]);
  useEffect(() => { getGlobalPos().then(setChains).catch(() => setChains([])); }, [user.business_unit]);
  useEffect(() => { getCampaigns().then(setCampaigns).catch(() => setCampaigns([])); }, []);
  const loadDropdowns = () => getDropdowns().then(setDropdowns).catch(() => {});
  useEffect(() => { loadDropdowns(); }, []);
  // If an existing lead's channel partner isn't in the managed list, treat it as an "Other" value.
  useEffect(() => {
    if (form.lead_source === 'Channel Partner' && form.channel_partner_name
        && channelPartners.length && !channelPartners.includes(form.channel_partner_name)) {
      setCpOther(true);
    }
    if (isJHES && form.lead_source === 'Lead Affiliate' && form.affiliate_name
        && affiliates.length && !affiliates.includes(form.affiliate_name)) {
      setAffOther(true);
    }
  }, [dropdowns, form.lead_source, form.channel_partner_name, form.affiliate_name, isJHES]); // eslint-disable-line

  useEffect(() => {
    if (lead) {
      setForm({
        property_type: lead.property_type || '', property_category: lead.property_category || '',
        customer_name: lead.customer_name || '', owner_id: lead.owner_id || '',
        city: lead.city || '', state: lead.state || '', lead_source: lead.lead_source || '',
        channel_partner_name: lead.channel_partner_name || '', kam_name: lead.kam_name || '', affiliate_name: lead.affiliate_name || '',
        new_or_renewal: lead.new_or_renewal || '', lead_temperature: lead.lead_temperature || '', competitor: lead.competitor || '',
        includes_platform: !!lead.includes_platform, platform_rate: lead.platform_rate || '', platform_qty: lead.platform_qty || '',
        includes_cms: !!lead.includes_cms, cms_rate: lead.cms_rate || '', cms_qty: lead.cms_qty || '',
        includes_connectivity: !!lead.includes_connectivity, connectivity_rate: lead.connectivity_rate || '', connectivity_qty: lead.connectivity_qty || '',
        includes_amc: !!lead.includes_amc, amc_rate: lead.amc_rate || '', amc_qty: lead.amc_qty || '',
        includes_iptv: !!lead.includes_iptv, iptv_rate: lead.iptv_rate || '', iptv_qty: lead.iptv_qty || '',
        includes_jhes: !!lead.includes_jhes, jhes_rate: lead.jhes_rate || '', jhes_qty: lead.jhes_qty || '',
        includes_display: !!lead.includes_display, display_rate: lead.display_rate || '', display_qty: lead.display_qty || '',
        includes_installation: !!lead.includes_installation, installation_rate: lead.installation_rate || '', installation_qty: lead.installation_qty || '',
        includes_device: !!lead.includes_device, device_sku: lead.device_sku || '', device_cost_type: lead.device_cost_type || 'capex', device_rate: lead.device_rate || '',
        device_qty: lead.device_qty || '', device_requested_date: lead.device_requested_date || '',
        jhes_product: lead.jhes_product || '',
        potential_tcv_lakhs: lead.potential_tcv_lakhs || '', tcv_manual: lead.tcv_manual === undefined ? true : !!lead.tcv_manual,
        contract_period_months: lead.contract_period_months || '',
        po_validity_months: lead.po_validity_months || '',
        phase: lead.phase || 'New', next_followup_date: lead.next_followup_date || '', po_expected_date: lead.po_expected_date || '',
        service_start_date: lead.service_start_date || '', service_end_date: lead.service_end_date || '',
        billing_cycle: lead.billing_cycle || '', payment_terms: lead.payment_terms || '',
        hold_end_date: lead.hold_end_date || '', po_number: lead.po_number || '',
        global_po_id: lead.global_po_id || '',
        campaign_id: lead.campaign_id || '',
        lost_reason: lead.lost_reason?.startsWith('Other: ') ? 'Other' : (lead.lost_reason || ''),
        po_actual_value_lakhs: lead.po_actual_value_lakhs || '', additional_notes: lead.additional_notes || '',
      });
      setLostOther(lead.lost_reason?.startsWith('Other: ') ? lead.lost_reason.slice(7) : '');
      setCustom(lead.custom_fields || {});
      setContacts((lead.contacts || []).map(c => ({ name: c.name, phone: c.phone || '', email: c.email || '', designation: c.designation || '' })));
      setExistingPoUrl(lead.po_document_url || null);
      setLines(parseServiceLines(lead.services_json));
      setPhaseChanged(false);
      setPoType('individual');            // an existing lead is always an Individual PO
      setLinkToChain(!!lead.global_po_id);
      // A stored Account Mix value not in the fixed list is a manually-entered "Other" value.
      setPtOther(!!lead.property_type && !PROPERTY_TYPES.includes(lead.property_type));
      setPcOther(!!lead.property_category && !PROPERTY_CATEGORIES.includes(lead.property_category));
    } else {
      // NEW lead flow. Three cases:
      //   plain new  → everything blank, new_or_renewal = "New".
      //   additional → copy the source's STATIC fields only; new_or_renewal = "Expansion".
      //   renewal    → copy statics PLUS services + deal size; new_or_renewal = "Renewal".
      const ef = expansionFrom || null;
      const isRenewal = ef && expansionMode === 'renewal';
      setForm({
        ...emptyForm,
        customer_name: ef?.customer_name || '',
        owner_id: ef?.owner_id || (!isAdmin ? user.id : ''),
        property_type: ef?.property_type || '',
        property_category: ef?.property_category || '',
        state: ef?.state || '',
        city: ef?.city || '',
        lead_source: ef?.lead_source || '',
        channel_partner_name: ef?.channel_partner_name || '',
        kam_name: ef?.kam_name || '',
        affiliate_name: ef?.affiliate_name || '',
        lead_temperature: ef?.lead_temperature || '',
        // Auto-tagged by flow; the field is no longer shown in the form.
        new_or_renewal: !ef ? 'New' : (isRenewal ? 'Renewal' : 'Expansion'),
        // Renewal repeats the same contract, so copy its deal size; additional/new leave it blank.
        contract_period_months: isRenewal ? (ef.contract_period_months || '') : '',
        po_validity_months: isRenewal ? (ef.po_validity_months || '') : '',
        potential_tcv_lakhs: isRenewal ? (ef.potential_tcv_lakhs || '') : '',
        tcv_manual: isRenewal ? (ef.tcv_manual === undefined ? true : !!ef.tcv_manual) : false,
        next_followup_date: addDaysStr(todayStr(), 14),
        device_rate: isJHES ? '0' : '',
      });
      setCustom({});
      if (ef && ef.global_po_id) {
        setPoType('individual');
        setLinkToChain(true);
        setForm(f => ({ ...f, global_po_id: ef.global_po_id }));
      } else {
        setPoType('individual'); setLinkToChain(false);
      }
      setGlobalForm(emptyGlobal); setCpOther(false); setAffOther(false);
      setPtOther(!!ef?.property_type && !PROPERTY_TYPES.includes(ef.property_type));
      setPcOther(!!ef?.property_category && !PROPERTY_CATEGORIES.includes(ef.property_category));
      const copiedContacts = ef && Array.isArray(ef.contacts) && ef.contacts.length
        ? ef.contacts.map(c => ({ name: c.name || '', phone: c.phone || '', email: c.email || '', designation: c.designation || '' }))
        : [{ name: '', phone: '', email: '', designation: '' }];
      setContacts(copiedContacts);
      // Renewal copies the services list too; additional/new start blank.
      setLines(isRenewal ? parseServiceLines(ef.services_json) : []);
      setExistingPoUrl(null);
      setPhaseChanged(true);
      setPhaseDate(todayStr());
    }
  }, [lead, expansionFrom, expansionMode, isAdmin, user?.id, user?.business_unit, isJHES]);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handlePhaseChange = (newPhase) => {
    const inactive = ['PO Received', 'Lost'].includes(newPhase);
    setForm(f => ({
      ...f,
      phase: newPhase,
      next_followup_date: inactive ? '' : addDaysStr(todayStr(), 14),
      // Entering On Hold: seed the resume/hold-until date so confidence freezes with an end date.
      hold_end_date: newPhase === 'On Hold' ? (f.hold_end_date || addDaysStr(todayStr(), 60)) : '',
    }));
    setPhaseDate(todayStr());
    setPhaseChanged(true);
  };

  // TCV/ACV auto-calculate from the Services Offered lines × contract period via the single shared
  // pricing engine, unless the BD overrides TCV by hand (tcv_manual). effectiveTcv is what's shown in
  // the field and persisted on save.
  const serviceTotals = computeServicesTotals(lines, form.contract_period_months);
  const computedTcv = serviceTotals.tcvLakhs > 0 ? serviceTotals.tcvLakhs : '';
  const effectiveTcv = form.tcv_manual ? form.potential_tcv_lakhs : computedTcv;
  const overrideTcv = () => setForm(f => ({ ...f, tcv_manual: true, potential_tcv_lakhs: computedTcv || 0 }));
  const useAutoTcv = () => setForm(f => ({ ...f, tcv_manual: false }));

  // First-year ACV: from the pricing engine for auto mode (OPEX annualised at its cadence, CAPEX full
  // in year 1); for a hand-typed TCV the whole value is annualised evenly.
  const acv = () => {
    if (form.tcv_manual) return computeAcvLakhs(form, { manual: true, manualTcv: form.potential_tcv_lakhs });
    return serviceTotals.acvLakhs > 0 ? serviceTotals.acvLakhs : null;
  };

  const addContact = () => setContacts(c => [...c, { name: '', phone: '', email: '', designation: '' }]);
  const updateContact = (i, key, val) => setContacts(c => c.map((row, idx) => idx === i ? { ...row, [key]: val } : row));
  const removeContact = (i) => setContacts(c => c.filter((_, idx) => idx !== i));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      // Global PO — a chain reference record only (no funnel, no POC, no scoring). Created in "new" mode.
      if (!lead && poType === 'global') {
        if (!globalForm.chain_name.trim()) { setError('Chain name is required.'); return; }
        const devices = parseInt(globalForm.device_total, 10);
        if (!Number.isFinite(devices) || devices < 0) { setError('Number of requirement must be a non-negative whole number.'); return; }
        if (!globalForm.device_type) { setError('Please select a type.'); return; }
        const savedGlobal = await createGlobalPo({
          chain_name: globalForm.chain_name.trim(),
          device_total: devices,
          device_type: globalForm.device_type,
          price_lakhs: globalForm.price_lakhs === '' ? null : parseFloat(globalForm.price_lakhs),
          expected_start_date: globalForm.expected_start_date || null,
          expected_end_date: globalForm.expected_end_date || null,
        });
        onSave(savedGlobal);
        return;
      }
      // Contacts (POC) — enforce only what the template marks mandatory. Empty rows are dropped.
      const nonEmptyContacts = contacts.filter(c => [c.name, c.email, c.phone, c.designation].some(v => String(v || '').trim()));
      const anyContactReq = contactCfg.nameReq || contactCfg.emailReq || contactCfg.phoneReq || contactCfg.desigReq;
      if (anyContactReq && nonEmptyContacts.length === 0) { setError('At least one contact (POC) is required.'); return; }
      for (const c of nonEmptyContacts) {
        if (contactCfg.nameReq && !String(c.name || '').trim()) { setError('Name is required for each contact.'); return; }
        if (contactCfg.emailReq && !String(c.email || '').trim()) { setError('Email is required for each contact.'); return; }
        if (contactCfg.phoneReq && !String(c.phone || '').trim()) { setError('Phone is required for each contact.'); return; }
        if (contactCfg.desigReq && !String(c.designation || '').trim()) { setError('Designation is required for each contact.'); return; }
      }
      // Mandatory custom fields defined in the business template.
      for (const f of customFields) {
        if (!f.mandatory) continue;
        const v = custom[f.slug];
        if (v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0)) {
          setError(`${f.label} is required.`);
          return;
        }
      }
      // A PO document is mandatory once a deal is marked PO Received.
      if (form.phase === 'PO Received' && !existingPoUrl && !poFile) {
        setError('A PO document is required once the phase is PO Received.');
        return;
      }
      // Once the PO document is attached, its PO Number (identifier) is required.
      if (form.phase === 'PO Received' && (existingPoUrl || poFile) && !String(form.po_number || '').trim()) {
        setError('Please enter the PO Number for the received PO.');
        return;
      }
      const payload = {
        ...form,
        business_unit: user.business_unit,
        // Chain link — only when the property is marked as part of a chain (else standalone).
        global_po_id: linkToChain && form.global_po_id ? form.global_po_id : null,
        // In auto mode form.potential_tcv_lakhs isn't kept in sync — send the computed value.
        potential_tcv_lakhs: form.tcv_manual ? form.potential_tcv_lakhs : (computedTcv || ''),
        // Unified Services Offered line list (all businesses). Backend recomputes TCV/ACV from it.
        services: lines,
        lost_reason: form.phase === 'Lost' && form.lost_reason === 'Other' && lostOther.trim()
          ? `Other: ${lostOther.trim()}` : form.lost_reason,
        contacts: nonEmptyContacts,
        custom_fields: custom,
        phase_date: phaseChanged ? phaseDate : undefined,
        // Resume/hold-until date — only meaningful while On Hold (freezes confidence until manual resume).
        hold_end_date: form.phase === 'On Hold' ? (form.hold_end_date || undefined) : undefined,
        po_document_url: existingPoUrl,
        // Renewal flow: link this new lead back to the specific PO it renews.
        renewed_from_lead_id: (!lead && expansionFrom && expansionMode === 'renewal') ? expansionFrom.id : undefined,
      };

      let saved = lead ? await updateLead(lead.id, payload) : await createLead(payload);

      if (poFile) {
        const { url } = await uploadPoDocument(saved.id, poFile);
        saved = await updateLead(saved.id, { ...payload, po_document_url: url });
      }

      onSave(saved);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // Phase-date window: a BD may adjust it ±7 days ("New" can't be backdated — a lead starts today at
  // the earliest). Manager / Business Admin / Global Admin (any non-BD role) are unrestricted and may
  // set any date, so no min/max is applied for them.
  const isNewPhase = form.phase === 'New';
  // BDs can only backdate a phase change — up to 7 days back, no future dates. A phase change
  // records something that already happened. Non-BDs are unrestricted.
  const minPhaseDate = isBD ? addDaysStr(todayStr(), -7) : undefined;
  const maxPhaseDate = isBD ? todayStr() : undefined;
  const inactivePhase = ['PO Received', 'Lost'].includes(form.phase);

  // Extras helper — renders custom fields (from Edit Template) for one template section key,
  // inline as raw <div> children so they flow into whatever grid the caller is in. Returns null
  // when the section has no custom fields, so an unused injection point costs nothing.
  const KNOWN_SECTIONS = new Set(['account', 'location', 'source', 'classification', 'commercials', 'pipeline', 'po', 'dates', 'other']);
  const renderExtras = (sectionKey) => {
    const fields = customBySection.get(sectionKey);
    if (!fields || fields.length === 0) return null;
    return fields.map(f => (
      <FieldInput key={f.slug} field={f}
        value={custom[f.slug] ?? ''}
        onChange={(v) => setC(f.slug, v)}
        options={Array.isArray(f.options) ? f.options : []} />
    ));
  };
  // Any template section keys that DON'T map to a hardcoded LeadForm section — rendered at the
  // bottom as their own labelled block so user-created custom sections still appear somewhere.
  const extraSectionKeys = [...customBySection.keys()].filter(k => !KNOWN_SECTIONS.has(k));

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {leadsReadOnly && (
        <div style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#475569' }}>
          👁 Read-only — you can view this lead but not change it.
        </div>
      )}
      {expansionFrom && !lead && (
        <div style={{ background: '#e8f2ff', border: '1px solid #c7d2fe', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#0066d6', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>{expansionMode === 'renewal' ? '🔄' : '➕'}</span>
          <span>
            <strong>{expansionMode === 'renewal' ? 'Renewal of' : 'Additional PO for'} {expansionFrom.customer_name}</strong>
            {expansionFrom.lead_ref && <span style={{ color: '#0a84ff', fontFamily: 'monospace', marginLeft: 6 }}>· copied from {expansionFrom.lead_ref}</span>}
            <span style={{ color: '#64748b', marginLeft: 6, fontSize: 12 }}>
              {expansionMode === 'renewal'
                ? 'Statics, services and deal size copied from the PO being renewed. Adjust the dates and price.'
                : 'Static details filled in. Fill the services, deal size and dates fresh.'}
            </span>
          </span>
        </div>
      )}
      <fieldset disabled={leadsReadOnly} style={{ border: 'none', padding: 0, margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 22 }}>
      {error && <div className="badge badge-red" style={{ padding: '8px 12px', fontSize: 13 }}>{error}</div>}

      {/* PO Type — chosen at creation. An existing lead is always an Individual PO. Hidden when the
          business has disabled the PO Type field in Edit Template. */}
      {!lead && poTypeEnabled && !expansionFrom && (
        <section>
          <p className="section-title">PO Type</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {[
              { key: 'individual', title: 'Individual PO', desc: 'A property-level deal — enters the funnel and is scored.' },
              { key: 'global', title: 'Global PO (chain)', desc: 'A chain/account reference record — not tracked in the funnel.' },
            ].map(o => (
              <button key={o.key} type="button" onClick={() => setPoType(o.key)}
                style={{ flex: 1, minWidth: 200, textAlign: 'left', cursor: 'pointer', borderRadius: 10, padding: '12px 14px',
                  border: `2px solid ${poType === o.key ? '#0a84ff' : '#e2e8f0'}`, background: poType === o.key ? '#e8f2ff' : '#fff' }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>{o.title}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{o.desc}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Global PO sub-form — reference record only (no funnel, no scoring). */}
      {!lead && poType === 'global' && (
        <section>
          <p className="section-title">Global PO — Chain Reference</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Chain Name" required>
              <input required className="input" value={globalForm.chain_name} onChange={e => setGlobal('chain_name', e.target.value)} placeholder="e.g. Sunrise Hotels" />
            </Field>
            <Field label="Number of Requirement" required>
              <input required type="number" min="0" className="input" value={globalForm.device_total} onChange={e => setGlobal('device_total', e.target.value)} placeholder="Total capacity across the chain" />
            </Field>
            <Field label="Type" required>
              <select required className="input" value={globalForm.device_type} onChange={e => setGlobal('device_type', e.target.value)}>
                <option value="">Select type…</option>
                {(buConfig?.services || []).map(s => (
                  <option key={s.slug} value={s.label}>{s.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Price (₹ Lakhs)">
              <input type="number" step="0.01" min="0" className="input" value={globalForm.price_lakhs} onChange={e => setGlobal('price_lakhs', e.target.value)} />
            </Field>
            <Field label="Expected Start Date">
              <input type="date" className="input" value={globalForm.expected_start_date} onChange={e => setGlobal('expected_start_date', e.target.value)} />
            </Field>
            <Field label="Expected End Date">
              <input type="date" className="input" value={globalForm.expected_end_date} onChange={e => setGlobal('expected_end_date', e.target.value)} />
            </Field>
          </div>
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 10 }}>Saved for reference only — a Global PO does not enter the sales funnel and has no stage or confidence score. Devices consumed are tracked automatically as its Individual POs are won.</p>
        </section>
      )}

      {poType === 'individual' && (<>
      {/* Chain Mapping — link this Individual PO to a chain, or leave it standalone. Hidden when PO
          Type is disabled for this business (no Global POs → nothing to map to).
          For Additional/Renewal flows, chain mapping is inherited from the source lead automatically. */}
      {poTypeEnabled && !expansionFrom && (
      <section>
        <p className="section-title">Chain Mapping</p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#334155' }}>
          <input type="checkbox" checked={linkToChain} onChange={e => { setLinkToChain(e.target.checked); if (!e.target.checked) set('global_po_id', ''); }} />
          This property belongs to a chain
        </label>
        {linkToChain ? (
          <div style={{ marginTop: 10 }}>
            <Field label="Chain (Global PO)" required>
              <select required className="input" value={form.global_po_id} onChange={e => set('global_po_id', e.target.value)}>
                <option value="">Select a chain…</option>
                {chains.map(c => {
                  const s = c.status || {};
                  return <option key={c.id} value={c.id}>{c.chain_name} ({c.device_type || 'Hardware'}) — {s.consumed ?? 0} of {c.device_total} won{s.exceeded ? ' · exceeded' : ` · ${s.remaining} left`}</option>;
                })}
              </select>
            </Field>
            {chains.length === 0 && <p style={{ fontSize: 12, color: '#b45309', marginTop: 6 }}>No chains yet — create one first via New Lead → PO Type → Global PO.</p>}
          </div>
        ) : (
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>Standalone property — no chain mapping.</p>
        )}
      </section>
      )}
      {poTypeEnabled && expansionFrom && linkToChain && (
      <section>
        <p className="section-title">Chain Mapping</p>
        <p style={{ fontSize: 13, color: '#334155' }}>
          Linked to chain: <strong>{chains.find(c => String(c.id) === String(form.global_po_id))?.chain_name || '—'}</strong>
          <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 6 }}>(inherited from source PO)</span>
        </p>
      </section>
      )}

      {/* Account Mix — captured before the customer details (all businesses). Each field is driven by
          the template (Edit Template → Account section). Unchecking a field hides it here; unchecking
          both built-in fields with no custom fields hides the whole section. */}
      {accountSectionEnabled && (
        <section>
          <p className="section-title">Account Mix</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {propertyTypeEnabled && (
              <Field label="Property Type">
                {ptOther ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="input" style={{ flex: 1 }} placeholder="Enter property type" value={form.property_type} onChange={e => set('property_type', e.target.value)} autoFocus />
                    <button type="button" className="btn btn-sm" style={{ whiteSpace: 'nowrap' }} onClick={() => { setPtOther(false); set('property_type', ''); }}>✕</button>
                  </div>
                ) : (
                  <select className="input" value={form.property_type} onChange={e => {
                    if (e.target.value === 'Other') { setPtOther(true); set('property_type', ''); }
                    else set('property_type', e.target.value);
                  }}>
                    <option value="">Select type</option>
                    {PROPERTY_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                )}
              </Field>
            )}
            {propertyCategoryEnabled && (
              <Field label="Property Category">
                {pcOther ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="input" style={{ flex: 1 }} placeholder="Enter property category" value={form.property_category} onChange={e => set('property_category', e.target.value)} autoFocus />
                    <button type="button" className="btn btn-sm" style={{ whiteSpace: 'nowrap' }} onClick={() => { setPcOther(false); set('property_category', ''); }}>✕</button>
                  </div>
                ) : (
                  <select className="input" value={form.property_category} onChange={e => {
                    if (e.target.value === 'Other') { setPcOther(true); set('property_category', ''); }
                    else set('property_category', e.target.value);
                  }}>
                    <option value="">Select category</option>
                    {PROPERTY_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                )}
              </Field>
            )}
            {renderExtras('account')}
          </div>
        </section>
      )}

      {/* Section 1: Lead Info */}
      <section>
        <p className="section-title">Lead Information</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Customer Name" required>
            <input required className="input" value={form.customer_name} onChange={e => set('customer_name', e.target.value)} />
          </Field>
          <Field label="Lead Owner" required>
            {isAdmin ? (
              <select required className="input" value={form.owner_id} onChange={e => set('owner_id', e.target.value)}>
                <option value="">Select BD</option>
                {bds.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            ) : (
              <input className="input" value={user.name} readOnly disabled style={{ background: '#f8fafc' }} />
            )}
          </Field>
          {fieldOn('location', 'state') && (
            <Field label="State / UT" required={req('state')}>
              <select required={req('state')} className="input" value={form.state} onChange={e => set('state', e.target.value)}>
                <option value="">Select State / UT</option>
                {form.state && ![...INDIAN_STATES, ...UNION_TERRITORIES].includes(form.state) && <option value={form.state}>{form.state}</option>}
                <optgroup label="States">{INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}</optgroup>
                <optgroup label="Union Territories">{UNION_TERRITORIES.map(s => <option key={s} value={s}>{s}</option>)}</optgroup>
              </select>
            </Field>
          )}
          {fieldOn('location', 'city') && (
            <Field label="City" required={req('city')}><input required={req('city')} className="input" value={form.city} onChange={e => set('city', e.target.value)} /></Field>
          )}
          {renderExtras('location')}
          {fieldOn('source', 'lead_source') && (
          <Field label="Lead Source" required={req('lead_source')}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select required={req('lead_source')} className="input" style={{ flex: 1 }} value={form.lead_source} onChange={e => set('lead_source', e.target.value)}>
                <option value="">Select</option>
                {form.lead_source && !sourceOpts.includes(form.lead_source) && <option value={form.lead_source}>{form.lead_source}</option>}
                {sourceOpts.map(s => <option key={s}>{s}</option>)}
              </select>
              {showManage && <DropdownManager field="lead_source" label="Lead Source" onChange={loadDropdowns} />}
            </div>
          </Field>
          )}
          {form.lead_source === 'Channel Partner' && (
            <Field label="Channel Partner Name" required>
              {cpOther ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input required className="input" style={{ flex: 1 }} placeholder="Enter new channel partner name" value={form.channel_partner_name} onChange={e => set('channel_partner_name', e.target.value)} autoFocus />
                  {showManage && <DropdownManager field="channel_partner" label="Channel Partner" onChange={loadDropdowns} />}
                  <button type="button" className="btn btn-sm" style={{ whiteSpace: 'nowrap' }} onClick={() => { setCpOther(false); set('channel_partner_name', ''); }}>✕</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select required className="input" style={{ flex: 1 }} value={form.channel_partner_name}
                    onChange={e => {
                      if (e.target.value === '__other__') { setCpOther(true); set('channel_partner_name', ''); }
                      else set('channel_partner_name', e.target.value);
                    }}>
                    <option value="">Select channel partner</option>
                    {channelPartners.map(cp => <option key={cp} value={cp}>{cp}</option>)}
                    <option value="__other__">Other (enter name)…</option>
                  </select>
                  {showManage && <DropdownManager field="channel_partner" label="Channel Partner" onChange={loadDropdowns} />}
                </div>
              )}
            </Field>
          )}
          {form.lead_source === 'KAM' && (
            <Field label="KAM Name" required>
              <input required className="input" value={form.kam_name} onChange={e => set('kam_name', e.target.value)} placeholder="Key Account Manager name" />
            </Field>
          )}
          {form.lead_source === 'Lead Affiliate' && (
            <Field label="Affiliate Name" required>
              {isJHES ? (
                <>
                  {affOther ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input required className="input" style={{ flex: 1 }} placeholder="Enter new affiliate name" value={form.affiliate_name} onChange={e => set('affiliate_name', e.target.value)} autoFocus />
                      {showManage && <DropdownManager field="lead_affiliate" label="Lead Affiliate" onChange={loadDropdowns} />}
                      <button type="button" className="btn btn-sm" style={{ whiteSpace: 'nowrap' }} onClick={() => { setAffOther(false); set('affiliate_name', ''); }}>✕</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <select required className="input" style={{ flex: 1 }} value={form.affiliate_name}
                        onChange={e => {
                          if (e.target.value === '__other__') { setAffOther(true); set('affiliate_name', ''); }
                          else set('affiliate_name', e.target.value);
                        }}>
                        <option value="">Select affiliate</option>
                        {affiliates.map(a => <option key={a} value={a}>{a}</option>)}
                        <option value="__other__">Other (enter name)…</option>
                      </select>
                      {showManage && <DropdownManager field="lead_affiliate" label="Lead Affiliate" onChange={loadDropdowns} />}
                    </div>
                  )}
                </>
              ) : (
                <input required className="input" value={form.affiliate_name} onChange={e => set('affiliate_name', e.target.value)} placeholder="Lead affiliate name" />
              )}
            </Field>
          )}
          {renderExtras('source')}
          {/* New / Renewal is no longer a manual field. A plain new lead is auto-tagged "New";
              the "+ Additional PO" header flow tags leads "Expansion" (Additional) or "Renewal". */}
          {fieldOn('classification', 'lead_temperature') && (
            <Field label="Lead Rating" required={req('lead_temperature')}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <select required={req('lead_temperature')} className="input" style={{ flex: 1 }} value={form.lead_temperature} onChange={e => set('lead_temperature', e.target.value)}>
                  <option value="">Select</option>
                  {form.lead_temperature && !ratingOpts.includes(form.lead_temperature) && <option value={form.lead_temperature}>{form.lead_temperature}</option>}
                  {ratingOpts.map(r => <option key={r}>{r}</option>)}
                </select>
                {showManage && <DropdownManager field="lead_temperature" label="Lead Rating" onChange={loadDropdowns} />}
              </div>
            </Field>
          )}
          {fieldOn('classification', 'competitor') && (
            <Field label="Competitor"><input className="input" value={form.competitor} onChange={e => set('competitor', e.target.value)} placeholder="Optional" /></Field>
          )}
          <Field label="Campaign">
            <select className="input" value={form.campaign_id || ''} onChange={e => set('campaign_id', e.target.value)}>
              <option value="">— None —</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          {renderExtras('classification')}
        </div>
      </section>

      {/* Section 2: Services Offered — the shared, catalog-driven, three-category section (same for
          every business). The Global Admin defines the catalog in Edit Template; the BD picks items
          and sets OPEX/CAPEX, frequency, rate and qty here. */}
      <ServicesOffered catalog={buConfig?.services || []} contractMonths={form.contract_period_months}
        value={lines} onChange={setLines} readOnly={leadsReadOnly} />

      {/* Section 3: Deal Size — Contract Period first, since the auto-calculated TCV depends on it */}
      <section>
        <p className="section-title">Deal Size</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          {fieldOn('commercials', 'contract_period_months') && (
            <Field label="Contract Period (Months)" required={req('contract_period_months')}><input required={req('contract_period_months')} type="number" min="1" className="input" value={form.contract_period_months} onChange={e => set('contract_period_months', e.target.value)} /></Field>
          )}
          {fieldOn('commercials', 'potential_tcv_lakhs') && (
          <Field label="Potential TCV (Lakhs)" required={req('potential_tcv_lakhs')}>
            <input
              required={req('potential_tcv_lakhs')} type="number" step="0.01" min="0" className="input"
              value={effectiveTcv}
              readOnly={!form.tcv_manual}
              onChange={e => set('potential_tcv_lakhs', e.target.value)}
              style={!form.tcv_manual ? { background: '#f8fafc', color: '#334155' } : undefined}
              title={!form.tcv_manual ? 'Auto-calculated — click Override to edit' : undefined}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
              {form.tcv_manual ? (
                <>
                  <button type="button" className="btn btn-sm" onClick={useAutoTcv}>↻ Use auto-calc</button>
                  {computedTcv !== '' && <span style={{ fontSize: 11, color: '#94a3b8' }}>Auto-calc: ₹{computedTcv} L</span>}
                </>
              ) : (
                <>
                  <button type="button" className="btn btn-sm" onClick={overrideTcv}>✎ Override</button>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>
                    {computedTcv === ''
                      ? 'Auto-calc: add services with rate & quantity (and contract period), or Override to type a value.'
                      : 'Auto-calculated from services × contract period.'}
                  </span>
                </>
              )}
            </div>
          </Field>
          )}
          {fieldOn('commercials', 'po_validity_months') && (
            <Field label="PO Validity (Months)">
              <input type="number" min="1" className="input" value={form.po_validity_months} onChange={e => set('po_validity_months', e.target.value)} />
            </Field>
          )}
          {renderExtras('commercials')}
        </div>
        {acv() !== null && (
          <div className="badge badge-blue" style={{ marginTop: 10, padding: '6px 12px' }}>
            First-Year ACV: ₹{acv()} L/yr
            {!form.tcv_manual && lines.some(l => (l.hw && l.hw.nature === 'capex') || (l.svc && l.svc.nature === 'capex')) && (
              <span style={{ marginLeft: 6, fontWeight: 500 }}>· incl. one-time CAPEX in year 1</span>
            )}
          </div>
        )}
      </section>

      {/* Section 4: Phase & Timeline */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <p className="section-title" style={{ marginBottom: 0 }}>Phase & Timeline</p>
          {lead && hasConfidence(lead) && (() => {
            const c = Math.round(Number(lead.confidence_score));
            const band = confBand(c), t = confidenceTrend(lead);
            const mark = t === 'up' ? <span style={{ color: '#16a34a' }}>▲ up</span>
              : t === 'down' ? <span style={{ color: '#dc2626' }}>▼ down</span>
              : t === 'hold' ? <span style={{ color: '#0ea5e9' }}>❄ frozen</span>
              : <span style={{ color: '#94a3b8' }}>● flat</span>;
            return (
              <span title="Win-confidence score (auto-computed from stage + SLA decay)"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: band.bg, color: band.fg, borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 700 }}>
                Confidence {c}% <span style={{ fontSize: 11, fontWeight: 600 }}>{mark} vs last week</span>
              </span>
            );
          })()}
        </div>
        <p style={{ fontSize: 11, color: '#94a3b8', margin: '4px 0 12px' }}>Confidence is calculated automatically from the phase and its SLA decay — it is not editable.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Current Phase" required>
            <select required className="input" value={form.phase} onChange={e => handlePhaseChange(e.target.value)}>
              {PHASES.map(p => <option key={p}>{p}</option>)}
            </select>
          </Field>
          {!inactivePhase && fieldOn('pipeline', 'next_followup_date') && (
            <Field label="Next Follow-Up Date">
              <input type="date" className="input" value={form.next_followup_date} onChange={e => set('next_followup_date', e.target.value)} />
            </Field>
          )}
          {phaseChanged && (
            <Field label={`"${form.phase}" Date${isBD ? ' (today − up to 7 days back)' : ''}`}>
              <input type="date" className="input" value={phaseDate} min={minPhaseDate} max={maxPhaseDate} onChange={e => setPhaseDate(e.target.value)} />
              <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                {!isBD
                  ? 'Defaults to today. You can set any date.'
                  : 'Defaults to today. You can backdate up to 7 days if this phase actually happened earlier — no future dates.'}
              </p>
            </Field>
          )}
          {form.phase === 'On Hold' && (
            <Field label="Resume / Hold-until Date">
              <input type="date" className="input" value={form.hold_end_date} onChange={e => set('hold_end_date', e.target.value)} />
              <p style={{ fontSize: 11, color: '#0ea5e9', marginTop: 4 }}>Confidence is frozen while On Hold. Reaching this date does not auto-resume — move the phase back manually to restart the lead.</p>
            </Field>
          )}
          {form.phase === 'Lost' && fieldOn('other', 'lost_reason') && (
            <Field label="Lost Reason" required>
              {form.lost_reason === 'Other' ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="input" style={{ flex: 1 }} placeholder="Please describe the reason…" value={lostOther} onChange={e => setLostOther(e.target.value)} autoFocus />
                  <button type="button" className="btn btn-sm" style={{ whiteSpace: 'nowrap' }} onClick={() => { set('lost_reason', ''); setLostOther(''); }}>✕</button>
                </div>
              ) : (
                <select required className="input" value={form.lost_reason} onChange={e => set('lost_reason', e.target.value)}>
                  <option value="">Select reason</option>
                  {LOST_REASONS.map(r => <option key={r}>{r}</option>)}
                </select>
              )}
            </Field>
          )}
          {form.phase === 'PO Received' && fieldOn('dates', 'service_start_date') && (
            <Field label="PO Start Date" required>
              <input type="date" required className="input" value={form.service_start_date} onChange={e => set('service_start_date', e.target.value)} />
            </Field>
          )}
          {form.phase === 'PO Received' && fieldOn('dates', 'service_end_date') && (
            <Field label="PO End Date" required>
              <input type="date" required min={form.service_start_date || undefined} className="input" value={form.service_end_date} onChange={e => set('service_end_date', e.target.value)} />
            </Field>
          )}
          {form.phase === 'PO Received' && (() => {
            const BILLING_OPTS = ['Monthly', 'Quarterly', 'Semi-annually', 'Annually', 'Advance'];
            const isCustomBilling = form.billing_cycle && !BILLING_OPTS.includes(form.billing_cycle);
            return (
              <Field label="Billing Cycle">
                {isCustomBilling ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="input" style={{ flex: 1 }} placeholder="Enter billing cycle" value={form.billing_cycle} onChange={e => set('billing_cycle', e.target.value)} autoFocus />
                    <button type="button" className="btn btn-sm" style={{ whiteSpace: 'nowrap' }} onClick={() => set('billing_cycle', '')}>✕</button>
                  </div>
                ) : (
                  <select className="input" value={form.billing_cycle} onChange={e => set('billing_cycle', e.target.value === 'Others' ? ' ' : e.target.value)}>
                    <option value="">Select billing cycle</option>
                    {BILLING_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                    <option value="Others">Others (type custom)</option>
                  </select>
                )}
              </Field>
            );
          })()}
          {form.phase === 'PO Received' && (() => {
            const PAYMENT_OPTS = ['100% Advance', '7 Days Credit', '15 Days Credit', '30 Days Credit', '45 Days Credit'];
            const isCustomPayment = form.payment_terms && !PAYMENT_OPTS.includes(form.payment_terms);
            return (
              <Field label="Payment Terms">
                {isCustomPayment ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="input" style={{ flex: 1 }} placeholder="Enter payment terms" value={form.payment_terms} onChange={e => set('payment_terms', e.target.value)} autoFocus />
                    <button type="button" className="btn btn-sm" style={{ whiteSpace: 'nowrap' }} onClick={() => set('payment_terms', '')}>✕</button>
                  </div>
                ) : (
                  <select className="input" value={form.payment_terms} onChange={e => set('payment_terms', e.target.value === 'Others' ? ' ' : e.target.value)}>
                    <option value="">Select payment terms</option>
                    {PAYMENT_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                    <option value="Others">Others (type custom)</option>
                  </select>
                )}
              </Field>
            );
          })()}
          <Field label="Hardware Requested Date">
            <input type="date" className="input" value={form.device_requested_date || ''} onChange={e => set('device_requested_date', e.target.value)} />
            <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>When the hardware for this deal is expected — used (and sorted by) in the Inventory Pipeline.</p>
          </Field>
          {fieldOn('pipeline', 'po_expected_date') && (
            <Field label="PO Expected Date" required={req('po_expected_date')}>
              <input type="date" required={req('po_expected_date')} className="input" value={form.po_expected_date} onChange={e => set('po_expected_date', e.target.value)} />
            </Field>
          )}
          {renderExtras('pipeline')}
          {renderExtras('dates')}
        </div>
      </section>

      {/* Section 5: Contacts — the whole section hides when the contacts section is off in the
          template (unless a custom field was added into it). Per-field visibility (Phone, Designation)
          is already driven by contactCfg. */}
      {sectionOn('contacts', ['contact_name', 'contact_email', 'contact_phone', 'contact_designation']) && (
      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p className="section-title" style={{ margin: 0 }}>Contacts (POC){(contactCfg.nameReq || contactCfg.emailReq || contactCfg.phoneReq || contactCfg.desigReq) ? ' *' : ''}</p>
          <button type="button" className="btn btn-sm" onClick={addContact}>+ Add Contact</button>
        </div>
        <p style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0 0' }}>Add the point(s) of contact for this deal.{(contactCfg.nameReq || contactCfg.emailReq) ? ' At least one contact is required.' : ''}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {contacts.map((c, i) => {
            const cols = ['1fr', ' 1fr', contactCfg.showPhone ? ' 1fr' : '', contactCfg.showDesig ? ' 1fr' : '', ' auto'].join('');
            return (
            <div key={i} className="card-sm" style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'end' }}>
              <Field label="Name" required={contactCfg.nameReq}><input required={contactCfg.nameReq} className="input" value={c.name} onChange={e => updateContact(i, 'name', e.target.value)} /></Field>
              <Field label="Email" required={contactCfg.emailReq}><input required={contactCfg.emailReq} type="email" className="input" value={c.email} onChange={e => updateContact(i, 'email', e.target.value)} /></Field>
              {contactCfg.showPhone && <Field label="Phone" required={contactCfg.phoneReq}><input required={contactCfg.phoneReq} className="input" value={c.phone} onChange={e => updateContact(i, 'phone', e.target.value)} /></Field>}
              {contactCfg.showDesig && <Field label="Designation" required={contactCfg.desigReq}><input required={contactCfg.desigReq} className="input" value={c.designation} onChange={e => updateContact(i, 'designation', e.target.value)} /></Field>}
              <button type="button" className="btn btn-sm btn-danger" onClick={() => removeContact(i)}>✕</button>
            </div>
            );
          })}
          {/* Only show the "required" prompt when the template actually marks a contact field mandatory.
              Otherwise contacts are optional, and an empty section must not read as an error. */}
          {contacts.length === 0 && (contactCfg.nameReq || contactCfg.emailReq) && (
            <p style={{ fontSize: 12, color: '#dc2626' }}>At least one contact (POC) is required — click “+ Add Contact”.</p>
          )}
        </div>
      </section>
      )}

      {/* Section 6: PO Document — the Document uploader and PO Number input each follow the template.
          po_type (Chain vs Individual) is already gated above by poTypeEnabled. Whole section hides
          when both built-in fields are off AND no custom fields were added into 'po'. */}
      {(fieldOn('po', 'po_document_url') || fieldOn('po', 'po_number') || customBySection.get('po')) && (
      <section>
        <p className="section-title">PO Document{form.phase === 'PO Received' && fieldOn('po', 'po_document_url') ? ' *' : ''}</p>
        {fieldOn('po', 'po_document_url') && (<>
          {form.phase === 'PO Received' && !existingPoUrl && !poFile && (
            <p style={{ fontSize: 12, color: '#dc2626', margin: '0 0 8px' }}>A PO document is required once the phase is PO Received.</p>
          )}
          {existingPoUrl && !poFile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div className="badge badge-green" style={{ padding: '6px 12px' }}>
                <a href={fileUrl(existingPoUrl)} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>📄 View uploaded document</a>
              </div>
              <button type="button" className="btn btn-sm" style={{ color: '#dc2626', fontSize: 11 }}
                onClick={() => { if (window.confirm('Remove the uploaded PO document?')) setExistingPoUrl(null); }}>
                🗑 Remove
              </button>
            </div>
          )}
          <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={e => setPoFile(e.target.files[0] || null)} />
        </>)}
        {/* PO Number is asked for ONLY after a PO document is attached (identifier for the received PO). */}
        {fieldOn('po', 'po_number') && form.phase === 'PO Received' && (poFile || existingPoUrl) && (
          <div style={{ marginTop: 12 }}>
            <Field label="PO Number" required>
              <input required className="input" value={form.po_number} onChange={e => set('po_number', e.target.value)} placeholder="Enter PO number (identifier)" />
              <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>A unique identifier for the received PO — required once the document is attached.</p>
            </Field>
          </div>
        )}
        {customBySection.get('po') && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 12 }}>
            {renderExtras('po')}
          </div>
        )}
      </section>
      )}

      {/* Section 7: Notes — the whole section hides when 'other' is off in the template, unless custom
          fields were added into it. Lost Reason also lives in 'other' but renders in Phase & Timeline. */}
      {(fieldOn('other', 'additional_notes') || customBySection.get('other')) && (
        <section>
          {fieldOn('other', 'additional_notes') && (
            <>
              <p className="section-title">Additional Notes</p>
              <MentionTextarea
                value={form.additional_notes || ''}
                onChange={val => set('additional_notes', val)}
                placeholder="Add notes… Use @Name to mention someone"
                className="input"
                rows={4}
                style={{ resize: 'vertical' }}
              />
            </>
          )}
          {customBySection.get('other') && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 12 }}>
              {renderExtras('other')}
            </div>
          )}
        </section>
      )}

      {/* Any user-created custom template sections (i.e. sections whose key doesn't match a
          hardcoded LeadForm section) are surfaced here, each as its own labelled block. Standard
          template sections are injected inline above and never land in this bottom pile. */}
      {extraSectionKeys.map(key => {
        const fields = customBySection.get(key) || [];
        const label = fields[0]?._sectionLabel || key;
        return (
          <section key={key}>
            <p className="section-title">{label}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {renderExtras(key)}
            </div>
          </section>
        );
      })}
      </>)}

      {/* History (Audit Trail) — only shown when editing an existing lead */}
      {lead && lead.id && (
        <section>
          <p className="section-title">History</p>
          <AuditTimeline entityType="lead" entityId={lead.id} />
        </section>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : (lead ? 'Save Changes' : (poType === 'global' ? 'Create Global PO' : 'Create Lead'))}</button>
      </div>
      </fieldset>
    </form>
  );
}
