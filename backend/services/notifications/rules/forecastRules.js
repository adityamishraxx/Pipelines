const { Lead, Setting } = require('../../../models');
const { Op } = require('sequelize');
const { notify } = require('../dispatcher');
const { forecastUsersInBu, adminTierInBu, unique } = require('../recipients');

async function sweepConfidenceDrop(businessUnit) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const leads = await Lead.findAll({
      where: {
        business_unit: businessUnit,
        phase: { [Op.notIn]: ['PO Received', 'Lost', 'On Hold'] },
        confidence_score: { [Op.not]: null },
        confidence_prev: { [Op.not]: null },
      },
      attributes: ['id', 'sr_no', 'customer_name', 'owner_id', 'confidence_score', 'confidence_prev'],
      raw: true,
    });

    const significant = leads.filter(l => {
      const cur = Number(l.confidence_score);
      const prev = Number(l.confidence_prev);
      return prev > 0 && (prev - cur) / prev >= 0.15;
    });

    if (!significant.length) return;

    const recipients = unique(
      await forecastUsersInBu(businessUnit),
      await adminTierInBu(businessUnit),
    );
    if (!recipients.length) return;

    for (const lead of significant) {
      const cur = Number(lead.confidence_score).toFixed(0);
      const prev = Number(lead.confidence_prev).toFixed(0);
      await notify({
        recipients,
        businessUnit,
        ruleKey: 'confidence_drop',
        severity: 'critical',
        title: `Confidence dropped: #${lead.sr_no} (${prev}→${cur})`,
        body: `"${lead.customer_name}" confidence fell from ${prev} to ${cur}.`,
        leadId: lead.id,
        entityType: 'lead',
        entityId: lead.id,
        linkPath: `/leads/${lead.id}`,
        dedupeKey: `conf_drop_${lead.id}_${today}`,
      });
    }
  } catch (e) { console.error('[notif] sweepConfidenceDrop:', e.message); }
}

async function sweepPipelineTarget(businessUnit) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const leads = await Lead.findAll({
      where: {
        business_unit: businessUnit,
        phase: { [Op.notIn]: ['PO Received', 'Lost'] },
      },
      attributes: ['id', 'potential_tcv_lakhs', 'phase'],
      raw: true,
    });

    const totalPipeline = leads.reduce((sum, l) => sum + (parseFloat(l.potential_tcv_lakhs) || 0), 0);

    const targetRow = await Setting.findByPk('pipeline_target_lakhs');
    if (!targetRow) return;
    const target = parseFloat(targetRow.value);
    if (!target || totalPipeline >= target) return;

    const pct = ((totalPipeline / target) * 100).toFixed(0);
    const recipients = await adminTierInBu(businessUnit);
    if (!recipients.length) return;

    await notify({
      recipients,
      businessUnit,
      ruleKey: 'pipeline_below_target',
      severity: 'critical',
      title: `Pipeline at ${pct}% of target`,
      body: `Active pipeline is ${totalPipeline.toFixed(1)}L vs target ${target}L.`,
      leadId: null,
      entityType: 'pipeline',
      entityId: null,
      linkPath: '/forecast',
      dedupeKey: `pipeline_target_${businessUnit}_${today}`,
    });
  } catch (e) { console.error('[notif] sweepPipelineTarget:', e.message); }
}

module.exports = { sweepConfidenceDrop, sweepPipelineTarget };
