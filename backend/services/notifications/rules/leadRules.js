const { notify } = require('../dispatcher');
const { ownerOf, managersInBu, adminTierInBu, unique } = require('../recipients');

async function onPhaseChange({ lead, fromPhase, toPhase, actor, businessUnit }) {
  try {
    const recipients = unique(ownerOf(lead), await managersInBu(businessUnit));
    await notify({
      recipients,
      businessUnit,
      ruleKey: 'lead_phase_change',
      severity: 'info',
      title: `Lead #${lead.sr_no} moved to ${toPhase}`,
      body: `${actor.name} moved "${lead.customer_name}" from ${fromPhase} to ${toPhase}.`,
      leadId: lead.id,
      entityType: 'lead',
      entityId: lead.id,
      linkPath: `/leads/${lead.id}`,
      dedupeKey: `lead_phase_${lead.id}_${toPhase}_${new Date().toISOString().slice(0, 10)}`,
    });
  } catch (e) { console.error('[notif] onPhaseChange:', e.message); }
}

async function onOwnerChange({ lead, oldOwnerId, newOwnerId, actor, businessUnit }) {
  try {
    const recipients = unique([oldOwnerId, newOwnerId], await managersInBu(businessUnit));
    await notify({
      recipients,
      businessUnit,
      ruleKey: 'lead_reassigned',
      severity: 'info',
      title: `Lead #${lead.sr_no} reassigned`,
      body: `${actor.name} reassigned "${lead.customer_name}" to a new owner.`,
      leadId: lead.id,
      entityType: 'lead',
      entityId: lead.id,
      linkPath: `/leads/${lead.id}`,
      dedupeKey: `lead_reassign_${lead.id}_${newOwnerId}_${Date.now()}`,
    });
  } catch (e) { console.error('[notif] onOwnerChange:', e.message); }
}

async function onBulkReassign({ ids, newOwnerId, actor, businessUnit }) {
  try {
    const managers = await managersInBu(businessUnit);
    const recipients = unique([newOwnerId], managers);
    await notify({
      recipients,
      businessUnit,
      ruleKey: 'lead_reassigned',
      severity: 'info',
      title: `${ids.length} lead(s) bulk reassigned`,
      body: `${actor.name} bulk-reassigned ${ids.length} lead(s).`,
      leadId: null,
      entityType: 'lead',
      entityId: null,
      linkPath: '/leads',
      dedupeKey: `bulk_reassign_${actor.id}_${Date.now()}`,
    });
  } catch (e) { console.error('[notif] onBulkReassign:', e.message); }
}

async function onLeadCreated({ lead, actor, businessUnit }) {
  try {
    const managers = await managersInBu(businessUnit);
    if (!managers.length) return;
    await notify({
      recipients: managers,
      businessUnit,
      ruleKey: 'lead_created',
      severity: 'low',
      title: `New lead #${lead.sr_no} created`,
      body: `${actor.name} created "${lead.customer_name}".`,
      leadId: lead.id,
      entityType: 'lead',
      entityId: lead.id,
      linkPath: `/leads/${lead.id}`,
      dedupeKey: `lead_created_${lead.id}`,
    });
  } catch (e) { console.error('[notif] onLeadCreated:', e.message); }
}

async function onPoDocumentUploaded({ lead, actor, businessUnit }) {
  try {
    const recipients = unique(ownerOf(lead), await adminTierInBu(businessUnit));
    await notify({
      recipients,
      businessUnit,
      ruleKey: 'po_document_uploaded',
      severity: 'low',
      title: `PO document uploaded for #${lead.sr_no}`,
      body: `${actor.name} uploaded a PO document for "${lead.customer_name}".`,
      leadId: lead.id,
      entityType: 'lead',
      entityId: lead.id,
      linkPath: `/leads/${lead.id}`,
      dedupeKey: `po_doc_${lead.id}_${Date.now()}`,
    });
  } catch (e) { console.error('[notif] onPoDocumentUploaded:', e.message); }
}

async function onLeadMarkedLost({ lead, actor, businessUnit }) {
  try {
    const recipients = unique(ownerOf(lead), await adminTierInBu(businessUnit));
    await notify({
      recipients,
      businessUnit,
      ruleKey: 'lead_lost',
      severity: 'critical',
      title: `Lead #${lead.sr_no} marked Lost`,
      body: `${actor.name} marked "${lead.customer_name}" as Lost. Reason: ${lead.lost_reason || 'Not specified'}.`,
      leadId: lead.id,
      entityType: 'lead',
      entityId: lead.id,
      linkPath: `/leads/${lead.id}`,
      dedupeKey: `lead_lost_${lead.id}_${new Date().toISOString().slice(0, 10)}`,
    });
  } catch (e) { console.error('[notif] onLeadMarkedLost:', e.message); }
}

async function onLeadOnHold({ lead, actor, businessUnit }) {
  try {
    const managers = await managersInBu(businessUnit);
    await notify({
      recipients: managers,
      businessUnit,
      ruleKey: 'lead_on_hold',
      severity: 'warning',
      title: `Lead #${lead.sr_no} put On Hold`,
      body: `${actor.name} put "${lead.customer_name}" on hold${lead.hold_end_date ? ' until ' + lead.hold_end_date : ''}.`,
      leadId: lead.id,
      entityType: 'lead',
      entityId: lead.id,
      linkPath: `/leads/${lead.id}`,
      dedupeKey: `lead_hold_${lead.id}_${new Date().toISOString().slice(0, 10)}`,
    });
  } catch (e) { console.error('[notif] onLeadOnHold:', e.message); }
}

module.exports = {
  onPhaseChange, onOwnerChange, onBulkReassign, onLeadCreated,
  onPoDocumentUploaded, onLeadMarkedLost, onLeadOnHold,
};
