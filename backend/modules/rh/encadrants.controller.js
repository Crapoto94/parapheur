/**
 * Encadrants — liste des directeurs et responsables de service.
 *  - récupération depuis oracle.rh_v_extract_dsi (PostgreSQL)
 *  - email enrichi via l'API Ville (APM), aucun paramétrage AD local.
 *
 * Utilisé par le module Parapheur pour déterminer les agents éligibles à la
 * signature sécurisée (DG / directeurs).
 */
const { pgDb } = require('../../shared/database');
const apm = require('../../shared/apm');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ACTIVE_FILTER = `("POSITION_L" LIKE 'Activité%' OR "POSITION_L" LIKE 'Temps partiel%')`;

/** Détecte si un service = le service "d'accueil" de sa direction, c'est-à-dire
 *  le service générique qui porte le même libellé que la direction elle-même.
 */
function isDirectionService(dirLabel, svcLabel) {
    if (!dirLabel || !svcLabel) return false;
    return dirLabel.trim().toUpperCase() === svcLabel.trim().toUpperCase();
}

// ─── Controller ──────────────────────────────────────────────────────────────

module.exports = {

    /**
     * GET /api/admin/rh/encadrants
     * Retourne les directeurs + responsables de service actifs, enrichis
     * avec l'email AD (via l'API Ville) et le téléphone stocké en base.
     */
    getEncadrants: async (req, res) => {
        try {
            // 1. Récupérer directeurs et resp. de service actifs.
            // On exclut les « directeurs » d'équipements (crèche, multi-accueil, maison de quartier,
            // résidences autonomie) et les postes de direction de cabinet ou artistique qui
            // ne correspondent pas à des chefs de direction administrative.
            const agents = await pgDb.all(`
                SELECT
                    "MATRICULE", "NOM", "PRENOM",
                    "DIRECTION", "DIRECTION_L",
                    "SERVICE", "SERVICE_L",
                    "POSTE_L", "FONCTION_L",
                    "POSITION_L"
                FROM oracle.rh_v_extract_dsi
                WHERE ${ACTIVE_FILTER}
                  AND (
                    "POSTE_L" LIKE 'DIRECTEUR%GENERAL%'
                    OR "POSTE_L" LIKE 'DIRECTEUR·TRICE D%'
                    OR "POSTE_L" LIKE 'RESPONSABLE DU SERVICE%'
                  )
                  AND "POSTE_L" NOT LIKE '%CABINET%'
                  AND "POSTE_L" NOT LIKE '%ARTISTIQUE%'
                  AND "POSTE_L" NOT LIKE '%MAISON DE QUARTIER%'
                  AND "POSTE_L" NOT LIKE '%CRECHE%'
                  AND "POSTE_L" NOT LIKE '%MULTI ACCUEIL%'
                  AND "POSTE_L" NOT LIKE '%MULTI-ACCUEIL%'
                  AND "POSTE_L" NOT LIKE '%RESIDENCES AUTONOMIE%'
                ORDER BY "DIRECTION", "SERVICE", "NOM", "PRENOM"
            `);

            if (!agents.length) return res.json([]);

            // 2. Données stockées (téléphones + liens AD manuels)
            const phones = await pgDb.all('SELECT matricule, telephone, telephone_perso, ad_username, email_override FROM hub.encadrants');
            const phoneMap = new Map(phones.map(p => [p.matricule, { telephone: p.telephone, telephone_perso: p.telephone_perso, ad_username: p.ad_username, email_override: p.email_override }]));

            // 3. Emails depuis l'AD via l'API Ville (APM), best-effort, pour les
            //    encadrants sans override manuel. Recherche par « PRENOM NOM ».
            const emailMap = new Map(); // matricule -> { email, ad_phone }
            const norm = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
            for (const a of agents) {
                const stored = phoneMap.get(a.MATRICULE) || {};
                if (stored.email_override) continue;
                const full = `${a.PRENOM || ''} ${a.NOM || ''}`.trim();
                if (!full) continue;
                try {
                    const found = await apm.adSearch(full);
                    const hit = (found || []).find(u => norm(u.displayName) === norm(full))
                        || (found || []).find(u => norm(u.displayName) === norm(`${a.NOM || ''} ${a.PRENOM || ''}`))
                        || (found || [])[0];
                    if (hit && hit.email) emailMap.set(a.MATRICULE, { email: hit.email, ad_phone: hit.phone || '' });
                } catch (e) { /* agent ignoré */ }
            }

            // 4. Assembler la réponse
            const result = agents.map(a => {
                const adData = emailMap.get(a.MATRICULE) || {};
                const stored = phoneMap.get(a.MATRICULE) || {};
                const poste = (a.POSTE_L || '').toUpperCase();
                const isDirecteur = poste.startsWith('DIRECTEUR');
                const isDG = isDirecteur && poste.includes('GENERAL');
                const role = isDG ? 'dg' : (isDirecteur ? 'directeur' : 'responsable_service');
                const isDirSvc = role === 'responsable_service' && isDirectionService(a.DIRECTION_L, a.SERVICE_L);
                // Email : priorité à l'override manuel, puis à l'AD
                const email = stored.email_override || adData.email || '';
                return {
                    matricule: a.MATRICULE,
                    nom: a.NOM,
                    prenom: a.PRENOM,
                    direction_code: a.DIRECTION,
                    direction_label: a.DIRECTION_L,
                    service_code: a.SERVICE,
                    service_label: a.SERVICE_L,
                    poste: a.POSTE_L,
                    role,
                    is_direction_service: isDirSvc,
                    email,
                    email_source: stored.email_override ? 'manuel' : (adData.email ? 'ad' : ''),
                    ad_phone: adData.ad_phone || '',
                    ad_username: stored.ad_username || '',
                    telephone: stored.telephone || '',
                    telephone_perso: stored.telephone_perso || '',
                    position: a.POSITION_L
                };
            });

            res.json(result);
        } catch (error) {
            console.error('[ENCADRANTS] getEncadrants:', error.message);
            res.status(500).json({ error: error.message });
        }
    },
};
