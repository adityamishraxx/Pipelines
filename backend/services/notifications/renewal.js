const { Lead } = require('../../models');
const { Op } = require('sequelize');

function renewalStatus(lead, renewedIds) {
  if (lead.phase !== 'PO Received') return null;
  if (renewedIds && renewedIds.has(lead.id)) return { days: null, band: 'renewed' };
  const end = lead.service_end_date;
  if (!end) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const endD = new Date(end); endD.setHours(0, 0, 0, 0);
  if (isNaN(endD.getTime())) return null;
  const days = Math.round((endD - today) / 86400000);
  let band;
  if (days < 0) band = 'expired';
  else if (days <= 30) band = 'red';
  else if (days <= 60) band = 'amber';
  else if (days <= 90) band = 'yellow';
  else band = 'ok';
  return { days, band };
}

function buildRenewedSet(leads) {
  const s = new Set();
  for (const l of leads) if (l.renewed_from_lead_id) s.add(l.renewed_from_lead_id);
  return s;
}

async function loadRenewedSetForBu(businessUnit) {
  const leads = await Lead.findAll({
    where: { business_unit: businessUnit, renewed_from_lead_id: { [Op.not]: null } },
    attributes: ['renewed_from_lead_id'],
    raw: true,
  });
  return buildRenewedSet(leads);
}

async function wonLeadsForBu(businessUnit) {
  return Lead.findAll({
    where: { business_unit: businessUnit, phase: 'PO Received' },
    attributes: ['id', 'owner_id', 'business_unit', 'customer_name', 'sr_no', 'phase', 'service_end_date', 'renewed_from_lead_id'],
    raw: true,
  });
}

module.exports = { renewalStatus, buildRenewedSet, loadRenewedSetForBu, wonLeadsForBu };
