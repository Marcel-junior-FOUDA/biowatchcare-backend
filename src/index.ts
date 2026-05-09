import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { config } from './config';
import { logger } from './logger';
import { errorHandler } from './middleware/error';
import authRoutes from './routes/auth.routes';
import insurerRoutes from './routes/insurer.routes';
import doctorRoutes from './routes/doctor.routes';
import pharmacistRoutes from './routes/pharmacist.routes';
import hospitalRoutes from './routes/hospital.routes';
import superAdminRoutes from './routes/super_admin.routes';

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

// ── Erreurs ───────────────────────────────────────────────────────────────────
app.use(errorHandler);

// ── Démarrage ─────────────────────────────────────────────────────────────────
app.listen(config.port, () => {
  logger.info(`BioWatchCare API démarré sur le port ${config.port} (${config.nodeEnv})`);
});

export default app;
