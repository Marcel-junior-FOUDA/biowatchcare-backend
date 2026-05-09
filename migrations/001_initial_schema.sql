-- BioWatchCare — Schéma initial PostgreSQL
-- Exécuter avec : psql $DATABASE_URL -f migrations/001_initial_schema.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Hôpitaux ──────────────────────────────────────────────────────────────────
CREATE TABLE hospitals (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  address         TEXT,
  solana_public_key TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Utilisateurs (tous rôles) ─────────────────────────────────────────────────
CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email             TEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  role              TEXT NOT NULL CHECK (role IN ('super_admin','hospital_admin','doctor','pharmacist','patient','insurer')),
  display_name      TEXT,
  hospital_id       UUID REFERENCES hospitals(id),
  solana_public_key TEXT NOT NULL DEFAULT '',
  is_first_login    BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role  ON users(role);

-- ── Patients ──────────────────────────────────────────────────────────────────
CREATE TABLE patients (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name         TEXT NOT NULL,
  date_of_birth     DATE,
  phone             TEXT,
  email             TEXT UNIQUE,
  solana_public_key TEXT NOT NULL DEFAULT '',
  patient_id_hash   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Relations assureur ↔ patient ──────────────────────────────────────────────
CREATE TABLE insurer_patients (
  insurer_id    UUID NOT NULL REFERENCES users(id),
  patient_id    UUID NOT NULL REFERENCES patients(id),
  contract_type TEXT NOT NULL DEFAULT 'Individuel',
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (insurer_id, patient_id)
);

-- ── Relations médecin ↔ patient ───────────────────────────────────────────────
CREATE TABLE doctor_patients (
  doctor_id  UUID NOT NULL REFERENCES users(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  PRIMARY KEY (doctor_id, patient_id)
);

-- ── Ordonnances ───────────────────────────────────────────────────────────────
CREATE TABLE prescriptions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id   UUID NOT NULL REFERENCES patients(id),
  doctor_id    UUID NOT NULL REFERENCES users(id),
  rx_hash      TEXT NOT NULL UNIQUE,
  pointer_hash TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','dispensed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prescriptions_patient ON prescriptions(patient_id);
CREATE INDEX idx_prescriptions_doctor  ON prescriptions(doctor_id);

-- ── Tokens QR ─────────────────────────────────────────────────────────────────
CREATE TABLE qr_tokens (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prescription_id UUID NOT NULL REFERENCES prescriptions(id),
  token_hash      TEXT NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ NOT NULL,
  used            BOOLEAN NOT NULL DEFAULT false,
  used_by         UUID REFERENCES users(id),
  used_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Dispenses ─────────────────────────────────────────────────────────────────
CREATE TABLE dispenses (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prescription_id UUID NOT NULL REFERENCES prescriptions(id),
  pharmacist_id   UUID NOT NULL REFERENCES users(id),
  dispensed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Factures ──────────────────────────────────────────────────────────────────
CREATE TABLE invoices (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id          UUID NOT NULL REFERENCES patients(id),
  hospital_id         UUID NOT NULL REFERENCES hospitals(id),
  amount              NUMERIC(12,2) NOT NULL,
  currency_code       CHAR(3) NOT NULL DEFAULT 'XAF',
  invoice_hash        TEXT NOT NULL UNIQUE,
  documents_provided  BOOLEAN NOT NULL DEFAULT false,
  payment_method      TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','auto_approved','approved','rejected')),
  date                DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invoices_patient  ON invoices(patient_id);
CREATE INDEX idx_invoices_hospital ON invoices(hospital_id);

-- ── Réclamations ──────────────────────────────────────────────────────────────
CREATE TABLE claims (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id     UUID NOT NULL REFERENCES invoices(id),
  insurer_id     UUID NOT NULL REFERENCES users(id),
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('auto_approved','pending','approved','rejected')),
  payment_method TEXT,
  reason_code    SMALLINT,
  is_auto        BOOLEAN NOT NULL DEFAULT false,
  decided_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (invoice_id, insurer_id)
);

CREATE INDEX idx_claims_insurer ON claims(insurer_id);
CREATE INDEX idx_claims_invoice ON claims(invoice_id);

-- ── Consentements ─────────────────────────────────────────────────────────────
CREATE TABLE consents (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  grantee_id UUID NOT NULL REFERENCES users(id),
  scopes     INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  revoked    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (patient_id, grantee_id)
);
