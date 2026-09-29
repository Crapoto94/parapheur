# Parapheur électronique — outil autonome

Outil isolé de signature et de vérification électronique de documents PDF,
extrait du monolithe **AppDSI** (`C:\dev\appdsi`) et packagé dans son propre
dépôt avec ses conteneurs.

## Composants

| Dossier         | Rôle                                                                 | Conteneur            | Port hôte (défaut) |
|-----------------|----------------------------------------------------------------------|----------------------|--------------------|
| `backend/`      | API du parapheur (signature, vérification, certificats P12, relances) | `parapheur-backend`  | **3004** → 3001 |
| `frontend/`     | Back-office : créer/gérer les parapheurs, signataires, délégations    | `parapheur-frontend` | **3005** → 5173 |
| `frontend-dmz/` | Front public : signature par lien + vérification par QR code          | `parapheur-dmz`      | **3006** → 5177 |

Les ports hôte sont choisibles pour ne pas entrer en conflit avec AppDSI
(3001/5173/5174/5175/5177) ; surchargeables via `BACKEND_PORT`,
`BACKOFFICE_PORT`, `DMZ_PORT` dans `.env`.

Le back-office inclut la page d'**administration des certificats P12**
(`/admin/parapheur-certificats`, réservée aux admins) : URL publique du
flashcode, fréquence des e-mails, sceau PAdES, formule de signature en masse,
autorité de certification interne, journal des signatures et contrôle
d'intégrité.

## Ce qui est partagé avec AppDSI

L'extraction reste **compatible avec les données existantes** :

- **PostgreSQL** `ivry_admin`, schéma `hub_parapheur` (mêmes tables) — via
  `POSTGRES_*` ;
- **Stockage SMB/Alfresco** des PDF et certificats (couche `shared/storage`) ;
- **Réglages** : variables d'environnement (`.env`) ; les réglages modifiables
  depuis l'administration (paramètres du parapheur, stockage, Alfresco) sont
  écrits dans `backend/data/settings.json`. **Aucune base SQLite.**
- **Connexion AD/LDAP** (`/api/auth/magapp-login`) via l'API Ville (APM) et
  **clé JWT partagée** ;
- **Envoi d'e-mails** et **SMS** : API Ville (APM) en priorité ;
- **Compte administrateur local** défini par `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

> Les jetons de signature (`PARAPHEUR_PUBLIC_URL`) et les QR codes pointent vers
> le front public. L'identification AD et la recherche AD passent par l'API
> Ville (APM), comme l'envoi de mails et de SMS : aucun paramétrage AD local.
>
> L'API Ville se configure dans PostgreSQL `hub.infra_apis` (clé `apm_mail`,
> repli `apm_ai`) : `base_url` + `api_key`. Sa clé API doit porter les
> permissions `mail_send`, `sms_send`, `ad_auth` et `ad_search`.

## Démarrage rapide (Docker)

```bash
cp .env.example .env      # renseigner POSTGRES_*, JWT_SECRET, URLs
docker compose up -d --build
```

- API : http://localhost:3004/api/health
- Back-office : http://localhost:3005
- Front public (DMZ) : http://localhost:3006

## Démarrage local (Windows, hors Docker)

```bat
run-all.bat
```

Ouvre 3 fenêtres : backend (3004), back-office (3005), front DMZ (3006).
Scripts individuels dans `scripts\` (`run-backend.ps1`, `run-backoffice.ps1`,
`run-dmz.ps1`). Le backend local lit `backend/.env` et désactive par défaut le
cron de relances (`DISABLE_PARAPHEUR_CRON=1`) pour ne pas envoyer de vrais
e-mails depuis un poste.

## API principale

| Méthode | Chemin | Auth | Description |
|---------|--------|------|-------------|
| POST | `/api/auth/magapp-login` | — | Connexion (AD/LDAP + repli local) |
| GET  | `/api/auth/me` | JWT | Profil du porteur du jeton |
| POST | `/api/auth/magapp-parapheur-access` | JWT | Lien « module seul » depuis le MagApp |
| GET  | `/api/parapheur/...` | JWT | API de gestion (parapheurs, signatures, certificats) |
| GET  | `/api/parapheur/public/:token/...` | jeton | API publique de signature |
| GET  | `/api/parapheur/verify/:token/...` | jeton | Vérification publique (lecture seule) |
| GET  | `/api/health` | — | État du service |
| GET  | `/api/infra/rh-studio/agents/search` | JWT | Recherche d'agents (signataires) |

## Front DMZ (isolement réseau)

Le conteneur `parapheur-dmz` n'expose que 4 préfixes d'API vers le backend
(`/api/health`, `/api/auth/magapp-login` en POST, `/api/parapheur/public/`,
`/api/parapheur/verify/`) et applique un durcissement + WAF nginx. En DMZ
séparée, définir `BACKEND_URL=http://<ip-lan>:3004` et n'autoriser que le
TCP 3004 côté firewall. Voir `frontend-dmz/README-DMZ.md`.

## Suivi

Le dossier d'origine `appdsi/parapheur-dmz` est **conservé pour le moment** et
pourra être supprimé une fois la bascule validée.
