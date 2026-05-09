import 'dotenv/config';

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
}

export const config = {
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',

  db: {
    url: required('DATABASE_URL'),
  },

  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: process.env['JWT_EXPIRES_IN'] ?? '15m',
    refreshSecret: required('JWT_REFRESH_SECRET'),
    refreshExpiresIn: process.env['JWT_REFRESH_EXPIRES_IN'] ?? '7d',
  },

  solana: {
    rpcUrl: process.env['SOLANA_RPC_URL'] ?? 'https://api.devnet.solana.com',
    adminPrivateKey: JSON.parse(
      process.env['SOLANA_ADMIN_PRIVATE_KEY'] ?? '[]',
    ) as number[],
    programId:
      process.env['PROGRAM_ID'] ??
      'FhXSGiUzcvtAVqXM8tyy1HzUf4mFxkUQEvwgmjLRgow3',
  },

  autoReimbThreshold: parseInt(
    process.env['AUTO_REIMB_THRESHOLD'] ?? '50000',
    10,
  ),
} as const;
