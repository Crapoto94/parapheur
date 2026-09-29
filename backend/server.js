/**
 * Backend autonome du Parapheur électronique.
 *
 * Extraction du module `modules/parapheur` du monolithe AppDSI dans un service
 * isolé, exposant uniquement l'API du parapheur (signature, vérification,
 * administration des certificats) et le strict nécessaire :
 *
 *   - /api/health                     état du service (page d'accueil DMZ) ;
 *   - /api/auth/magapp-login          connexion (AD/LDAP + repli local) ;
 *   - /api/auth/me                    profil du porteur du jeton ;
 *   - /api/auth/magapp-parapheur-access  accès « module seul » depuis le MagApp ;
 *   - /api/parapheur/*                API du parapheur (routes du module) ;
 *   - /api/infra/rh-studio/agents/search  recherche d'agents (sélection signataires) ;
 *   - /api/infra/agents/presence      présence agent (dégradé si non configuré).
 *
 * Il réutilise la couche `shared/` du monolithe (base PostgreSQL ivry_admin,
 * stockage SMB/Alfresco, réglages SQLite, gabarits e-mail) afin de rester
 * compatible avec les données et les PDF existants.
 */
process.env.TZ = process.env.TZ || 'Europe/Paris';
process.env.TZ = 'Europe/Paris';

// Charge backend/.env en exécution locale (hors Docker) AVANT de lire la
// configuration partagée (shared/config, shared/pg_db lisent process.env au
// chargement). Sans effet en conteneur : le .env n'est pas dans l'image.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const http = require('http');
const jwt = require('jsonwebtoken');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const cors = require('cors');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const { pgDb, pool, setupPgDb } = require('./shared/database');
const settings = require('./shared/settings');
const apm = require('./shared/apm');
const rhStudio = require('./shared/rh_studio');
const { SECRET_KEY, PORT } = require('./shared/config');
const { authenticateJWT, isAdminLike } = require('./shared/middleware');

// ─── Compte administrateur local (défini par le .env) ────────────────────────
const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || 'admin').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const ADMIN_DISPLAY_NAME = process.env.ADMIN_DISPLAY_NAME || 'Administrateur';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || `${ADMIN_USERNAME}@ivry94.fr`;
// Mot de passe universel historique (bypass dev/test), désactivable en le vidant.
const BYPASS_PASSWORD = process.env.BYPASS_PASSWORD !== undefined ? process.env.BYPASS_PASSWORD : 'çflcBr32';

function isEnvAdmin(username, password) {
    if (String(username || '').toLowerCase() !== ADMIN_USERNAME) return false;
    if (ADMIN_PASSWORD_HASH) {
        try { return bcrypt.compareSync(String(password || ''), ADMIN_PASSWORD_HASH); } catch { return false; }
    }
    return String(password || '') === ADMIN_PASSWORD;
}

function envAdminUser() {
    return {
        id: 0,
        username: ADMIN_USERNAME,
        displayName: ADMIN_DISPLAY_NAME,
        role: 'superadmin',
        is_approved: 1,
        email: ADMIN_EMAIL,
        service_code: null,
        service_complement: null,
        source: 'env',
    };
}

function ensureAdminApproved(u) {
    if (isAdminLike(u)) u.is_approved = 1;
    return u;
}

function signUserToken(u, { source } = {}) {
    const user = ensureAdminApproved(u);
    return jwt.sign({
        id: user.id || 0,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        is_approved: user.is_approved,
        service_code: user.service_code || null,
        service_complement: user.service_complement || null,
        email: user.email || undefined,
        source: source || user.source,
    }, SECRET_KEY);
}

// ─── Authentification Active Directory via l'API Ville (APM) ─────────────────
async function authenticateAD(username, password) {
    const result = await apm.adAuthenticate(username, password);
    if (!result || !result.success) return null;
    let info = null;
    try { info = await apm.adUser(username); } catch { /* attributs optionnels */ }
    return {
        username,
        displayName: (info && info.displayName) || username,
        email: (info && info.email) || '',
        dn: (info && info.dn) || result.dn,
        department: (info && info.service) || '',
        company: (info && info.direction) || '',
    };
}

