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

// ── Sécurité ──────────────────────────────────────────────────────────────────
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

// ── Migrations (exécutées une fois au premier démarrage) ─────────────────────
let _migrationsDone = false;

async function runMigrations() {
  if (_migrationsDone) return;
  const migrationsDir = path.resolve(__dirname, '../migrations');
  if (!fs.existsSync(migrationsDir)) {
    logger.warn(`Migrations directory not found: ${migrationsDir}`);
    _migrationsDone = true;
    return;
  }
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  await db.query(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  const hospitalsExists = await db.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'hospitals'`,
  );
  const seed001Recorded = await db.query(
    `SELECT 1 FROM _migrations WHERE name = '001_initial_schema.sql'`,
  );
  if (hospitalsExists.rows.length > 0 && seed001Recorded.rows.length === 0) {
    await db.query(`INSERT INTO _migrations (name) VALUES ('001_initial_schema.sql')`);
    logger.info('Migration 001 déjà appliquée (marquée comme telle)');
  }

  for (const file of files) {
    const applied = await db.query('SELECT name FROM _migrations WHERE name = $1', [file]);
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
      logger.error(`Échec migration ${file}:`, err);
      throw err;
    }
  }
  _migrationsDone = true;
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  await runMigrations();
  res.json({ status: 'ok', env: config.nodeEnv });
});

// ── Routes (avec migration lazy au premier appel) ─────────────────────────────
app.use(async (_req, _res, next) => {
  try {
    await runMigrations();
    next();
  } catch (err) {
    next(err);
  }
});

app.use('/auth', authRoutes);
app.use('/insurer', insurerRoutes);
app.use('/doctor', doctorRoutes);
app.use('/pharmacist', pharmacistRoutes);
app.use('/hospital', hospitalRoutes);
app.use('/super-admin', superAdminRoutes);
app.use('/patient', patientRoutes);

// ── Erreurs ───────────────────────────────────────────────────────────────────
app.use(errorHandler);

export default app;
