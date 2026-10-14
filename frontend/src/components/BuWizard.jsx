import React, { useEffect, useMemo, useState } from 'react';
import { getBuCatalog, createBusinessUnit } from '../services/api';

// Guided Business Unit creation wizard. A new unit starts from a TEMPLATE (the union of every
// business, or an existing one) and the admin then shapes it: opt sections in/out, toggle predefined
// fields, mark mandatory, ADD custom fields (choosing a type — dropdown/checkbox/text/…) inside any
// section, and ADD custom sections. Services, modules, dashboards, reports and an approval workflow
// follow.
//
// Storage framework: the whole sectioned schema is saved to business_units.config.formSchema (JSON).
// Predefined ("core") fields use their real leads columns; custom fields store their values in
// leads.custom_fields (JSON) — so a new field never needs a schema change. Live now: the unit, its
// services and SLA. Captured now / wired next: field-by-field lead-form rendering, module nav,
// dashboards, reports, workflow.
const STEPS = ['Basics', 'Sales Fields', 'Services', 'Modules', 'Dashboards', 'Reports', 'Workflow', 'Review'];
const PRESET_COLORS = ['#0a84ff', '#ea580c', '#0891b2', '#16a34a', '#db2777', '#7c3aed', '#0ea5e9', '#f59e0b'];
const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
const fieldSlugify = (s) => slugify(s).replace(/-/g, '_').slice(0, 64);
const APPROVER_ROLES = [
  { value: 'business_admin', label: 'Business Admin' },
  { value: 'pmo', label: 'Manager' },
  { value: 'bd', label: 'Business Development' },
];
// The three service catalog categories the Global Admin builds per business.
export const SERVICE_CATEGORIES = [
  { key: 'hardware',          title: 'Hardware',             hint: 'Devices / SKUs — flow into the Inventory Pipeline.' },
  { key: 'software',          title: 'Software / Services',  hint: 'Services & licences (OPEX recurring or CAPEX one-time). Do not flow to the Inventory Pipeline.' },
  { key: 'hardware_software', title: 'Hardware + Software',  hint: 'A device plus a licensing / service component — the hardware flows into the Inventory Pipeline.' },
];

