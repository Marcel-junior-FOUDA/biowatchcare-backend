# BioWatchCare — Documentation MVP 01

> Ce document explique le projet dans son état actuel : ce que c'est, comment ça marche, comment le lancer, et comment contribuer. Pas besoin d'être développeur expert pour le comprendre.

---

## C'est quoi BioWatchCare ?

BioWatchCare est une **application mobile de santé numérique** pour l'Afrique centrale (Cameroun en priorité). Elle permet à tous les acteurs du système de santé de travailler ensemble sur un même dossier médical numérique :

- Un **patient** peut consulter son dossier médical depuis son téléphone
- Un **médecin** crée des consultations et des ordonnances
- Un **pharmacien** délivre les médicaments en scannant un QR code
- Un **hôpital** gère ses patients et envoie des factures
- Un **assureur** rembourse automatiquement les soins éligibles

Toutes les actions importantes (création de patient, ordonnance, facture) sont **enregistrées sur la blockchain Solana** — ce qui garantit que personne ne peut les falsifier ou les effacer.

---

## Les trois parties du projet

Le projet est découpé en trois parties qui fonctionnent ensemble :

```
┌─────────────────────────────────────────────────────────┐
│                    Application Flutter                   │
│         (ce que l'utilisateur voit sur son téléphone)    │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP (internet)
┌──────────────────────▼──────────────────────────────────┐
│                  Backend Node.js (Vercel)                │
│         (le cerveau : gère les données, la sécurité)     │
└──────────┬─────────────────────────┬────────────────────┘
           │                         │
┌──────────▼──────────┐   ┌──────────▼──────────────────┐
│  Base de données    │   │  Blockchain Solana (devnet)  │
│  PostgreSQL         │   │  Programme: E7BWwRFQ...      │
│  (Supabase cloud)   │   │  (traçabilité immuable)      │
└─────────────────────┘   └──────────────────────────────┘
```

### 1. L'application mobile (Flutter)
- Écrite en **Dart / Flutter** → fonctionne sur Android et iOS
- Branche GitHub : `biowatchcare-frontend`
- Chaque profil (médecin, pharmacien, patient…) a son propre écran et ses fonctions

### 2. Le serveur backend (Node.js)
- Écrit en **TypeScript / Express**
- Hébergé sur **Vercel** : `https://biowatchcare-backend.vercel.app`
- Repo dédié : `Marcel-junior-FOUDA/biowatchcare-backend`
- Il stocke les données dans PostgreSQL et les traces dans Solana

### 3. Le smart contract (Solana)
- Écrit en **Rust / Anchor**
- Déployé sur Solana devnet (réseau de test)
- Adresse du programme : `E7BWwRFQBYXmNqqAfNPYm1ccgWysJqtJrvUSq1NTnooX`
- Branche GitHub : `biowatchcare-smartcontract`

---

## Les 6 profils utilisateurs

| Profil | Ce qu'il peut faire |
|---|---|
| **Super Admin** | Créer des hôpitaux et leurs administrateurs |
| **Admin Hôpital** | Gérer le staff (médecins, pharmaciens, assureurs) et les patients de l'hôpital |
| **Médecin** | Créer des consultations, rédiger des ordonnances, générer des QR codes |
| **Pharmacien** | Scanner le QR code d'une ordonnance pour délivrer les médicaments |
| **Assureur** | Voir les factures de ses patients assurés, approuver ou rejeter les remboursements |
| **Patient** | Consulter son dossier médical, ses ordonnances, ses factures |

---

## Comptes de démonstration

Ces comptes existent déjà dans la base partagée. Utilisez-les pour tester :

| Profil | Email | Mot de passe |
|---|---|---|
| Super Admin | `admin@biowatchcare.app` | `Biowatchcare2025!` |
| Admin Hôpital | `hospital@biowatchcare.app` | `Hospital2025!` |
| Médecin | `doctor@biowatchcare.app` | `Doctor2025!` |
| Pharmacien | `pharmacist@biowatchcare.app` | `Pharmacist2025!` |
| Assureur | `insurer@biowatchcare.app` | `Insurer2025!` |
| Patient | `patient@biowatchcare.app` | `Patient2025!` |

