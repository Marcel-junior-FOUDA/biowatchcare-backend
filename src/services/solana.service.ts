import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, web3 } from '@coral-xyz/anchor';
import { config } from '../config';
import { logger } from '../logger';

const PROGRAM_ID = new PublicKey(config.solana.programId);

let _connection: Connection;
let _adminKeypair: Keypair;
let _provider: AnchorProvider;

function getConnection(): Connection {
  if (!_connection) {
    _connection = new Connection(config.solana.rpcUrl, 'confirmed');
  }
  return _connection;
}

function getAdminKeypair(): Keypair {
  if (!_adminKeypair) {
    if (config.solana.adminPrivateKey.length === 0) {
      logger.warn('SOLANA_ADMIN_PRIVATE_KEY non configurée — mode simulation');
      _adminKeypair = Keypair.generate();
    } else {
      _adminKeypair = Keypair.fromSecretKey(
        Uint8Array.from(config.solana.adminPrivateKey),
      );
    }
  }
  return _adminKeypair;
}

export function getProvider(): AnchorProvider {
  if (!_provider) {
    const wallet = new Wallet(getAdminKeypair());
    _provider = new AnchorProvider(getConnection(), wallet, {
      commitment: 'confirmed',
    });
  }
  return _provider;
}

// ── PDA helpers ──────────────────────────────────────────────────────────────

export function deriveEntityRolePDA(entityPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('role'), entityPubkey.toBuffer()],
    PROGRAM_ID,
  );
}

export function derivePatientProfilePDA(patientIdHash: Buffer): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('patient'), patientIdHash],
    PROGRAM_ID,
  );
}

export function deriveInvoicePDA(
  patientPubkey: PublicKey,
  invoiceHash: Buffer,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('invoice'), patientPubkey.toBuffer(), invoiceHash],
    PROGRAM_ID,
  );
}

export function deriveClaimPDA(
  invoicePubkey: PublicKey,
  insurerPubkey: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('claim'),
      invoicePubkey.toBuffer(),
      insurerPubkey.toBuffer(),
    ],
    PROGRAM_ID,
  );
}

// ── On-chain queries ─────────────────────────────────────────────────────────

export async function getEntityRole(
  entityPubkey: PublicKey,
): Promise<{ role: string; status: string; metadataHash: Uint8Array } | null> {
  try {
    const connection = getConnection();
    const [pda] = deriveEntityRolePDA(entityPubkey);
    const accountInfo = await connection.getAccountInfo(pda);
    if (!accountInfo) return null;

    // Manual deserialization (discriminator 8 bytes + data)
    const data = accountInfo.data.slice(8);
    const role = data[0]; // EntityRoleKind enum
    const status = data[1]; // EntityStatus enum
    const metadataHash = data.slice(2, 34);

    const roleMap: Record<number, string> = {
      0: 'hospital',
      1: 'insurer',
      2: 'doctor',
      3: 'pharmacist',
    };
    const statusMap: Record<number, string> = {
      0: 'pending',
      1: 'approved',
      2: 'revoked',
    };

    return {
      role: roleMap[role] ?? 'unknown',
      status: statusMap[status] ?? 'unknown',
      metadataHash,
    };
  } catch (err) {
    logger.error('getEntityRole error', err);
    return null;
  }
}

export async function isEntityApproved(pubkeyStr: string): Promise<boolean> {
  try {
    const pubkey = new PublicKey(pubkeyStr);
    const entity = await getEntityRole(pubkey);
    return entity?.status === 'approved';
  } catch {
    return false;
  }
}

// ── Simulation mode helper ───────────────────────────────────────────────────

export function isSolanaConfigured(): boolean {
  return config.solana.adminPrivateKey.length > 0;
}
