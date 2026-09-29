const jwt = require('jsonwebtoken');
const { SECRET_KEY } = require('./config');
const { pool } = require('./database');

// ─── Role helpers ─────────────────────────────────────────────────────────────
/** "Superadmin" → sees ALL data, full system access (formerly 'admin') */
const isSuperAdmin = (user) =>
    user && (user.role === 'superadmin' || user.username?.toLowerCase() === 'admin' || user.username?.toLowerCase() === 'adminhub');

/** "Admin or superadmin" → can access /admin menu, but new 'admin' role only sees own data */
const isAdminLike = (user) =>
    isSuperAdmin(user) || (user && user.role === 'admin');

/**
 * Jetons kiosque DSI Dashboard : code opaque court (16 car.), révocable en base,
 * limité au strict accès en lecture (GET). Utilisés pour l'affichage automatisé
 * sans ré-authentification (postes en mode kiosque). Contrairement aux JWT
 * habituels ils ne contiennent aucun point ('.') — c'est ce qui permet de les
 * distinguer avant même de tenter un jwt.verify().
 */
const isKioskToken = (user) => !!(user && user.type === 'dsi_kiosk');
const looksLikeKioskShortCode = (token) => typeof token === 'string' && !token.includes('.');

async function resolveKioskShortCode(code, req, res, next) {
    if (req.method !== 'GET') {
        return res.status(403).json({ message: 'Jeton kiosque : accès en lecture seule' });
    }
    try {
        const r = await pool.query(
            'SELECT label, created_by, revoked_at FROM hub.dsi_dashboard_kiosk_tokens WHERE short_code = $1',
            [code]
        );
        const row = r.rows[0];
        if (!row || row.revoked_at) {
            return res.status(401).json({ message: 'Jeton kiosque révoqué ou inconnu' });
        }
        req.user = {
            type: 'dsi_kiosk',
            id: 0,
            username: row.created_by,
            displayName: `Kiosque : ${row.label}`,
            role: 'dsi_kiosk',
            is_approved: 1,
        };
        // Horodatage best-effort, sans bloquer la requête sur son résultat.
        pool.query('UPDATE hub.dsi_dashboard_kiosk_tokens SET last_used_at = NOW() WHERE short_code = $1', [code]).catch(() => {});
        next();
    } catch (e) {
        console.error('[KIOSK] Erreur de vérification du jeton:', e.message);
        res.status(500).json({ message: 'Erreur de vérification du jeton' });
    }
}

// Filet de sécurité pour les jetons kiosque signés en JWT émis par une version
// antérieure (avant le passage au code court) : ils sont encore valides pour
// jwt.verify(), donc on doit continuer à leur appliquer lecture-seule + révocation.
async function enforceLegacyKioskJwt(user, req, res) {
    if (req.method !== 'GET') {
        res.status(403).json({ message: 'Jeton kiosque : accès en lecture seule' });
        return false;
    }
    try {
        const r = await pool.query(
            'SELECT revoked_at FROM hub.dsi_dashboard_kiosk_tokens WHERE token_jti = $1',
            [user.jti]
        );
        if (r.rows.length === 0 || r.rows[0].revoked_at) {
            res.status(401).json({ message: 'Jeton kiosque révoqué ou inconnu' });
            return false;
        }
    } catch (e) {
        console.error('[KIOSK] Erreur de vérification du jeton (JWT legacy):', e.message);
        res.status(500).json({ message: 'Erreur de vérification du jeton' });
        return false;
    }
    return true;
}

/**
 * Middleware to verify JWT token
 */
const authenticateJWT = (req, res, next) => {
    const authHeader = req.headers.authorization;
    // Repli sur ?token= pour les ressources chargées sans header (ex: <img src>)
    const queryToken = req.query && req.query.token;
    if (!authHeader && queryToken) {
        if (looksLikeKioskShortCode(queryToken)) return resolveKioskShortCode(queryToken, req, res, next);
        return jwt.verify(queryToken, SECRET_KEY, async (err, user) => {
            if (err) return res.status(403).json({ message: 'Session expirée ou invalide' });
            if (isAdminLike(user)) user.is_approved = 1;
            req.user = user;
            if (isKioskToken(user) && !(await enforceLegacyKioskJwt(user, req, res))) return;
            next();
        });
    }
    if (authHeader) {
        const token = authHeader.split(' ')[1];
        if (!token) {
            console.log(`[JWT] Token missing for ${req.path}`);
            return res.status(401).json({ message: 'Token manquant dans le header' });
        }
        if (looksLikeKioskShortCode(token)) return resolveKioskShortCode(token, req, res, next);

        jwt.verify(token, SECRET_KEY, async (err, user) => {
            if (err) {
                console.error(`[JWT ERROR] Verification failed for ${req.path}: ${err.message}`);
                return res.status(403).json({ message: 'Session expirée ou invalide' });
            }
            // Ensure admins are always approved
            if (isAdminLike(user)) {
                user.is_approved = 1;
            }
            req.user = user;
            if (isKioskToken(user) && !(await enforceLegacyKioskJwt(user, req, res))) return;
            console.log(`[JWT] User ${user.username} verified for ${req.path}`);
            next();
        });
    } else {
        console.log(`[JWT] Auth header missing for ${req.path}`);
        res.status(401).json({ message: 'Authentification requise' });
    }
};

