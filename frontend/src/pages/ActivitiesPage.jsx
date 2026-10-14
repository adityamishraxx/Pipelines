import React, { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import {
  getActivities, createActivity, updateActivity, deleteActivity,
  getActivityTabs, createActivityTab, renameActivityTab, deleteActivityTab,
  getBusinessMembers,
} from '../services/api';
import { fmtDate } from '../utils/leadHelpers';
import MentionTextarea from '../components/MentionTextarea';

// Kanban columns. Order matches the board left-to-right. `slug` is what the API stores in `status`.
// Columns are FIXED per the product spec — the user-managed grouping happens via TABS at the top of
// the page. Hiding a column is a personal-view preference (see hidden-columns state below), NOT a
// data change: a hidden column keeps its cards, they just don't render for that user.
const COLUMNS = [
  { slug: 'to_do',        label: 'To Do',            color: '#64748b' },
  { slug: 'in_progress',  label: 'In Progress',      color: '#2563eb' },
  { slug: 'delayed',      label: 'Delayed',          color: '#f97316' },
  { slug: 'blocked',      label: 'On Hold / Blocked', color: '#dc2626' },
  { slug: 'completed',    label: 'Completed',        color: '#16a34a' },
];

const PRIORITY_COLORS = {
  high:   { bg: '#fee2e2', fg: '#991b1b' },
  medium: { bg: '#fef3c7', fg: '#92400e' },
  low:    { bg: '#dbeafe', fg: '#1e40af' },
};

const EMPTY_CARD = {
  isNew: true, title: '', previous_steps: '', recent_updates: '', next_steps: '',
  status: 'to_do', priority: '', owner_name: '',
  start_date: '', next_followup_date: '', due_date: '',    // due_date is surfaced as "Estimated Closure"
};

export default function ActivitiesPage() {
  const { user, canFull, canEdit } = useAuth();
  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [cards, setCards] = useState([]);
  const [members, setMembers] = useState([]);   // business members, for the owner picker
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);  // null | { …card, isNew? }
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [addingTab, setAddingTab] = useState(false);
  const [newTabName, setNewTabName] = useState('');
  const [err, setErr] = useState('');
  const [dragCardId, setDragCardId] = useState(null); // HTML5 native drag-and-drop state
  const [dragOverCol, setDragOverCol] = useState(null);
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  // Per-user hidden columns preference — kept in localStorage keyed by user id so hiding a column
  // on one machine follows the user everywhere they use the same browser but doesn't affect anyone
  // else. Storing SLUGS of hidden columns keeps the default (all visible) implicit.
  const hiddenKey = `salescrm_activities_hidden_${user?.id ?? 'anon'}`;
  const [hiddenCols, setHiddenCols] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(hiddenKey) || '[]')); }
    catch { return new Set(); }
  });
  const persistHidden = (set) => { localStorage.setItem(hiddenKey, JSON.stringify([...set])); };
  const toggleColumnHidden = (slug) => {
    setHiddenCols(prev => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      persistHidden(next);
      return next;
    });
  };
  const visibleColumns = COLUMNS.filter(c => !hiddenCols.has(c.slug));

  const canCreate = canFull('activities');
  const canMove = canEdit('activities');

  // Initial load — tabs, cards, and the business member list for the owner picker.
  useEffect(() => {
    Promise.all([
      getActivityTabs().catch(e => ({ __err: e.response?.data?.message || 'Could not load tabs.' })),
      getActivities().catch(e => ({ __err: e.response?.data?.message || 'Could not load cards.' })),
      getBusinessMembers(user.business_unit).catch(() => []),
    ]).then(([tabResult, cardResult, memberList]) => {
        const tabList = tabResult?.__err ? null : tabResult;
        const cardList = cardResult?.__err ? null : cardResult;
        if (tabResult?.__err) setErr(tabResult.__err);
        else if (cardResult?.__err) setErr(cardResult.__err);
        setTabs(tabList || []);
        setCards(cardList || []);
        setMembers(memberList || []);
        if (tabList?.length) setActiveTabId(tabList[0].id);
      })
      .finally(() => setLoading(false));
  }, [user.business_unit]);

  const cardsByCol = useMemo(() => {
    const map = Object.fromEntries(COLUMNS.map(c => [c.slug, []]));
    for (const card of cards) {
      if (card.tab_id !== activeTabId) continue;
      (map[card.status] || map.to_do).push(card);
    }
    return map;
  }, [cards, activeTabId]);

  const openNew = (statusSlug) => setEditing({ ...EMPTY_CARD, status: statusSlug, tab_id: activeTabId });
  const openEdit = (card) => setEditing({
    ...card,
    owner_name: card.owner_name || '',
    priority: card.priority || '',
    start_date: card.start_date || '',
    next_followup_date: card.next_followup_date || '',
    due_date: card.due_date || '',
    previous_steps: card.previous_steps || '',
    recent_updates: card.recent_updates || '',
    next_steps: card.next_steps || '',
  });
  const closeModal = () => setEditing(null);

  const save = async (payload) => {
    setErr('');
    try {
      const withTab = { ...payload, tab_id: payload.tab_id || activeTabId };
      if (payload.isNew) {
        const saved = await createActivity(withTab);
        setCards(list => [...list, saved]);
      } else {
        const saved = await updateActivity(payload.id, withTab);
        setCards(list => list.map(c => c.id === saved.id ? saved : c));
      }
      closeModal();
    } catch (e) {
      setErr(e.response?.data?.message || 'Could not save the card.');
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this card?')) return;
    try {
      await deleteActivity(id);
      setCards(list => list.filter(c => c.id !== id));
      closeModal();
    } catch (e) {
      setErr(e.response?.data?.message || 'Could not delete.');
    }
  };

  // Move on drop — status change is the one write we need on the card row. Optimistic so the drop
  // feels instant, then reconciled with the server response (or rolled back on failure).
  const moveCard = async (cardId, toStatus) => {
    const card = cards.find(c => c.id === cardId);
    if (!card || card.status === toStatus) return;
    setCards(list => list.map(c => c.id === cardId ? { ...c, status: toStatus } : c));
    try {
      const saved = await updateActivity(cardId, { ...card, status: toStatus });
      setCards(list => list.map(c => c.id === saved.id ? saved : c));
    } catch (e) {
      setCards(list => list.map(c => c.id === cardId ? { ...c, status: card.status } : c));
      setErr(e.response?.data?.message || 'Could not move the card.');
    }
  };

  // -------------------- Tab actions --------------------
  const addTab = async () => {
    const label = newTabName.trim();
    if (!label) { setAddingTab(false); setNewTabName(''); return; }
    try {
      const created = await createActivityTab(label);
      setTabs(t => [...t, created]);
      setActiveTabId(created.id);
      setAddingTab(false); setNewTabName('');
    } catch (e) {
      setErr(e.response?.data?.message || 'Could not create the tab.');
    }
  };

  const startRename = (tab) => { setRenamingId(tab.id); setRenameDraft(tab.label); };
  const commitRename = async () => {
    const label = renameDraft.trim();
    if (!label) { setRenamingId(null); return; }
    try {
      const saved = await renameActivityTab(renamingId, label);
      setTabs(t => t.map(x => x.id === saved.id ? saved : x));
    } catch (e) {
      setErr(e.response?.data?.message || 'Could not rename the tab.');
    } finally {
      setRenamingId(null);
    }
  };

  const removeTab = async (tab) => {
    if (tabs.length <= 1) { window.alert('You must keep at least one tab.'); return; }
    const cardsInTab = cards.filter(c => c.tab_id === tab.id).length;
    const msg = cardsInTab
      ? `Delete "${tab.label}"? Its ${cardsInTab} card(s) will be removed too.`
      : `Delete "${tab.label}"?`;
    if (!window.confirm(msg)) return;
    try {
      await deleteActivityTab(tab.id);
      setTabs(t => t.filter(x => x.id !== tab.id));
      setCards(list => list.filter(c => c.tab_id !== tab.id));
      if (activeTabId === tab.id) {
        const remaining = tabs.filter(x => x.id !== tab.id);
        setActiveTabId(remaining[0]?.id ?? null);
      }
    } catch (e) {
      setErr(e.response?.data?.message || 'Could not delete the tab.');
    }
  };

  return (
    <Layout>
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Task Board</h1>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>Track calls, follow-ups and internal tasks on shared boards. Drag cards between columns to update status.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', position: 'relative' }}>
          {/* Columns picker — a small popover that lets each user hide phases they don't want to see.
              Preference is per-user (localStorage), so it doesn't affect other people's boards. */}
          <button className="btn" onClick={() => setShowColumnPicker(v => !v)}>
            ⚙ Columns{hiddenCols.size > 0 ? ` (${COLUMNS.length - hiddenCols.size}/${COLUMNS.length})` : ''}
          </button>
          {showColumnPicker && (
            <div onMouseLeave={() => setShowColumnPicker(false)}
              style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', padding: 10, zIndex: 30, minWidth: 220 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>Show / hide phases</div>
              {COLUMNS.map(col => (
                <label key={col.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', cursor: 'pointer', fontSize: 13 }}>
                  <input type="checkbox" checked={!hiddenCols.has(col.slug)} onChange={() => toggleColumnHidden(col.slug)} />
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: col.color }} />
                  <span>{col.label}</span>
                </label>
              ))}
              <p style={{ fontSize: 11, color: '#94a3b8', margin: '6px 0 0' }}>Hidden phases keep their cards — this only changes your view.</p>
            </div>
          )}
          {canCreate && activeTabId && (
            <button className="btn btn-primary" onClick={() => openNew('to_do')}>+ New card</button>
          )}
        </div>
      </div>

      {/* Tab strip — one tab per board, plus add/rename/delete controls. */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '0 24px', display: 'flex', gap: 4, alignItems: 'flex-end', overflowX: 'auto' }}>
        {tabs.map(tab => {
          const active = tab.id === activeTabId;
          const renaming = renamingId === tab.id;
          return (
            <div key={tab.id} style={{ display: 'flex', alignItems: 'center', borderBottom: active ? '2px solid #0a84ff' : '2px solid transparent', padding: '10px 4px 8px' }}>
              {renaming ? (
                <input autoFocus value={renameDraft}
                  onChange={e => setRenameDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
                  style={{ padding: '4px 8px', fontSize: 13, fontWeight: 600, border: '1px solid #0a84ff', borderRadius: 6, minWidth: 120 }} />
              ) : (
                <button
                  onClick={() => setActiveTabId(tab.id)}
                  onDoubleClick={() => canCreate && startRename(tab)}
                  title={canCreate ? 'Click to open. Double-click to rename.' : 'Click to open.'}
                  style={{ background: 'transparent', border: 'none', padding: '4px 10px', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: active ? '#0a84ff' : '#64748b' }}>
                  {tab.label}
                </button>
              )}
              {active && canCreate && !renaming && tabs.length > 1 && (
                <button onClick={() => removeTab(tab)} title="Delete tab"
                  style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 14, padding: '2px 6px' }}>×</button>
              )}
            </div>
          );
        })}
        {canCreate && (addingTab ? (
          <div style={{ display: 'flex', alignItems: 'center', padding: '10px 4px 8px', gap: 6 }}>
            <input autoFocus value={newTabName} onChange={e => setNewTabName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addTab(); if (e.key === 'Escape') { setAddingTab(false); setNewTabName(''); } }}
              placeholder="New tab name…"
              style={{ padding: '4px 8px', fontSize: 13, border: '1px solid #0a84ff', borderRadius: 6, minWidth: 140 }} />
            <button onClick={addTab} className="btn btn-sm btn-primary">Add</button>
            <button onClick={() => { setAddingTab(false); setNewTabName(''); }} className="btn btn-sm">Cancel</button>
          </div>
        ) : (
          <button onClick={() => setAddingTab(true)} title="Add a tab"
            style={{ background: 'transparent', border: '1px dashed #cbd5e1', borderRadius: 6, color: '#64748b', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: '4px 10px', margin: '10px 8px 8px' }}>+ Tab</button>
        ))}
      </div>

      {err && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '8px 16px', fontSize: 13 }}>{err}</div>}

      <div style={{ padding: 20, overflowX: 'auto' }}>
        {loading ? (
          <p style={{ color: '#94a3b8', padding: 40, textAlign: 'center' }}>Loading board…</p>
        ) : !activeTabId ? (
          <p style={{ color: '#94a3b8', padding: 40, textAlign: 'center' }}>No tabs yet — add one to get started.</p>
        ) : visibleColumns.length === 0 ? (
          <p style={{ color: '#94a3b8', padding: 40, textAlign: 'center' }}>All phases are hidden — use the Columns menu to bring one back.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${visibleColumns.length}, minmax(300px, 1fr))`, gap: 14, minWidth: 300 * visibleColumns.length }}>
            {visibleColumns.map(col => {
              const isDropTarget = dragOverCol === col.slug;
              return (
                <div key={col.slug}
                  onDragOver={(e) => { if (canMove && dragCardId) { e.preventDefault(); setDragOverCol(col.slug); } }}
                  onDragLeave={() => setDragOverCol(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!canMove || !dragCardId) return;
                    moveCard(dragCardId, col.slug);
                    setDragCardId(null); setDragOverCol(null);
                  }}
                  style={{
                    background: isDropTarget ? '#e8f2ff' : '#f8fafc',
                    borderRadius: 12, padding: 12, minHeight: 200,
                    border: isDropTarget ? '2px dashed #0a84ff' : '2px solid transparent',
                    transition: 'background .15s, border-color .15s',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: col.color }} />
                      <span style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>{col.label}</span>
                      <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>{cardsByCol[col.slug].length}</span>
                    </div>
                    {canCreate && (
                      <button onClick={() => openNew(col.slug)} title="Add card to this column"
                        style={{ border: '1px solid #e2e8f0', background: '#fff', borderRadius: 8, padding: '2px 8px', cursor: 'pointer', fontSize: 13, color: '#475569' }}>+</button>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {cardsByCol[col.slug].length === 0 && (
                      <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: 16 }}>No cards</p>
                    )}
                    {cardsByCol[col.slug].map(card => (
                      <CardTile key={card.id} card={card}
                        draggable={canMove}
                        isDragging={dragCardId === card.id}
                        onDragStart={() => setDragCardId(card.id)}
                        onDragEnd={() => { setDragCardId(null); setDragOverCol(null); }}
                        onEdit={() => openEdit(card)} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editing && (
        <CardModal card={editing} tabs={tabs} members={members}
          onSave={save} onDelete={editing.isNew ? null : () => remove(editing.id)}
          onClose={closeModal} readOnly={!(editing.isNew ? canCreate : canMove)} />
      )}
    </Layout>
  );
}

// One card. Everything the reader needs to know without opening the card is on the face:
// owner, priority, Recent Updates, Next Steps, Start Date, Next Follow-up Date. Draggable when the
// user has 'edit' on the module.
function CardTile({ card, draggable, isDragging, onDragStart, onDragEnd, onEdit }) {
  const p = card.priority && PRIORITY_COLORS[card.priority];
  // Overdue = next follow-up date is in the past and the card isn't completed.
  const nextDate = card.next_followup_date;
  const overdue = nextDate && card.status !== 'completed' && new Date(nextDate) < new Date(new Date().toDateString());
  // Legacy owner_id path: prefer the free-text owner_name; fall back to the joined user for old rows.
  const ownerLabel = card.owner_name || card.owner?.name || '';
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(card.id));
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onEdit}
      style={{
        background: '#fff', borderRadius: 10, padding: 12,
        boxShadow: isDragging ? '0 8px 20px rgba(79,70,229,0.25)' : '0 1px 3px rgba(0,0,0,0.06)',
        border: '1px solid #e2e8f0', cursor: draggable ? 'grab' : 'pointer',
        opacity: isDragging ? 0.5 : 1, transition: 'opacity .1s, box-shadow .1s',
      }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, color: '#0f172a', lineHeight: 1.3, flex: 1 }}>{card.title}</div>
        {p && <span style={{ background: p.bg, color: p.fg, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, textTransform: 'uppercase' }}>{card.priority}</span>}
      </div>

      {ownerLabel && (
        <div style={{ marginTop: 6, fontSize: 11.5, color: '#475569', display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 20, height: 20, borderRadius: 999, background: '#0a84ff', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700 }}>
            {ownerLabel.trim().slice(0, 1).toUpperCase()}
          </span>
          <span style={{ fontWeight: 600 }}>{ownerLabel}</span>
        </div>
      )}

      {/* Recent Updates and Next Steps live on the face — this is the whole point of the redesign. */}
      {card.recent_updates && (
        <div style={{ marginTop: 8, background: '#f8fafc', borderLeft: '3px solid #2563eb', padding: '6px 8px', borderRadius: '0 6px 6px 0' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#2563eb', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 }}>Recent Updates</div>
          <div style={{ fontSize: 12, color: '#334155', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{card.recent_updates}</div>
        </div>
      )}
      {card.next_steps && (
        <div style={{ marginTop: 6, background: '#e8f2ff', borderLeft: '3px solid #16a34a', padding: '6px 8px', borderRadius: '0 6px 6px 0' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 }}>Next Steps</div>
          <div style={{ fontSize: 12, color: '#334155', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{card.next_steps}</div>
        </div>
      )}

      {(card.start_date || card.next_followup_date || card.due_date) && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10, paddingTop: 8, borderTop: '1px dashed #e2e8f0', fontSize: 11, color: '#64748b' }}>
          {card.start_date && (
            <span title="Start date" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.3, fontSize: 9.5 }}>Start</span>
              <span>{fmtDate(card.start_date)}</span>
            </span>
          )}
          {card.next_followup_date && (
            <span title="Next follow-up date" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: overdue ? '#dc2626' : '#64748b', fontWeight: overdue ? 700 : 500 }}>
              <span style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, fontSize: 9.5 }}>Follow-up</span>
              <span>{fmtDate(card.next_followup_date)}{overdue ? ' · overdue' : ''}</span>
            </span>
          )}
          {card.due_date && (
            <span title="Estimated closure" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.3, fontSize: 9.5 }}>Est. Closure</span>
              <span>{fmtDate(card.due_date)}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function CardModal({ card, tabs, members, onSave, onDelete, onClose, readOnly }) {
  const [form, setForm] = useState(card);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  // Owner picker: a dropdown of this business's members, plus "Other" to type a name for someone
  // outside the team. The field is in "Other" mode when a value is set that isn't a known member.
  const memberNames = (members || []).map(m => m.name);
  const [ownerOther, setOwnerOther] = useState(() => !!form.owner_name && !memberNames.includes(form.owner_name));
  const submit = (e) => {
    e.preventDefault();
    if (readOnly) return;
    if (!form.title.trim()) return;
    onSave(form);
  };
  return (
    // No close-on-backdrop-click — consistent with other form modals.
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <span style={{ fontWeight: 700, fontSize: 15 }}>{card.isNew ? 'New card' : 'Edit card'}</span>
          <button className="btn btn-sm" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit} className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="field-label">Title *</label>
            <input className="input" required autoFocus value={form.title} onChange={e => set('title', e.target.value)} disabled={readOnly} />
          </div>

          {/* The three story fields — Previous, Recent, Next. Ordered chronologically so the modal
              reads top-to-bottom as "what happened → what's happening → what comes next". */}
          <div>
            <label className="field-label" style={{ color: '#64748b' }}>Previous Steps</label>
            <MentionTextarea className="input" rows={2} value={form.previous_steps || ''} onChange={v => set('previous_steps', v)} disabled={readOnly}
              placeholder="What has already been done…" />
          </div>
          <div>
            <label className="field-label" style={{ color: '#2563eb' }}>Recent Updates</label>
            <MentionTextarea className="input" rows={2} value={form.recent_updates || ''} onChange={v => set('recent_updates', v)} disabled={readOnly}
              placeholder="Latest news / status change…" />
          </div>
          <div>
            <label className="field-label" style={{ color: '#16a34a' }}>Next Steps</label>
            <MentionTextarea className="input" rows={2} value={form.next_steps || ''} onChange={v => set('next_steps', v)} disabled={readOnly}
              placeholder="What comes next…" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className="field-label">Tab</label>
              <select className="input" value={form.tab_id || ''} onChange={e => set('tab_id', e.target.value ? +e.target.value : null)} disabled={readOnly}>
                {tabs.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">Column</label>
              <select className="input" value={form.status} onChange={e => set('status', e.target.value)} disabled={readOnly}>
                {COLUMNS.map(c => <option key={c.slug} value={c.slug}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">Priority</label>
              <select className="input" value={form.priority || ''} onChange={e => set('priority', e.target.value)} disabled={readOnly}>
                <option value="">—</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div>
              <label className="field-label">Owner</label>
              {ownerOther ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="input" type="text" style={{ flex: 1 }} value={form.owner_name || ''} onChange={e => set('owner_name', e.target.value)} disabled={readOnly}
                    placeholder="Name of someone outside the team" maxLength={255} autoFocus />
                  <button type="button" className="btn btn-sm" style={{ whiteSpace: 'nowrap' }} disabled={readOnly} onClick={() => { setOwnerOther(false); set('owner_name', ''); }}>✕</button>
                </div>
              ) : (
                <select className="input" value={form.owner_name || ''} disabled={readOnly}
                  onChange={e => {
                    if (e.target.value === '__other__') { setOwnerOther(true); set('owner_name', ''); }
                    else set('owner_name', e.target.value);
                  }}>
                  <option value="">Unassigned</option>
                  {memberNames.map(n => <option key={n} value={n}>{n}</option>)}
                  <option value="__other__">Other (type a name)…</option>
                </select>
              )}
            </div>
            <div>
              <label className="field-label">Start date</label>
              <input type="date" className="input" value={form.start_date || ''} onChange={e => set('start_date', e.target.value)} disabled={readOnly} />
            </div>
            <div>
              <label className="field-label">Next Follow-up Date</label>
              <input type="date" className="input" value={form.next_followup_date || ''} onChange={e => set('next_followup_date', e.target.value)} disabled={readOnly} />
            </div>
            <div>
              <label className="field-label">Estimated Closure</label>
              <input type="date" className="input" value={form.due_date || ''} onChange={e => set('due_date', e.target.value)} disabled={readOnly} />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            {onDelete && !readOnly ? (
              <button type="button" className="btn btn-danger btn-sm" onClick={onDelete}>Delete</button>
            ) : <span />}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              {!readOnly && <button type="submit" className="btn btn-primary">{card.isNew ? 'Create' : 'Save'}</button>}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
