const { Lead, Setting, User } = require('../../../models');
const { Op } = require('sequelize');
const { notify } = require('../dispatcher');
const { ownerOf, managersInBu, adminTierInBu, unique } = require('../recipients');
const { stageAging, slaMapFor } = require('../stage');

async function resolveOwner(ownerName, businessUnit) {
  if (!ownerName) return null;
  const u = await User.findOne({ where: { name: ownerName, business_unit: businessUnit, active: true }, attributes: ['id'] });
  return u ? u.id : null;
}

async function onTaskStatusChange({ card, oldStatus, newStatus, actor, businessUnit }) {
  try {
    const ownerId = card.owner_id || await resolveOwner(card.owner_name, businessUnit);
    const managers = await managersInBu(businessUnit);
    const recipients = unique(ownerId ? [ownerId] : [], managers);
    if (!recipients.length) return;
    await notify({
      recipients,
      businessUnit,
      ruleKey: 'task_status_change',
      severity: 'info',
      title: `Task "${card.title}" moved to ${newStatus}`,
      body: `${actor.name} moved task from ${oldStatus} to ${newStatus}.`,
      leadId: card.lead_id || null,
      entityType: 'activity',
      entityId: card.id,
      linkPath: '/activities',
      dedupeKey: `task_status_${card.id}_${newStatus}_${Date.now()}`,
    });
  } catch (e) { console.error('[notif] onTaskStatusChange:', e.message); }
}

async function onTaskAssigned({ card, actor, businessUnit }) {
  try {
    const ownerId = await resolveOwner(card.owner_name, businessUnit);
    if (!ownerId || ownerId === actor.id) return;
    await notify({
      recipients: [ownerId],
      businessUnit,
      ruleKey: 'task_assigned',
      severity: 'low',
      title: `Task "${card.title}" assigned to you`,
      body: `${actor.name} assigned you this task.`,
      leadId: card.lead_id || null,
      entityType: 'activity',
      entityId: card.id,
      linkPath: '/activities',
      dedupeKey: `task_assign_${card.id}_${ownerId}_${Date.now()}`,
    });
  } catch (e) { console.error('[notif] onTaskAssigned:', e.message); }
}

async function sweepStaleLeads(businessUnit) {
  try {
    const row = await Setting.findByPk('notification_stale_days');
    const staleDays = row ? parseInt(row.value, 10) : 14;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - staleDays);
    const today = new Date().toISOString().slice(0, 10);

    const staleLeads = await Lead.findAll({
      where: {
        business_unit: businessUnit,
        phase: { [Op.notIn]: ['PO Received', 'Lost', 'On Hold'] },
        [Op.or]: [
          { last_activity_at: { [Op.lt]: cutoff } },
          { last_activity_at: null, created_at: { [Op.lt]: cutoff } },
        ],
      },
      attributes: ['id', 'sr_no', 'customer_name', 'owner_id', 'phase'],
      raw: true,
    });

    for (const lead of staleLeads) {
      const recipients = unique(ownerOf(lead), await managersInBu(businessUnit));
      await notify({
        recipients,
        businessUnit,
        ruleKey: 'stale_lead',
        severity: 'warning',
        title: `Lead #${lead.sr_no} is stale (${staleDays}+ days)`,
        body: `"${lead.customer_name}" has had no activity for ${staleDays}+ days.`,
        leadId: lead.id,
        entityType: 'lead',
        entityId: lead.id,
        linkPath: `/leads/${lead.id}`,
        dedupeKey: `stale_${lead.id}_${today}`,
      });
    }
  } catch (e) { console.error('[notif] sweepStaleLeads:', e.message); }
}

