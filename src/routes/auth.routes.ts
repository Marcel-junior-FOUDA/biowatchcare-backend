import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { makeTokenPair, verifyRefreshToken } from '../services/token.service';
import { AppError } from '../middleware/error';
import { authenticate } from '../middleware/auth';
import type { JwtPayload } from '../middleware/auth';
import { logger } from '../logger';

const router = Router();

// ── Schémas de validation ────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  solana_public_key: z.string().optional().default(''),
});

const changePasswordSchema = z.object({
  current_password: z.string().min(6),
  new_password: z.string().min(8),
  new_solana_public_key: z.string().min(32),
});

const refreshSchema = z.object({
  refresh_token: z.string(),
});

// ── POST /auth/login ─────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const body = loginSchema.parse(req.body);

  const user = await queryOne<{
    id: string;
    email: string;
    password_hash: string;
    role: string;
    solana_public_key: string;
    is_first_login: boolean;
    display_name: string | null;
    hospital_id: string | null;
  }>(
    'SELECT id, email, password_hash, role, solana_public_key, is_first_login, display_name, hospital_id FROM users WHERE email = $1',
    [body.email.toLowerCase()],
  );

  if (!user || !(await bcrypt.compare(body.password, user.password_hash))) {
    throw new AppError(401, 'Email ou mot de passe incorrect');
  }

  // Update solana pubkey if changed (key rotation on password change)
  if (user.solana_public_key !== body.solana_public_key) {
    await query(
      'UPDATE users SET solana_public_key = $1, updated_at = NOW() WHERE id = $2',
      [body.solana_public_key, user.id],
    );
    logger.info(`Clé Solana mise à jour pour ${user.email}`);
  }

  const payload: JwtPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    solanaPublicKey: body.solana_public_key,
  };

  const tokens = makeTokenPair(payload);

  res.json({
    ...tokens,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      solana_public_key: body.solana_public_key,
      is_first_login: user.is_first_login,
      display_name: user.display_name,
      hospital_id: user.hospital_id,
    },
  });
});

// ── POST /auth/change-password ───────────────────────────────────────────────

router.post('/change-password', authenticate, async (req, res) => {
  const body = changePasswordSchema.parse(req.body);
  const userId = req.user!.sub;

  const user = await queryOne<{ password_hash: string }>(
    'SELECT password_hash FROM users WHERE id = $1',
    [userId],
  );
  if (!user || !(await bcrypt.compare(body.current_password, user.password_hash))) {
    throw new AppError(401, 'Mot de passe actuel incorrect');
  }

  const newHash = await bcrypt.hash(body.new_password, 12);
  await query(
    `UPDATE users
     SET password_hash = $1,
         solana_public_key = $2,
         is_first_login = false,
         updated_at = NOW()
     WHERE id = $3`,
    [newHash, body.new_solana_public_key, userId],
  );

  const updatedUser = await queryOne<{
    id: string;
    email: string;
    role: string;
    display_name: string | null;
    hospital_id: string | null;
  }>(
    'SELECT id, email, role, display_name, hospital_id FROM users WHERE id = $1',
    [userId],
  );

  const payload: JwtPayload = {
    sub: updatedUser!.id,
    email: updatedUser!.email,
    role: updatedUser!.role,
    solanaPublicKey: body.new_solana_public_key,
  };

  res.json({
    ...makeTokenPair(payload),
    user: {
      ...updatedUser,
      solana_public_key: body.new_solana_public_key,
      is_first_login: false,
    },
  });
});

// ── POST /auth/refresh ───────────────────────────────────────────────────────

router.post('/refresh', async (req, res) => {
  const { refresh_token } = refreshSchema.parse(req.body);
  let payload: JwtPayload;
  try {
    payload = verifyRefreshToken(refresh_token);
  } catch {
    throw new AppError(401, 'Refresh token invalide ou expiré');
  }

  // Verify user still exists
  const user = await queryOne<{ id: string }>(
    'SELECT id FROM users WHERE id = $1',
    [payload.sub],
  );
  if (!user) throw new AppError(401, 'Utilisateur introuvable');

  res.json(makeTokenPair(payload));
});

// ── POST /auth/logout ────────────────────────────────────────────────────────

router.post('/logout', authenticate, (_req, res) => {
  // Stateless JWT — client supprime les tokens de son côté
  res.json({ message: 'Déconnecté avec succès' });
});

export default router;
