import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { PublicKey } from '@solana/web3.js';
import { query, queryOne } from '../db';
import { authenticate, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/error';
import { logger } from '../logger';
import {
  buildAddPrescriptionTx,
  buildIssueQrTokenTx,
  derivePatientProfilePDA,
  derivePrescriptionPDA,
} from '../services/solana.service';

const router = Router();
router.use(authenticate, requireRole('doctor', 'super_admin'));

// ── GET /doctor/me ────────────────────────────────────────────────────────────

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

// ── GET /doctor/stats ─────────────────────────────────────────────────────────

router.get('/stats', async (req, res) => {
  const doctorId = req.user!.sub;
  const [patients, prescriptions] = await Promise.all([
    queryOne<{ count: string }>(
      'SELECT COUNT(*) FROM doctor_patients WHERE doctor_id = $1',
      [doctorId],
    ),
    queryOne<{ count: string }>(
      "SELECT COUNT(*) FROM prescriptions WHERE doctor_id = $1 AND status = 'active'",
      [doctorId],
    ),
  ]);
  res.json({
    patients: parseInt(patients?.count ?? '0'),
    active_prescriptions: parseInt(prescriptions?.count ?? '0'),
  });
});

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

  const rxHashBuf = crypto
    .createHash('sha256')
    .update(`${body.patient_id}:${body.medication_pointer_hash}:${Date.now()}`)
    .digest();
  const rxHash = rxHashBuf.toString('hex');

  const pointerHashBuf = Buffer.from(
    body.medication_pointer_hash.padEnd(64, '0').slice(0, 64),
    'hex',
  );

  const [rx] = await query<{ id: string }>(
    `INSERT INTO prescriptions (patient_id, doctor_id, rx_hash, pointer_hash, status)
     VALUES ($1, $2, $3, $4, 'active')
     RETURNING id`,
    [body.patient_id, doctorId, rxHash, body.medication_pointer_hash],
  );

  // Construire la tx partielle Solana — Flutter co-signe avec la clé du médecin
  const [doctorRow, patientRow] = await Promise.all([
    queryOne<{ solana_public_key: string }>(
      'SELECT solana_public_key FROM users WHERE id = $1',
      [doctorId],
    ),
    queryOne<{ patient_id_hash: string }>(
      'SELECT patient_id_hash FROM patients WHERE id = $1',
      [body.patient_id],
    ),
  ]);

  let solanaPartialTx: string | null = null;
  if (doctorRow?.solana_public_key && patientRow?.patient_id_hash) {
    const patientIdHash = Buffer.from(patientRow.patient_id_hash, 'hex');
    solanaPartialTx = await buildAddPrescriptionTx(
      patientIdHash,
      rxHashBuf,
      pointerHashBuf,
      doctorRow.solana_public_key,
    );
  }

  res.status(201).json({
    id: rx!.id,
    rx_hash: rxHash,
    status: 'active',
    ...(solanaPartialTx ? { solana_partial_tx: solanaPartialTx } : {}),
  });
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

  const tokenHashBuf = crypto.randomBytes(32);
  const tokenHash = tokenHashBuf.toString('hex');
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  const [qr] = await query<{ id: string }>(
    `INSERT INTO qr_tokens (prescription_id, token_hash, expires_at, used)
     VALUES ($1, $2, $3, false)
     RETURNING id`,
    [rxId, tokenHash, expiresAt],
  );

  // Construire la tx partielle Solana pour issue_qr_token
  const [doctorRow, rxRow] = await Promise.all([
    queryOne<{ solana_public_key: string }>(
      'SELECT solana_public_key FROM users WHERE id = $1',
      [doctorId],
    ),
    queryOne<{ rx_hash: string; patient_id: string }>(
      'SELECT rx_hash, patient_id FROM prescriptions WHERE id = $1',
      [rxId],
    ),
  ]);

  let solanaPartialTx: string | null = null;
  if (doctorRow?.solana_public_key && rxRow) {
    const patientRow = await queryOne<{ patient_id_hash: string }>(
      'SELECT patient_id_hash FROM patients WHERE id = $1',
      [rxRow.patient_id],
    );
    if (patientRow?.patient_id_hash) {
      const patientIdHash = Buffer.from(patientRow.patient_id_hash, 'hex');
      const rxHashBuf = Buffer.from(rxRow.rx_hash, 'hex');
      const [patientPDA] = derivePatientProfilePDA(patientIdHash);
      const [prescriptionPDA] = derivePrescriptionPDA(patientPDA, rxHashBuf);

      solanaPartialTx = await buildIssueQrTokenTx(
        prescriptionPDA,
        tokenHashBuf,
        doctorRow.solana_public_key,
      );
    }
  }

  res.status(201).json({
    id: qr!.id,
    token_hash: tokenHash,
    expires_at: expiresAt.toISOString(),
    ...(solanaPartialTx ? { solana_partial_tx: solanaPartialTx } : {}),
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

// ── GET /doctor/patients/search?code=BWC-XXXX ─────────────────────────────────

router.get('/patients/search', async (req, res) => {
  const { code } = req.query;
  if (!code || typeof code !== 'string') throw new AppError(400, 'code requis');

  const patient = await queryOne<{
    id: string;
    full_name: string;
    date_of_birth: string | null;
    phone: string | null;
    email: string | null;
    patient_code: string;
  }>(
    `SELECT id, full_name, date_of_birth, phone, email, patient_code
     FROM patients
     WHERE UPPER(patient_code) = UPPER($1)`,
    [code.trim()],
  );

  if (!patient) throw new AppError(404, 'Aucun patient trouvé avec ce code');
  res.json(patient);
});

// ── GET /doctor/hospital-staff ────────────────────────────────────────────────
// Retourne les pharmaciens et assureurs du même hôpital

router.get('/hospital-staff', async (req, res) => {
  const doctorId = req.user!.sub;
  const rows = await query<{
    id: string;
    display_name: string | null;
    role: string;
    email: string;
    specialty: string | null;
    license_number: string | null;
  }>(
    `SELECT u.id, u.display_name, u.role, u.email, u.specialty, u.license_number
     FROM users u
     WHERE u.hospital_id = (SELECT hospital_id FROM users WHERE id = $1)
       AND u.role IN ('pharmacist', 'insurer')
     ORDER BY u.role, u.display_name`,
    [doctorId],
  );
  res.json(rows);
});

// ── POST /doctor/consultations ────────────────────────────────────────────────

const createConsultationSchema = z.object({
  patient_id: z.string().uuid(),
  pharmacist_id: z.string().uuid().optional(),
  insurer_id: z.string().uuid().optional(),
  motif: z.string().min(1),
  observations: z.string().optional(),
  conclusion: z.string().optional(),
  medications: z.array(z.object({
    name: z.string().min(1),
    dosage: z.string().optional(),
    frequency: z.string().optional(),
    duration: z.string().optional(),
    instructions: z.string().optional(),
  })).default([]),
});

router.post('/consultations', async (req, res) => {
  const doctorId = req.user!.sub;
  const body = createConsultationSchema.parse(req.body);

  // Lier le patient au médecin si pas encore fait
  await query(
    `INSERT INTO doctor_patients (doctor_id, patient_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [doctorId, body.patient_id],
  );

  const [consultation] = await query<{ id: string }>(
    `INSERT INTO consultations
       (patient_id, doctor_id, pharmacist_id, insurer_id, motif, observations, conclusion, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')
     RETURNING id`,
    [
      body.patient_id,
      doctorId,
      body.pharmacist_id ?? null,
      body.insurer_id ?? null,
      body.motif,
      body.observations ?? null,
      body.conclusion ?? null,
    ],
  );

  // Créer l'ordonnance associée (même si medications vide, on la crée)
  const medicationsJson = JSON.stringify(body.medications);
  const pointerHash = crypto
    .createHash('sha256')
    .update(`${consultation!.id}:${medicationsJson}:${Date.now()}`)
    .digest('hex');

  const rxHash = crypto
    .createHash('sha256')
    .update(`${body.patient_id}:${pointerHash}:${Date.now()}`)
    .digest('hex');

  const [rx] = await query<{ id: string }>(
    `INSERT INTO prescriptions (patient_id, doctor_id, consultation_id, rx_hash, pointer_hash, medications_json, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'draft')
     RETURNING id`,
    [body.patient_id, doctorId, consultation!.id, rxHash, pointerHash, medicationsJson],
  );

  res.status(201).json({
    consultation_id: consultation!.id,
    prescription_id: rx!.id,
    rx_hash: rxHash,
    status: 'draft',
  });
});

// ── POST /doctor/consultations/:id/sign ───────────────────────────────────────

router.post('/consultations/:id/sign', async (req, res) => {
  const doctorId = req.user!.sub;
  const { id } = req.params;

  const consultation = await queryOne<{
    id: string;
    status: string;
    doctor_id: string;
    patient_id: string;
    pharmacist_id: string | null;
    insurer_id: string | null;
  }>(
    'SELECT id, status, doctor_id, patient_id, pharmacist_id, insurer_id FROM consultations WHERE id = $1',
    [id],
  );
  if (!consultation) throw new AppError(404, 'Consultation introuvable');
  if (consultation.doctor_id !== doctorId) throw new AppError(403, 'Accès refusé');
  if (consultation.status !== 'draft') throw new AppError(409, 'Consultation déjà signée');

  // Signer la consultation
  await query(
    `UPDATE consultations SET status = 'signed', signed_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [id],
  );

  // Activer l'ordonnance
  await query(
    `UPDATE prescriptions SET status = 'active', updated_at = NOW()
     WHERE consultation_id = $1`,
    [id],
  );

  // Récupérer l'ordonnance pour générer le QR
  const rx = await queryOne<{ id: string }>(
    'SELECT id FROM prescriptions WHERE consultation_id = $1',
    [id],
  );

  let qrToken: string | null = null;
  if (rx) {
    qrToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    await query(
      `INSERT INTO qr_tokens (prescription_id, token_hash, expires_at, used)
       VALUES ($1, $2, $3, false)`,
      [rx.id, qrToken, expiresAt],
    );
  }

  // Notification au patient
  const patientUser = await queryOne<{ id: string }>(
    'SELECT id FROM users WHERE patient_id = $1',
    [consultation.patient_id],
  );
  if (patientUser) {
    const doctor = await queryOne<{ display_name: string | null }>(
      'SELECT display_name FROM users WHERE id = $1',
      [doctorId],
    );
    await query(
      `INSERT INTO notifications (user_id, type, title, body, data)
       VALUES ($1, 'consultation_signed', 'Consultation signée',
               $2, $3)`,
      [
        patientUser.id,
        `Dr. ${doctor?.display_name ?? 'Votre médecin'} a signé votre consultation. Votre ordonnance est disponible.`,
        JSON.stringify({ consultation_id: id }),
      ],
    );
  }

  // Notification au pharmacien si sélectionné
  if (consultation.pharmacist_id) {
    await query(
      `INSERT INTO notifications (user_id, type, title, body, data)
       VALUES ($1, 'new_prescription', 'Nouvelle ordonnance',
               'Une nouvelle ordonnance vous est attribuée.', $2)`,
      [
        consultation.pharmacist_id,
        JSON.stringify({ consultation_id: id, prescription_id: rx?.id }),
      ],
    );
  }

  logger.info(`Consultation ${id} signée par médecin ${doctorId}`);

  res.json({
    message: 'Consultation signée',
    qr_token: qrToken,
    prescription_id: rx?.id,
  });
});

// ── GET /doctor/consultations ─────────────────────────────────────────────────

router.get('/consultations', async (req, res) => {
  const doctorId = req.user!.sub;

  // Check whether migration 002 has been applied
  const tableCheck = await query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'consultations'`,
    [],
  );
  if (tableCheck.length === 0) {
    res.json([]);
    return;
  }

  const colCheck = await query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'patients' AND column_name = 'patient_code'`,
    [],
  );
  const hasPatientCode = colCheck.length > 0;

  const colCheckRx = await query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'prescriptions' AND column_name = 'medications_json'`,
    [],
  );
  const hasMedicationsJson = colCheckRx.length > 0;

  const patientCodeExpr = hasPatientCode    ? 'p.patient_code'      : 'NULL::text';
  const medicationsExpr = hasMedicationsJson ? 'rx.medications_json' : 'NULL::jsonb';

  const rows = await query(
    `SELECT c.id, c.motif, c.status, c.signed_at, c.created_at,
            p.full_name AS patient_name, ${patientCodeExpr} AS patient_code,
            rx.id AS prescription_id, ${medicationsExpr} AS medications_json
     FROM consultations c
     JOIN patients p ON p.id = c.patient_id
     LEFT JOIN prescriptions rx ON ${hasMedicationsJson ? 'rx.consultation_id = c.id' : 'false'}
     WHERE c.doctor_id = $1
       AND c.status IN ('signed', 'dispensed')
     ORDER BY c.created_at DESC`,
    [doctorId],
  );
  res.json(rows);
});

// ── GET /doctor/notifications ─────────────────────────────────────────────────

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
