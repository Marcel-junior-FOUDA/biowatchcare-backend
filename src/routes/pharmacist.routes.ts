import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { authenticate, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/error';

const router = Router();
router.use(authenticate, requireRole('pharmacist', 'super_admin'));

// ── GET /pharmacist/me ────────────────────────────────────────────────────────

router.get('/me', async (req, res) => {
  const userId = req.user!.sub;
  const me = await queryOne<{
    id: string; email: string; display_name: string | null;
    specialty: string | null; license_number: string | null; phone: string | null;
    hospital_id: string | null; hospital_name: string | null;
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

// ── GET /pharmacist/stats ─────────────────────────────────────────────────────

router.get('/stats', async (req, res) => {
  const pharmacistId = req.user!.sub;
  const [dispenses, patients] = await Promise.all([
    queryOne<{ count: string }>(
      'SELECT COUNT(*) FROM dispenses WHERE pharmacist_id = $1',
      [pharmacistId],
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(DISTINCT rx.patient_id) FROM dispenses d
       JOIN prescriptions rx ON rx.id = d.prescription_id
       WHERE d.pharmacist_id = $1`,
      [pharmacistId],
    ),
  ]);
  res.json({
    dispenses: parseInt(dispenses?.count ?? '0'),
    patients: parseInt(patients?.count ?? '0'),
  });
});

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

  await query(
    `UPDATE prescriptions SET status = 'dispensed', updated_at = NOW() WHERE id = $1`,
    [qr.prescription_id],
  );

  // Notifier le patient
  const rx = await queryOne<{ patient_id: string }>(
    'SELECT patient_id FROM prescriptions WHERE id = $1',
    [qr.prescription_id],
  );
  if (rx) {
    const patientUser = await queryOne<{ id: string }>(
      'SELECT id FROM users WHERE patient_id = $1',
      [rx.patient_id],
    );
    if (patientUser) {
      await query(
        `INSERT INTO notifications (user_id, type, title, body, data)
         VALUES ($1, 'prescription_dispensed', 'Médicaments délivrés',
                 'Vos médicaments ont été délivrés par la pharmacie.', $2)`,
        [patientUser.id, JSON.stringify({ prescription_id: qr.prescription_id })],
      );
    }
  }

  res.json({ message: 'Médicament dispensé avec succès', prescription_id: qr.prescription_id });
});

// ── GET /pharmacist/dispenses ─────────────────────────────────────────────────

router.get('/dispenses', async (req, res) => {
  const pharmacistId = req.user!.sub;
  const rows = await query(
    `SELECT d.id, d.prescription_id, p.full_name AS patient_name,
            rx.rx_hash, d.dispensed_at
     FROM dispenses d
     JOIN prescriptions rx ON rx.id = d.prescription_id
     JOIN patients p ON p.id = rx.patient_id
     WHERE d.pharmacist_id = $1
     ORDER BY d.dispensed_at DESC`,
    [pharmacistId],
  );
  res.json(rows);
});

// ── GET /pharmacist/prescriptions/:id ────────────────────────────────────────

router.get('/prescriptions/:id', async (req, res) => {
  const rx = await queryOne<{
    id: string;
    patient_id: string;
    rx_hash: string;
    medications_json: unknown;
    status: string;
    created_at: string;
    patient_name: string;
    doctor_name: string | null;
    motif: string | null;
    conclusion: string | null;
  }>(
    `SELECT rx.id, rx.patient_id, rx.rx_hash, rx.medications_json, rx.status, rx.created_at,
            p.full_name AS patient_name,
            u.display_name AS doctor_name,
            c.motif, c.conclusion,
            qt.token_hash AS qr_token,
            qt.expires_at AS qr_expires_at,
            qt.used AS qr_used
     FROM prescriptions rx
     JOIN patients p ON p.id = rx.patient_id
     JOIN users u ON u.id = rx.doctor_id
     LEFT JOIN consultations c ON c.id = rx.consultation_id
     LEFT JOIN qr_tokens qt ON qt.prescription_id = rx.id
       AND qt.used = false AND qt.expires_at > NOW()
     WHERE rx.id = $1
     LIMIT 1`,
    [req.params['id']],
  );
  if (!rx) throw new AppError(404, 'Ordonnance introuvable');
  res.json(rx);
});

// ── GET /pharmacist/notifications ─────────────────────────────────────────────

router.get('/notifications', async (req, res) => {
  const userId = req.user!.sub;
  const rows = await query(
    `SELECT id, type, title, body, data, read, created_at
     FROM notifications WHERE user_id = $1
     ORDER BY created_at DESC LIMIT 50`,
    [userId],
  );
  res.json(rows);
});

router.patch('/notifications/:id/read', async (req, res) => {
  const userId = req.user!.sub;
  await query(
    'UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2',
    [req.params['id'], userId],
  );
  res.json({ ok: true });
});

export default router;