> La première connexion demande de changer le mot de passe. C'est normal — c'est une mesure de sécurité.

---

## Comment lancer l'application (Flutter)

### Prérequis
- Flutter SDK installé (`flutter --version` doit fonctionner)
- Android Studio ou VS Code avec l'extension Flutter
- Un émulateur Android lancé, ou un téléphone branché en USB

### Étapes

```bash
# 1. Cloner le projet
git clone https://github.com/Marcel-junior-FOUDA/Biowatchcare.git
cd Biowatchcare

# 2. Se mettre sur la bonne branche
git checkout biowatchcare-frontend

# 3. Installer les dépendances Flutter
flutter pub get

# 4. Lancer l'application
flutter run
```

C'est tout. L'application se connecte automatiquement au backend Vercel — **pas besoin de lancer quoi que ce soit d'autre**.

---

## Comment lancer le backend en local (optionnel)

Le backend tourne déjà sur Vercel donc ce n'est utile que si vous voulez modifier le code serveur et tester localement.

### Prérequis
- Node.js version 20 ou plus (`node --version`)
- npm version 10 ou plus

### Étapes

```bash
# 1. Cloner le repo dédié backend
git clone https://github.com/Marcel-junior-FOUDA/biowatchcare-backend.git
cd biowatchcare-backend

# 2. Installer les dépendances
npm install

# 3. Copier la configuration (tout est déjà rempli)
cp .env.example .env

# 4. Lancer le serveur
npm run dev
# → "BioWatchCare API démarré sur le port 3000"
```

Pour tester que ça marche, ouvrez un navigateur sur : `http://localhost:3000/health`
Vous devez voir : `{ "status": "ok" }`

> Si vous développez le backend localement, pensez à changer l'URL dans Flutter.
> Dans `lib/core/config/app_config.dart`, remplacez `biowatchcare-backend.vercel.app` par `10.0.2.2:3000` (émulateur Android) ou `localhost:3000` (web).

---

## Comment déployer une mise à jour du backend

Chaque push sur le repo `biowatchcare-backend` déclenche automatiquement un redéploiement sur Vercel.

```bash
# Depuis le dossier biowatchcare-backend :
git add .
git commit -m "feat: ma modification"
git push origin main
# → Vercel redéploie automatiquement en ~1 minute
```

---

## Comment fonctionne la sécurité

### Connexion (JWT)
Quand un utilisateur se connecte, le serveur lui donne deux "clés" :
- **Access token** : valable 15 minutes — utilisé pour chaque action
- **Refresh token** : valable 7 jours — sert à renouveler l'access token sans se reconnecter

Quand l'access token expire, l'application le renouvelle silencieusement. L'utilisateur ne voit rien.

### Blockchain Solana
Chaque action importante génère aussi une transaction sur Solana :
1. Le serveur prépare la transaction et la signe partiellement (signature admin)
2. L'application Flutter co-signe avec la clé dérivée du mot de passe de l'utilisateur
3. La transaction est envoyée sur Solana devnet

Cela crée une **trace immuable** : même si quelqu'un pirate la base de données, les données blockchain restent intactes et vérifiables.

### Clé Solana dérivée du mot de passe
La clé blockchain de l'utilisateur n'est jamais stockée nulle part. Elle est **recalculée à chaque connexion** à partir de l'email et du mot de passe. Si l'utilisateur oublie son mot de passe, il perd l'accès à sa clé blockchain.

---

## Structure des fichiers importants

