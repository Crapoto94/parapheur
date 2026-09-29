/**
 * Réglages de l'application (remplace l'ancienne base SQLite).
 *
 * Les valeurs par défaut proviennent du fichier `.env` (variables
 * d'environnement). Les réglages modifiables depuis l'administration (paramètres
 * du parapheur, stockage documentaire, Alfresco) sont écrits dans un fichier
 * JSON local (`data/settings.json`, surchargeable via `SETTINGS_FILE`) qui
 * prend le pas sur le `.env`.
 *
 * Plus aucune donnée de paramétrage n'est stockée en base SQLite.
 */
const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = process.env.SETTINGS_FILE
    ? path.resolve(process.env.SETTINGS_FILE)
    : path.join(__dirname, '..', 'data', 'settings.json');

function parseBool(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    const s = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'oui', 'on'].includes(s)) return true;
    if (['0', 'false', 'no', 'non', 'off'].includes(s)) return false;
    return fallback;
}

function parsePositiveInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

function trimTrailingSlash(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

const DEFAULT_MAIL_TEMPLATE = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<body style="margin: 0; padding: 0; min-width: 100%; background-color: #f4f7f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
    <table width="100%" bgcolor="#f4f7f9" border="0" cellpadding="0" cellspacing="0" style="background-color: #f4f7f9;">
    <tr>
        <td style="padding: 40px 0;">
            <table align="center" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 750px;">
                <!-- Header / Logo -->
                <tr>
                    <td align="center" style="padding-bottom: 30px;">
                        <img src="Ivry.png" width="180" border="0" alt="Ivry s/ Seine" style="display: block;" />
                        <div style="font-size: 18px; font-weight: 700; color: #1a202c; margin-top: 10px;">Ville d'Ivry-sur-seine</div>
                    </td>
                </tr>
                <!-- Content Area -->
                <tr>
                    <td bgcolor="#ffffff" style="background-color: #ffffff; padding: 40px; border: 1px solid #e1e7ed; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="width: 100%; max-width: 100%; table-layout: fixed;">
                            <tr>
                                <td style="font-size: 16px; line-height: 1.6; color: #2d3748; width: 100%; max-width: 100%;">
                                    {{content}}
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
                <!-- Footer area -->
                <tr>
                    <td align="center" style="padding: 30px;">
                        <!-- Accent Line -->
                        <table width="100%" border="0" cellspacing="0" cellpadding="0">
                            <tr>
                                <td height="4" style="height: 4px; background: linear-gradient(to right, #e53e3e, {{footerColor}}); border-radius: 2px;"></td>
                            </tr>
                        </table>
                        <br />
                        <table width="100%" border="0" cellspacing="0" cellpadding="0">
                            <tr>
                                <td align="center" style="color: #718096; font-size: 13px; line-height: 20px;">
                                    <div style="text-transform: uppercase; letter-spacing: 1.2px; font-weight: 800; color: {{footerColor}}; font-size: 11px; margin-bottom: 5px;">{{footer1}}</div>
                                    <div style="font-weight: 600; color: #4a5568;">{{footer2}}</div>
                                    <div>{{footer3}}</div>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </td>
    </tr>
    </table>
</body>
</html>`;

const ENV_DEFAULTS = {
    app_base_url: trimTrailingSlash(process.env.APP_BASE_URL || process.env.APP_URL || process.env.FRONTEND_URL || ''),
    parapheur: {
        public_base_url: trimTrailingSlash(process.env.PARAPHEUR_PUBLIC_URL || ''),
        seal_enabled: parseBool(process.env.PARAPHEUR_SEAL_ENABLED, true),
        bulk_sign_mention: process.env.PARAPHEUR_BULK_SIGN_MENTION || '',
        notify_interval_minutes: parsePositiveInt(process.env.PARAPHEUR_NOTIFY_INTERVAL_MINUTES, 2),
    },
    storage: {
        backend: process.env.STORAGE_BACKEND || 'filesystem',
        root_path: process.env.STORAGE_ROOT_PATH || '',
        login: process.env.STORAGE_LOGIN || '',
        password: process.env.STORAGE_PASSWORD || '',
        domain: process.env.STORAGE_DOMAIN || '',
    },
    alfresco: {
        url: process.env.ALFRESCO_URL || '',
        username: process.env.ALFRESCO_USERNAME || '',
        password: process.env.ALFRESCO_PASSWORD || '',
        root_path: process.env.ALFRESCO_ROOT_PATH || '',
    },
    documents: {
        backend: process.env.DOCUMENTS_BACKEND || 'filesystem',
    },
    mail: {
        smtp_host: process.env.MAIL_SMTP_HOST || '',
        smtp_port: parsePositiveInt(process.env.MAIL_SMTP_PORT, 0),
        smtp_user: process.env.MAIL_SMTP_USER || '',
        smtp_pass: process.env.MAIL_SMTP_PASS || '',
        smtp_secure: process.env.MAIL_SMTP_SECURE || '',
        proxy_host: process.env.MAIL_PROXY_HOST || '',
        proxy_port: parsePositiveInt(process.env.MAIL_PROXY_PORT, 0),
        sender_email: process.env.MAIL_SENDER_EMAIL || '',
        sender_name: process.env.MAIL_SENDER_NAME || 'DSI Hub',
        api_key: process.env.MAIL_API_KEY || '',
        api_url: process.env.MAIL_API_URL || 'https://api.brevo.com/v3/smtp/email',
        template_html: process.env.MAIL_TEMPLATE_HTML || DEFAULT_MAIL_TEMPLATE,
        footer_color: process.env.MAIL_FOOTER_COLOR || '#2563eb',
        footer1: process.env.MAIL_FOOTER1 || "VILLE D'IVRY-SUR-SEINE",
        footer2: process.env.MAIL_FOOTER2 || 'Hôtel de Ville — Esplanade Georges Marrane',
        footer3: process.env.MAIL_FOOTER3 || '94200 Ivry-sur-Seine',
        global_enable: parseBool(process.env.MAIL_GLOBAL_ENABLE, true),
        use_api: parseBool(process.env.MAIL_USE_API, true),
    },
};

let fileData = {};

function reload() {
    try {
        const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        fileData = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch {
        fileData = {};
    }
}

function persist() {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(fileData, null, 2), 'utf8');
}

/** Section de réglages : valeurs par défaut du .env surchargées par le fichier. */
function section(name) {
    const defaults = ENV_DEFAULTS[name] || {};
    const file = (fileData[name] && typeof fileData[name] === 'object' && !Array.isArray(fileData[name])) ? fileData[name] : {};
    return { ...defaults, ...file };
}

/** Met à jour (et persiste) une section de réglages. */
function updateSection(name, patch = {}) {
    const current = (fileData[name] && typeof fileData[name] === 'object' && !Array.isArray(fileData[name])) ? fileData[name] : {};
    fileData[name] = { ...current, ...patch };
    persist();
    return section(name);
}

function getAppBaseUrl() {
    const v = (fileData.app_base_url !== undefined ? fileData.app_base_url : ENV_DEFAULTS.app_base_url) || '';
    return trimTrailingSlash(v);
}

function saveAppBaseUrl(value) {
    fileData.app_base_url = trimTrailingSlash(value);
    persist();
    return fileData.app_base_url;
}

reload();

module.exports = {
    SETTINGS_FILE,
    section,
    updateSection,
    getAppBaseUrl,
    saveAppBaseUrl,
    reload,
    parseBool,
};
