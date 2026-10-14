import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getBds, getDropdowns, getBusinessUnitConfig, createLead, updateLead, getGlobalPos, createGlobalPo, getCampaigns } from '../services/api';
import { STAGE_ORDER, INDIAN_STATES, UNION_TERRITORIES } from '../utils/constants';
import { todayStr, addDaysStr } from '../utils/leadHelpers';
import MentionTextarea from './MentionTextarea';
import ServicesOffered, { parseServiceLines } from './ServicesOffered';
import AuditTimeline from './AuditTimeline';

// Schema-driven lead form for CUSTOM (wizard-built) business units. It renders exactly the sections
// and fields configured for that business (business_units.config.formSchema): predefined ("core")
// fields map to their leads columns, custom fields save to leads.custom_fields (JSON), and the
// services chosen in the wizard render with rate/qty and auto-calc TCV (stored the JSON way). The
// three original businesses keep their own hand-built LeadForm instead of this.
const STATE_OPTIONS = [...INDIAN_STATES, ...UNION_TERRITORIES];
const SOURCE_KINDS = ['Channel Partner', 'KAM', 'Lead Affiliate'];
// Source kind -> { the lead column, the dropdown field it's stored under, the label }.
const SOURCE_META = {
  'Channel Partner': { field: 'channel_partner_name', dd: 'channel_partner', label: 'Channel Partner Name' },
  'KAM': { field: 'kam_name', dd: 'kam', label: 'KAM Name' },
  'Lead Affiliate': { field: 'affiliate_name', dd: 'lead_affiliate', label: 'Affiliate Name' },
};
// Fields rendered by dedicated controls (not the generic section loop): stage, PO type (shown as
// cards), PO document, and the three lead-source name fields (shown inline under Lead Source).
const SKIP = new Set(['phase', 'next_followup_date', 'po_expected_date', 'lost_reason', 'po_type', 'po_document_url', 'channel_partner_name', 'kam_name', 'affiliate_name',
  // new_or_renewal is no longer a manual field — plain new leads auto-tag "New"; the "+ Additional PO"
  // header flow tags leads "Expansion" (Additional) or "Renewal".
  'new_or_renewal',
  // Contacts fields are rendered by the dedicated Contacts (POC) sub-form, not the generic loop.
  'contact_name', 'contact_email', 'contact_phone', 'contact_designation',
  'billing_cycle', 'payment_terms']);
const LOST_REASONS = ['Pricing', 'Competition', 'No Budget', 'No Decision', 'Timing', 'Product Fit', 'Other'];
// Sections that come AFTER Phase & Timeline in the original form layout.
const AFTER_PHASE = new Set(['po', 'dates', 'other']);

