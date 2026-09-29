/**
 * Client de l'API Ville (APM) — partie annuaire + SMS.
 *
 * Comme l'envoi de mails (`shared/apm_mail.js`), la configuration est
 * centralisée côté API Ville : table PostgreSQL `hub.infra_apis`, clé
 * `apm_mail` (repli sur `apm_ai`, même hôte APM).
 * Aucun paramétrage AD/SMS local n'est requis dans ce backend.
 *
 * Endpoints APM consommés (proxy sécurisé par clé API) :
 *   POST /api/v1/sms/send              { mobile, message }
 *   GET  /api/v1/ad/search?q=          recherche multi-résultats
 *   GET  /api/v1/ad/user?identifier=   fiche détaillée
 *   POST /api/v1/ad/authenticate       { username, password }
 */
const { pgDb } = require('./database');

async function getConfig() {
    let cfg = await pgDb.get('SELECT * FROM hub.infra_apis WHERE key = ?', ['apm_mail']);
    if (!cfg || !cfg.base_url || !cfg.api_key) {
        const ai = await pgDb.get('SELECT * FROM hub.infra_apis WHERE key = ?', ['apm_ai']);
        if (ai && ai.base_url && ai.api_key) cfg = { ...ai, key: 'apm_mail' };
    }
    if (!cfg || !cfg.base_url) throw new Error("API Ville (APM) non configurée — renseigner base_url/api_key via /admin/infra");
    if (cfg.enabled === false) throw new Error("L'API Ville (APM) est désactivée — l'activer via /admin/infra");
    if (!cfg.api_key) throw new Error("Clé API Ville (APM) manquante — à renseigner via /admin/infra");
    return cfg;
}

/** Vrai si l'API Ville est configurée (sans lever d'exception). */
async function isConfigured() {
    try { await getConfig(); return true; } catch { return false; }
}

function baseUrl(cfg) {
    return (cfg.base_url || '').replace(/\/+$/, '');
}

function apiHeaders(cfg, extra = {}) {
    return { [cfg.header_name || 'X-API-KEY']: cfg.api_key, ...extra };
}

function describeError(status, text, label) {
    return `HTTP ${status} depuis l'API Ville (${label})${text ? ' — ' + text.slice(0, 300) : ''}`;
}

/** Normalise une entrée LDAP aplatie renvoyée par l'APM. */
function normalizeAdEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const first = (v) => (Array.isArray(v) ? v[0] : v);
    const username = first(entry.sAMAccountName || entry.samaccountname) || '';
    const displayName = first(entry.displayName || entry.cn || entry.name) || username;
    return {
        username,
        displayName,
        email: first(entry.mail || entry.userPrincipalName) || '',
        service: first(entry.department) || '',
        direction: first(entry.company || entry.companyName) || '',
        title: first(entry.title) || '',
        phone: first(entry.telephoneNumber || entry.mobile) || '',
        employeeID: first(entry.employeeID) || '',
        dn: entry.dn || '',
    };
}

/** Envoie un SMS via le proxy SMS de l'API Ville (Frizbi côté APM). */
async function sendSms(mobile, message, source) {
    if (!mobile || !message) throw new Error('Numéro et message SMS requis.');
    const cfg = await getConfig();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
        const resp = await fetch(`${baseUrl(cfg)}/api/v1/sms/send`, {
            method: 'POST',
            headers: apiHeaders(cfg, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({ mobile: String(mobile).replace(/\D/g, ''), message, source: source || 'parapheur' }),
            signal: ctrl.signal,
        });
        const text = await resp.text().catch(() => '');
        if (!resp.ok) throw new Error(describeError(resp.status, text, 'SMS'));
        return true;
    } finally {
        clearTimeout(timer);
    }
}

/** Recherche multi-résultats dans l'AD (via l'API Ville). Renvoie [] si introuvable. */
async function adSearch(query) {
    const q = String(query || '').trim();
    if (!q) return [];
    const cfg = await getConfig();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
        const resp = await fetch(`${baseUrl(cfg)}/api/v1/ad/search?q=${encodeURIComponent(q)}`, {
            headers: apiHeaders(cfg, { Accept: 'application/json' }),
            signal: ctrl.signal,
        });
        const text = await resp.text().catch(() => '');
        if (resp.status === 404 || resp.status === 204) return [];
        if (!resp.ok) throw new Error(describeError(resp.status, text, 'annuaire AD'));
        let data;
        try { data = JSON.parse(text); } catch { return []; }
        const list = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
        return list.map(normalizeAdEntry).filter(Boolean);
    } finally {
        clearTimeout(timer);
    }
}

/** Fiche détaillée d'un utilisateur AD (via l'API Ville). Renvoie null si introuvable. */
async function adUser(identifier) {
    const id = String(identifier || '').trim();
    if (!id) return null;
    const cfg = await getConfig();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
        const resp = await fetch(`${baseUrl(cfg)}/api/v1/ad/user?identifier=${encodeURIComponent(id)}`, {
            headers: apiHeaders(cfg, { Accept: 'application/json' }),
            signal: ctrl.signal,
        });
        const text = await resp.text().catch(() => '');
        if (resp.status === 404 || resp.status === 204) return null;
        if (!resp.ok) throw new Error(describeError(resp.status, text, 'annuaire AD'));
        let data;
        try { data = JSON.parse(text); } catch { return null; }
        const entry = Array.isArray(data) ? data[0] : (Array.isArray(data?.data) ? data.data[0] : data);
        return normalizeAdEntry(entry);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Vérifie les identifiants d'un utilisateur dans l'AD via l'API Ville.
 * Renvoie { success, dn } en cas de succès, null si les identifiants sont refusés.
 */
async function adAuthenticate(username, password) {
    const cfg = await getConfig();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
        const resp = await fetch(`${baseUrl(cfg)}/api/v1/ad/authenticate`, {
            method: 'POST',
            headers: apiHeaders(cfg, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({ username: String(username || ''), password: String(password || '') }),
            signal: ctrl.signal,
        });
        const text = await resp.text().catch(() => '');
        if (resp.status === 401) return null;
        if (!resp.ok) throw new Error(describeError(resp.status, text, 'authentification AD'));
        let data;
        try { data = JSON.parse(text); } catch { return null; }
        return (data && data.success) ? data : null;
    } finally {
        clearTimeout(timer);
    }
}

module.exports = {
    getConfig,
    isConfigured,
    sendSms,
    adSearch,
    adUser,
    adAuthenticate,
    normalizeAdEntry,
};