export default function BuWizard({ onClose, onCreated }) {
  const [step, setStep] = useState(0);
  const [catalog, setCatalog] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const [basics, setBasics] = useState({ name: '', slug: '', description: '', color: PRESET_COLORS[0], business_type: '' });
  const [slugTouched, setSlugTouched] = useState(false);
  const [template, setTemplate] = useState('union');
  const [sections, setSections] = useState([]);   // [{ key, label, enabled, custom, collapsed, fields:[...] }]
  const [services, setServices] = useState([]);   // [{ slug, label, nature, enabled, custom }]
  const [modules, setModules] = useState([]);
  const [dashboards, setDashboards] = useState([]);
  const [reports, setReports] = useState([]);
  const [workflow, setWorkflow] = useState({ enabled: false, levels: [{ level: 1, approver_role: 'pmo' }] });
  const [newSection, setNewSection] = useState('');

  useEffect(() => {
    getBuCatalog()
      .then(cat => {
        setCatalog(cat);
        setSections(cat.fieldSections.map(sec => ({
          key: sec.key, label: sec.label, enabled: true, custom: false, collapsed: false,
          fields: sec.fields.map(f => ({ ...f, enabled: true, mandatory: false })),
        })));
        // Services start EMPTY — the admin builds this business's catalog from scratch, by category.
        setServices([]);
        setModules(cat.modules.map(m => ({ ...m, enabled: m.core || !m.optIn })));
      })
      .catch(e => setLoadErr(e.response?.data?.message || 'Could not load the field/service catalog.'));
  }, []);

  const onName = (v) => setBasics(b => ({ ...b, name: v, slug: slugTouched ? b.slug : slugify(v) }));

  // Template selection only affects the starting field/section set — services are always built from
  // scratch per business (no pre-filled service list).
  const applyTemplate = (val) => setTemplate(val);

  // ---- service catalog builder (grouped by category) ----
  const addService = (category, label, nature) => {
    const name = String(label || '').trim();
    if (!name) return;
    const slug = fieldSlugify(name);
    setServices(ss => ss.some(x => x.slug === slug) ? ss : [...ss, { slug, label: name, nature: nature || 'opex', category, enabled: true }]);
  };
  const removeService = (slug) => setServices(ss => ss.filter(x => x.slug !== slug));
  const setServiceNature = (slug, nature) => setServices(ss => ss.map(x => x.slug === slug ? { ...x, nature } : x));

  // ---- section / field mutations ----
  const patchSection = (key, fn) => setSections(secs => secs.map(s => s.key === key ? fn(s) : s));
  const toggleSection = (key) => patchSection(key, s => ({ ...s, enabled: !s.enabled }));
  const collapseSection = (key) => patchSection(key, s => ({ ...s, collapsed: !s.collapsed }));
  const setAllFields = (secKey, val) => patchSection(secKey, s => ({ ...s, fields: s.fields.map(f => ({ ...f, enabled: val })) }));
  const toggleField = (secKey, slug) => patchSection(secKey, s => ({ ...s, fields: s.fields.map(f => f.slug === slug ? { ...f, enabled: !f.enabled } : f) }));
  const toggleMandatory = (secKey, slug) => patchSection(secKey, s => ({ ...s, fields: s.fields.map(f => f.slug === slug ? { ...f, mandatory: !f.mandatory } : f) }));
  const removeField = (secKey, slug) => patchSection(secKey, s => ({ ...s, fields: s.fields.filter(f => !(f.slug === slug && f.custom)) }));

  const addCustomField = (secKey, draft) => {
    const label = draft.label.trim();
    if (!label) return false;
    const slug = fieldSlugify(label);
    const clash = sections.some(s => s.fields.some(f => f.slug === slug));
    if (clash) return false;
    const opts = (draft.type === 'select' || draft.type === 'multiselect')
      ? draft.options.split(',').map(o => o.trim()).filter(Boolean)
      : undefined;
    patchSection(secKey, s => ({ ...s, fields: [...s.fields, { slug, label, type: draft.type, options: opts, core: false, custom: true, enabled: true, mandatory: false }] }));
    return true;
  };

  const addCustomSection = () => {
    const label = newSection.trim();
    if (!label) return;
    const key = fieldSlugify(label) || `section_${sections.length + 1}`;
    if (sections.some(s => s.key === key)) { setNewSection(''); return; }
    setSections(secs => [...secs, { key, label, enabled: true, custom: true, collapsed: false, fields: [] }]);
    setNewSection('');
  };
  const removeSection = (key) => setSections(secs => secs.filter(s => !(s.key === key && s.custom)));

  const canNext = () => (step === 0 ? basics.name.trim() && slugify(basics.slug) : true);

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const config = {
        template,
        formSchema: {
          sections: sections.map(sec => ({
            key: sec.key, label: sec.label, enabled: sec.enabled, custom: !!sec.custom,
            fields: sec.fields.map(f => ({
              slug: f.slug, label: f.label, type: f.type, options: f.options || null,
              core: !!f.core, custom: !!f.custom, enabled: f.enabled, mandatory: f.mandatory,
            })),
          })),
        },
        services: services.map(s => ({ slug: s.slug, label: s.label, nature: s.nature, category: s.category || 'software', hardware: s.category === 'hardware' || s.category === 'hardware_software', enabled: s.enabled, custom: !!s.custom })),
        modules: modules.map(m => ({ slug: m.slug, enabled: m.enabled })),
        dashboards, reports,
        workflow: workflow.enabled ? workflow : { enabled: false, levels: [] },
      };
      await createBusinessUnit({
        slug: slugify(basics.slug), name: basics.name.trim(), description: basics.description,
        color: basics.color, business_type: basics.business_type, config,
      });
      onCreated();
    } catch (e) {
      setErr(e.response?.data?.message || 'Could not create the business unit.');
      setBusy(false);
      setStep(0);
    }
  };

  const totalFields = sections.reduce((n, s) => n + s.fields.filter(f => f.enabled && s.enabled).length, 0);

  // Deliberately NO close-on-backdrop-click: a stray click outside must not discard in-progress
  // wizard state. Use the × or Cancel button to close.
  return (
    <div style={ov.backdrop}>
      <div style={ov.modal}>
        <div style={{ padding: '18px 22px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>New Business Unit — Guided Setup</h2>
            <button onClick={onClose} style={ov.x}>×</button>
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 12 }}>
            {STEPS.map((label, i) => (
              <div key={label} style={{ fontSize: 11, fontWeight: 700, padding: '4px 9px', borderRadius: 999,
                background: i === step ? '#0a84ff' : i < step ? '#e0e7ff' : '#f1f5f9',
                color: i === step ? '#fff' : i < step ? '#0066d6' : '#94a3b8' }}>{i + 1}. {label}</div>
            ))}
          </div>
        </div>

        <div style={{ padding: 22, overflowY: 'auto', flex: 1 }}>
          {loadErr && <div style={ov.error}>{loadErr}</div>}
          {!catalog && !loadErr && <p style={{ fontSize: 13, color: '#64748b' }}>Loading the catalog from your existing businesses…</p>}

          {catalog && step === 0 && (
            <div>
              <Field label="Business name"><input style={ov.input} value={basics.name} onChange={e => onName(e.target.value)} autoFocus placeholder="e.g. Telecom" /></Field>
              <Field label="Slug (system id, fixed after creation)">
                <input style={{ ...ov.input, fontFamily: 'monospace' }} value={basics.slug}
                  onChange={e => { setSlugTouched(true); setBasics(b => ({ ...b, slug: slugify(e.target.value) })); }} placeholder="e.g. telecom" />
              </Field>
              <Field label="Start from template">
                <select style={ov.input} value={template} onChange={e => applyTemplate(e.target.value)}>
                  <option value="union">Union of all businesses (everything, then trim)</option>
                  {(catalog.templates || []).map(t => <option key={t.slug} value={t.slug}>Like {t.name}</option>)}
                </select>
                <div style={ov.hint}>A template pre-selects the services that business uses. You can still change everything in the next steps.</div>
              </Field>
              <Field label="Description"><input style={ov.input} value={basics.description} onChange={e => setBasics(b => ({ ...b, description: e.target.value }))} placeholder="Short description" /></Field>
              <Field label="Business type"><input style={ov.input} value={basics.business_type} onChange={e => setBasics(b => ({ ...b, business_type: e.target.value }))} placeholder="e.g. Hardware, SaaS, Services" /></Field>
              <Field label="Colour">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {PRESET_COLORS.map(c => (
                    <button type="button" key={c} onClick={() => setBasics(b => ({ ...b, color: c }))}
                      style={{ width: 28, height: 28, borderRadius: 7, background: c, cursor: 'pointer', border: basics.color === c ? '3px solid #0f172a' : '2px solid #e2e8f0' }} />
                  ))}
                </div>
              </Field>
            </div>
          )}

          {catalog && step === 1 && (
            <div>
              <Intro>Organise the lead form. Turn whole <b>sections</b> on/off, toggle predefined fields, mark mandatory, and <b>+ add custom fields</b> (choose a type — dropdown, checkbox, text…) inside any section. You can also add a new section.</Intro>
              {sections.map(sec => (
                <SectionCard key={sec.key} sec={sec} catalog={catalog}
                  onToggle={() => toggleSection(sec.key)} onCollapse={() => collapseSection(sec.key)}
                  onToggleField={(slug) => toggleField(sec.key, slug)} onToggleMandatory={(slug) => toggleMandatory(sec.key, slug)}
                  onRemoveField={(slug) => removeField(sec.key, slug)} onAddField={(draft) => addCustomField(sec.key, draft)}
                  onSetAllFields={(val) => setAllFields(sec.key, val)}
                  onRemoveSection={() => removeSection(sec.key)} />
              ))}
              <div style={ov.addRow}>
                <input style={{ ...ov.input, margin: 0 }} value={newSection} onChange={e => setNewSection(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomSection(); } }} placeholder="Add a custom section (e.g. Compliance)…" />
                <button type="button" className="btn btn-sm" style={ov.ghost} onClick={addCustomSection}>+ Section</button>
              </div>
            </div>
          )}

          {catalog && step === 2 && (
            <div>
              <Intro>Build the services {basics.name || 'this business'} offers. Add each item under its category and set a default OPEX/CAPEX. <b>Hardware</b> and <b>Hardware + Software</b> items flow into the Inventory Pipeline. BDs later pick these on the lead form — they cannot add new ones.</Intro>
              {SERVICE_CATEGORIES.map(cat => (
                <ServiceCategoryBuilder key={cat.key}
                  category={cat}
                  items={services.filter(s => (s.category || 'software') === cat.key)}
                  onAdd={(label, nature) => addService(cat.key, label, nature)}
                  onRemove={removeService}
                  onNature={setServiceNature} />
              ))}
            </div>
          )}

          {catalog && step === 3 && (
            <div>
              <Intro>Which modules/features should {basics.name || 'this business'} have? Core modules are always on.</Intro>
              {modules.map(m => (
                <div key={m.slug} style={ov.row}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: m.core ? 'default' : 'pointer' }}>
                    <input type="checkbox" checked={m.enabled} disabled={m.core} onChange={() => setModules(ms => ms.map(x => x.slug === m.slug && !x.core ? { ...x, enabled: !x.enabled } : x))} />
                    <span style={{ fontSize: 13, color: m.enabled ? '#0f172a' : '#94a3b8' }}>{m.label}{m.core && <span style={ov.pill}>core</span>}</span>
                  </label>
                </div>
              ))}
            </div>
          )}

          {catalog && step === 4 && <ChecklistStep title="Which dashboards does this business need?" note="Captured as settings — the per-business dashboard engine is a later phase." options={catalog.dashboards} selected={dashboards} setSelected={setDashboards} />}
          {catalog && step === 5 && <ChecklistStep title="Which reports does this business need?" note="Captured as settings — the per-business report builder is a later phase." options={catalog.reports} selected={reports} setSelected={setReports} />}

          {catalog && step === 6 && (
            <div>
              <Intro>Does {basics.name || 'this business'} require an approval workflow? Captured as settings — the approval engine is a later phase.</Intro>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 12 }}>
                <input type="checkbox" checked={workflow.enabled} onChange={e => setWorkflow(w => ({ ...w, enabled: e.target.checked }))} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>Require approvals for deals</span>
              </label>
              {workflow.enabled && (
                <div>
                  {workflow.levels.map((lv, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, width: 58 }}>Level {lv.level}</span>
                      <select style={{ ...ov.input, margin: 0, flex: 1 }} value={lv.approver_role}
                        onChange={e => setWorkflow(w => ({ ...w, levels: w.levels.map((x, j) => j === i ? { ...x, approver_role: e.target.value } : x) }))}>
                        {APPROVER_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                      {workflow.levels.length > 1 && <button type="button" style={ov.x} onClick={() => setWorkflow(w => ({ ...w, levels: w.levels.filter((_, j) => j !== i).map((x, k) => ({ ...x, level: k + 1 })) }))}>×</button>}
                    </div>
                  ))}
                  {workflow.levels.length < 3 && <button type="button" className="btn btn-sm" style={ov.ghost} onClick={() => setWorkflow(w => ({ ...w, levels: [...w.levels, { level: w.levels.length + 1, approver_role: 'business_admin' }] }))}>+ Add approval level</button>}
                </div>
              )}
            </div>
          )}

          {catalog && step === 7 && (
            <div>
              <Intro>Review — here's what will be created for <b>{basics.name}</b>.</Intro>
              <Summary label="Slug" value={slugify(basics.slug)} />
              <Summary label="Template" value={template === 'union' ? 'Union of all' : `Like ${(catalog.templates.find(t => t.slug === template) || {}).name || template}`} />
              <Summary label="Sections" value={sections.filter(s => s.enabled).map(s => s.label).join(', ')} />
              <Summary label="Fields enabled" value={`${totalFields} across ${sections.filter(s => s.enabled).length} sections`} />
              <Summary label="Custom fields" value={sections.flatMap(s => s.fields).filter(f => f.custom).map(f => f.label).join(', ') || '—'} />
              <Summary label="Services" value={services.filter(s => s.enabled).map(s => s.label).join(', ') || '—'} />
              <Summary label="Modules" value={modules.filter(m => m.enabled).map(m => m.label).join(', ')} />
              <Summary label="Dashboards" value={dashboards.join(', ') || '—'} />
              <Summary label="Reports" value={reports.join(', ') || '—'} />
              <Summary label="Approvals" value={workflow.enabled ? workflow.levels.map(l => `L${l.level}:${l.approver_role}`).join(', ') : 'None'} />
              <div style={{ ...ov.note, marginTop: 12 }}>Live immediately: the business, its {services.filter(s => s.enabled).length} services, and SLA. Captured for a later phase: field-by-field form rendering, module nav, dashboards, reports, and workflow.</div>
              {err && <div style={{ ...ov.error, marginTop: 12 }}>{err}</div>}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '14px 22px', borderTop: '1px solid #f1f5f9' }}>
          <button className="btn" style={ov.ghost} onClick={step === 0 ? onClose : () => setStep(s => s - 1)}>{step === 0 ? 'Cancel' : '← Back'}</button>
          {step < STEPS.length - 1
            ? <button className="btn" style={{ ...ov.primary, opacity: canNext() ? 1 : 0.5 }} disabled={!canNext() || !catalog} onClick={() => setStep(s => s + 1)}>Next →</button>
            : <button className="btn" style={ov.primary} disabled={busy} onClick={submit}>{busy ? 'Creating…' : 'Create Business Unit'}</button>}
        </div>
      </div>
    </div>
  );
}

