-- BioWatchCare — Migration 002: Consultation flow
-- Ajouter : patient_code, CNI, diagnostic, médications, notifications

-- ── patient_code (BWC-XXXX) ───────────────────────────────────────────────────

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS patient_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS cni_number   TEXT;

-- Génère un code BWC-XXXX pour les patients existants
CREATE OR REPLACE FUNCTION generate_patient_code() RETURNS TEXT AS $$
DECLARE
  v_code TEXT;
  v_exists BOOLEAN;
BEGIN
  LOOP
    v_code := 'BWC-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
    SELECT EXISTS(SELECT 1 FROM patients WHERE patient_code = v_code) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;
  RETURN v_code;
END;
$$ LANGUAGE plpgsql;

-- Remplir les codes manquants
UPDATE patients SET patient_code = generate_patient_code() WHERE patient_code IS NULL;

-- Rendre obligatoire après remplissage
ALTER TABLE patients ALTER COLUMN patient_code SET NOT NULL;

-- ── Consultations ─────────────────────────────────────────────────────────────
-- Une consultation regroupe un diagnostic + une ordonnance

CREATE TABLE IF NOT EXISTS consultations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id      UUID NOT NULL REFERENCES patients(id),
  doctor_id       UUID NOT NULL REFERENCES users(id),
  pharmacist_id   UUID REFERENCES users(id),
  insurer_id      UUID REFERENCES users(id),
  -- Diagnostic
  motif           TEXT,
  observations    TEXT,
  conclusion      TEXT,
  -- L'ordonnance est liée via prescriptions.consultation_id
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','signed','dispensed')),
  signed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consultations_patient ON consultations(patient_id);
CREATE INDEX IF NOT EXISTS idx_consultations_doctor  ON consultations(doctor_id);

-- Lier ordonnances → consultations
ALTER TABLE prescriptions
  ADD COLUMN IF NOT EXISTS consultation_id UUID REFERENCES consultations(id),
  ADD COLUMN IF NOT EXISTS medications_json JSONB NOT NULL DEFAULT '[]';

-- Étendre le CHECK status pour autoriser 'draft' (nécessaire pour le flow consultation)
ALTER TABLE prescriptions DROP CONSTRAINT IF EXISTS prescriptions_status_check;
ALTER TABLE prescriptions ADD CONSTRAINT prescriptions_status_check
  CHECK (status = ANY (ARRAY['draft','active','cancelled','dispensed']));

-- ── Notifications ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}',
  read        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read, created_at DESC);

-- ── users: lien patient_id pour le rôle patient ───────────────────────────────
-- Permet de retrouver le dossier patient depuis un user de rôle 'patient'

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES patients(id);

-- Ajouter specialty/license_number/phone aux users si manquants (déjà dans schema initial)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS specialty       TEXT,
  ADD COLUMN IF NOT EXISTS license_number  TEXT,
  ADD COLUMN IF NOT EXISTS phone           TEXT;