async function sweepStageTAT(businessUnit) {
  try {
    const tatMap = await slaMapFor(businessUnit);
    const row = await Setting.findByPk('stage_tat_escalation_multiplier');
    const multiplier = row ? parseFloat(row.value) : 2;
    const today = new Date().toISOString().slice(0, 10);

    const leads = await Lead.findAll({
      where: {
        business_unit: businessUnit,
        phase: { [Op.notIn]: ['PO Received', 'Lost', 'On Hold'] },
      },
      attributes: ['id', 'sr_no', 'customer_name', 'owner_id', 'phase', 'phase_changed_at', 'created_at'],
      raw: true,
    });

    for (const lead of leads) {
      const aging = stageAging(lead, tatMap);
      if (!aging.level || aging.level === 'ok') continue;

      const severity = aging.days > aging.target * multiplier ? 'critical' : 'warning';
      const recipients = unique(ownerOf(lead), await adminTierInBu(businessUnit));
      await notify({
        recipients,
        businessUnit,
        ruleKey: 'stage_tat_breach',
        severity,
        title: `Lead #${lead.sr_no} exceeds TAT in ${lead.phase}`,
        body: `"${lead.customer_name}" has been in ${lead.phase} for ${aging.days}d (target: ${aging.target}d).`,
        leadId: lead.id,
        entityType: 'lead',
        entityId: lead.id,
        linkPath: `/leads/${lead.id}`,
        dedupeKey: `tat_${lead.id}_${lead.phase}_${today}`,
      });
    }
  } catch (e) { console.error('[notif] sweepStageTAT:', e.message); }
}

async function sweepFollowupOverdue(businessUnit) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);

    const leads = await Lead.findAll({
      where: {
        business_unit: businessUnit,
        phase: { [Op.notIn]: ['Lost', 'PO Received', 'On Hold'] },
        next_followup_date: { [Op.lt]: today },
      },
      attributes: ['id', 'sr_no', 'customer_name', 'owner_id', 'phase', 'next_followup_date'],
      raw: true,
    });

    for (const lead of leads) {
      const recipients = ownerOf(lead);
      if (!recipients.length) continue;
      await notify({
        recipients,
        businessUnit,
        ruleKey: 'followup_overdue',
        severity: 'warning',
        title: `Followup overdue: #${lead.sr_no}`,
        body: `"${lead.customer_name}" followup was due ${lead.next_followup_date}.`,
        leadId: lead.id,
        entityType: 'lead',
        entityId: lead.id,
        linkPath: `/leads/${lead.id}`,
        dedupeKey: `followup_${lead.id}_${todayStr}`,
      });
    }
  } catch (e) { console.error('[notif] sweepFollowupOverdue:', e.message); }
}

async function sweepHoldEnding(businessUnit) {
  try {
    const row = await Setting.findByPk('hold_ending_days');
    const window = row ? parseInt(row.value, 10) : 3;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const limit = new Date(today);
    limit.setDate(limit.getDate() + window);
    const todayStr = today.toISOString().slice(0, 10);

    const leads = await Lead.findAll({
      where: {
        business_unit: businessUnit,
        phase: 'On Hold',
        hold_end_date: { [Op.lte]: limit, [Op.gte]: today },
      },
      attributes: ['id', 'sr_no', 'customer_name', 'owner_id', 'hold_end_date'],
      raw: true,
    });

    for (const lead of leads) {
      const recipients = unique(ownerOf(lead), await managersInBu(businessUnit));
      await notify({
        recipients,
        businessUnit,
        ruleKey: 'hold_ending',
        severity: 'info',
        title: `Hold ending soon: #${lead.sr_no}`,
        body: `"${lead.customer_name}" hold ends ${lead.hold_end_date}.`,
        leadId: lead.id,
        entityType: 'lead',
        entityId: lead.id,
        linkPath: `/leads/${lead.id}`,
        dedupeKey: `hold_end_${lead.id}_${todayStr}`,
      });
    }
  } catch (e) { console.error('[notif] sweepHoldEnding:', e.message); }
}

module.exports = {
  onTaskStatusChange, onTaskAssigned, sweepStaleLeads, sweepStageTAT,
  sweepFollowupOverdue, sweepHoldEnding,
};
