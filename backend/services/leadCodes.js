// Customer + Location grouping + per-lead reference codes.
//
// customer_code  — shared by every lead whose customer (normalized name) matches, within a business
//                  unit. Format CUST-00001 (globally sequential, minted on first appearance).
// location_code  — 3-letter code for WHERE the PO is, derived from the most specific geography on the
//                  lead: the CITY when present (MUM, DEL, PAT), else the STATE (MAH, KAR, BHR), else
//                  "UNK". City is preferred so same-named cities in different states stay distinct;
//                  state fallback means a city-less PO still groups by state instead of collapsing
//                  into one big Unknown bucket.
// lead_ref       — unique per lead: `<customer_code>-<location_code>-NN`, where NN is the running PO
//                  sequence FOR THAT CUSTOMER + LOCATION-CODE pair (01, 02, …).
//
// location_code is DERIVED FROM city/state, so it is kept in sync: new leads get it at creation,
// edits recompute it when city/state change (recomputeLocationOnEdit), and the boot-time backfill
// re-sequences any lead whose stored code no longer matches its current city/state.

const { sequelize } = require('../models');

function normalizeName(name) {
  return String(name || '').toLowerCase().trim();
}

function formatCustomerCode(n) {
  return `CUST-${String(n).padStart(5, '0')}`;
}

function formatLeadRef(customerCode, locationCode, seq) {
  return `${customerCode}-${locationCode}-${String(seq).padStart(2, '0')}`;
}

// Curated 3-letter codes for common Indian cities; anything else uses its first 3 letters.
const COMMON_CITY_CODES = {
  mumbai: 'MUM', delhi: 'DEL', 'new delhi': 'DEL', bengaluru: 'BLR', bangalore: 'BLR',
  chennai: 'CHE', kolkata: 'KOL', hyderabad: 'HYD', pune: 'PUN', ahmedabad: 'AMD',
  chandigarh: 'CHD', jaipur: 'JAI', lucknow: 'LKO', kochi: 'COK', cochin: 'COK',
  surat: 'SUR', indore: 'IDR', bhopal: 'BHP', nagpur: 'NGP', patna: 'PAT',
  thane: 'THN', vadodara: 'VAD', visakhapatnam: 'VIZ', coimbatore: 'CJB',
  gurgaon: 'GGN', gurugram: 'GGN', noida: 'NOI', faridabad: 'FBD', ghaziabad: 'GZB',
  mysore: 'MYS', mysuru: 'MYS', mangalore: 'MLR', mangaluru: 'MLR',
};

// 3-letter codes for Indian states / UTs (used only when a lead has no city). Keyed by the
// lowercased full state name. Anything not listed uses its first 3 letters.
const STATE_CODES = {
  'andhra pradesh': 'APD', 'arunachal pradesh': 'ARP', assam: 'ASM', bihar: 'BHR',
  chhattisgarh: 'CTG', goa: 'GOA', gujarat: 'GUJ', haryana: 'HAR', 'himachal pradesh': 'HPR',
  jharkhand: 'JHR', karnataka: 'KAR', kerala: 'KER', 'madhya pradesh': 'MPR', maharashtra: 'MAH',
  manipur: 'MAN', meghalaya: 'MEG', mizoram: 'MIZ', nagaland: 'NAG', odisha: 'ODI', orissa: 'ODI',
  punjab: 'PNB', rajasthan: 'RAJ', sikkim: 'SIK', 'tamil nadu': 'TND', telangana: 'TLG',
  tripura: 'TRI', 'uttar pradesh': 'UPR', uttarakhand: 'UTK', 'west bengal': 'WBL',
  delhi: 'DEL', 'jammu and kashmir': 'JNK', ladakh: 'LAD', puducherry: 'PDY', pondicherry: 'PDY',
  chandigarh: 'CHD', 'andaman and nicobar islands': 'AND', lakshadweep: 'LKD',
  'dadra and nagar haveli and daman and diu': 'DNH',
};

