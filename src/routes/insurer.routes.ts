import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { authenticate, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/error';
import { logger } from '../logger';
import { config } from '../config';

const router = Router();
router.use(authenticate, requireRole('insurer', 'super_admin'));

// ── GET /insurer/me ──────────────────────────────────────────────────────────

router.get('/me', async (req, res) => {
  const userId = req.user!.sub;
  const me = await queryOne<{
    id: string;
    email: string;
    display_name: string | null;
    specialty: string | null;
    license_number: string | null;
    phone: string | null;
    hospital_id: string | null;
    hospital_name: string | null;
  }>(
    `SELECT u.id, u.email, u.display_name, u.specialty, u.license_number, u.phone,
            u.hospital_id, h.name AS hospital_name
     FROM users u LEFT JOIN hospitals h ON h.id = u.hospital_id
     WHERE u.id = $1`,
    [userId],
  );
  if (!me) throw new AppError(404, 'Utilisateur introuvable');
  res.json(me);
});

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
  temp_password: z.string().min(8),
  contract_type: z.enum(['Individuel', 'Familial', 'Entreprise']),
});

router.post('/patients', async (req, res) => {
  const insurerId = req.user!.sub;
  const body = createPatientSchema.parse(req.body);

  const existingUser = await queryOne<{ id: string }>(
    'SELECT id FROM users WHERE email = $1',
    [body.email.toLowerCase()],
  );
  if (existingUser) throw new AppError(409, 'Un compte avec cet email existe déjà');

  const bcrypt = await import('bcryptjs');
  const hash = await bcrypt.hash(body.temp_password, 12);

  // Récupérer hospital_id de l'assureur si disponible
  const insurer = await queryOne<{ hospital_id: string | null }>(
    'SELECT hospital_id FROM users WHERE id = $1',
    [insurerId],
  );

  // Créer le compte utilisateur patient
  const [user] = await query<{ id: string }>(
    `INSERT INTO users
       (email, password_hash, role, display_name, phone, hospital_id, is_first_login, solana_public_key)
     VALUES ($1, $2, 'patient', $3, $4, $5, true, '')
     RETURNING id`,
    [body.email.toLowerCase(), hash, body.full_name, body.phone, insurer?.hospital_id ?? null],
  );

  // Générer un code patient unique BWC-XXXX
  let patientCode = '';
  let codeExists = true;
  while (codeExists) {
    patientCode = 'BWC-' + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM patients WHERE patient_code = $1',
      [patientCode],
    );
    codeExists = !!existing;
  }

  // Créer le dossier patient
  const [patient] = await query<{ id: string }>(
    `INSERT INTO patients (full_name, date_of_birth, phone, email, solana_public_key, patient_code)
     VALUES ($1, $2, $3, $4, '', $5)
     RETURNING id`,
    [body.full_name, body.date_of_birth, body.phone, body.email.toLowerCase(), patientCode],
  );

  // Lier le compte user au dossier patient
  await query(
    'UPDATE users SET patient_id = $1 WHERE id = $2',
    [patient!.id, user!.id],
  );

  await query(
    `INSERT INTO insurer_patients (insurer_id, patient_id, contract_type, active)
     VALUES ($1, $2, $3, true)`,
    [insurerId, patient!.id, body.contract_type],
  );

  res.status(201).json({
    id: user!.id,
    patient_id: patient!.id,
    patient_code: patientCode,
    email: body.email,
    full_name: body.full_name,
    is_first_login: true,
  });
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
