/**
 * Supprime l'ancien super_admin et en crée un nouveau.
 * Usage : npx ts-node scripts/seed-super-admin.ts
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';

const NEW_EMAIL    = 'admin@biowatchcare.app';
const NEW_PASSWORD = 'Biowatchcare2025!';

async function main() {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });

  // Supprimer tous les super_admin existants
  const deleted = await pool.query(
    "DELETE FROM users WHERE role = 'super_admin' RETURNING email",
  );
  if (deleted.rowCount && deleted.rowCount > 0) {
    const emails = (deleted.rows as { email: string }[]).map((r) => r.email).join(', ');
    console.log(`✓ Super-admin(s) supprimé(s) : ${emails}`);
  } else {
    console.log('ℹ Aucun super_admin existant à supprimer.');
  }

  const hash = await bcrypt.hash(NEW_PASSWORD, 12);

  await pool.query(
    `INSERT INTO users
       (email, password_hash, role, display_name, solana_public_key, is_first_login)
     VALUES ($1, $2, 'super_admin', 'Super Admin BioWatchCare', '', false)`,
    [NEW_EMAIL, hash],
  );

  console.log('\n✅ Nouveau super_admin créé :');
  console.log(`   Email    : ${NEW_EMAIL}`);
  console.log(`   Password : ${NEW_PASSWORD}`);

  await pool.end();
}

main().catch((err) => {
  console.error('Erreur :', err);
  process.exit(1);
});
