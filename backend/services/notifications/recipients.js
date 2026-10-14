const { User } = require('../../models');
const { hasLevel } = require('../permissions');
const { Op } = require('sequelize');

// Get active users in a BU by roles.
async function usersInBu(businessUnit, roles) {
  return User.findAll({
    where: { business_unit: businessUnit, active: true, role: { [Op.in]: roles } },
    attributes: ['id', 'role', 'module_permissions', 'forecast_access', 'super_admin_scope'],
  });
}

// Lead owner (Team Member).
function ownerOf(lead) {
  return lead.owner_id ? [lead.owner_id] : [];
}

// Managers (pmo) in the BU.
async function managersInBu(businessUnit) {
  const users = await usersInBu(businessUnit, ['pmo']);
  return users.map(u => u.id);
}

// Business Admins in the BU.
async function businessAdminsInBu(businessUnit) {
  const users = await usersInBu(businessUnit, ['business_admin']);
  return users.map(u => u.id);
}

// Global Admins signed into this BU (super_admin role with this BU).
async function globalAdminsInBu(businessUnit) {
  const users = await usersInBu(businessUnit, ['super_admin']);
  return users.map(u => u.id);
}

// Admin tier: super_admin + business_admin + pmo for a BU.
async function adminTierInBu(businessUnit) {
  const users = await usersInBu(businessUnit, ['super_admin', 'business_admin', 'pmo']);
  return users.map(u => u.id);
}

// Users with forecast access or forecast module read+ in a BU.
async function forecastUsersInBu(businessUnit) {
  const users = await User.findAll({
    where: { business_unit: businessUnit, active: true },
    attributes: ['id', 'role', 'module_permissions', 'forecast_access'],
  });
  return users
    .filter(u => u.forecast_access || hasLevel(u, 'forecast', 'read'))
    .map(u => u.id);
}

// Unique merge of multiple recipient lists.
function unique(...arrays) {
  return [...new Set(arrays.flat())];
}

module.exports = {
  ownerOf, managersInBu, businessAdminsInBu, globalAdminsInBu,
  adminTierInBu, forecastUsersInBu, usersInBu, unique,
};
