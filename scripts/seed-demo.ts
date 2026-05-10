/**
 * Seed de démonstration : crée un hôpital + hospital_admin + médecin + pharmacien + assureur + patient.
 * Usage : npx ts-node scripts/seed-demo.ts
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });

async function hash(pw: string) {
  return bcrypt.hash(pw, 12);
}

async function main() {
  // ── Hôpital ─────────────────────────────────────────────────────────────────
  const { rows: [hospital] } = await pool.query<{ id: string }>(
    `INSERT INTO hospitals (name, address)
     VALUES ('Hôpital Central Demo', 'Yaoundé, Cameroun')
     ON CONFLICT DO NOTHING
     RETURNING id`,
  );

  let hospitalId: string;
  if (hospital) {
    hospitalId = hospital.id;
  } else {
    const { rows: [existing] } = await pool.query<{ id: string }>(
      "SELECT id FROM hospitals WHERE name = 'Hôpital Central Demo'",
    );
    hospitalId = existing!.id;
  }

  // ── Utilisateurs ─────────────────────────────────────────────────────────────
  const users = [
    {
      email: 'hospital@biowatchcare.app',
      password: 'Hospital2025!',
      role: 'hospital_admin',
      display_name: 'Admin Hôpital Central',
    },
    {
      email: 'doctor@biowatchcare.app',
      password: 'Doctor2025!',
      role: 'doctor',
      display_name: 'Dr. Jean Mbarga',
      specialty: 'Médecine générale',
      license_number: 'MED-001',
    },
    {
      email: 'pharmacist@biowatchcare.app',
      password: 'Pharmacist2025!',
      role: 'pharmacist',
      display_name: 'Paul Nkomo',
      license_number: 'PHA-001',
    },
    {
      email: 'insurer@biowatchcare.app',
      password: 'Insurer2025!',
      role: 'insurer',
      display_name: 'Marie Assurances',
    },
    {
      email: 'patient@biowatchcare.app',
      password: 'Patient2025!',
      role: 'patient',
      display_name: 'Ama Ngo',
    },
  ];

  const created: { email: string; password: string; role: string }[] = [];

  for (const u of users) {
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [u.email],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      // Mettre à jour le mot de passe et is_first_login = false
      const h = await hash(u.password);
      await pool.query(
        `UPDATE users SET password_hash = $1, is_first_login = false, hospital_id = $2 WHERE email = $3`,
        [h, hospitalId, u.email],
      );
      console.log(`↺ Mot de passe mis à jour : ${u.email}`);
    } else {
      const h = await hash(u.password);
      await pool.query(
        `INSERT INTO users
           (email, password_hash, role, display_name, specialty, license_number,
            hospital_id, solana_public_key, is_first_login)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'',false)`,
        [
          u.email,
          h,
          u.role,
          u.display_name,
          (u as any).specialty ?? null,
          (u as any).license_number ?? null,
          hospitalId,
        ],
      );

      // Si c'est un patient, créer aussi le dossier patient
      if (u.role === 'patient') {
        const { rows: [userRow] } = await pool.query<{ id: string }>(
          'SELECT id FROM users WHERE email = $1',
          [u.email],
        );
        const patientCode = 'BWC-0001';
        const { rows: [patient] } = await pool.query<{ id: string }>(
          `INSERT INTO patients (full_name, date_of_birth, phone, email, solana_public_key, patient_code)
           VALUES ($1,'1990-01-01','699000001',$2,'','${patientCode}')
           RETURNING id`,
          [u.display_name, u.email],
        );
        await pool.query(
          'UPDATE users SET patient_id = $1 WHERE id = $2',
          [patient!.id, userRow!.id],
        );
        await pool.query(
          `INSERT INTO hospital_patients (hospital_id, patient_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [hospitalId, patient!.id],
        );
      }

      console.log(`✓ Créé : ${u.email} (${u.role})`);
    }
    created.push({ email: u.email, password: u.password, role: u.role });
  }

  console.log('\n=== Identifiants de démonstration ===');
  console.log(`${'Rôle'.padEnd(18)} ${'Email'.padEnd(35)} Mot de passe`);
  console.log('-'.repeat(72));
  [
    { email: 'admin@biowatchcare.app', password: 'Biowatchcare2025!', role: 'super_admin' },
    ...created,
  ].forEach((u) => {
    console.log(`${u.role.padEnd(18)} ${u.email.padEnd(35)} ${u.password}`);
  });

  await pool.end();
}

main().catch((err) => {
  console.error('Erreur :', err);
  process.exit(1);
});