### Backend
```
biowatchcare-backend/
├── src/
│   ├── app.ts              ← Application Express (routes, middlewares)
│   ├── index.ts            ← Démarrage local
│   ├── config.ts           ← Lit les variables d'environnement
│   ├── db.ts               ← Connexion à la base de données
│   ├── routes/
│   │   ├── auth.routes.ts        ← Connexion, déconnexion
│   │   ├── doctor.routes.ts      ← Consultations, ordonnances
│   │   ├── pharmacist.routes.ts  ← Dispensation QR
│   │   ├── hospital.routes.ts    ← Gestion staff et patients
│   │   ├── insurer.routes.ts     ← Remboursements
│   │   ├── patient.routes.ts     ← Dossier médical
│   │   └── super_admin.routes.ts ← Gestion hôpitaux
│   └── services/
│       └── solana.service.ts     ← Transactions blockchain
├── migrations/             ← Scripts de création de la base de données
├── scripts/
│   ├── seed-demo.ts        ← Crée les comptes de démo
│   └── seed-super-admin.ts ← Réinitialise le super admin
├── api/
│   └── index.ts            ← Point d'entrée Vercel
├── vercel.json             ← Configuration déploiement Vercel
└── .env.example            ← Configuration partagée (copier en .env)
```

### Frontend Flutter
```
biowatchcare/
├── lib/
│   ├── main.dart           ← Point d'entrée de l'app
│   ├── core/
│   │   ├── config/
│   │   │   └── app_config.dart   ← URL du backend, timeouts
│   │   ├── network/
│   │   │   └── api_client.dart   ← Client HTTP (Dio)
│   │   ├── crypto/
│   │   │   └── key_derivation_service.dart ← Clé Solana depuis le mot de passe
│   │   └── solana/
│   │       └── solana_transaction_service.dart ← Co-signature et broadcast
│   └── features/
│       ├── auth/           ← Connexion, changement de mot de passe
│       ├── super_admin/    ← Interface Super Admin
│       ├── hospital_admin/ ← Interface Admin Hôpital
│       ├── doctor/         ← Interface Médecin
│       ├── pharmacist/     ← Interface Pharmacien
│       ├── assureur/       ← Interface Assureur
│       └── patient/        ← Interface Patient
```

---

## Base de données — Les tables principales

| Table | Ce qu'elle contient |
|---|---|
| `users` | Tous les comptes (email, mot de passe hashé, rôle, clé Solana) |
| `hospitals` | Les hôpitaux enregistrés |
| `patients` | Les dossiers patients (nom, date de naissance, téléphone) |
| `consultations` | Les consultations médicales |
| `prescriptions` | Les ordonnances |
| `qr_tokens` | Les QR codes générés pour la dispensation |
| `dispenses` | Les médicaments effectivement délivrés |
| `invoices` | Les factures hospitalières |
| `claims` | Les demandes de remboursement |
| `notifications` | Les notifications envoyées aux utilisateurs |

---

## Flux complet d'un parcours patient

Voici ce qui se passe de A à Z quand un patient va chez le médecin :

```
1. Admin hôpital crée le patient
   → Compte créé en base de données
   → Transaction Solana enregistrée (trace immuable)

2. Médecin ouvre une consultation
   → Recherche le patient par son code BWC-XXXX
   → Saisit diagnostic, observations, conclusion

3. Médecin rédige l'ordonnance
   → Liste les médicaments avec dosage et durée
   → Génère un QR code valable 48h
   → Transaction Solana enregistrée

4. Patient va à la pharmacie
   → Montre le QR code au pharmacien

5. Pharmacien scanne le QR code
   → L'application vérifie automatiquement la validité
   → Marque l'ordonnance comme dispensée
   → Transaction Solana enregistrée

6. Hôpital crée une facture
   → Montant envoyé à l'assureur du patient
   → Si montant ≤ 50 000 FCFA avec documents : remboursement automatique
   → Sinon : l'assureur doit approuver manuellement

7. Assureur approuve ou rejette
   → Transaction Solana enregistrée
   → Patient et hôpital sont notifiés
```

---

## Variables d'environnement expliquées

Le fichier `.env` contient les paramètres secrets du backend. Voici ce que chaque variable signifie en langage simple :

