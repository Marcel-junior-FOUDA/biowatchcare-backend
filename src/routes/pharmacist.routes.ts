import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { authenticate, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/error';

const router = Router();
router.use(authenticate, requireRole('pharmacist', 'super_admin'));

const verifySchema = z.object({
  token_hash: z.string().min(32),
});

// ── POST /pharmacist/qr/verify ────────────────────────────────────────────────

router.post('/qr/verify', async (req, res) => {
  const body = verifySchema.parse(req.body);

  const qr = await queryOne<{
    id: string;
    prescription_id: string;
    expires_at: string;
    used: boolean;
  }>(
    'SELECT id, prescription_id, expires_at, used FROM qr_tokens WHERE token_hash = $1',
    [body.token_hash],
  );

  if (!qr) {
    return res.json({ valid: false, reason: 'Token introuvable' });
  }
  if (qr.used) {
    return res.json({ valid: false, reason: 'Token déjà utilisé' });
  }
  if (new Date(qr.expires_at) < new Date()) {
    return res.json({ valid: false, reason: 'Token expiré' });
  }

  res.json({ valid: true, prescription_id: qr.prescription_id });
});

// ── POST /pharmacist/qr/dispense ──────────────────────────────────────────────

router.post('/qr/dispense', async (req, res) => {
  const pharmacistId = req.user!.sub;
  const body = verifySchema.parse(req.body);

  const qr = await queryOne<{
    id: string;
    prescription_id: string;
    expires_at: string;
    used: boolean;
  }>(
    'SELECT id, prescription_id, expires_at, used FROM qr_tokens WHERE token_hash = $1',
    [body.token_hash],
  );

  if (!qr) throw new AppError(404, 'Token introuvable');
  if (qr.used) throw new AppError(409, 'Token déjà utilisé');
  if (new Date(qr.expires_at) < new Date()) throw new AppError(410, 'Token expiré');

  await query(
    'UPDATE qr_tokens SET used = true, used_by = $1, used_at = NOW() WHERE id = $2',
    [pharmacistId, qr.id],
  );

  await query(
    `INSERT INTO dispenses (prescription_id, pharmacist_id, dispensed_at)
     VALUES ($1, $2, NOW())`,
    [qr.prescription_id, pharmacistId],
  );

  res.json({ message: 'Médicament dispensé avec succès', prescription_id: qr.prescription_id });
});

// ── GET /pharmacist/dispenses ─────────────────────────────────────────────────

router.get('/dispenses', async (req, res) => {
  const pharmacistId = req.user!.sub;
  const rows = await query(
    `SELECT d.id, p.full_name AS patient_name, rx.rx_hash,
            d.dispensed_at
     FROM dispenses d
     JOIN prescriptions rx ON rx.id = d.prescription_id
     JOIN patients p ON p.id = rx.patient_id
     WHERE d.pharmacist_id = $1
     ORDER BY d.dispensed_at DESC`,
    [pharmacistId],
  );
  res.json(rows);
});

export default router;
