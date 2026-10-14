const { User } = require('../models');
const dispatcher = require('./notifications/dispatcher');

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
  nov: 10, november: 10, dec: 11, december: 11,
};

function parseDate(text) {
  let m;
  m = text.match(/(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s*(\d{4})?/i);
  if (m) return new Date(m[3] ? parseInt(m[3], 10) : new Date().getFullYear(), MONTHS[m[2].toLowerCase().slice(0, 3)], parseInt(m[1], 10));

  m = text.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+(\d{1,2})\s*,?\s*(\d{4})?/i);
  if (m) return new Date(m[3] ? parseInt(m[3], 10) : new Date().getFullYear(), MONTHS[m[1].toLowerCase().slice(0, 3)], parseInt(m[2], 10));

  m = text.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
  if (m) return new Date(m[3] ? parseInt(m[3], 10) : new Date().getFullYear(), parseInt(m[2], 10) - 1, parseInt(m[1], 10));

  return null;
}

async function processMentions({ text, oldText, businessUnit, actorId, entityType, entityLabel, linkPath }) {
  if (!text || !businessUnit) return [];

  const users = await User.findAll({
    where: { business_unit: businessUnit, active: true },
    attributes: ['id', 'name'],
  });
  users.sort((a, b) => (b.name?.length || 0) - (a.name?.length || 0));

  function extractMentions(src) {
    const found = [];
    if (!src) return found;
    const regex = /@([^\n@]+)/g;
    let match;
    while ((match = regex.exec(src)) !== null) {
      const afterAt = match[1];
      for (const u of users) {
        if (u.name && afterAt.toLowerCase().startsWith(u.name.toLowerCase())) {
          const rest = src.slice(match.index + 1 + u.name.length);
          let followUpDate = null;
          const dm = rest.match(/(?:^|\s)(?:date|by|on)\s+(.+?)(?:\.|,|\n|$)/i);
          if (dm) followUpDate = parseDate(dm[1].trim());
          found.push({ userId: u.id, userName: u.name, followUpDate });
          break;
        }
      }
    }
    return found;
  }

  const newMentions = extractMentions(text);
  const oldMentions = extractMentions(oldText);
  const oldKeys = new Set(oldMentions.map(m => `${m.userId}-${m.followUpDate?.toISOString() || ''}`));
  const fresh = newMentions.filter(m => !oldKeys.has(`${m.userId}-${m.followUpDate?.toISOString() || ''}`));

  for (const m of fresh) {
    if (m.userId === actorId) continue;
    const fmtDate = m.followUpDate
      ? m.followUpDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      : null;
    const dateStr = fmtDate ? ` — follow up by ${fmtDate}` : '';
    const dedupeKey = `mention-${entityType || 'note'}-${Date.now()}-${m.userId}`;
    await dispatcher.notify({
      recipients: [m.userId],
      businessUnit,
      ruleKey: 'mention',
      severity: fmtDate ? 'warning' : 'info',
      title: `You were mentioned in ${entityLabel || 'a note'}`,
      body: `${entityLabel || ''}${dateStr}`,
      entityType: entityType || null,
      linkPath: linkPath || null,
      dedupeKey,
    });
  }

  return fresh;
}

module.exports = { processMentions, parseDate };
