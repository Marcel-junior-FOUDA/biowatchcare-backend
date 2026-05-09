import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { query, queryOne } from '../db';
import { authenticate, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/error';

const router = Router();
router.use(authenticate, requireRole('doctor', 'super_admin'));

// ── GET /doctor/patients ──────────────────────────────────────────────────────

router.get('/patients', async (req, res) => {
  const doctorId = req.user!.sub;
  const rows = await query(
    `SELECT p.id, p.full_name, p.date_of_birth, p.phone, p.email, p.solana_public_key
     FROM patients p
     JOIN doctor_patients dp ON dp.patient_id = p.id
     WHERE dp.doctor_id = $1
     ORDER BY p.full_name`,
    [doctorId],
  );
  res.json(rows);
});

// ── GET /doctor/prescriptions ─────────────────────────────────────────────────

router.get('/prescriptions', async (req, res) => {
  const doctorId = req.user!.sub;
  const rows = await query(
    `SELECT rx.id, p.full_name AS patient_name, rx.rx_hash,
            rx.pointer_hash, rx.status, rx.created_at
     FROM prescriptions rx
     JOIN patients p ON p.id = rx.patient_id
     WHERE rx.doctor_id = $1
     ORDER BY rx.created_at DESC`,
    [doctorId],
  );
  res.json(rows);
});

// ── POST /doctor/prescriptions ────────────────────────────────────────────────

const createRxSchema = z.object({
  patient_id: z.string().uuid(),
  medication_pointer_hash: z.string().min(32),
});

router.post('/prescriptions', async (req, res) => {
  const doctorId = req.user!.sub;
  const body = createRxSchema.parse(req.body);

  const rxHash = crypto
    .createHash('sha256')
    .update(`${body.patient_id}:${body.medication_pointer_hash}:${Date.now()}`)
    .digest('hex');

  const [rx] = await query<{ id: string }>(
    `INSERT INTO prescriptions (patient_id, doctor_id, rx_hash, pointer_hash, status)
     VALUES ($1, $2, $3, $4, 'active')
     RETURNING id`,
    [body.patient_id, doctorId, rxHash, body.medication_pointer_hash],
  );

  res.status(201).json({ id: rx!.id, rx_hash: rxHash, status: 'active' });
});

// ── POST /doctor/prescriptions/:rxId/qr ──────────────────────────────────────

router.post('/prescriptions/:rxId/qr', async (req, res) => {
  const doctorId = req.user!.sub;
  const { rxId } = req.params;

  const rx = await queryOne<{ status: string; doctor_id: string }>(
    'SELECT status, doctor_id FROM prescriptions WHERE id = $1',
    [rxId],
  );
  if (!rx) throw new AppError(404, 'Ordonnance introuvable');
  if (rx.doctor_id !== doctorId) throw new AppError(403, 'Accès refusé');
  if (rx.status !== 'active') throw new AppError(409, 'Ordonnance non active');

  const tokenHash = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  const [qr] = await query<{ id: string }>(
    `INSERT INTO qr_tokens (prescription_id, token_hash, expires_at, used)
     VALUES ($1, $2, $3, false)
     RETURNING id`,
    [rxId, tokenHash, expiresAt],
  );

  res.status(201).json({
    id: qr!.id,
    token_hash: tokenHash,
    expires_at: expiresAt.toISOString(),
  });
});

// ── DELETE /doctor/prescriptions/:rxId ───────────────────────────────────────

router.delete('/prescriptions/:rxId', async (req, res) => {
  const doctorId = req.user!.sub;
  const { rxId } = req.params;

  const rx = await queryOne<{ doctor_id: string; status: string }>(
    'SELECT doctor_id, status FROM prescriptions WHERE id = $1',
    [rxId],
  );
  if (!rx) throw new AppError(404, 'Ordonnance introuvable');
  if (rx.doctor_id !== doctorId) throw new AppError(403, 'Accès refusé');
  if (rx.status === 'cancelled') throw new AppError(409, 'Déjà annulée');

  await query(
    "UPDATE prescriptions SET status = 'cancelled', updated_at = NOW() WHERE id = $1",
    [rxId],
  );
  res.json({ message: 'Ordonnance annulée' });
});

export default router;
