import { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AppError } from './error';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  solanaPublicKey: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new AppError(401, 'Token manquant'));
  }
  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, config.jwt.secret) as JwtPayload;
    next();
  } catch {
    next(new AppError(401, 'Token invalide ou expiré'));
  }
};

export function requireRole(...roles: string[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError(403, 'Accès refusé'));
    }
    next();
  };
}