// One collapsible, opt-in/out section with its predefined + custom fields and an add-field form.
export function SectionCard({ sec, catalog, onToggle, onCollapse, onToggleField, onToggleMandatory, onRemoveField, onAddField, onSetAllFields, onRemoveSection }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ label: '', type: 'text', options: '' });
  const typeMeta = catalog.fieldTypes.find(t => t.value === draft.type) || {};

  const submitField = () => {
    if (onAddField(draft)) { setDraft({ label: '', type: 'text', options: '' }); setAdding(false); }
  };

  return (
    <div style={{ border: '1px solid #e5e9f0', borderRadius: 10, marginBottom: 10, opacity: sec.enabled ? 1 : 0.6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: '#f8fafc', borderRadius: '10px 10px 0 0' }}>
        <input type="checkbox" checked={sec.enabled} onChange={onToggle} title="Include this section" />
        <button type="button" onClick={onCollapse} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#0f172a', flex: 1, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: '#94a3b8' }}>{sec.collapsed ? '▶' : '▼'}</span>
          {sec.label}
          {sec.custom && <span style={ov.pillGreen}>custom</span>}
          <span style={{ fontSize: 11, fontWeight: 500, color: '#94a3b8' }}>({sec.fields.filter(f => f.enabled).length}/{sec.fields.length})</span>
        </button>
        {sec.custom && <button type="button" style={ov.x} title="Remove section" onClick={onRemoveSection}>×</button>}
      </div>

      {!sec.collapsed && (
        <div style={{ padding: '8px 12px' }}>
          {sec.enabled && sec.fields.length > 1 && (
            <div style={{ display: 'flex', gap: 10, marginBottom: 4 }}>
              <button type="button" onClick={() => onSetAllFields(true)} style={ov.linkBtn}>Select all</button>
              <span style={{ color: '#cbd5e1' }}>·</span>
              <button type="button" onClick={() => onSetAllFields(false)} style={ov.linkBtn}>Select none</button>
            </div>
          )}
          {sec.fields.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8', padding: '4px 0' }}>No fields yet — add one below.</div>}
          {sec.fields.map(f => (
            <div key={f.slug} style={ov.row}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: 'pointer' }}>
                <input type="checkbox" checked={f.enabled} disabled={!sec.enabled} onChange={() => onToggleField(f.slug)} />
                <span style={{ fontSize: 13, color: f.enabled && sec.enabled ? '#0f172a' : '#94a3b8' }}>
                  {f.label}
                  <span style={ov.type}>{f.type}</span>
                  {Array.isArray(f.options) && f.options.length > 0 && <span style={{ fontSize: 10.5, color: '#94a3b8' }}> · {f.options.join(' / ')}</span>}
                  {f.custom && <span style={ov.pillGreen}>custom</span>}
                </span>
              </label>
              {f.enabled && sec.enabled && (
                <label style={{ fontSize: 11.5, color: '#64748b', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={f.mandatory} onChange={() => onToggleMandatory(f.slug)} /> mandatory
                </label>
              )}
              {f.custom && <button type="button" style={{ ...ov.x, fontSize: 16 }} title="Remove field" onClick={() => onRemoveField(f.slug)}>×</button>}
            </div>
          ))}

          {adding ? (
            <div style={{ background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 8, padding: 10, marginTop: 8 }}>
              <input style={{ ...ov.input, marginBottom: 6 }} value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} placeholder="Field label (e.g. GSTIN)" autoFocus />
              <div style={{ display: 'flex', gap: 6 }}>
                <select style={{ ...ov.input, margin: 0, flex: 1 }} value={draft.type} onChange={e => setDraft(d => ({ ...d, type: e.target.value }))}>
                  {catalog.fieldTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              {typeMeta.hasOptions && (
                <input style={{ ...ov.input, marginTop: 6 }} value={draft.options} onChange={e => setDraft(d => ({ ...d, options: e.target.value }))} placeholder="Options, comma-separated (e.g. Individual, Global)" />
              )}
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn btn-sm" style={ov.ghost} onClick={() => { setAdding(false); setDraft({ label: '', type: 'text', options: '' }); }}>Cancel</button>
                <button type="button" className="btn btn-sm" style={ov.primary} onClick={submitField}>Add field</button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-sm" style={{ ...ov.ghost, marginTop: 8 }} disabled={!sec.enabled} onClick={() => setAdding(true)}>+ Add custom field</button>
          )}
        </div>
      )}
    </div>
  );
}