/**
 * Middleware to optionally verify JWT token without blocking
 */
const tryAuthenticateJWT = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
        const token = authHeader.split(' ')[1];
        if (token) {
            jwt.verify(token, SECRET_KEY, (err, user) => {
                if (!err) {
                    if (isAdminLike(user)) {
                        user.is_approved = 1;
                    }
                    req.user = user;
                }
                next();
            });
            return;
        }
    }
    next();
};

/**
 * Middleware for SuperAdmin only (system management, sees all data)
 * Accepts: role='superadmin' OR legacy usernames 'admin'/'adminhub'
 */
const authenticateAdmin = (req, res, next) => {
    authenticateJWT(req, res, () => {
        if (isSuperAdmin(req.user)) {
            next();
        } else {
            res.status(403).json({ message: 'Accès refusé : superadministrateur uniquement' });
        }
    });
};

/**
 * Middleware for Admin UI access (role='admin' OR role='superadmin')
 * The new 'admin' role can access the /admin menu but only sees own data.
 */
const authenticateAdminUI = (req, res, next) => {
    authenticateJWT(req, res, () => {
        if (isAdminLike(req.user)) {
            next();
        } else {
            res.status(403).json({ message: 'Accès refusé : rôle admin requis' });
        }
    });
};

/**
 * Middleware for Internal (scheduled syncs) or Admin
 */
const authenticateInternalOrAdmin = (req, res, next) => {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Internal ')) {
        const token = Buffer.from('scheduled-sync:internal').toString('base64');
        if (auth === `Internal ${token}`) {
            req.user = { username: 'scheduled-sync', role: 'admin' };
            return next();
        }
    }
    authenticateAdmin(req, res, next);
};

/**
 * Middleware for Admin or Finances/Compta roles
 */
const authenticateAdminOrFinances = (req, res, next) => {
    authenticateJWT(req, res, () => {
        if (req.user && (isSuperAdmin(req.user) || req.user.role === 'finances' || req.user.role === 'compta')) {
            next();
        } else {
            res.status(403).json({ message: 'Accès refusé : administrateur ou finances/compta uniquement' });
        }
    });
};

// ─── API Key middleware ─────────────────────────────────────────────────────────
// Extrait une clé API depuis X-API-Key, ?api_key=, ou Authorization: Bearer dsk_...
const extractApiKey = (req) => {
  const header = req.headers['x-api-key'] || req.query.api_key;
  if (header) return header;
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token.startsWith('dsk_')) return token;
  }
  return null;
};

const authenticateApiKey = async (req, res, next) => {
  if (req.apiKey) return next(); // déjà authentifié en amont (passerelle)
  const key = extractApiKey(req);
  if (!key) return res.status(401).json({ error: 'Clé API requise (en-tête X-API-Key ou Authorization: Bearer dsk_...)' });
  const prefix = key.length > 20 ? key.slice(0, 20) : key;
  try {
    const { rows } = await pool.query(
      `SELECT id, name, key_hash, scope, permissions, expires_at, is_active FROM hub.api_keys WHERE key_prefix = $1`,
      [prefix]
    );
    for (const row of rows) {
      const valid = await require('bcryptjs').compare(key.slice(20), row.key_hash);
      if (!valid) continue;
      if (!row.is_active) return res.status(403).json({ error: 'Clé API désactivée' });
      if (row.expires_at && new Date(row.expires_at) < new Date()) return res.status(403).json({ error: 'Clé API expirée' });
      await pool.query('UPDATE hub.api_keys SET last_used_at = NOW() WHERE id = $1', [row.id]);
      req.apiKey = { id: row.id, name: row.name, scope: row.scope, permissions: row.permissions || 'read' };
      // Identité de service synthétique : les contrôleurs/services attendent un req.user.
      // user_id null est toléré (pas de FK sur ticket_history.user_id).
      req.user = {
        id: null,
        username: `apikey:${row.name}`,
        email: null,
        // Rôle élevé en LECTURE seule : l'accès est déjà borné par le périmètre
        // de la clé + la passerelle qui n'autorise que les requêtes GET.
        role: 'superadmin',
        is_approved: 1,
        displayName: `API · ${row.name}`,
        via_api_key: true,
      };
      break;
    }
    if (!req.apiKey) return res.status(403).json({ error: 'Clé API invalide' });
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

const requireApiScope = (scope) => (req, res, next) => {
  // Requête authentifiée par clé API : on vérifie le périmètre (module).
  if (req.apiKey) {
    if (req.apiKey.scope === '*' || req.apiKey.scope === scope) return next();
    return res.status(403).json({ error: `Cette clé n'a pas accès au module ${scope}` });
  }
  // Requête authentifiée par JWT (UI/session) : pas de restriction de périmètre.
  if (req.user) return next();
  return res.status(401).json({ error: 'Authentification requise' });
};

const authenticateJWTorApiKey = async (req, res, next) => {
  // Clé API fournie via X-API-Key, ?api_key= ou Authorization: Bearer dsk_...
  if (extractApiKey(req)) {
    return authenticateApiKey(req, res, next);
  }
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authenticateJWT(req, res, next);
  }
  return authenticateApiKey(req, res, next);
};

// Accès humain réservé aux admins (JWT) OU clé API restreinte au module `scope`.
// Idéal pour exposer en lecture des données d'administration sans ouvrir l'accès
// à tous les utilisateurs connectés.
const authenticateAdminOrApiKey = (scope) => (req, res, next) => {
  // Voie clé API : authenticateApiKey gère l'échec (réponse envoyée, callback non appelé).
  if (extractApiKey(req)) {
    return authenticateApiKey(req, res, () => requireApiScope(scope)(req, res, next));
  }
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authenticateAdmin(req, res, next);
  }
  return authenticateApiKey(req, res, () => requireApiScope(scope)(req, res, next));
};

