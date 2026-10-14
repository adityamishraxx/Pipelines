const jwt = require('jsonwebtoken');
const { User } = require('../models');

// authenticate — reads Bearer token, verifies, loads user, stamps last_seen
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Missing token' });

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }

    const user = await User.findByPk(payload.id, { attributes: { exclude: ['password_hash'] } });
    if (!user)          return res.status(401).json({ message: 'User not found' });
    if (!user.active)   return res.status(403).json({ message: 'User is inactive' });

    // Non-blocking last_seen stamp
    user.update({ last_seen: new Date() }).catch(() => {});

    req.user = user;

    // A Read-only Super Admin changes nothing, anywhere. Enforced here rather than per-route so a
    // route added later is covered automatically and cannot accidentally become writable for them.
    // /api/auth/* is exempt so they can still sign in and change their own password — that is
    // account self-service, not a change to any platform's data.
    if (user.super_admin_scope === 'read'
        && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
        && !String(req.originalUrl || '').includes('/api/auth/')) {
      return res.status(403).json({
        message: 'Your Super Admin access is Read-only — you can view every platform but cannot make changes.',
        read_only: true,
      });
    }

    return next();
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

// authorize(...roles) — allows only the listed roles
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
    if (!roles.length || roles.includes(req.user.role)) return next();
    return res.status(403).json({ message: 'Forbidden' });
  };
}

const {
  isSuperAdmin, isSuperAdminRead, isSuperAdminWrite,
} = require('../services/permissions');

// The "admin tier" — roles that can reach admin surfaces (Settings, Reports, bulk actions, dropdowns).
// Fine-grained rules (who can assign which role, which business) are enforced inside those handlers.
// A cross-platform Super Admin passes regardless of their platform role, since the grant is additive
// (a BD who is also a Super Admin must still reach Settings).
const ADMIN_TIER_ROLES = ['super_admin', 'business_admin', 'pmo'];
function adminOnly(req, res, next) {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  if (ADMIN_TIER_ROLES.includes(req.user.role) || isSuperAdmin(req.user)) return next();
  return res.status(403).json({ message: 'Forbidden' });
}

// A Read-only Super Admin makes no changes anywhere, on any platform. Enforced centrally on the
// HTTP method rather than endpoint by endpoint, so a route added later is covered by default and
// cannot accidentally become writable for them.
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];
function blockReadOnlySuperAdmin(req, res, next) {
  if (req.user && isSuperAdminRead(req.user) && !SAFE_METHODS.includes(req.method)) {
    return res.status(403).json({
      message: 'Your Super Admin access is Read-only — you can view every platform but cannot make changes.',
      read_only: true,
    });
  }
  return next();
}

// --- Per-module access levels (see services/permissions.js) -----------------------------------
// These compose WITH the role guards above rather than replacing them: a route may carry both, and
// both must pass. Because permissions are always read from the database row loaded by authenticate()
// — never from the JWT — a permission change takes effect on the user's very next request, with no
// re-login and no token refresh.
const { hasLevel, hasLevelInAny, MODULE_LABELS, LEVEL_LABELS } = require('../services/permissions');

function denied(res, module, minLevel) {
  return res.status(403).json({
    message: `You need ${LEVEL_LABELS[minLevel]} access to ${MODULE_LABELS[module] || module}.`,
    module, required: minLevel,
  });
}

// requireModule('leads', 'edit') — the caller must hold at least that level in that module.
function requireModule(module, minLevel = 'read') {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
    if (hasLevel(req.user, module, minLevel)) return next();
    return denied(res, module, minLevel);
  };
}

// requireAnyModule(['leads','dashboard','reports'], 'read') — for endpoints that back more than one
// module. GET /api/leads is the main case: the Leads list, the Dashboard and Reports all read it, so
// a Dashboard-only user must still be able to fetch lead rows.
function requireAnyModule(modules, minLevel = 'read') {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
    if (hasLevelInAny(req.user, modules, minLevel)) return next();
    return denied(res, modules[0], minLevel);
  };
}

module.exports = {
  authenticate, authorize, adminOnly, requireModule, requireAnyModule,
  blockReadOnlySuperAdmin, isSuperAdmin, isSuperAdminRead, isSuperAdminWrite,
};