// One category's catalog builder: the list of items added so far, plus an input to add a new one.
// The default OPEX/CAPEX is editable for every category (a "service" can be a one-time CAPEX charge
// like installation); category only decides whether the item flows to the Inventory Pipeline.
export function ServiceCategoryBuilder({ category, items, onAdd, onRemove, onNature }) {
  const defaultNature = category.key === 'software' ? 'opex' : 'capex';
  const [draft, setDraft] = useState({ label: '', nature: defaultNature });
  const add = () => {
    if (!draft.label.trim()) return;
    onAdd(draft.label, draft.nature);
    setDraft({ label: '', nature: defaultNature });
  };
  return (
    <div style={{ border: '1px solid #e5e9f0', borderRadius: 10, marginBottom: 12 }}>
      <div style={{ padding: '9px 12px', background: '#f8fafc', borderRadius: '10px 10px 0 0' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{category.title}</span>
        <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 8 }}>{category.hint}</span>
      </div>
      <div style={{ padding: '8px 12px' }}>
        {items.length === 0 && <p style={{ fontSize: 12, color: '#94a3b8', margin: '2px 0 8px' }}>No items yet — add the {category.title.toLowerCase()} this business offers.</p>}
        {items.map(s => (
          <div key={s.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: 13, flex: 1, color: '#0f172a' }}>{s.label}</span>
            <select value={s.nature} onChange={e => onNature(s.slug, e.target.value)} style={{ ...ov.input, margin: 0, width: 90, padding: '4px 6px' }}>
              <option value="opex">OPEX</option><option value="capex">CAPEX</option>
            </select>
            <button type="button" style={ov.x} title="Remove" onClick={() => onRemove(s.slug)}>×</button>
          </div>
        ))}
        <div style={ov.addRow}>
          <input style={{ ...ov.input, margin: 0, flex: 1 }} value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            placeholder={category.key === 'hardware' ? 'Add a device / SKU name…' : category.key === 'hardware_software' ? 'Add a hardware + software item…' : 'Add a service…'} />
          <select style={{ ...ov.input, margin: 0, width: 90 }} value={draft.nature} onChange={e => setDraft(d => ({ ...d, nature: e.target.value }))}>
            <option value="opex">OPEX</option><option value="capex">CAPEX</option>
          </select>
          <button type="button" className="btn btn-sm" style={ov.ghost} onClick={add}>+ Add</button>
        </div>
      </div>
    </div>
  );
}

