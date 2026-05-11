import 'dotenv/config';
import fs from 'fs';

const DEFAULT_PROGRAM_ID = 'E7BWwRFQBYXmNqqAfNPYm1ccgWysJqtJrvUSq1NTnooX'; // deployed on devnet

function requiredEnv(key: string, errors: string[]): string {
  const value = process.env[key]?.trim();
  if (!value) {
    errors.push(`Missing env var: ${key}`);
    return '';
  }
  return value;
}

function parseIntegerEnv(
  key: string,
  fallback: string,
  errors: string[],
): number {
  const raw = process.env[key] ?? fallback;
  const parsed = Number.parseInt(raw, 10);

  if (Number.isNaN(parsed)) {
    errors.push(`Invalid integer env var: ${key}=${raw}`);
    return Number.parseInt(fallback, 10);
  }

  return parsed;
}

function parseSolanaAdminPrivateKey(errors: string[]): number[] {
  const keypairPath = process.env['SOLANA_ADMIN_PRIVATE_KEY_PATH']?.trim();
  if (keypairPath) {
    try {
      const rawFile = fs.readFileSync(keypairPath, 'utf8');
      const parsed = JSON.parse(rawFile) as unknown;
      if (!Array.isArray(parsed) || parsed.some((value) => !Number.isInteger(value))) {
        errors.push(
          'SOLANA_ADMIN_PRIVATE_KEY_PATH must point to a Solana keypair JSON array',
        );
        return [];
      }
      return parsed;
    } catch {
      errors.push(
        `SOLANA_ADMIN_PRIVATE_KEY_PATH could not be read or parsed: ${keypairPath}`,
      );
      return [];
    }
  }

  const raw = process.env['SOLANA_ADMIN_PRIVATE_KEY'] ?? '[]';

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.some((value) => !Number.isInteger(value))) {
      errors.push('SOLANA_ADMIN_PRIVATE_KEY must be a JSON array of integers');
      return [];
    }
    return parsed;
  } catch {
    errors.push('SOLANA_ADMIN_PRIVATE_KEY must be valid JSON');
    return [];
  }
}

const configErrors: string[] = [];

const port = parseIntegerEnv('PORT', '3000', configErrors);
const autoReimbThreshold = parseIntegerEnv(
  'AUTO_REIMB_THRESHOLD',
  '50000',
  configErrors,
);
const databaseUrl = requiredEnv('DATABASE_URL', configErrors);
const jwtSecret = requiredEnv('JWT_SECRET', configErrors);
const jwtRefreshSecret = requiredEnv('JWT_REFRESH_SECRET', configErrors);
const solanaAdminPrivateKey = parseSolanaAdminPrivateKey(configErrors);

if (configErrors.length > 0) {
  throw new Error(
    `Invalid environment configuration:\n- ${configErrors.join('\n- ')}`,
  );
}

export const config = {
  port,
  nodeEnv: process.env['NODE_ENV'] ?? 'development',

  db: {
    url: databaseUrl,
  },

  jwt: {
    secret: jwtSecret,
    expiresIn: process.env['JWT_EXPIRES_IN'] ?? '4h',
    refreshSecret: jwtRefreshSecret,
    refreshExpiresIn: process.env['JWT_REFRESH_EXPIRES_IN'] ?? '7d',
  },

  solana: {
    rpcUrl: process.env['SOLANA_RPC_URL'] ?? 'https://api.devnet.solana.com',
    adminPrivateKey: solanaAdminPrivateKey,
    adminPrivateKeyPath: process.env['SOLANA_ADMIN_PRIVATE_KEY_PATH']?.trim() ?? '',
    programId: process.env['PROGRAM_ID'] ?? DEFAULT_PROGRAM_ID,
  },

  autoReimbThreshold,
} as const;
