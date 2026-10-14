import React, { useEffect, useState } from 'react';
import { getBusinessUnitConfig, getBuCatalog, updateBusinessUnit } from '../services/api';
import { SectionCard, SelectAllRow, ov, ServiceCategoryBuilder, SERVICE_CATEGORIES } from './BuWizard';

// Edit an existing business unit's lead-intake TEMPLATE (its sectioned fields). Works for every
// business: the three originals get a template generated from their current fields (so they're
// editable too), and wizard-built units load their saved schema. Saving writes config.formSchema via
// PUT /business-units/:slug. Custom fields added here store their values in leads.custom_fields.
const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);

// Modules that default to ON when a BU has no explicit config.modules — mirrors the backend's
// OPT_IN_MODULES set. Keep the two in sync so the toggles reflect the true resolved state.
const OPT_IN_MODULES = new Set(['activities', 'voc', 'campaigns', 'customers']);

export default function BuTemplateEditor({ bu, onClose, onSaved }) {
  const [catalog, setCatalog] = useState(null);
  const [sections, setSections] = useState(null);
  const [services, setServices] = useState([]);   // [{ slug, label, nature, category, enabled }]
  const [modules, setModules] = useState([]);      // [{ slug, label, core, enabled }]
  const [isOriginal, setIsOriginal] = useState(false);
  const [newSection, setNewSection] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    Promise.all([getBusinessUnitConfig(bu.slug), getBuCatalog()])
      .then(([cfg, cat]) => {
        setCatalog(cat);
        setIsOriginal(cfg.isOriginal);
        // Load the saved schema, then MERGE any catalog sections it's missing (e.g. a section added
        // to the product after this business was created, like Contacts (POC)) so nothing in the
        // lead form is absent from the editor. New sections come in enabled with their catalog fields.
        const saved = (cfg.formSchema.sections || []).map(s => ({ ...s, collapsed: true, fields: s.fields.map(f => ({ ...f })) }));
        const savedKeys = new Set(saved.map(s => s.key));
        for (const cs of (cat.fieldSections || [])) {
          if (savedKeys.has(cs.key)) continue;
          saved.push({ key: cs.key, label: cs.label, enabled: true, custom: false, collapsed: true,
            fields: cs.fields.map(f => ({ ...f, enabled: true, mandatory: false })) });
        }
        setSections(saved);
        // Services: load ONLY this business's own catalog (not the union of every business), grouped by
        // category. The admin builds/edits it per category — add a device/service, remove one, set its
        // default OPEX/CAPEX. All loaded items are enabled (they ARE this business's catalog).
        const catOf = (s) => s?.category || (s?.hardware ? 'hardware' : 'software');
        setServices((cfg.services || []).map(s => ({ slug: s.slug, label: s.label, nature: s.nature, category: catOf(s), enabled: true })));
        // Modules: seed from the catalog with each unit's stored enablement applied on top. A module
        // absent from stored modules follows the backend default (opt-in modules off, others on).
        const storedMap = new Map((cfg.modules || []).map(m => [m.slug, !!m.enabled]));
        setModules((cat.modules || []).map(m => ({
          slug: m.slug, label: m.label, core: !!m.core,
          enabled: storedMap.has(m.slug) ? storedMap.get(m.slug) : (m.core || !OPT_IN_MODULES.has(m.slug)),
        })));
      })
      .catch(e => setErr(e.response?.data?.message || 'Could not load the template.'));
  }, [bu.slug]);

  const toggleModule = (slug) => setModules(ms => ms.map(m => m.slug === slug ? { ...m, enabled: !m.enabled } : m));

  const addService = (category, label, nature) => {
    const name = String(label || '').trim();
    if (!name) return;
    const slug = slugify(name);
    setServices(ss => ss.some(s => s.slug === slug) ? ss : [...ss, { slug, label: name, nature: nature || 'opex', category, enabled: true }]);
  };
  const removeService = (slug) => setServices(ss => ss.filter(s => s.slug !== slug));
  const setServiceNature = (slug, nature) => setServices(ss => ss.map(s => s.slug === slug ? { ...s, nature } : s));

  const patchSection = (key, fn) => setSections(secs => secs.map(s => s.key === key ? fn(s) : s));
  const toggleSection = (key) => patchSection(key, s => ({ ...s, enabled: !s.enabled }));
  const collapseSection = (key) => patchSection(key, s => ({ ...s, collapsed: !s.collapsed }));
  const setAllFields = (key, val) => patchSection(key, s => ({ ...s, fields: s.fields.map(f => ({ ...f, enabled: val })) }));
  const toggleField = (key, slug) => patchSection(key, s => ({ ...s, fields: s.fields.map(f => f.slug === slug ? { ...f, enabled: !f.enabled } : f) }));
  const toggleMandatory = (key, slug) => patchSection(key, s => ({ ...s, fields: s.fields.map(f => f.slug === slug ? { ...f, mandatory: !f.mandatory } : f) }));
  const removeField = (key, slug) => patchSection(key, s => ({ ...s, fields: s.fields.filter(f => !(f.slug === slug && f.custom)) }));
  const addCustomField = (key, draft) => {
    const label = draft.label.trim();
    if (!label) return false;
    const slug = slugify(label);
    if (sections.some(s => s.fields.some(f => f.slug === slug))) return false;
    const opts = (draft.type === 'select' || draft.type === 'multiselect') ? draft.options.split(',').map(o => o.trim()).filter(Boolean) : undefined;
    patchSection(key, s => ({ ...s, fields: [...s.fields, { slug, label, type: draft.type, options: opts, core: false, custom: true, enabled: true, mandatory: false }] }));
    return true;
  };
  const addCustomSection = () => {
    const label = newSection.trim();
    if (!label) return;
    const key = slugify(label) || `section_${sections.length + 1}`;
    if (sections.some(s => s.key === key)) { setNewSection(''); return; }
    setSections(secs => [...secs, { key, label, enabled: true, custom: true, collapsed: false, fields: [] }]);
    setNewSection('');
  };
  const removeSection = (key) => setSections(secs => secs.filter(s => !(s.key === key && s.custom)));

  const save = async () => {
    setBusy(true); setErr('');
    try {
      const formSchema = { sections: sections.map(sec => ({
        key: sec.key, label: sec.label, enabled: sec.enabled, custom: !!sec.custom,
        fields: sec.fields.map(f => ({ slug: f.slug, label: f.label, type: f.type, options: f.options || null, core: !!f.core, custom: !!f.custom, enabled: f.enabled, mandatory: f.mandatory })),
      })) };
      const svc = services.map(s => ({ slug: s.slug, label: s.label, nature: s.nature, category: s.category || 'software', hardware: s.category === 'hardware' || s.category === 'hardware_software', enabled: s.enabled }));
      const mods = modules.map(m => ({ slug: m.slug, enabled: !!m.enabled }));
      await updateBusinessUnit(bu.slug, { config: { formSchema, services: svc, modules: mods } });
      onSaved();
    } catch (e) {
      setErr(e.response?.data?.message || 'Could not save the template.');
      setBusy(false);
    }
  };

  // Deliberately NO close-on-backdrop-click: a stray click outside must not discard
  // in-progress template edits. Use the × or Cancel button to close.
  return (
    <div style={ov.backdrop}>
      <div style={{ ...ov.modal, maxWidth: 580 }}>
        <div style={{ padding: '18px 22px 12px', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Edit Lead Template — {bu.name}</h2>
            <button onClick={onClose} style={ov.x}>×</button>
          </div>
          <p style={{ fontSize: 12.5, color: '#64748b', margin: '6px 0 0' }}>
            Turn sections on/off, toggle fields, mark mandatory, and add custom fields/sections. Changes apply to this business's New Lead form.
            {isOriginal && ' This is an original business — its built-in fields stay; your edits (hidden fields, custom fields) layer on top.'}
          </p>
        </div>

        <div style={{ padding: 22, overflowY: 'auto', flex: 1 }}>
          {err && <div style={ov.error}>{err}</div>}
          {!sections && !err && <p style={{ fontSize: 13, color: '#64748b' }}>Loading template…</p>}
          {sections && catalog && sections.map(sec => (
            <SectionCard key={sec.key} sec={sec} catalog={catalog}
              onToggle={() => toggleSection(sec.key)} onCollapse={() => collapseSection(sec.key)}
              onToggleField={(slug) => toggleField(sec.key, slug)} onToggleMandatory={(slug) => toggleMandatory(sec.key, slug)}
              onRemoveField={(slug) => removeField(sec.key, slug)} onAddField={(draft) => addCustomField(sec.key, draft)}
              onSetAllFields={(val) => setAllFields(sec.key, val)} onRemoveSection={() => removeSection(sec.key)} />
          ))}
          {sections && (
            <div style={ov.addRow}>
              <input style={{ ...ov.input, margin: 0 }} value={newSection} onChange={e => setNewSection(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomSection(); } }} placeholder="Add a custom section…" />
              <button type="button" className="btn btn-sm" style={ov.ghost} onClick={addCustomSection}>+ Section</button>
            </div>
          )}

          {sections && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>Services Offered</div>
              <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 10px' }}>Build this business's catalog by category. Items appear on its New Lead form, grouped the same way; the default OPEX/CAPEX pre-fills the lead line. <b>Hardware</b> and <b>Hardware + Software</b> flow into the Inventory Pipeline — <b>Software / Service</b> does not.</p>
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

          {modules.length > 0 && (
            <div style={{ border: '1px solid #e5e9f0', borderRadius: 10, marginTop: 16 }}>
              <div style={{ padding: '9px 12px', background: '#f8fafc', borderRadius: '10px 10px 0 0', fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                Modules <span style={{ fontSize: 11, fontWeight: 500, color: '#94a3b8' }}>({modules.filter(m => m.enabled).length} of {modules.length} enabled)</span>
              </div>
              <div style={{ padding: '8px 12px' }}>
                <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 8px' }}>Turn modules on or off for this business. Core modules (Leads, Dashboard) can't be disabled — everyone needs them.</p>
                {modules.map(m => (
                  <label key={m.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #f1f5f9', cursor: m.core ? 'not-allowed' : 'pointer' }}>
                    <input type="checkbox" checked={m.enabled} disabled={m.core} onChange={() => toggleModule(m.slug)} />
                    <span style={{ fontSize: 13, color: m.enabled ? '#0f172a' : '#94a3b8', flex: 1 }}>{m.label}</span>
                    {m.core && <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', background: '#f1f5f9', padding: '1px 8px', borderRadius: 999 }}>CORE</span>}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 22px', borderTop: '1px solid #f1f5f9' }}>
          <button className="btn" style={ov.ghost} onClick={onClose}>Cancel</button>
          <button className="btn" style={ov.primary} disabled={busy || !sections} onClick={save}>{busy ? 'Saving…' : 'Save template'}</button>
        </div>
      </div>
    </div>
  );
}