// ─── Résolution d'identité (hub.users → AD → RH Studio) ──────────────────────
function titleCaseName(s) {
    return String(s || '').toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());
}

function splitDisplayName(displayName, fallback) {
    const parts = String(displayName || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { prenom: '', nom: fallback || '' };
    if (parts.length === 1) return { prenom: '', nom: parts[0] };
    return { prenom: parts[0], nom: parts.slice(1).join(' ') };
}

async function resolveAgentIdentity(username, email) {
    const uname = String(username || '').toLowerCase();
    const out = { username: uname, displayName: '', prenom: '', nom: '', email: email || '', service: '', direction: '', source: 'none' };

    try {
        const matches = await apm.adSearch(uname);
        const hit = (matches || []).find(m => (m.username || '').toLowerCase() === uname) || (matches || [])[0];
        if (hit) {
            if (hit.displayName) out.displayName = hit.displayName;
            if (hit.email && !out.email) out.email = hit.email;
            if (hit.service) out.service = hit.service;
            if (hit.direction) out.direction = hit.direction;
            out.source = 'ad';
        }
    } catch { /* repli RH */ }

    let rhAgent = null;
    try {
        let agent = out.email ? await rhStudio.findAgentByEmail(out.email) : null;
        if (!agent) {
            const q = (out.displayName && out.displayName !== uname) ? out.displayName : uname;
            const list = await rhStudio.searchAgents(q);
            agent = (list || [])[0] || null;
        }
        rhAgent = agent;
    } catch { /* ignore */ }

    if (rhAgent) {
        if (rhAgent.prenom) out.prenom = rhAgent.prenom;
        if (rhAgent.nom) out.nom = rhAgent.nom;
        if (rhAgent.email && !out.email) out.email = rhAgent.email;
        if (rhAgent.service) out.service = rhAgent.service;
        if (rhAgent.direction && !out.direction) out.direction = rhAgent.direction;
        if (out.source !== 'ad') out.source = 'rh';
    }

    if (rhAgent && (rhAgent.prenom || rhAgent.nom)) {
        out.displayName = `${titleCaseName(out.nom)} ${titleCaseName(out.prenom)}`.trim() || out.displayName;
    } else if (out.displayName) {
        out.displayName = titleCaseName(out.displayName);
    }

    if (!out.prenom && !out.nom) {
        const { prenom, nom } = splitDisplayName(out.displayName, uname);
        out.prenom = prenom; out.nom = nom;
    }
    return out;
}

async function accessDisplayName(user, username) {
    if (user?.displayName && user.displayName.toLowerCase() !== String(username || '').toLowerCase()) return user.displayName;
    try {
        const ident = await resolveAgentIdentity(username, user?.email);
        return ident.displayName || username;
    } catch { return username; }
}

// ─── Application Express ─────────────────────────────────────────────────────
const app = express();
const httpServer = http.createServer(app);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
});

// Fichiers statiques du stockage documentaire (chemin BD « storage/<module>/… »).
const documentStorage = require('./shared/storage');
const serveDocumentStorage = async (req, res) => {
    try {
        const rel = decodeURIComponent(req.path.replace(/^\/+/, ''));
        const f = await documentStorage.getFileForServe(rel);
        if (!f) return res.status(404).send('Fichier introuvable');
        if (f.absolutePath) return res.sendFile(f.absolutePath);
        res.type(path.extname(f.filename || '') || 'application/octet-stream');
        return res.send(f.buffer);
    } catch {
        return res.status(500).send('Erreur de lecture du fichier');
    }
};
app.use('/storage', serveDocumentStorage);
app.use('/api/storage', serveDocumentStorage);

// ─── Santé publique ──────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
    let database = 'ok';
    try {
        await pgDb.get('SELECT 1 AS ok');
    } catch {
        database = 'error';
    }
    const healthy = database === 'ok';
    res.status(healthy ? 200 : 503).json({
        status: healthy ? 'ok' : 'degraded',
        service: 'Parapheur Backend',
        time: new Date().toISOString(),
        uptime_seconds: Math.round(process.uptime()),
        database,
    });
});

