-- Migration 003: add Solana hash columns for on-chain traceability

ALTER TABLE dispenses
  ADD COLUMN IF NOT EXISTS dispense_hash TEXT;