// ─── Passerelle API globale (lecture seule, scopée par module) ──────────────────
// Correspondance segment d'URL (après /api) → périmètre logique (scope) de la clé.
const SEG_TO_SCOPE = {
  tickets: 'tickets', 'auto-resolution': 'tickets',
  tasks: 'tasks',
  ville: 'ville',
  projets: 'projets', revues: 'projets',
  copieurs: 'copieurs',
  consumable: 'consommables',
  contrats: 'contrats',
  certificates: 'certificates',
  parc: 'parc',
  network: 'reseau',
  infra: 'infra',
  stocks: 'stocks',
  telecom: 'telecom',
  'lignes-mobiles': 'lignes_mobiles',
  mobilite: 'mobilite',
  deploiements: 'deploiements',
  budget: 'finance', finance: 'finance', tiers: 'finance', contacts: 'finance',
  rh: 'rh',
  'rencontres-budgetaires': 'rencontres', 'rencontres-reunions': 'rencontres',
  'directions-services': 'rencontres', 'direction-emails': 'rencontres',
  glpi: 'glpi',
  documents: 'documents', ged: 'documents', storage: 'documents',
  'calendrier-dsi': 'calendrier',
  live: 'live',
  'mail-collector': 'mail',
  transcriptmanager: 'transcript',
  'dsi-dashboard': 'dashboard',
  maps: 'dxf',
  'oracle-automation': 'oracle',
  notes: 'notes',
};

// Déduit le périmètre (scope) attendu depuis le chemin relatif à /api.
const scopeForPath = (relPath) => {
  const parts = String(relPath || '').split('?')[0].split('/').filter(Boolean);
  if (parts.length === 0) return null;
  let seg = parts[0];
  if (seg === 'admin') seg = parts[1]; // ex: /admin/rh → rh
  return SEG_TO_SCOPE[seg] || null;
};

// Monté sur /api AVANT les routers. Si une clé API est présente :
//  - authentifie la clé,
//  - n'autorise QUE les requêtes GET (lecture seule),
//  - vérifie que le périmètre de la clé couvre le module ciblé.
// Sans clé API → laisse passer (authentification JWT habituelle).
const apiKeyGate = (req, res, next) => {
  if (!extractApiKey(req)) return next();
  return authenticateApiKey(req, res, () => {
    if (req.method !== 'GET' && req.apiKey.permissions !== 'read_write') {
      return res.status(403).json({ error: "Clé API en lecture seule : passez la permission de cette clé en 'read_write' (/admin/api-keys) pour autoriser l'écriture" });
    }
    const scope = scopeForPath(req.path);
    if (!scope) {
      return res.status(403).json({ error: 'Ce chemin n\'est pas exposé via clé API' });
    }
    if (req.apiKey.scope !== '*' && req.apiKey.scope !== scope) {
      return res.status(403).json({ error: `Cette clé n'a pas accès au module ${scope}` });
    }
    next();
  });
};

// Laisse passer les requêtes déjà authentifiées par la passerelle (req.apiKey),
// sinon applique le middleware d'origine.
const bypassIfApiKey = (fn) => (req, res, next) => {
  if (req.apiKey) return next();
  return fn(req, res, next);
};

module.exports = {
    authenticateJWT: bypassIfApiKey(authenticateJWT),
    tryAuthenticateJWT,
    authenticateAdmin: bypassIfApiKey(authenticateAdmin),
    authenticateAdminUI: bypassIfApiKey(authenticateAdminUI),
    authenticateInternalOrAdmin: bypassIfApiKey(authenticateInternalOrAdmin),
    authenticateAdminOrFinances: bypassIfApiKey(authenticateAdminOrFinances),
    authenticateApiKey,
    requireApiScope,
    authenticateJWTorApiKey,
    authenticateAdminOrApiKey,
    apiKeyGate,
    scopeForPath,
    isSuperAdmin,
    isAdminLike,
};