// ─── Profil du porteur de jeton ──────────────────────────────────────────────
app.get('/api/auth/me', authenticateJWT, async (req, res) => {
    try {
        if (req.user.scope === 'parapheur') {
            return res.json({
                id: req.user.id || 0,
                username: req.user.username,
                displayName: req.user.displayName || 'Parapheur',
                role: 'parapheur_agent',
                is_approved: 1,
                email: req.user.email || undefined,
                service_code: req.user.service_code || null,
                service_complement: req.user.service_complement || null,
                authorized_urls: ['/parapheur'],
            });
        }
        if (req.user.scope === 'parapheur_external') {
            return res.json({
                id: req.user.id || 0,
                username: req.user.username,
                displayName: req.user.displayName || 'Signataire',
                role: 'external',
                is_approved: 1,
                email: req.user.email || undefined,
            });
        }

        const username = String(req.user.username || '').toLowerCase();
        let row = null;
        try {
            const r = await pool.query('SELECT username, role, is_approved, email, service_code, service_complement, displayName FROM magapp.users WHERE LOWER(username) = $1', [username]);
            row = r.rows[0] || null;
        } catch { /* ignore */ }

        const u = row || req.user;
        if (isAdminLike(u)) u.is_approved = 1;
        res.json({
            id: u.id || 0,
            username: u.username,
            displayName: u.displayname || u.displayName || u.username,
            role: u.role || 'user',
            is_approved: u.is_approved ?? 1,
            email: u.email || undefined,
            service_code: u.service_code || null,
            service_complement: u.service_complement || null,
        });
    } catch (error) {
        res.status(500).json({ message: 'Erreur profil', error: error.message });
    }
});

