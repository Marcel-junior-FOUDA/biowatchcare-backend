import jwt from 'jsonwebtoken';
import { config } from '../config';
import type { JwtPayload } from '../middleware/auth';

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  } as jwt.SignOptions);
}

export function signRefreshToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn,
  } as jwt.SignOptions);
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwt.refreshSecret) as JwtPayload;
}

export function makeTokenPair(payload: JwtPayload) {
  return {
    access_token: signAccessToken(payload),
    refresh_token: signRefreshToken(payload),
  };
}
