import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { authenticate, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/error';

const router = Router();
router.use(authenticate, requireRole('super_admin'));

// ── GET /super-admin/stats ────────────────────────────────────────────────────

router.get('/stats', async (_req, res) => {
  const [hospitals, doctors, pharmacists, pendingInvoices] = await Promise.all([
    queryOne<{ count: string }>('SELECT COUNT(*) FROM hospitals'),
    queryOne<{ count: string }>('SELECT COUNT(*) FROM users WHERE role = $1', ['doctor']),
    queryOne<{ count: string }>('SELECT COUNT(*) FROM users WHERE role = $1', ['pharmacist']),
    queryOne<{ count: string }>('SELECT COUNT(*) FROM invoices WHERE status = $1', ['pending']),
  ]);

  res.json({
    hospitals: parseInt(hospitals?.count ?? '0'),
    doctors: parseInt(doctors?.count ?? '0'),
    pharmacists: parseInt(pharmacists?.count ?? '0'),
    pending_invoices: parseInt(pendingInvoices?.count ?? '0'),
  });
});

// ── GET /super-admin/hospitals ────────────────────────────────────────────────

router.get('/hospitals', async (_req, res) => {
  const rows = await query(
    `SELECT h.id, h.name, h.address, h.created_at,
            COUNT(DISTINCT u.id) FILTER (WHERE u.role IN ('doctor','pharmacist')) AS staff_count
     FROM hospitals h
     LEFT JOIN users u ON u.hospital_id = h.id
     GROUP BY h.id
     ORDER BY h.created_at DESC`,
  );
  res.json(rows);
});

// ── POST /super-admin/hospitals ───────────────────────────────────────────────

const createHospitalSchema = z.object({
  name: z.string().min(2),
  address: z.string().optional().default(''),
});

router.post('/hospitals', async (req, res) => {
  const body = createHospitalSchema.parse(req.body);

  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM hospitals WHERE name = $1',
    [body.name],
  );
  if (existing) throw new AppError(409, 'Un hôpital avec ce nom existe déjà');

  const [hospital] = await query<{ id: string; name: string; address: string; created_at: string }>(
    `INSERT INTO hospitals (name, address) VALUES ($1, $2)
     RETURNING id, name, address, created_at`,
    [body.name, body.address],
  );

  res.status(201).json({ ...hospital, staff_count: 0 });
});

// ── POST /super-admin/hospitals/:id/admin ─────────────────────────────────────

const createAdminSchema = z.object({
  email: z.string().email(),
  display_name: z.string().min(2),
  temp_password: z.string().min(8),
});

router.post('/hospitals/:id/admin', async (req, res) => {
  const { id: hospitalId } = req.params;
  const body = createAdminSchema.parse(req.body);

  const hospital = await queryOne<{ id: string }>(
    'SELECT id FROM hospitals WHERE id = $1',
    [hospitalId],
  );
  if (!hospital) throw new AppError(404, 'Hôpital introuvable');

  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM users WHERE email = $1',
    [body.email.toLowerCase()],
  );
  if (existing) throw new AppError(409, 'Email déjà utilisé');

  const bcrypt = await import('bcryptjs');
  const hash = await bcrypt.hash(body.temp_password, 12);

  const [user] = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role, display_name, hospital_id, is_first_login, solana_public_key)
     VALUES ($1, $2, 'hospital_admin', $3, $4, true, '')
     RETURNING id`,
    [body.email.toLowerCase(), hash, body.display_name, hospitalId],
  );

  res.status(201).json({
    id: user!.id,
    email: body.email,
    display_name: body.display_name,
    role: 'hospital_admin',
    hospital_id: hospitalId,
    is_first_login: true,
  });
});

// ── DELETE /super-admin/hospitals/:id ────────────────────────────────────────

router.delete('/hospitals/:id', async (req, res) => {
  const { id: hospitalId } = req.params;

  const hospital = await queryOne<{ id: string; name: string }>(
    'SELECT id, name FROM hospitals WHERE id = $1',
    [hospitalId],
  );
  if (!hospital) throw new AppError(404, 'Hôpital introuvable');

  // Détacher les utilisateurs avant suppression (nullify hospital_id)
  await query('UPDATE users SET hospital_id = NULL WHERE hospital_id = $1', [hospitalId]);
  await query('DELETE FROM hospitals WHERE id = $1', [hospitalId]);

  res.json({ message: `Hôpital "${hospital.name}" supprimé` });
});

// ── GET /super-admin/me ───────────────────────────────────────────────────────

router.get('/me', async (req, res) => {
  const userId = req.user!.sub;
  const user = await queryOne<{
    id: string;
    email: string;
    display_name: string | null;
    role: string;
    created_at: string;
  }>(
    'SELECT id, email, display_name, role, created_at FROM users WHERE id = $1',
    [userId],
  );
  if (!user) throw new AppError(404, 'Utilisateur introuvable');
  res.json(user);
});

export default router;
