-- Migration 003: table hospital_patients manquante + colonne dispense_hash

CREATE TABLE IF NOT EXISTS hospital_patients (
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  patient_id  UUID NOT NULL REFERENCES patients(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (hospital_id, patient_id)
);

ALTER TABLE dispenses
  ADD COLUMN IF NOT EXISTS dispense_hash TEXT;
