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
    `SELECT u.id, u.email, u.role, u.display_name, u.created_at
     FROM users u
     WHERE u.hospital_id = (SELECT hospital_id FROM users WHERE id = $1)
       AND u.role IN ('doctor', 'pharmacist')
     ORDER BY u.display_name`,
    [hospitalId],
  );
  res.json(rows);
});

// ── POST /hospital/staff ──────────────────────────────────────────────────────

const createStaffSchema = z.object({
  email: z.string().email(),
  role: z.enum(['doctor', 'pharmacist']),
  display_name: z.string().min(2),
  temp_password: z.string().min(8),
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
    `INSERT INTO users (email, password_hash, role, display_name, hospital_id, is_first_login, solana_public_key)
     VALUES ($1, $2, $3, $4, $5, true, '')
     RETURNING id`,
    [body.email.toLowerCase(), hash, body.role, body.display_name, admin.hospital_id],
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