export function SelectAllRow({ onAll, onNone }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
      <button type="button" onClick={onAll} style={ov.linkBtn}>Select all</button>
      <span style={{ color: '#cbd5e1' }}>·</span>
      <button type="button" onClick={onNone} style={ov.linkBtn}>Select none</button>
    </div>
  );
}

function ChecklistStep({ title, note, options, selected, setSelected }) {
  const toggle = (o) => setSelected(sel => sel.includes(o) ? sel.filter(x => x !== o) : [...sel, o]);
  return (
    <div>
      <Intro>{title}</Intro>
      <SelectAllRow onAll={() => setSelected([...options])} onNone={() => setSelected([])} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {options.map(o => (
          <label key={o} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', border: '1px solid #eef2f7', borderRadius: 8, cursor: 'pointer', background: selected.includes(o) ? '#e8f2ff' : '#fff' }}>
            <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} />
            <span style={{ fontSize: 13 }}>{o}</span>
          </label>
        ))}
      </div>
      <div style={{ ...ov.note, marginTop: 12 }}>{note}</div>
    </div>
  );
}

const Field = ({ label, children }) => (
  <div style={{ marginBottom: 12 }}>
    <label style={{ fontSize: 12, fontWeight: 600, color: '#334155', display: 'block', marginBottom: 6 }}>{label}</label>
    {children}
  </div>
);
const Intro = ({ children }) => <p style={{ fontSize: 12.5, color: '#64748b', margin: '0 0 14px', lineHeight: 1.5 }}>{children}</p>;
const Summary = ({ label, value }) => (
  <div style={{ display: 'flex', gap: 10, padding: '6px 0', borderBottom: '1px solid #f8fafc', fontSize: 13 }}>
    <span style={{ width: 130, color: '#94a3b8', flexShrink: 0 }}>{label}</span>
    <span style={{ color: '#0f172a', fontWeight: 500 }}>{value}</span>
  </div>
);

