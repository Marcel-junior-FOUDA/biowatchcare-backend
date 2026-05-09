import { Router } from 'express';
import { query, queryOne } from '../db';
import { authenticate, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/error';

const router = Router();
router.use(authenticate, requireRole('patient', 'super_admin'));

// ── GET /patient/me ───────────────────────────────────────────────────────────

router.get('/me', async (req, res) => {
  const userId = req.user!.sub;
  const me = await queryOne<{
    id: string;
    email: string;
    display_name: string | null;
    phone: string | null;
    hospital_name: string | null;
    patient_code: string | null;
    full_name: string | null;
    date_of_birth: string | null;
  }>(
    `SELECT u.id, u.email, u.display_name, u.phone,
            h.name AS hospital_name,
            p.patient_code, p.full_name, p.date_of_birth
     FROM users u
     LEFT JOIN hospitals h ON h.id = u.hospital_id
     LEFT JOIN patients p ON p.id = u.patient_id
     WHERE u.id = $1`,
    [userId],
  );
  if (!me) throw new AppError(404, 'Utilisateur introuvable');
  res.json(me);
});

// ── GET /patient/consultations ────────────────────────────────────────────────

router.get('/consultations', async (req, res) => {
  const userId = req.user!.sub;

  const user = await queryOne<{ patient_id: string | null }>(
    'SELECT patient_id FROM users WHERE id = $1',
    [userId],
  );
  if (!user?.patient_id) return res.json([]);

  const rows = await query(
    `SELECT c.id, c.motif, c.observations, c.conclusion, c.status, c.signed_at, c.created_at,
            u.display_name AS doctor_name,
            rx.id AS prescription_id, rx.medications_json,
            qt.token_hash AS qr_token, qt.expires_at AS qr_expires_at
     FROM consultations c
     JOIN users u ON u.id = c.doctor_id
     LEFT JOIN prescriptions rx ON rx.consultation_id = c.id
     LEFT JOIN qr_tokens qt ON qt.prescription_id = rx.id AND qt.used = false AND qt.expires_at > NOW()
     WHERE c.patient_id = $1
     ORDER BY c.created_at DESC`,
    [user.patient_id],
  );
  res.json(rows);
});

// ── GET /patient/notifications ────────────────────────────────────────────────

router.get('/notifications', async (req, res) => {
  const userId = req.user!.sub;
  const rows = await query(
    `SELECT id, type, title, body, data, read, created_at
     FROM notifications
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [userId],
  );
  res.json(rows);
});

// ── PATCH /patient/notifications/:id/read ─────────────────────────────────────

router.patch('/notifications/:id/read', async (req, res) => {
  const userId = req.user!.sub;
  await query(
    'UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2',
    [req.params['id'], userId],
  );
  res.json({ ok: true });
});

export default router;
