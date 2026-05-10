# BioWatchCare — Backend API

API REST Node.js/Express/TypeScript pour la plateforme **BioWatchCare** — carnet médical numérique ancré sur la blockchain Solana.

---

## Stack technique

| Domaine         | Choix                                          |
|-----------------|------------------------------------------------|
| Runtime         | Node.js 20+                                    |
| Framework       | Express + express-async-errors                 |
| Langage         | TypeScript (strict)                            |
| Base de données | PostgreSQL (Supabase en dev partagé)           |
| Auth            | JWT (access 15 min + refresh 7 jours)          |
| Validation      | Zod                                            |
| Crypto          | bcryptjs                                       |
| Blockchain      | @solana/web3.js + @coral-xyz/anchor            |
| Logs            | winston                                        |

---

## Prérequis

- Node.js **20+**
- npm **10+**
- Accès à une base PostgreSQL (locale ou Supabase)

---

## Installation

```bash
git clone https://github.com/Marcel-junior-FOUDA/Biowatchcare.git
cd Biowatchcare
git checkout biowatchcare-backend
npm install
```

---

## Configuration

Copier le fichier d'exemple et remplir les valeurs :

```bash
cp .env.example .env
```

| Variable                  | Description                                              | Obligatoire |
|---------------------------|----------------------------------------------------------|-------------|
| `PORT`                    | Port d'écoute (défaut : `3000`)                          | Non         |
| `NODE_ENV`                | `development` ou `production`                            | Non         |
| `DATABASE_URL`            | URL PostgreSQL complète                                  | **Oui**     |
| `JWT_SECRET`              | Secret de signature des access tokens (min 32 chars)     | **Oui**     |
| `JWT_EXPIRES_IN`          | Durée de validité des access tokens (défaut : `15m`)     | Non         |
| `JWT_REFRESH_SECRET`      | Secret de signature des refresh tokens (min 32 chars)    | **Oui**     |
| `JWT_REFRESH_EXPIRES_IN`  | Durée de validité des refresh tokens (défaut : `7d`)     | Non         |
| `SOLANA_RPC_URL`          | URL du nœud Solana (défaut : devnet)                     | Non         |
| `SOLANA_ADMIN_PRIVATE_KEY`| Clé privée admin Solana au format JSON `[1,2,3,...]`     | Non*        |
| `PROGRAM_ID`              | Adresse du programme Solana déployé                      | Non*        |
| `AUTO_REIMB_THRESHOLD`    | Seuil de remboursement automatique en FCFA               | Non         |

> \* Sans `SOLANA_ADMIN_PRIVATE_KEY`, le backend fonctionne en **mode simulation** (les appels on-chain sont skippés). Indispensable uniquement pour les fonctionnalités blockchain réelles.

### Base de données partagée (dev)

L'équipe utilise une instance Supabase partagée. Demande les credentials à un membre de l'équipe et place-les dans `DATABASE_URL`.

### Base de données locale (alternative)

```bash
# Créer la base
createdb biowatchcare_db

# Dans .env
DATABASE_URL=postgresql://postgres:password@localhost:5432/biowatchcare_db
```

Les migrations s'appliquent **automatiquement au démarrage** — aucune commande manuelle nécessaire.

---

## Démarrage

```bash
# Développement (hot reload)
npm run dev

# Production
npm run build
npm start
```

Vérifier que le serveur est opérationnel :

```
GET http://localhost:3000/health
→ { "status": "ok", "env": "development" }
```

---

## Scripts disponibles

| Commande        | Description                              |
|-----------------|------------------------------------------|
| `npm run dev`   | Serveur avec hot reload (ts-node-dev)    |
| `npm run build` | Compilation TypeScript → `dist/`         |
| `npm start`     | Lance le serveur compilé                 |
| `npm run lint`  | Analyse statique ESLint                  |

---

## Structure du projet

```
src/
├── index.ts              # Point d'entrée — serveur Express + auto-migrations
├── config.ts             # Variables d'environnement (dotenv)
├── db.ts                 # Pool PostgreSQL
├── logger.ts             # Configuration winston
├── middleware/
│   ├── auth.ts           # Middleware JWT (authenticate, requireRole)
│   └── error.ts          # Gestionnaire d'erreurs global (AppError, ZodError)
├── services/
│   ├── token.service.ts  # makeTokenPair, verifyRefreshToken
│   └── solana.service.ts # Interactions on-chain (PDA, queries)
└── routes/
    ├── auth.routes.ts        # /auth — login, logout, refresh, change-password
    ├── doctor.routes.ts      # /doctor — consultations, patients, stats
    ├── pharmacist.routes.ts  # /pharmacist — ordonnances, dispensation
    ├── hospital.routes.ts    # /hospital — staff, patients
    ├── insurer.routes.ts     # /insurer — patients, remboursements
    ├── patient.routes.ts     # /patient — dossier médical, consentements
    └── super_admin.routes.ts # /super-admin — hôpitaux, admins

migrations/
├── 001_initial_schema.sql    # Schéma initial complet
└── 002_consultation_flow.sql # Tables consultations et notifications
```

---

## Endpoints principaux

### Auth
| Méthode | Endpoint                  | Description                          |
|---------|---------------------------|--------------------------------------|
| POST    | `/auth/login`             | Connexion (email + password)         |
| POST    | `/auth/refresh`           | Renouveler les tokens                |
| POST    | `/auth/logout`            | Déconnexion                          |
| POST    | `/auth/change-password`   | Changement de mot de passe (1ère connexion) |

### Rôles couverts
- `super_admin` — `/super-admin/*`
- `hospital_admin` — `/hospital/*`
- `doctor` — `/doctor/*`
- `pharmacist` — `/pharmacist/*`
- `insurer` — `/insurer/*`
- `patient` — `/patient/*`

---

## Authentification

L'API utilise des **JWT Bearer tokens** :

```
Authorization: Bearer <access_token>
```

- **Access token** : durée 15 min
- **Refresh token** : durée 7 jours, à envoyer sur `POST /auth/refresh`
- À la première connexion, `is_first_login: true` force le changement de mot de passe

---

## Branches

| Branche                      | Contenu                              |
|------------------------------|--------------------------------------|
| `main`                       | Branche d'intégration principale     |
| `biowatchcare-backend`       | API Node.js (ce dépôt)               |
| `biowatchcare-frontend`      | Application Flutter                  |
| `biowatchcare-smartcontract` | Programme Solana (Anchor / Rust)     |

---

## Conventions

- **Commits** — format conventionnel : `feat:`, `fix:`, `refactor:`, `docs:`
- **Lint** — `npm run lint` doit passer avant tout commit
- **Ne jamais committer `.env`** — utiliser `.env.example` pour documenter les variables

---

## Licence

Projet académique / privé — tous droits réservés.