function threeLetters(raw) {
  const alpha = String(raw || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return alpha.slice(0, 3) || 'UNK';
}

function cityCode(city) {
  const norm = String(city || '').trim().toLowerCase();
  return COMMON_CITY_CODES[norm] || threeLetters(city);
}

function stateCode(state) {
  const norm = String(state || '').trim().toLowerCase();
  return STATE_CODES[norm] || threeLetters(state);
}

// The location code for a lead: CITY if present, else STATE, else UNK.
function locationCodeFor(city, state) {
  if (String(city || '').trim()) return cityCode(city);
  if (String(state || '').trim()) return stateCode(state);
  return 'UNK';
}

// Resolve (or mint) the customer_code for a (business unit, customer name) within a transaction.
async function customerCodeFor(businessUnit, customerName, t) {
  const norm = normalizeName(customerName);
  const [existing] = await sequelize.query(
    `SELECT customer_code FROM leads
      WHERE business_unit = ? AND customer_code IS NOT NULL
        AND LOWER(TRIM(customer_name)) = ?
      ORDER BY id ASC LIMIT 1`,
    { replacements: [businessUnit, norm], transaction: t },
  );
  if (existing.length) return existing[0].customer_code;
  const [maxRow] = await sequelize.query(
    `SELECT MAX(CAST(SUBSTRING(customer_code, 6) AS INTEGER)) AS maxn
       FROM leads WHERE customer_code IS NOT NULL`,
    { transaction: t },
  );
  return formatCustomerCode((Number(maxRow[0].maxn) || 0) + 1);
}

// Next PO sequence for a customer_code + location_code pair, optionally excluding one lead id
// (used on edit so the lead being moved doesn't count itself).
async function nextSeq(customerCode, locationCode, excludeId, t) {
  const [row] = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM leads
      WHERE customer_code = ? AND location_code = ?${excludeId ? ' AND id <> ?' : ''}`,
    { replacements: excludeId ? [customerCode, locationCode, excludeId] : [customerCode, locationCode], transaction: t },
  );
  return (Number(row[0].cnt) || 0) + 1;
}

// Assign { customer_code, location_code, lead_ref } for a NEW lead.
async function assignLeadCodes(businessUnit, customerName, city, state, t) {
  const customerCode = await customerCodeFor(businessUnit, customerName, t);
  const locationCode = locationCodeFor(city, state);
  const seq = await nextSeq(customerCode, locationCode, null, t);
  return { customer_code: customerCode, location_code: locationCode, lead_ref: formatLeadRef(customerCode, locationCode, seq) };
}

// On EDIT: if the lead's city/state change moves it to a different location_code, re-issue the
// location_code + lead_ref into the new bucket. Returns the patch, or null when nothing changes
// (same location, or the lead has no customer_code yet — those are left to the backfill).
async function recomputeLocationOnEdit(existing, nextCity, nextState, t) {
  if (!existing || !existing.customer_code) return null;
  const newLoc = locationCodeFor(nextCity, nextState);
  if (newLoc === existing.location_code) return null;
  const seq = await nextSeq(existing.customer_code, newLoc, existing.id, t);
  return { location_code: newLoc, lead_ref: formatLeadRef(existing.customer_code, newLoc, seq) };
}

// Backfill / re-sequence. Runs when ANY lead needs rework:
//   • missing customer_code / location_code / lead_ref, OR
//   • lead_ref not in the new 3-part shape, OR
//   • stored location_code no longer matches locationCodeFor(current city, current state).
// When triggered it recomputes EVERY lead deterministically in creation order, so customer codes,
// location codes and per-(customer+location) sequences are all consistent. Idempotent: once every
// lead matches, it is a no-op on subsequent boots.
async function backfillLeadCodes({ silent = false } = {}) {
  const [rows] = await sequelize.query(
    `SELECT id, business_unit, customer_name, city, state, customer_code, location_code, lead_ref
       FROM leads ORDER BY (sr_no IS NULL), sr_no ASC, id ASC`,
  );

  const needsRework = rows.some(r =>
    !r.customer_code || !r.location_code || !r.lead_ref
    || !/^CUST-\d{5}-.+-\d{2,}$/.test(r.lead_ref)
    || r.location_code !== locationCodeFor(r.city, r.state),
  );
  if (!needsRework) return 0;

  const codeByKey = new Map();  // `${bu}||${norm_name}` -> customer_code
  const seqByPair = new Map();  // `${customer_code}||${location_code}` -> current max sequence
  let maxN = 0;

  const t = await sequelize.transaction();
  try {
    for (const r of rows) {
      const key = `${r.business_unit}||${normalizeName(r.customer_name)}`;
      let code = codeByKey.get(key);
      if (!code) { maxN += 1; code = formatCustomerCode(maxN); codeByKey.set(key, code); }
      const loc = locationCodeFor(r.city, r.state);
      const pairKey = `${code}||${loc}`;
      const seq = (seqByPair.get(pairKey) || 0) + 1;
      seqByPair.set(pairKey, seq);
      await sequelize.query(
        `UPDATE leads SET customer_code = ?, location_code = ?, lead_ref = ? WHERE id = ?`,
        { replacements: [code, loc, formatLeadRef(code, loc, seq), r.id], transaction: t },
      );
    }
    await t.commit();
    if (!silent) console.log(`[lead-codes] re-sequenced ${rows.length} lead(s) with customer + location codes`);
    return rows.length;
  } catch (e) {
    await t.rollback();
    throw e;
  }
}

module.exports = {
  normalizeName, formatCustomerCode, formatLeadRef, locationCodeFor,
  assignLeadCodes, recomputeLocationOnEdit, backfillLeadCodes,
};
