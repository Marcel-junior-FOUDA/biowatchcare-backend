import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { authenticate, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/error';
import { logger } from '../logger';
import { config } from '../config';

const router = Router();
router.use(authenticate, requireRole('insurer', 'super_admin'));

// ── GET /insurer/patients ────────────────────────────────────────────────────

router.get('/patients', async (req, res) => {
  const insurerId = req.user!.sub;
  const rows = await query<{
    id: string;
    full_name: string;
    date_of_birth: string;
    phone: string;
    email: string;
    contract_type: string;
    active: boolean;
    solana_public_key: string;
  }>(
    `SELECT p.id, p.full_name, p.date_of_birth, p.phone, p.email,
            ip.contract_type, ip.active, p.solana_public_key
     FROM patients p
     JOIN insurer_patients ip ON ip.patient_id = p.id
     WHERE ip.insurer_id = $1
     ORDER BY p.full_name`,
    [insurerId],
  );
  res.json(rows);
});

// ── POST /insurer/patients ───────────────────────────────────────────────────

const createPatientSchema = z.object({
  full_name: z.string().min(2),
  date_of_birth: z.string(),
  phone: z.string(),
  email: z.string().email(),
  contract_type: z.enum(['Individuel', 'Familial', 'Entreprise']),
});

router.post('/patients', async (req, res) => {
  const insurerId = req.user!.sub;
  const body = createPatientSchema.parse(req.body);

  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM patients WHERE email = $1',
    [body.email.toLowerCase()],
  );
  if (existing) throw new AppError(409, 'Un patient avec cet email existe déjà');

  const [patient] = await query<{ id: string; full_name: string; solana_public_key: string }>(
    `INSERT INTO patients (full_name, date_of_birth, phone, email, solana_public_key)
     VALUES ($1, $2, $3, $4, '')
     RETURNING id, full_name, solana_public_key`,
    [body.full_name, body.date_of_birth, body.phone, body.email.toLowerCase()],
  );

  await query(
    `INSERT INTO insurer_patients (insurer_id, patient_id, contract_type, active)
     VALUES ($1, $2, $3, true)`,
    [insurerId, patient!.id, body.contract_type],
  );

  res.status(201).json({ ...body, id: patient!.id, solana_public_key: '' });
});

// ── GET /insurer/invoices ────────────────────────────────────────────────────

router.get('/invoices', async (req, res) => {
  const insurerId = req.user!.sub;
  const rows = await query(
    `SELECT i.id, p.full_name AS patient_name, h.name AS hospital_name,
            i.amount, i.date, i.status, i.documents_provided,
            i.payment_method, i.invoice_hash
     FROM invoices i
     JOIN patients p ON p.id = i.patient_id
     JOIN hospitals h ON h.id = i.hospital_id
     JOIN insurer_patients ip ON ip.patient_id = i.patient_id AND ip.insurer_id = $1
     ORDER BY i.date DESC`,
    [insurerId],
  );
  res.json(rows);
});

// ── POST /insurer/claims/:claimId/decide ─────────────────────────────────────

const decideSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  payment_method: z.enum(['Mobile Money', 'Virement bancaire']),
  reason_code: z.number().int().min(0).max(255).optional(),
});

router.post('/claims/:claimId/decide', async (req, res) => {
  const { claimId } = req.params;
  const insurerId = req.user!.sub;
  const body = decideSchema.parse(req.body);

  const claim = await queryOne<{
    id: string;
    status: string;
    invoice_id: string;
    amount: number;
    documents_provided: boolean;
  }>(
    `SELECT c.id, c.status, c.invoice_id, i.amount, i.documents_provided
     FROM claims c
     JOIN invoices i ON i.id = c.invoice_id
     WHERE c.id = $1 AND c.insurer_id = $2`,
    [claimId, insurerId],
  );

  if (!claim) throw new AppError(404, 'Réclamation introuvable');
  if (claim.status !== 'pending') {
    throw new AppError(409, 'Cette réclamation a déjà été traitée');
  }

  await query(
    `UPDATE claims
     SET status = $1, payment_method = $2, decided_at = NOW()
     WHERE id = $3`,
    [body.decision, body.payment_method, claimId],
  );

  logger.info(
    `Claim ${claimId} ${body.decision} par assureur ${insurerId} via ${body.payment_method}`,
  );

  res.json({ message: `Réclamation ${body.decision === 'approved' ? 'approuvée' : 'rejetée'}` });
});

// ── GET /insurer/claims ───────────────────────────────────────────────────────

router.get('/claims', async (req, res) => {
  const insurerId = req.user!.sub;
  const rows = await query(
    `SELECT c.id, p.full_name AS patient_name, c.invoice_id,
            i.amount, i.date, c.payment_method, c.status,
            p.phone AS phone, c.is_auto
     FROM claims c
     JOIN invoices i ON i.id = c.invoice_id
     JOIN patients p ON p.id = i.patient_id
     WHERE c.insurer_id = $1
     ORDER BY i.date DESC`,
    [insurerId],
  );
  res.json(rows);
});

export default router;
