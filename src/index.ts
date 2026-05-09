import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';

import { config } from './config';
import { logger } from './logger';
import { errorHandler } from './middleware/error';
import { db } from './db';
import authRoutes from './routes/auth.routes';
import insurerRoutes from './routes/insurer.routes';
import doctorRoutes from './routes/doctor.routes';
import pharmacistRoutes from './routes/pharmacist.routes';
import hospitalRoutes from './routes/hospital.routes';
import superAdminRoutes from './routes/super_admin.routes';
import patientRoutes from './routes/patient.routes';

const app = express();

// ── Sécurité ─────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Trop de requêtes, réessayez dans 15 minutes' },
  }),
);
app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', env: config.nodeEnv });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/insurer', insurerRoutes);
app.use('/doctor', doctorRoutes);
app.use('/pharmacist', pharmacistRoutes);
app.use('/hospital', hospitalRoutes);
app.use('/super-admin', superAdminRoutes);
app.use('/patient', patientRoutes);

// ── Erreurs ───────────────────────────────────────────────────────────────────
app.use(errorHandler);

// ── Auto-migration ────────────────────────────────────────────────────────────
async function runMigrations() {
  const migrationsDir = path.resolve(__dirname, '../migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  await db.query(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  // Si la table hospitals existe déjà mais que 001 n'est pas enregistrée,
  // c'est que la migration initiale a été appliquée manuellement — la marquer.
  const hospitalsExists = await db.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'hospitals'`,
  );
  const seed001Recorded = await db.query(
    `SELECT 1 FROM _migrations WHERE name = '001_initial_schema.sql'`,
  );
  if (hospitalsExists.rows.length > 0 && seed001Recorded.rows.length === 0) {
    await db.query(
      `INSERT INTO _migrations (name) VALUES ('001_initial_schema.sql')`,
    );
    logger.info('Migration 001 déjà appliquée (marquée comme telle)');
  }

  for (const file of files) {
    const applied = await db.query(
      'SELECT name FROM _migrations WHERE name = $1',
      [file],
    );
    if (applied.rows.length > 0) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await db.query('BEGIN');
    try {
      await db.query(sql);
      await db.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await db.query('COMMIT');
      logger.info(`Migration appliquée : ${file}`);
    } catch (err) {
      await db.query('ROLLBACK');
      logger.error(`Échec de la migration ${file} :`, err);
      throw err;
    }
  }
}

// ── Démarrage ─────────────────────────────────────────────────────────────────
runMigrations()
  .then(() => {
    app.listen(config.port, () => {
      logger.info(`BioWatchCare API démarré sur le port ${config.port} (${config.nodeEnv})`);
    });
  })
  .catch(err => {
    logger.error('Impossible de démarrer — migration échouée :', err);
    process.exit(1);
  });

export default app;
