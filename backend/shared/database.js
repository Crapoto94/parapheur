const { pgDb, pool, setupPgDb } = require('./pg_db');

/**
 * Interface de base de données unifiée du backend (PostgreSQL uniquement).
 *
 * SQLite a été supprimé : tout le paramétrage vit désormais dans `.env` et,
 * pour les réglages modifiables depuis l'administration, dans
 * `shared/settings.js` (fichier `data/settings.json`).
 */
module.exports = {
    pgDb,       // PostgreSQL wrapper
    pool,       // Raw PostgreSQL pool
    setupPgDb,  // PostgreSQL schema initializer

    /**
     * Oracle Connection Helper
     */
    getOracleConnection: async (settings) => {
        const oracledb = require('oracledb');
        if (!settings || !settings.is_enabled) {
            throw new Error('La connexion Oracle est désactivée dans les paramètres.');
        }

        const config = {
            user: settings.username,
            password: settings.password,
            connectString: `${settings.host}:${settings.port}/${settings.service_name}`
        };

        try {
            return await oracledb.getConnection(config);
        } catch (err) {
            console.error('Oracle Connection Error:', err.message);
            throw new Error(`Erreur de connexion Oracle (${settings.type}) : ${err.message}`);
        }
    }
};