export const ov = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 },
  modal: { background: '#fff', borderRadius: 14, width: '100%', maxWidth: 580, maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(0,0,0,0.25)' },
  x: { background: 'none', border: 'none', fontSize: 20, lineHeight: 1, color: '#94a3b8', cursor: 'pointer' },
  input: { width: '100%', padding: '9px 11px', border: '1.5px solid #e2e8f0', borderRadius: 9, fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  primary: { background: '#0a84ff', color: '#fff', border: 'none' },
  ghost: { background: '#fff', color: '#334155', border: '1px solid #e2e8f0' },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '5px 0' },
  pill: { marginLeft: 6, fontSize: 9.5, fontWeight: 700, background: '#e8f2ff', color: '#0066d6', padding: '1px 6px', borderRadius: 999, textTransform: 'uppercase' },
  pillGreen: { marginLeft: 6, fontSize: 9.5, fontWeight: 700, background: '#ecfdf5', color: '#047857', padding: '1px 6px', borderRadius: 999, textTransform: 'uppercase' },
  type: { marginLeft: 6, fontSize: 9.5, fontWeight: 700, background: '#f1f5f9', color: '#64748b', padding: '1px 6px', borderRadius: 4, textTransform: 'uppercase' },
  addRow: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, borderTop: '1px dashed #e2e8f0', paddingTop: 12 },
  note: { background: '#f8fafc', border: '1px solid #eef2f7', borderRadius: 8, padding: '9px 11px', fontSize: 11.5, color: '#64748b', lineHeight: 1.5 },
  hint: { fontSize: 11, color: '#94a3b8', marginTop: 4 },
  linkBtn: { background: 'none', border: 'none', color: '#0a84ff', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 },
  error: { background: '#fee2e2', color: '#b91c1c', padding: '8px 12px', borderRadius: 8, fontSize: 13 },
};
