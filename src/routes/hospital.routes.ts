import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { query, queryOne } from '../db';
import { authenticate, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/error';
import { config } from '../config';

const router = Router();
router.use(authenticate, requireRole('hospital_admin', 'super_admin'));

// ── GET /hospital/staff ───────────────────────────────────────────────────────

router.get('/staff', async (req, res) => {
  const hospitalId = req.user!.sub;
  const rows = await query(
    `SELECT u.id, u.email, u.role, u.display_name, u.specialty, u.license_number, u.phone, u.created_at
     FROM users u
     WHERE u.hospital_id = (SELECT hospital_id FROM users WHERE id = $1)
       AND u.role IN ('doctor', 'pharmacist', 'insurer')
     ORDER BY u.display_name`,
    [hospitalId],
  );
  res.json(rows);
});

// ── POST /hospital/staff ──────────────────────────────────────────────────────

const emailField = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
  z.string().email('Adresse e-mail invalide'),
);

const createStaffSchema = z.object({
  email: emailField,
  role: z.enum(['doctor', 'pharmacist', 'insurer']),
  display_name: z.string().min(2),
  temp_password: z.string().min(8),
  specialty: z.string().optional(),
  license_number: z.string().optional(),
  phone: z.string().optional(),
});

router.post('/staff', async (req, res) => {
  const adminId = req.user!.sub;
  const body = createStaffSchema.parse(req.body);

  const admin = await queryOne<{ hospital_id: string }>(
    'SELECT hospital_id FROM users WHERE id = $1',
    [adminId],
  );
  if (!admin?.hospital_id) throw new AppError(400, 'Admin sans hôpital associé');

  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM users WHERE email = $1',
    [body.email.toLowerCase()],
  );
  if (existing) throw new AppError(409, 'Email déjà utilisé');

  const bcrypt = await import('bcryptjs');
  const hash = await bcrypt.hash(body.temp_password, 12);

  const [user] = await query<{ id: string }>(
    `INSERT INTO users
       (email, password_hash, role, display_name, specialty, license_number, phone, hospital_id, is_first_login, solana_public_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, '')
     RETURNING id`,
    [
      body.email.toLowerCase(),
      hash,
      body.role,
      body.display_name,
      body.specialty ?? null,
      body.license_number ?? null,
      body.phone ?? null,
      admin.hospital_id,
    ],
  );

  res.status(201).json({ id: user!.id, email: body.email, role: body.role, is_first_login: true });
});

// ── GET /hospital/me ─────────────────────────────────────────────────────────

router.get('/me', async (req, res) => {
  const userId = req.user!.sub;
  const me = await queryOne<{
    id: string;
    email: string;
    display_name: string;
    role: string;
    hospital_id: string;
    hospital_name: string;
  }>(
    `SELECT u.id, u.email, u.display_name, u.role, u.hospital_id, h.name AS hospital_name
     FROM users u
     LEFT JOIN hospitals h ON h.id = u.hospital_id
     WHERE u.id = $1`,
    [userId],
  );
  if (!me) throw new AppError(404, 'Utilisateur introuvable');
  res.json(me);
});

// ── GET /hospital/patients ────────────────────────────────────────────────────

router.get('/patients', async (req, res) => {
  const userId = req.user!.sub;
  // Patients de l'hôpital : créés directement par l'admin,
  // ou liés via un médecin / assureur appartenant au même hôpital
  const rows = await query(
    `SELECT DISTINCT p.id, p.full_name, p.date_of_birth, p.phone, p.email, p.solana_public_key
     FROM patients p
     WHERE
       p.id IN (
         SELECT hp.patient_id FROM hospital_patients hp
         WHERE hp.hospital_id = (SELECT hospital_id FROM users WHERE id = $1)
       )
       OR p.id IN (
         SELECT dp.patient_id FROM doctor_patients dp
         JOIN users u ON u.id = dp.doctor_id
         WHERE u.hospital_id = (SELECT hospital_id FROM users WHERE id = $1)
       )
       OR p.id IN (
         SELECT ip.patient_id FROM insurer_patients ip
         JOIN users u ON u.id = ip.insurer_id
         WHERE u.hospital_id = (SELECT hospital_id FROM users WHERE id = $1)
       )
     ORDER BY p.full_name`,
    [userId],
  );
  res.json(rows);
});

// ── POST /hospital/patients ───────────────────────────────────────────────────

const createPatientHospitalSchema = z.object({
  full_name: z.string().min(2),
  date_of_birth: z.string(),
  phone: z.string(),
  email: emailField,
  temp_password: z.string().min(8),
});

router.post('/patients', async (req, res) => {
  const userId = req.user!.sub;
  const body = createPatientHospitalSchema.parse(req.body);

  const admin = await queryOne<{ hospital_id: string }>(
    'SELECT hospital_id FROM users WHERE id = $1',
    [userId],
  );
  if (!admin?.hospital_id) throw new AppError(400, 'Admin sans hôpital associé');

  const existingUser = await queryOne<{ id: string }>(
    'SELECT id FROM users WHERE email = $1',
    [body.email.toLowerCase()],
  );
  if (existingUser) throw new AppError(409, 'Un compte avec cet email existe déjà');

  const bcrypt = await import('bcryptjs');
  const hash = await bcrypt.hash(body.temp_password, 12);

  // Créer le compte utilisateur patient
  const [user] = await query<{ id: string }>(
    `INSERT INTO users
       (email, password_hash, role, display_name, phone, hospital_id, is_first_login, solana_public_key)
     VALUES ($1, $2, 'patient', $3, $4, $5, true, '')
     RETURNING id`,
    [body.email.toLowerCase(), hash, body.full_name, body.phone, admin.hospital_id],
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
    `INSERT INTO hospital_patients (hospital_id, patient_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [admin.hospital_id, patient!.id],
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

// ── POST /hospital/invoices ───────────────────────────────────────────────────

const createInvoiceSchema = z.object({
  patient_id: z.string().uuid(),
  amount: z.number().positive(),
  currency_code: z.string().length(3).default('XAF'),
  documents_provided: z.boolean().default(false),
});

router.post('/invoices', async (req, res) => {
  const hospitalId = req.user!.sub;
  const body = createInvoiceSchema.parse(req.body);

  const hospital = await queryOne<{ hospital_id: string }>(
    'SELECT hospital_id FROM users WHERE id = $1',
    [hospitalId],
  );

  const invoiceHash = crypto
    .createHash('sha256')
    .update(`${body.patient_id}:${body.amount}:${Date.now()}`)
    .digest('hex');

  const isAutoApproved =
    body.amount <= config.autoReimbThreshold && body.documents_provided;
  const status = isAutoApproved ? 'auto_approved' : 'pending';

  const [invoice] = await query<{ id: string }>(
    `INSERT INTO invoices
       (patient_id, hospital_id, amount, currency_code, invoice_hash, documents_provided, status, date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()::date)
     RETURNING id`,
    [
      body.patient_id,
      hospital?.hospital_id,
      body.amount,
      body.currency_code,
      invoiceHash,
      body.documents_provided,
      status,
    ],
  );

  res.status(201).json({
    id: invoice!.id,
    invoice_hash: invoiceHash,
    status,
    is_auto_approved: isAutoApproved,
  });
});

export default router;