export default function CustomLeadForm({ lead, onSave, onCancel, buConfig, expansionFrom = null, expansionMode = 'additional' }) {
  const { user } = useAuth();
  const [cfg, setCfg] = useState(null);
  const [bds, setBds] = useState([]);
  const [dropdowns, setDropdowns] = useState({});
  const [form, setForm] = useState({});       // core field slug -> value (also owner_id, phase, contract_period_months)
  const [custom, setCustom] = useState({});   // custom field slug -> value
  const [lines, setLines] = useState([]);     // Services Offered line list (services_json shape)
  const [poType, setPoType] = useState('individual');   // individual (a lead) | global (a chain record)
  const [linkToChain, setLinkToChain] = useState(false);
  const [chains, setChains] = useState([]);
  const [globalForm, setGlobalForm] = useState({ chain_name: '', device_total: '', device_type: '', price_lakhs: '', expected_start_date: '', expected_end_date: '' });
  const [contacts, setContacts] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([getBusinessUnitConfig(user.business_unit), getBds(user.business_unit), getDropdowns(), getGlobalPos().catch(() => []), getCampaigns().catch(() => [])])
      .then(([config, bdList, dd, chainList, campaignList]) => {
        setCfg(config);
        setBds(bdList || []);
        setDropdowns(dd || {});
        setChains(chainList || []);
        setCampaigns(campaignList || []);
        // Seed the Services Offered lines from the lead's stored services_json (new v2 shape).
        // On a Renewal, carry over the source PO's services; a plain/additional new lead starts blank.
        const isRenewal = !lead && expansionFrom && expansionMode === 'renewal';
        setLines(lead ? parseServiceLines(lead.services_json) : (isRenewal ? parseServiceLines(expansionFrom.services_json) : []));
        // Seed form + custom values from an existing lead (edit) or blanks (create).
        if (lead) {
          setForm({ owner_id: lead.owner_id || '', phase: lead.phase || 'New', contract_period_months: lead.contract_period_months || '', global_po_id: lead.global_po_id || '', campaign_id: lead.campaign_id || '', next_followup_date: lead.next_followup_date || '', po_expected_date: lead.po_expected_date || '', device_requested_date: lead.device_requested_date || '', lost_reason: lead.lost_reason || '', ...pickCore(lead, config) });
          setCustom(lead.custom_fields || {});
          setContacts((lead.contacts || []).map(c => ({ name: c.name, phone: c.phone || '', email: c.email || '', designation: c.designation || '' })));
          if (lead.global_po_id) setLinkToChain(true);
        } else {
          // NEW lead flow. Three cases:
          //   plain new  → blank, auto-tagged "New".
          //   additional → copy STATIC fields from the source lead; tagged "Expansion".
          //   renewal    → copy statics PLUS deal size; tagged "Renewal", linked to the source PO.
          const ef = expansionFrom || null;
          const renewal = ef && expansionMode === 'renewal';
          const base = { owner_id: ef?.owner_id || '', phase: 'New', contract_period_months: '', next_followup_date: '', po_expected_date: '', device_requested_date: '', lost_reason: '', new_or_renewal: 'New' };
          if (ef) {
            // Copy any core-field slug that the saved template tracks AND the source lead has a value for.
            Object.assign(base, pickCore(ef, config));
            // Overwrite the key statics explicitly (pickCore respects the schema but we also want these
            // regardless of whether the custom template toggled them off at some point).
            if (ef.customer_name) base.customer_name = ef.customer_name;
            if (ef.property_type) base.property_type = ef.property_type;
            if (ef.property_category) base.property_category = ef.property_category;
            if (ef.state) base.state = ef.state;
            if (ef.city) base.city = ef.city;
            if (ef.lead_source) base.lead_source = ef.lead_source;
            if (ef.channel_partner_name) base.channel_partner_name = ef.channel_partner_name;
            if (ef.kam_name) base.kam_name = ef.kam_name;
            if (ef.affiliate_name) base.affiliate_name = ef.affiliate_name;
            if (ef.lead_temperature) base.lead_temperature = ef.lead_temperature;
            base.new_or_renewal = renewal ? 'Renewal' : 'Expansion';
            // Renewal repeats the same contract — copy its deal size so only dates/price change.
            if (renewal) {
              base.contract_period_months = ef.contract_period_months || '';
              base.potential_tcv_lakhs = ef.potential_tcv_lakhs || '';
              base.po_validity_months = ef.po_validity_months || '';
            }
          }
          if (ef && ef.global_po_id) {
            base.global_po_id = ef.global_po_id;
            setLinkToChain(true);
          } else {
            setLinkToChain(false);
          }
          setForm(base);
          setCustom({});
          const copiedContacts = ef && Array.isArray(ef.contacts) && ef.contacts.length
            ? ef.contacts.map(c => ({ name: c.name || '', phone: c.phone || '', email: c.email || '', designation: c.designation || '' }))
            : [{ name: '', phone: '', email: '', designation: '' }];
          setContacts(copiedContacts);
        }
      })
      .catch(e => setErr(e.response?.data?.message || 'Could not load this business template.'));
  }, [user.business_unit, lead, expansionFrom, expansionMode]);

  const sections = useMemo(() => (cfg ? cfg.formSchema.sections.filter(s => s.enabled) : []), [cfg]);

  // Contacts (POC) config from the template: Name & Email are always shown/required; Phone and
  // Designation can be hidden or made mandatory per business. Defaults to shown/optional when the
  // template has no contacts section yet (older businesses).
  const contactCfg = useMemo(() => {
    const sec = (cfg?.formSchema?.sections || []).find(s => s.key === 'contacts');
    const f = (slug) => sec && sec.fields ? sec.fields.find(x => x.slug === slug) : null;
    const p = f('contact_phone'), d = f('contact_designation'), n = f('contact_name'), e = f('contact_email');
    return {
      showPhone: p ? p.enabled !== false : true, phoneReq: p ? !!p.mandatory : false,
      showDesig: d ? d.enabled !== false : true, desigReq: d ? !!d.mandatory : false,
      nameReq: n ? !!n.mandatory : false, emailReq: e ? !!e.mandatory : false,
    };
  }, [cfg]);
  // Mandatory resolver for CustomLeadForm's hardcoded (non-generic) fields. Only Customer Name, Phase
  // and the structural Lead Owner are always required; everything else follows the template.
  const mandatoryOf = useMemo(() => {
    const m = {};
    for (const sec of (cfg?.formSchema?.sections || [])) for (const f of (sec.fields || [])) m[f.slug] = !!f.mandatory;
    return m;
  }, [cfg]);
  const reqField = (slug) => slug === 'customer_name' || slug === 'phase' || slug === 'owner_id' || !!mandatoryOf[slug];

  const setF = (slug, v) => setForm(f => ({ ...f, [slug]: v }));
  const setC = (slug, v) => setCustom(c => ({ ...c, [slug]: v }));
  const addContact = () => setContacts(c => [...c, { name: '', phone: '', email: '', designation: '' }]);
  const updateContact = (i, key, val) => setContacts(c => c.map((row, idx) => idx === i ? { ...row, [key]: val } : row));
  const removeContact = (i) => setContacts(c => c.filter((_, idx) => idx !== i));

  // Options for a select field: lead_source (and channel/kam) come from managed dropdowns; state from
  // the states list; everything else from the field's own options.
  const optionsFor = (f) => {
    if (f.slug === 'lead_source' || f.optionsFrom === 'dropdown:lead_source') {
      return [...new Set([...(dropdowns.lead_source || []), ...SOURCE_KINDS])];
    }
    if (f.slug === 'state') return STATE_OPTIONS;
    // Hide "Expansion" from the New/Renewal picker in the regular New Lead flow — Expansion leads
    // can ONLY be created from the + Expansion flow, which locks the field to "Expansion" itself.
    if (f.slug === 'new_or_renewal') {
      const base = Array.isArray(f.options) ? f.options : [];
      return expansionFrom ? base : base.filter(o => o !== 'Expansion');
    }
    return Array.isArray(f.options) ? f.options : [];
  };
  const setGlobal = (k, v) => setGlobalForm(g => ({ ...g, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setErr('');

    // Global PO (chain) path: create a chain reference record, not a funnel lead.
    if (!lead && poType === 'global') {
      if (!globalForm.chain_name.trim()) { setErr('Chain Name is required.'); return; }
      setBusy(true);
      try {
        await createGlobalPo({
          chain_name: globalForm.chain_name.trim(),
          device_total: parseInt(globalForm.device_total, 10) || 0,
          device_type: globalForm.device_type,
          price_lakhs: globalForm.price_lakhs ? parseFloat(globalForm.price_lakhs) : null,
          expected_start_date: globalForm.expected_start_date || null,
          expected_end_date: globalForm.expected_end_date || null,
        });
        onSave();
      } catch (e2) { setErr(e2.response?.data?.message || 'Could not create the chain.'); setBusy(false); }
      return;
    }

    // Mandatory validation across enabled fields.
    for (const sec of sections) {
      for (const f of sec.fields) {
        if (!f.enabled || !f.mandatory || SKIP.has(f.slug)) continue;
        const val = f.core ? form[f.slug] : custom[f.slug];
        if (val === undefined || val === null || String(val).trim() === '') {
          setErr(`${f.label} is required.`); return;
        }
      }
    }
    if (!form.owner_id) { setErr('Lead Owner is required.'); return; }
    if (!form.customer_name || !String(form.customer_name).trim()) { setErr('Customer / Account Name is required.'); return; }
    if (form.lead_source === 'Channel Partner' && !String(form.channel_partner_name || '').trim()) { setErr('Channel Partner Name is required.'); return; }
    if (form.lead_source === 'KAM' && !String(form.kam_name || '').trim()) { setErr('KAM Name is required.'); return; }
    if (form.lead_source === 'Lead Affiliate' && !String(form.affiliate_name || '').trim()) { setErr('Affiliate Name is required.'); return; }
    // Contacts (POC) — enforce only what the template marks mandatory; drop empty rows.
    const nonEmptyContacts = contacts.filter(c => [c.name, c.email, c.phone, c.designation].some(v => String(v || '').trim()));
    const anyContactReq = contactCfg.nameReq || contactCfg.emailReq || contactCfg.phoneReq || contactCfg.desigReq;
    if (anyContactReq && nonEmptyContacts.length === 0) { setErr('At least one contact (POC) is required.'); return; }
    for (const c of nonEmptyContacts) {
      if (contactCfg.nameReq && !String(c.name || '').trim()) { setErr('Name is required for each contact.'); return; }
      if (contactCfg.emailReq && !String(c.email || '').trim()) { setErr('Email is required for each contact.'); return; }
      if (contactCfg.phoneReq && !String(c.phone || '').trim()) { setErr('Phone is required for each contact.'); return; }
      if (contactCfg.desigReq && !String(c.designation || '').trim()) { setErr('Designation is required for each contact.'); return; }
    }

    // Services Offered — the unified v2 line list. The backend recomputes TCV/ACV from it.
    const body = {
      ...form,
      business_unit: user.business_unit,
      global_po_id: linkToChain ? (form.global_po_id || null) : null,
      services: lines,
      custom_fields: custom,
      contacts: nonEmptyContacts,
      // Renewal copies the source PO's TCV verbatim — keep it manual so the backend doesn't recompute
      // it to 0 before the user has re-entered services. Plain/additional leads compute from services.
      tcv_manual: (!lead && expansionFrom && expansionMode === 'renewal'),
      // Renewal flow: link this new lead back to the specific PO it renews.
      renewed_from_lead_id: (!lead && expansionFrom && expansionMode === 'renewal') ? expansionFrom.id : undefined,
    };

    setBusy(true);
    try {
      if (lead) await updateLead(lead.id, body);
      else await createLead(body);
      onSave();
    } catch (e2) {
      setErr(e2.response?.data?.message || 'Could not save the lead.');
      setBusy(false);
    }
  };

  if (err && !cfg) return <div style={{ padding: 16, color: '#b91c1c', fontSize: 13 }}>{err}</div>;
  if (!cfg) return <div style={{ padding: 24, color: '#64748b' }}>Loading {user.business_unit} template…</div>;

  // The PO section / po_type field must be enabled in this business's template for the PO-type cards
  // and chain mapping to appear. Disabling PO Type in Edit Template hides them here.
  const poSection = sections.find(s => s.key === 'po');
  const poTypeField = poSection && poSection.fields.find(f => f.slug === 'po_type');
  const poEnabled = !!(poSection && poSection.enabled && poTypeField && poTypeField.enabled);

  // PO Type chooser (only when creating): an Individual PO is a funnel lead; a Global PO is a chain
  // reference record. Shown in both branches so the user can switch back.
  const poCards = poEnabled && !lead && !expansionFrom && (
    <div>
      <p className="section-title">PO TYPE</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <button type="button" onClick={() => setPoType('individual')} style={poCardStyle(poType === 'individual')}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Individual PO</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>A property-level deal — enters the funnel and is scored.</div>
        </button>
        <button type="button" onClick={() => setPoType('global')} style={poCardStyle(poType === 'global')}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Global PO (chain)</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>A chain/account reference record — not tracked in the funnel.</div>
        </button>
      </div>
    </div>
  );

  // Services Offered block — the shared catalog-driven, three-category section.
  const servicesBlock = (
    <ServicesOffered key="__services__" catalog={cfg.services || []} contractMonths={form.contract_period_months}
      value={lines} onChange={setLines} />
  );

  // Global PO branch — create a chain reference record instead of a lead.
  if (!lead && poType === 'global') {
    return (
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {poCards}
        <div>
          <p className="section-title">GLOBAL PO — CHAIN REFERENCE</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><label className="field-label">Chain Name *</label><input className="input" value={globalForm.chain_name} onChange={e => setGlobal('chain_name', e.target.value)} placeholder="e.g. Sunrise Hotels" /></div>
            <div><label className="field-label">Number of Requirement *</label><input className="input" type="number" min="0" value={globalForm.device_total} onChange={e => setGlobal('device_total', e.target.value)} /></div>
            <div>
              <label className="field-label">Type *</label>
              <select className="input" value={globalForm.device_type} onChange={e => setGlobal('device_type', e.target.value)}>
                <option value="">Select type…</option>
                {(cfg?.services || []).map(s => (
                  <option key={s.slug} value={s.label}>{s.label}</option>
                ))}
              </select>
            </div>
            <div><label className="field-label">Price (₹ Lakhs)</label><input className="input" type="number" step="0.01" value={globalForm.price_lakhs} onChange={e => setGlobal('price_lakhs', e.target.value)} /></div>
            <div><label className="field-label">Expected Start Date</label><input className="input" type="date" value={globalForm.expected_start_date} onChange={e => setGlobal('expected_start_date', e.target.value)} /></div>
            <div><label className="field-label">Expected End Date</label><input className="input" type="date" value={globalForm.expected_end_date} onChange={e => setGlobal('expected_end_date', e.target.value)} /></div>
          </div>
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 10 }}>Saved for reference only — a Global PO does not enter the sales funnel and has no stage or confidence score.</p>
        </div>
        {err && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '8px 12px', borderRadius: 8, fontSize: 13 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid #f1f5f9', paddingTop: 14 }}>
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Create Chain'}</button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
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
      {poCards}

      {/* Chain mapping — only when the PO Type is enabled in this business's template.
          For Additional/Renewal flows, chain mapping is inherited from the source lead. */}
      {poEnabled && !expansionFrom && (
      <div>
        <p className="section-title">CHAIN MAPPING</p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#334155' }}>
          <input type="checkbox" checked={linkToChain} onChange={e => { setLinkToChain(e.target.checked); if (!e.target.checked) setF('global_po_id', ''); }} />
          This property belongs to a chain
        </label>
        {linkToChain ? (
          <div style={{ marginTop: 10 }}>
            <label className="field-label">Chain (Global PO)</label>
            <select className="input" value={form.global_po_id || ''} onChange={e => setF('global_po_id', e.target.value)}>
              <option value="">Select a chain…</option>
              {chains.map(c => <option key={c.id} value={c.id}>{c.chain_name} ({c.device_type || 'Hardware'})</option>)}
            </select>
            {chains.length === 0 && <p style={{ fontSize: 12, color: '#b45309', marginTop: 6 }}>No chains yet — create one via New Lead → PO Type → Global PO.</p>}
          </div>
        ) : <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>Standalone property — no chain mapping.</p>}
      </div>
      )}
      {poEnabled && expansionFrom && linkToChain && (
      <div>
        <p className="section-title">CHAIN MAPPING</p>
        <p style={{ fontSize: 13, color: '#334155' }}>
          Linked to chain: <strong>{chains.find(c => String(c.id) === String(form.global_po_id))?.chain_name || '—'}</strong>
          <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 6 }}>(inherited from source PO)</span>
        </p>
      </div>
      )}

      {/* Structural: owner, always present at the top */}
      <div>
        <p className="section-title">LEAD OWNER</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label className="field-label">Lead Owner *</label>
            <select className="input" value={form.owner_id} onChange={e => setF('owner_id', e.target.value)}>
              <option value="">Select owner</option>
              {bds.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Campaign</label>
            <select className="input" value={form.campaign_id || ''} onChange={e => setF('campaign_id', e.target.value)}>
              <option value="">— None —</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Configured sections BEFORE Phase & Timeline (Account, Source, Services, Commercials). */}
      {sections.filter(s => !AFTER_PHASE.has(s.key)).map(sec => {
        const fields = sec.fields.filter(f => f.enabled && !SKIP.has(f.slug));
        const sectionEl = fields.length === 0 ? null : (
          <div key={sec.key}>
            <p className="section-title">{sec.label.toUpperCase()}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {fields.flatMap(f => {
                const el = (
                  <FieldInput key={f.slug} field={f}
                    value={f.core ? (form[f.slug] ?? '') : (custom[f.slug] ?? '')}
                    onChange={(v) => (f.core ? setF(f.slug, v) : setC(f.slug, v))}
                    options={optionsFor(f)} />
                );
                if (f.slug === 'lead_source' && SOURCE_KINDS.includes(form.lead_source)) {
                  return [el, <SourceNameField key={`srcname-${form.lead_source}`} leadSource={form.lead_source} form={form} setF={setF} dropdowns={dropdowns} />];
                }
                return [el];
              })}
            </div>
          </div>
        );
        if (sec.key === 'commercials') {
          return <React.Fragment key={sec.key}>{servicesBlock}{sectionEl}</React.Fragment>;
        }
        return sectionEl;
      })}
      {!sections.some(s => s.key === 'commercials') && servicesBlock}

      {/* Phase & Timeline — between Commercials and Contacts, matching original LeadForm */}
      {(() => {
        const inactivePhase = ['PO Received', 'Lost'].includes(form.phase);
        return (
          <div>
            <p className="section-title">PHASE & TIMELINE</p>
            <p style={{ fontSize: 11, color: '#94a3b8', margin: '-6px 0 12px' }}>Confidence is calculated automatically from the phase and its SLA decay — it is not editable.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="field-label">Current Phase *</label>
                <select className="input" value={form.phase} onChange={e => setF('phase', e.target.value)}>
                  {STAGE_ORDER.map(st => <option key={st} value={st}>{st}</option>)}
                </select>
              </div>
              {!inactivePhase && (
                <div>
                  <label className="field-label">Next Follow-Up Date</label>
                  <input type="date" className="input" value={form.next_followup_date} onChange={e => setF('next_followup_date', e.target.value)} />
                </div>
              )}
              {form.phase === 'Lost' && (() => {
                const isCustomLost = form.lost_reason && !LOST_REASONS.includes(form.lost_reason) && form.lost_reason !== 'Other';
                return (
                  <div>
                    <label className="field-label">Lost Reason *</label>
                    {form.lost_reason === 'Other' || isCustomLost ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input className="input" style={{ flex: 1 }} placeholder="Please describe the reason…" value={isCustomLost ? form.lost_reason : ''} onChange={e => setF('lost_reason', e.target.value || 'Other')} autoFocus />
                        <button type="button" className="btn btn-sm" style={{ whiteSpace: 'nowrap' }} onClick={() => setF('lost_reason', '')}>✕</button>
                      </div>
                    ) : (
                      <select required className="input" value={form.lost_reason} onChange={e => setF('lost_reason', e.target.value)}>
                        <option value="">Select reason</option>
                        {LOST_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    )}
                  </div>
                );
              })()}
              {form.phase === 'On Hold' && (
                <div>
                  <label className="field-label">Resume / Hold-until Date</label>
                  <input type="date" className="input" value={form.hold_end_date || ''} onChange={e => setF('hold_end_date', e.target.value)} />
                  <p style={{ fontSize: 11, color: '#0ea5e9', marginTop: 4 }}>Confidence is frozen while On Hold.</p>
                </div>
              )}
              <div>
                <label className="field-label">Hardware Requested Date</label>
                <input type="date" className="input" value={form.device_requested_date || ''} onChange={e => setF('device_requested_date', e.target.value)} />
                <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>When the hardware for this deal is expected — used (and sorted by) in the Inventory Pipeline.</p>
              </div>
              <div>
                <label className="field-label">PO Expected Date{reqField('po_expected_date') ? ' *' : ''}</label>
                <input type="date" className="input" value={form.po_expected_date} onChange={e => setF('po_expected_date', e.target.value)} required={reqField('po_expected_date')} />
              </div>
              {form.phase === 'PO Received' && (() => {
                const BILLING_OPTS = ['Monthly', 'Quarterly', 'Semi-annually', 'Annually', 'Advance'];
                const isCustom = form.billing_cycle && !BILLING_OPTS.includes(form.billing_cycle);
                return (
                  <div>
                    <label className="field-label">Billing Cycle</label>
                    {isCustom ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input className="input" style={{ flex: 1 }} placeholder="Enter billing cycle" value={form.billing_cycle} onChange={e => setF('billing_cycle', e.target.value)} autoFocus />
                        <button type="button" className="btn btn-sm" style={{ whiteSpace: 'nowrap' }} onClick={() => setF('billing_cycle', '')}>✕</button>
                      </div>
                    ) : (
                      <select className="input" value={form.billing_cycle || ''} onChange={e => setF('billing_cycle', e.target.value === 'Others' ? ' ' : e.target.value)}>
                        <option value="">Select billing cycle</option>
                        {BILLING_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                        <option value="Others">Others (type custom)</option>
                      </select>
                    )}
                  </div>
                );
              })()}
              {form.phase === 'PO Received' && (() => {
                const PAYMENT_OPTS = ['100% Advance', '7 Days Credit', '15 Days Credit', '30 Days Credit', '45 Days Credit'];
                const isCustom = form.payment_terms && !PAYMENT_OPTS.includes(form.payment_terms);
                return (
                  <div>
                    <label className="field-label">Payment Terms</label>
                    {isCustom ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input className="input" style={{ flex: 1 }} placeholder="Enter payment terms" value={form.payment_terms} onChange={e => setF('payment_terms', e.target.value)} autoFocus />
                        <button type="button" className="btn btn-sm" style={{ whiteSpace: 'nowrap' }} onClick={() => setF('payment_terms', '')}>✕</button>
                      </div>
                    ) : (
                      <select className="input" value={form.payment_terms || ''} onChange={e => setF('payment_terms', e.target.value === 'Others' ? ' ' : e.target.value)}>
                        <option value="">Select payment terms</option>
                        {PAYMENT_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
                        <option value="Others">Others (type custom)</option>
                      </select>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        );
      })()}

      {/* Section: Contacts (POC) — between Phase & Timeline and PO/Dates/Other */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p className="section-title" style={{ margin: 0 }}>Contacts (POC){(contactCfg.nameReq || contactCfg.emailReq || contactCfg.phoneReq || contactCfg.desigReq) ? ' *' : ''}</p>
          <button type="button" className="btn btn-sm" onClick={addContact}>+ Add Contact</button>
        </div>
        <p style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0 0' }}>Add the point(s) of contact for this deal.{(contactCfg.nameReq || contactCfg.emailReq) ? ' At least one contact is required.' : ''}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
          {contacts.map((c, i) => {
            const cols = ['1fr', ' 1fr', contactCfg.showPhone ? ' 1fr' : '', contactCfg.showDesig ? ' 1fr' : '', ' auto'].join('');
            return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'end' }}>
              <div><label className="field-label">Name{contactCfg.nameReq ? ' *' : ''}</label><input required={contactCfg.nameReq} className="input" value={c.name} onChange={e => updateContact(i, 'name', e.target.value)} /></div>
              <div><label className="field-label">Email{contactCfg.emailReq ? ' *' : ''}</label><input required={contactCfg.emailReq} type="email" className="input" value={c.email} onChange={e => updateContact(i, 'email', e.target.value)} /></div>
              {contactCfg.showPhone && <div><label className="field-label">Phone{contactCfg.phoneReq ? ' *' : ''}</label><input required={contactCfg.phoneReq} className="input" value={c.phone} onChange={e => updateContact(i, 'phone', e.target.value)} /></div>}
              {contactCfg.showDesig && <div><label className="field-label">Designation{contactCfg.desigReq ? ' *' : ''}</label><input required={contactCfg.desigReq} className="input" value={c.designation} onChange={e => updateContact(i, 'designation', e.target.value)} /></div>}
              <button type="button" className="btn btn-sm btn-danger" onClick={() => removeContact(i)} style={{ marginBottom: 2 }}>✕</button>
            </div>
            );
          })}
          {contacts.length === 0 && <p style={{ fontSize: 12, color: '#dc2626' }}>At least one contact (POC) is required — click "+ Add Contact".</p>}
        </div>
      </div>

      {/* Sections AFTER Phase & Timeline (PO, Dates, Other). */}
      {sections.filter(s => AFTER_PHASE.has(s.key)).map(sec => {
        const fields = sec.fields.filter(f => f.enabled && !SKIP.has(f.slug));
        if (fields.length === 0) return null;
        return (
          <div key={sec.key}>
            <p className="section-title">{sec.label.toUpperCase()}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {fields.map(f => (
                <FieldInput key={f.slug} field={f}
                  value={f.core ? (form[f.slug] ?? '') : (custom[f.slug] ?? '')}
                  onChange={(v) => (f.core ? setF(f.slug, v) : setC(f.slug, v))}
                  options={optionsFor(f)} />
              ))}
            </div>
          </div>
        );
      })}

      {/* History (Audit Trail) — only shown when editing an existing lead */}
      {lead && lead.id && (
        <div>
          <p className="section-title">HISTORY</p>
          <AuditTimeline entityType="lead" entityId={lead.id} />
        </div>
      )}

      {err && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '8px 12px', borderRadius: 8, fontSize: 13 }}>{err}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid #f1f5f9', paddingTop: 14 }}>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : (lead ? 'Save changes' : 'Create Lead')}</button>
      </div>
    </form>
  );
}

// The name field shown inline under Lead Source. A dropdown of previously-saved names for this
// business (stored on save) plus "Other" to enter a new one.
function SourceNameField({ leadSource, form, setF, dropdowns }) {
  const meta = SOURCE_META[leadSource];
  const opts = (dropdowns && dropdowns[meta.dd]) || [];
  const val = form[meta.field] || '';
  const [other, setOther] = useState(!!val && !opts.includes(val));
  return (
    <div>
      <label className="field-label">{meta.label} *</label>
      <select className="input" value={other ? '__other__' : val}
        onChange={e => {
          if (e.target.value === '__other__') { setOther(true); setF(meta.field, ''); }
          else { setOther(false); setF(meta.field, e.target.value); }
        }}>
        <option value="">Select…</option>
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
        <option value="__other__">Other (enter name)…</option>
      </select>
      {other && <input className="input" style={{ marginTop: 8 }} placeholder="Enter new name" value={val} onChange={e => setF(meta.field, e.target.value)} />}
    </div>
  );
}

export function FieldInput({ field, value, onChange, options, optionLabels = {}, disabled = false }) {
  const label = <label className="field-label">{field.label}{field.mandatory ? ' *' : ''}</label>;
  const common = { className: 'input', value: value ?? '', disabled, onChange: e => onChange(e.target.value) };
  // optionLabels lets a caller show a different label for a stored value (e.g. value "Expansion"
  // displayed as "Additional") without changing what's actually saved.
  const labelOf = (o) => optionLabels[o] || o;
  let control;
  switch (field.type) {
    case 'textarea': control = <MentionTextarea className="input" rows={2} value={value ?? ''} disabled={disabled} onChange={v => onChange(v)} placeholder="Use @Name to mention someone" />; break;
    case 'number':   control = <input {...common} type="number" />; break;
    case 'decimal':  control = <input {...common} type="number" step="0.01" />; break;
    case 'date':     control = <input {...common} type="date" />; break;
    case 'checkbox': control = (
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, height: 38 }}>
        <input type="checkbox" checked={!!value} disabled={disabled} onChange={e => onChange(e.target.checked)} /> Yes
      </label>); break;
    case 'select': {
      const hasOther = options.includes('Other') || options.includes('Others');
      const standardOpts = hasOther ? options.filter(o => o !== 'Other' && o !== 'Others') : options;
      const isCustom = hasOther && value && value.trim() && !options.includes(value);
      if (hasOther && (isCustom || (value && !standardOpts.includes(value) && !options.includes(value)))) {
        control = (
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="input" style={{ flex: 1 }} placeholder={`Enter ${field.label.toLowerCase()}`} value={value.trim() ? value : ''} disabled={disabled} onChange={e => onChange(e.target.value || ' ')} autoFocus />
            <button type="button" className="btn btn-sm" style={{ whiteSpace: 'nowrap' }} disabled={disabled} onClick={() => onChange('')}>✕</button>
          </div>);
      } else {
        control = (
          <select {...common} onChange={e => {
            if (e.target.value === '__field_other__') onChange(' ');
            else onChange(e.target.value);
          }}>
            <option value="">Select…</option>
            {value && !options.includes(value) && value !== ' ' && <option value={value}>{labelOf(value)}</option>}
            {standardOpts.map(o => <option key={o} value={o}>{labelOf(o)}</option>)}
            {hasOther && <option value="__field_other__">Other (type custom)</option>}
          </select>);
      }
      break;
    }
    case 'multiselect': control = (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {options.map(o => {
          const arr = Array.isArray(value) ? value : [];
          return (
            <label key={o} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5 }}>
              <input type="checkbox" checked={arr.includes(o)} onChange={e => onChange(e.target.checked ? [...arr, o] : arr.filter(x => x !== o))} /> {o}
            </label>
          );
        })}
      </div>); break;
    default:         control = <input {...common} type="text" />;
  }
  return <div>{label}{control}</div>;
}

// Copy the enabled core (column-backed) field values off an existing lead for editing.
function pickCore(lead, config) {
  const out = {};
  for (const sec of config.formSchema.sections) {
    for (const f of sec.fields) {
      if (f.core && lead[f.slug] !== undefined) out[f.slug] = lead[f.slug] ?? '';
    }
  }
  return out;
}
function poCardStyle(active) {
  return { textAlign: 'left', padding: 14, borderRadius: 12, cursor: 'pointer',
    border: active ? '2px solid #0a84ff' : '2px solid #e2e8f0', background: active ? '#e8f2ff' : '#fff' };
}