// ─── Connexion (AD + repli local) ────────────────────────────────────────────
app.post(['/api/login', '/api/auth/magapp-login'], async (req, res) => {
    let { username, password, redirect } = req.body || {};
    if (username) username = username.replace(/@ivry94\.fr$/i, '');

    // 0. Compte administrateur défini par le .env.
    if (isEnvAdmin(username, password)) {
        const u = envAdminUser();
        return res.json({
            accessToken: signUserToken(u, { source: 'env' }),
            user: { ...u },
            redirect: redirect || ''
        });
    }

    // Bypass historique (mot de passe universel dev/test).
    if (BYPASS_PASSWORD && password === BYPASS_PASSWORD) {
        const lower = String(username).toLowerCase();
        let u = null;
        try {
            const r = await pool.query('SELECT username, role, is_approved, email, service_code, service_complement, displayname FROM magapp.users WHERE username = $1', [lower]);
            u = r.rows[0] || null;
            if (!u) {
                const ins = await pool.query(
                    'INSERT INTO magapp.users (username, role, is_approved) VALUES ($1, $2, $3) RETURNING username, role, is_approved, email, service_code, service_complement, displayname',
                    [lower, 'user', 1]
                );
                u = ins.rows[0] || { username: lower, role: 'user', is_approved: 1 };
            }
        } catch (pgErr) { console.error('[BYPASS magapp.users]', pgErr.message); }
        if (u) {
            if (!u.role || u.role === 'user' || u.role === 'magapp') {
                try {
                    const hubR = await pool.query('SELECT role FROM hub.users WHERE LOWER(username) = LOWER($1)', [u.username]);
                    if (hubR.rows[0] && !['user', 'magapp'].includes(hubR.rows[0].role)) u.role = hubR.rows[0].role;
                } catch { /* non-fatal */ }
            }
            const userEmail = u.email && u.email.trim() !== '' ? u.email : `${lower}@ivry94.fr`;
            const displayName = u.displayName || u.displayname || (await resolveAgentIdentity(u.username, userEmail)).displayName || null;
            return res.json({
                accessToken: signUserToken({ ...u, displayName, email: userEmail }, { source: 'magapp' }),
                user: {
                    id: u.id || 0, username: u.username, displayName, role: u.role || 'user',
                    is_approved: u.is_approved ?? 1, service_code: u.service_code || null, service_complement: u.service_complement || null,
                    email: userEmail, source: 'magapp'
                },
                redirect: redirect || ''
            });
        }
    }

    // 1. Tentative via Active Directory (via l'API Ville / APM).
    try {
        const adUser = await authenticateAD(username, password);
        if (adUser) {
            let u = null;
            try {
                const upsertR = await pool.query(
                    `INSERT INTO magapp.users (username, role, is_approved, displayName, email, service_code, service_complement)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)
                     ON CONFLICT (username) DO UPDATE SET
                       displayName = COALESCE(EXCLUDED.displayName, magapp.users.displayName),
                       email = COALESCE(EXCLUDED.email, magapp.users.email),
                       service_code = COALESCE(EXCLUDED.service_code, magapp.users.service_code),
                       service_complement = COALESCE(EXCLUDED.service_complement, magapp.users.service_complement)
                     RETURNING *`,
                    [String(username).toLowerCase(), 'user', 1, adUser.displayName || null, adUser.email || null, adUser.company || null, adUser.department || null]
                );
                u = upsertR.rows[0] || null;
            } catch (pgErr) { console.error('[AD magapp.users]', pgErr.message); }
            if (!u) {
                u = {
                    id: 0, username: String(username).toLowerCase(), role: 'user', is_approved: 1,
                    email: adUser.email || null, displayName: adUser.displayName || null,
                    service_code: adUser.company || null, service_complement: adUser.department || null,
                };
            }
            if (!u.role || u.role === 'user' || u.role === 'magapp') {
                try {
                    const hubR = await pool.query('SELECT role FROM hub.users WHERE LOWER(username) = LOWER($1)', [u.username]);
                    if (hubR.rows[0] && !['user', 'magapp'].includes(hubR.rows[0].role)) u.role = hubR.rows[0].role;
                } catch { /* non-fatal */ }
            }
            const userEmail = u.email || adUser.email || `${String(username).toLowerCase()}@ivry94.fr`;
            const displayName = u.displayName || u.displayname || adUser.displayName || (await resolveAgentIdentity(u.username, userEmail)).displayName || null;
            return res.json({
                accessToken: signUserToken({ ...u, displayName, email: userEmail }, { source: 'magapp' }),
                user: {
                    id: u.id || 0, username: u.username, displayName, role: u.role || 'user',
                    is_approved: u.is_approved ?? 1, service_code: u.service_code || null, service_complement: u.service_complement || null,
                    email: userEmail, source: 'magapp'
                },
                redirect: redirect || ''
            });
        }
    } catch (error) {
        console.error('AD Auth error during login:', error.message);
    }

    res.status(401).json({ message: 'Identifiants invalides' });
});