| Variable | En simple | Valeur actuelle |
|---|---|---|
| `DATABASE_URL` | Adresse et mot de passe de la base de données | Supabase cloud partagé |
| `JWT_SECRET` | Clé secrète pour signer les tokens de connexion | Identique pour toute l'équipe |
| `JWT_REFRESH_SECRET` | Clé secrète pour les tokens de renouvellement | Identique pour toute l'équipe |
| `JWT_EXPIRES_IN` | Durée de validité d'une session | 15 minutes |
| `JWT_REFRESH_EXPIRES_IN` | Durée avant déconnexion forcée | 7 jours |
| `SOLANA_RPC_URL` | Adresse du nœud Solana à contacter | Devnet (réseau de test) |
| `SOLANA_ADMIN_PRIVATE_KEY` | Clé secrète de l'admin blockchain | 64 octets (partagée) |
| `PROGRAM_ID` | Adresse du smart contract déployé | `E7BWwRFQ...` |
| `AUTO_REIMB_THRESHOLD` | Montant max pour remboursement automatique | 50 000 FCFA |

> **Important** : Le fichier `.env` ne doit jamais être publié sur GitHub. Le fichier `.env.example` contient toutes les valeurs déjà remplies — il suffit de le copier.

---

## Problèmes fréquents et solutions

| Problème | Cause probable | Solution |
|---|---|---|
| "Email ou mot de passe incorrect" | Mauvais identifiants | Vérifier avec les comptes de démo ci-dessus |
| "Serveur injoignable" | Backend Vercel en cold start | Attendre 5 secondes et réessayer |
| "Cet email est déjà utilisé" | Le patient existe déjà | Chercher le patient existant |
| L'app ne démarre pas | Dépendances manquantes | Relancer `flutter pub get` |
| Port 3000 déjà utilisé (local) | Un serveur tourne déjà | Tuer le processus avec `taskkill /F /IM node.exe` (Windows) |
| Timeout de connexion | Backend local non démarré | Le backend est sur Vercel, pas besoin de le lancer |

---

## Informations techniques clés

| Information | Valeur |
|---|---|
| Backend URL (production) | `https://biowatchcare-backend.vercel.app` |
| Health check | `https://biowatchcare-backend.vercel.app/health` |
| Base de données | Supabase (eu-west-1) |
| Blockchain | Solana Devnet |
| Program ID | `E7BWwRFQBYXmNqqAfNPYm1ccgWysJqtJrvUSq1NTnooX` |
| Admin blockchain | `Eh54SWeR3qW6GxLng3DmvgdTibxEuVe1ZagsR5H4LvB5` |
| Repo mono (toutes branches) | `Marcel-junior-FOUDA/Biowatchcare` |
| Repo backend dédié | `Marcel-junior-FOUDA/biowatchcare-backend` |

---

## Glossaire

| Terme | Explication simple |
|---|---|
| **Flutter** | Technologie Google pour faire des apps mobiles avec un seul code |
| **Node.js** | Technologie pour faire des serveurs en JavaScript/TypeScript |
| **PostgreSQL** | Base de données (comme Excel, mais pour les applications) |
| **Supabase** | Service cloud qui héberge notre PostgreSQL |
| **Vercel** | Service cloud qui héberge notre backend (comme un serveur toujours allumé) |
| **Solana** | Blockchain rapide et peu coûteuse (alternative à Ethereum) |
| **Devnet** | Réseau de test Solana — comme un bac à sable, sans vraie monnaie |
| **Smart contract** | Programme qui tourne sur la blockchain, personne ne peut le modifier |
| **JWT** | Ticket d'authentification numérique avec date d'expiration |
| **PDA** | Adresse calculée automatiquement sur Solana pour stocker des données |
| **Hash** | Empreinte numérique unique d'un fichier ou d'une donnée |
| **QR code** | Code-barre 2D que le pharmacien scanne pour valider une ordonnance |
| **Riverpod** | Système de gestion d'état dans Flutter (qui voit quoi, quand) |
| **Dio** | Bibliothèque Flutter pour faire des appels HTTP au backend |
| **Borsh** | Format de sérialisation utilisé par Solana pour encoder les données |
