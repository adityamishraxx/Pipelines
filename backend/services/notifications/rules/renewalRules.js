const { notify } = require('../dispatcher');
const { ownerOf, managersInBu, adminTierInBu, unique } = require('../recipients');
const { renewalStatus, loadRenewedSetForBu, wonLeadsForBu } = require('../renewal');

async function onRenewalCreated({ lead, originalLeadId, actor, businessUnit }) {
  try {
    const recipients = unique(ownerOf(lead), await adminTierInBu(businessUnit));
    await notify({
      recipients,
      businessUnit,
      ruleKey: 'renewal_created',
      severity: 'low',
      title: `Renewal created for #${lead.sr_no}`,
      body: `${actor.name} created renewal "${lead.customer_name}" from lead #${originalLeadId}.`,
      leadId: lead.id,
      entityType: 'lead',
      entityId: lead.id,
      linkPath: `/leads/${lead.id}`,
      dedupeKey: `renewal_created_${lead.id}`,
    });
  } catch (e) { console.error('[notif] onRenewalCreated:', e.message); }
}

async function sweepRenewalDue(businessUnit) {
  try {
    const [wonLeads, renewedIds] = await Promise.all([
      wonLeadsForBu(businessUnit),
      loadRenewedSetForBu(businessUnit),
    ]);
    const today = new Date().toISOString().slice(0, 10);

    for (const lead of wonLeads) {
      const status = renewalStatus(lead, renewedIds);
      if (!status || status.band === 'ok' || status.band === 'renewed') continue;

      let severity = 'info';
      let title;
      if (status.band === 'expired') {
        severity = 'critical';
        title = `PO #${lead.sr_no} expired ${Math.abs(status.days)}d ago`;
      } else if (status.band === 'red') {
        severity = 'warning';
        title = `PO #${lead.sr_no} due in ${status.days}d`;
      } else {
        title = `PO #${lead.sr_no} due in ${status.days}d`;
      }

      const recipients = unique(ownerOf(lead), await managersInBu(businessUnit));
      await notify({
        recipients,
        businessUnit,
        ruleKey: 'renewal_due',
        severity,
        title,
        body: `"${lead.customer_name}" service ends ${lead.service_end_date}.`,
        leadId: lead.id,
        entityType: 'lead',
        entityId: lead.id,
        linkPath: `/leads/${lead.id}`,
        dedupeKey: `renewal_due_${lead.id}_${today}`,
      });
    }
  } catch (e) { console.error('[notif] sweepRenewalDue:', e.message); }
}

module.exports = { onRenewalCreated, sweepRenewalDue };