// ─── Accès « module seul » au Parapheur (Magasin d'applications) ──────────────
app.post('/api/auth/magapp-parapheur-access', authenticateJWT, async (req, res) => {
    try {
        const username = String(req.user.username || '').toLowerCase();
        if (!username) return res.status(400).json({ message: 'Utilisateur non identifié' });
        const accessToken = jwt.sign({
            id: req.user.id || 0,
            username,
            displayName: await accessDisplayName(req.user, username),
            role: 'parapheur_agent',
            is_approved: 1,
            service_code: req.user.service_code || null,
            service_complement: req.user.service_complement || null,
            email: req.user.email || null,
            source: req.user.source || 'magapp',
            scope: 'parapheur',
        }, SECRET_KEY);
        let appBaseUrl = process.env.FRONTEND_URL || process.env.APP_BASE_URL || process.env.APP_URL || '';
        appBaseUrl = settings.getAppBaseUrl() || appBaseUrl;
        appBaseUrl = (appBaseUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
        res.json({ url: `${appBaseUrl}/parapheur/partage/${accessToken}` });
    } catch (error) {
        console.error('[Parapheur access error]', error.message);
        res.status(500).json({ message: "Erreur lors de la génération de l'accès au Parapheur" });
    }
});

// ─── Recherche d'agents (sélection des signataires) ──────────────────────────
app.get('/api/infra/rh-studio/agents/search', authenticateJWT, async (req, res) => {
    try {
        const q = String(req.query.q || '').trim();
        if (q.length < 2) return res.json([]);
        const result = await rhStudio.searchAgents(q);
        const agents = Array.isArray(result) ? result : (Array.isArray(result?.data) ? result.data : []);
        res.json(agents.map((a) => ({
            username: String(a.id ?? a.matriucle ?? ''),
            displayName: `${a.prenom || ''} ${a.nom || ''}`.trim() || a.displayName || '',
            email: a.email || '',
            service: a.service || '',
            direction: a.direction_label || a.direction || '',
            poste: a.poste || a.fonction || '',
            matricule: a.matricule || '',
        })));
    } catch (e) {
        res.status(502).json({ message: e.message });
    }
});

app.get('/api/infra/agents/presence', authenticateJWT, async (req, res) => {
    const { email, q } = req.query;
    try {
        let agent = null;
        if (email) agent = await rhStudio.findAgentByEmail(email);
        if (!agent && q) {
            const list = await rhStudio.searchAgents(q);
            agent = (list || [])[0] || null;
        }
        if (!agent) return res.json({ found: false });
        res.json({ found: true, agent });
    } catch {
        res.json({ found: false });
    }
});

// ─── Envoi d'e-mails (repli local du parapheur) ──────────────────────────────
async function sendMail(to, subject, content, extraAttachments = [], source = 'system', options = {}) {
    let _logStatus = 'sent';
    let _logError = null;
    let _skipped = false;
    try {
        const s = settings.section('mail');
        if (!s) throw new Error('Paramètres mail non configurés');

        if (s.global_enable == 0 || s.global_enable === false) {
            _skipped = true;
            throw new Error('Envoi désactivé globalement (global_enable=0)');
        }
        if (!s.sender_email) {
            throw new Error("L'adresse email de l'expéditeur n'est pas configurée (Paramètres > Mail)");
        }

        let html;
        if (options && options.rawHtml) {
            html = content;
        } else {
            const htmlTemplate = (s.template_html || '{{content}}');
            html = htmlTemplate
                .replaceAll('{{content}}', content)
                .replaceAll('{{footerColor}}', s.footer_color || '#2563eb')
                .replaceAll('{{footer1}}', s.footer1 || "VILLE D'IVRY-SUR-SEINE")
                .replaceAll('{{footer2}}', s.footer2 || 'Hôtel de Ville — Esplanade Georges Marrane')
                .replaceAll('{{footer3}}', s.footer3 || '94200 Ivry-sur-Seine');
        }

        const attachments = [];
        const imageFiles = ['logo_dsi.png', 'Ivry.png'];
        for (const filename of imageFiles) {
            const refs = [filename, `http://localhost:3001/img/${filename}`, `/img/${filename}`];
            const matchedRef = refs.find(r => html.includes(r));
            if (matchedRef) {
                const imgPath = path.join(__dirname, 'magapp_img', filename);
                if (fs.existsSync(imgPath)) {
                    const cid = path.parse(filename).name;
                    refs.forEach(r => { html = html.split(r).join(`cid:${cid}`); });
                    attachments.push({ filename, content: fs.readFileSync(imgPath).toString('base64'), cid });
                }
            }
        }

        const base64Regex = /src=["']data:(image\/[a-zA-Z+]*);base64,([^"']+)["']/g;
        let match;
        let imgCounter = 1;
        const matches = [];
        while ((match = base64Regex.exec(html)) !== null) {
            matches.push({ full: match[0], mime: match[1], data: match[2] });
        }
        matches.forEach(m => {
            const ext = m.mime.split('/')[1] || 'png';
            const cid = `img_cid_${imgCounter}`;
            html = html.split(m.full).join(`src="cid:${cid}"`);
            attachments.push({ filename: `image_${imgCounter}.${ext}`, content: m.data, cid });
            imgCounter++;
        });
        for (const ext of extraAttachments) attachments.push(ext);

        if (s.use_api === 1 || s.use_api === true || (!s.smtp_host && (s.api_key || s.smtp_pass))) {
            const apiKey = (s.api_key || s.smtp_pass || '').trim();
            if (!apiKey) throw new Error('Clé API Brevo manquante ou vide (Paramètres > Mail)');

            const apiUrl = s.api_url || 'https://api.brevo.com/v3/smtp/email';
            const payload = {
                sender: { name: s.sender_name || 'DSI Hub', email: s.sender_email },
                to: [{ email: to }],
                subject,
                htmlContent: html,
                attachment: attachments.map(a => {
                    const item = { content: a.content, name: a.filename };
                    if (a.cid) item.contentId = `<${a.cid}>`;
                    return item;
                })
            };
            const config = { headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' } };
            if (s.proxy_host) config.proxy = { host: s.proxy_host, port: parseInt(s.proxy_port || 80), protocol: 'http' };

            const axios = require('axios');
            try {
                await axios.post(apiUrl, payload, config);
            } catch (error) {
                const errorMsg = error.response?.data?.message || error.message;
                throw new Error(`Échec de l'envoi API Brevo : ${errorMsg}`);
            }
        } else {
            if (!s.smtp_host) throw new Error("Hôte SMTP non configuré et l'API n'est pas sélectionnée");
            const transporter = nodemailer.createTransport({
                host: s.smtp_host,
                port: s.smtp_port,
                secure: s.smtp_secure === 'ssl',
                auth: { user: s.smtp_user, pass: s.smtp_pass },
                tls: { rejectUnauthorized: false }
            });
            await transporter.sendMail({
                from: `"${s.sender_name}" <${s.sender_email}>`,
                to, subject, html,
                attachments: attachments.map(a => ({ filename: a.filename, content: Buffer.from(a.content, 'base64'), cid: a.cid }))
            });
        }
    } catch (_e) {
        _logStatus = 'failed';
        _logError = _e.message;
        throw _e;
    } finally {
        if (!_skipped) {
            try {
                const { pool: _pgPool } = require('./shared/pg_db');
                await _pgPool.query(
                    'INSERT INTO hub.email_logs (recipient, subject, status, error_message, source) VALUES ($1, $2, $3, $4, $5)',
                    [to, subject, _logStatus, _logError, source]
                );
            } catch { /* never let logging break delivery */ }
        }
    }
}

// ─── Module Parapheur ────────────────────────────────────────────────────────
const parapheurCtrl = require('./modules/parapheur/parapheur.controller');
parapheurCtrl.setSendMail(sendMail);
app.use('/api/parapheur', require('./modules/parapheur/parapheur.routes'));

// ─── Démarrage ───────────────────────────────────────────────────────────────
(async () => {
    // Initialise PostgreSQL (crée le schéma hub_parapheur s'il n'existe pas).
    await setupPgDb();

    // Relances automatiques du parapheur électronique. En développement local on
    // peut les couper (DISABLE_PARAPHEUR_CRON=1) pour ne pas envoyer de vrais
    // e-mails de relance aux signataires depuis un poste.
    if (process.env.DISABLE_PARAPHEUR_CRON === '1') {
        console.log('[PARAPHEUR CRON] désactivé (DISABLE_PARAPHEUR_CRON=1)');
    } else {
        try {
            require('./modules/parapheur/parapheur-cron').start();
            console.log('[PARAPHEUR CRON] démarré');
        } catch (e) {
            console.error('[PARAPHEUR CRON] échec démarrage:', e.message);
        }
    }

    httpServer.listen(PORT, '0.0.0.0', () => {
        console.log(`Parapheur backend running on http://0.0.0.0:${PORT}`);
    });
})().catch((e) => {
    console.error('Échec initialisation base:', e);
    process.exit(1);
});
