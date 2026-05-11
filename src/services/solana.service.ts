import {
  Connection,
  Keypair,
  PublicKey,
  SendTransactionError,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import crypto from 'crypto';
import { config } from '../config';
import { logger } from '../logger';

// ── Seeds (mirrors constants.rs) ─────────────────────────────────────────────

const SEEDS = {
  CONFIG:  Buffer.from('config'),
  ROLE:    Buffer.from('role'),
  PATIENT: Buffer.from('patient'),
  CONSENT: Buffer.from('consent'),
  RX:      Buffer.from('rx'),
  QR:      Buffer.from('qr'),
  DISPENSE:Buffer.from('dispense'),
  INVOICE: Buffer.from('invoice'),
  CLAIM:   Buffer.from('claim'),
};

const PROGRAM_ID = new PublicKey(config.solana.programId);
const SYSTEM_PROGRAM = SystemProgram.programId;

// ── Discriminators (sha256('global:<snake_case_name>')[0..8]) ─────────────────

function disc(name: string): Buffer {
  return crypto.createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}

const DISC = {
  initialize_config:     disc('initialize_config'),
  register_entity:       disc('register_entity'),
  approve_entity:        disc('approve_entity'),
  revoke_entity:         disc('revoke_entity'),
  create_patient_profile:disc('create_patient_profile'),
  add_prescription:      disc('add_prescription'),
  issue_qr_token:        disc('issue_qr_token'),
  verify_qr_token:       disc('verify_qr_token'),
  dispense_with_qr:      disc('dispense_with_qr'),
  create_invoice:        disc('create_invoice'),
  auto_or_pending_claim: disc('auto_or_pending_claim'),
  insurer_decide_claim:  disc('insurer_decide_claim'),
  grant_consent:         disc('grant_consent'),
  revoke_consent:        disc('revoke_consent'),
};

// ── Borsh helpers ─────────────────────────────────────────────────────────────

function writePubkey(pk: PublicKey): Buffer {
  return pk.toBuffer();
}

function writeU64LE(n: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(n));
  return buf;
}

function writeU16LE(n: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(n);
  return buf;
}

function writeBool(b: boolean): Buffer {
  return Buffer.from([b ? 1 : 0]);
}

export class SolanaWriteError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly details?: string,
  ) {
    super(message);
    this.name = 'SolanaWriteError';
  }
}

type EntityStatus = 'missing' | 'pending' | 'approved' | 'revoked';

type EntityOnChainState = {
  exists: boolean;
  approved: boolean;
  rolePda: string;
  status: EntityStatus;
};

// Anchor serializes fieldless enums as a single u8 tag.
function writeRoleVariant(role: string): Buffer {
  const map: Record<string, number> = {
    hospital_admin: 0,
    hospital:       0,
    insurer:        1,
    doctor:         2,
    pharmacist:     3,
  };
  const idx = map[role];
  if (idx === undefined) throw new Error(`Rôle inconnu: ${role}`);
  return Buffer.from([idx]);
}

// ── Singletons ────────────────────────────────────────────────────────────────

let _connection: Connection;
let _adminKeypair: Keypair;

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

export function isSolanaConfigured(): boolean {
  return config.solana.adminPrivateKey.length > 0;
}

function normalizeErrorDetails(err: unknown): string {
  if (err instanceof SendTransactionError) {
    const logs = Array.isArray(err.logs) && err.logs.length > 0
      ? ` logs=${err.logs.join(' | ')}`
      : '';
    return `${err.message}${logs}`;
  }

  if (err instanceof Error) {
    const cause = 'cause' in err
      ? (err as Error & { cause?: unknown }).cause
      : undefined;
    const causeMessage = cause instanceof Error
      ? ` cause=${cause.message}`
      : typeof cause === 'string'
        ? ` cause=${cause}`
        : '';
    return `${err.message}${causeMessage}`;
  }

  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// ── PDA helpers ───────────────────────────────────────────────────────────────

export function deriveConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SEEDS.CONFIG], PROGRAM_ID);
}

export function deriveEntityRolePDA(entityPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.ROLE, entityPubkey.toBuffer()],
    PROGRAM_ID,
  );
}

export function derivePatientProfilePDA(patientIdHash: Buffer): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.PATIENT, patientIdHash],
    PROGRAM_ID,
  );
}

export function derivePrescriptionPDA(
  patientPDA: PublicKey,
  rxHash: Buffer,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.RX, patientPDA.toBuffer(), rxHash],
    PROGRAM_ID,
  );
}

export function deriveQrTokenPDA(
  prescriptionPDA: PublicKey,
  tokenHash: Buffer,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.QR, prescriptionPDA.toBuffer(), tokenHash],
    PROGRAM_ID,
  );
}

export function deriveDispensePDA(
  prescriptionPDA: PublicKey,
  pharmacistPubkey: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.DISPENSE, prescriptionPDA.toBuffer(), pharmacistPubkey.toBuffer()],
    PROGRAM_ID,
  );
}

export function deriveInvoicePDA(
  patientPDA: PublicKey,
  invoiceHash: Buffer,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.INVOICE, patientPDA.toBuffer(), invoiceHash],
    PROGRAM_ID,
  );
}

export function deriveClaimPDA(
  invoicePDA: PublicKey,
  insurerPubkey: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.CLAIM, invoicePDA.toBuffer(), insurerPubkey.toBuffer()],
    PROGRAM_ID,
  );
}

// ── Transaction builders ──────────────────────────────────────────────────────

/**
 * Admin-signs the transaction and returns base64-encoded partial tx
 * for Flutter to co-sign with the entity keypair and broadcast.
 */
async function buildPartialTx(tx: Transaction): Promise<string> {
  const connection = getConnection();
  const admin = getAdminKeypair();
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash('confirmed');

  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = admin.publicKey;
  tx.partialSign(admin);

  return tx.serialize({ requireAllSignatures: false }).toString('base64');
}

/**
 * Returns a base64 transaction to be signed and paid entirely by the user.
 * Used for operational instructions where the smart contract expects only the
 * hospital/doctor/pharmacist/insurer signer and no admin co-signature.
 */
async function buildUserSignedTx(
  tx: Transaction,
  signerPubkey: PublicKey,
): Promise<string> {
  const connection = getConnection();
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash('confirmed');

  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = signerPubkey;

  return tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  }).toString('base64');
}

/**
 * Admin sends and confirms a transaction that only requires the admin signature.
 */
async function sendAdminTx(tx: Transaction): Promise<string> {
  const connection = getConnection();
  const admin = getAdminKeypair();
  const sig = await sendAndConfirmTransaction(connection, tx, [admin], {
    commitment: 'confirmed',
  });
  return sig;
}

// ── register_entity ───────────────────────────────────────────────────────────

export async function registerEntity(
  entityPubkeyStr: string,
  role: string,
  metadataHash: Buffer,
) : Promise<string> {
  if (!isSolanaConfigured()) {
    throw new SolanaWriteError(
      'SOLANA_ADMIN_PRIVATE_KEY non configurée pour les écritures on-chain',
    );
  }
  try {
    const admin = getAdminKeypair();
    const entityPubkey = new PublicKey(entityPubkeyStr);
    const [configPDA] = deriveConfigPDA();
    const [rolePDA] = deriveEntityRolePDA(entityPubkey);
    const existingState = await getEntityOnChainState(entityPubkeyStr);

    if (existingState.status === 'revoked') {
      throw new SolanaWriteError(
        `Entité déjà enregistrée on-chain mais révoquée pour ${entityPubkeyStr}`,
        undefined,
        `rolePda=${existingState.rolePda} status=${existingState.status}`,
      );
    }

    if (existingState.exists) {
      logger.warn(
        `[Solana] registerEntity ignoré — entité déjà présente ${entityPubkeyStr} rolePda=${existingState.rolePda} status=${existingState.status}`,
      );
      return `already-registered:${existingState.rolePda}`;
    }

    // register_entity(role: Role, entity_pubkey: Pubkey, metadata_hash: [u8;32])
    const data = Buffer.concat([
      DISC.register_entity,
      writeRoleVariant(role),
      writePubkey(entityPubkey),
      metadataHash,
    ]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: admin.publicKey, isSigner: true,  isWritable: true  }, // admin
        { pubkey: configPDA,       isSigner: false, isWritable: false }, // config
        { pubkey: rolePDA,         isSigner: false, isWritable: true  }, // role_account
        { pubkey: SYSTEM_PROGRAM,  isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    const sig = await sendAdminTx(tx);
    logger.info(`[Solana] registerEntity OK — ${entityPubkeyStr} sig=${sig}`);
    return sig;
  } catch (err) {
    const details = err instanceof SolanaWriteError
      ? err.details
      : normalizeErrorDetails(err);
    logger.error(`[Solana] registerEntity error — ${entityPubkeyStr} ${details ?? ''}`.trim());
    throw new SolanaWriteError(
      `Échec on-chain de registerEntity pour ${entityPubkeyStr}`,
      err,
      details,
    );
  }
}

// ── approve_entity ────────────────────────────────────────────────────────────

export async function approveEntity(entityPubkeyStr: string): Promise<string> {
  if (!isSolanaConfigured()) {
    throw new SolanaWriteError(
      'SOLANA_ADMIN_PRIVATE_KEY non configurée pour les écritures on-chain',
    );
  }
  try {
    const admin = getAdminKeypair();
    const entityPubkey = new PublicKey(entityPubkeyStr);
    const [configPDA] = deriveConfigPDA();
    const [rolePDA] = deriveEntityRolePDA(entityPubkey);
    const existingState = await getEntityOnChainState(entityPubkeyStr);

    if (!existingState.exists) {
      throw new SolanaWriteError(
        `Entité absente on-chain pour approveEntity ${entityPubkeyStr}`,
        undefined,
        `rolePda=${existingState.rolePda} status=${existingState.status}`,
      );
    }

    if (existingState.status === 'revoked') {
      throw new SolanaWriteError(
        `Entité révoquée on-chain pour approveEntity ${entityPubkeyStr}`,
        undefined,
        `rolePda=${existingState.rolePda} status=${existingState.status}`,
      );
    }

    if (existingState.approved) {
      logger.warn(
        `[Solana] approveEntity ignoré — entité déjà approuvée ${entityPubkeyStr} rolePda=${existingState.rolePda}`,
      );
      return `already-approved:${existingState.rolePda}`;
    }

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: admin.publicKey, isSigner: true,  isWritable: true  },
        { pubkey: configPDA,       isSigner: false, isWritable: false },
        { pubkey: rolePDA,         isSigner: false, isWritable: true  },
      ],
      data: DISC.approve_entity,
    });

    const tx = new Transaction().add(ix);
    const sig = await sendAdminTx(tx);
    logger.info(`[Solana] approveEntity OK — ${entityPubkeyStr} sig=${sig}`);
    return sig;
  } catch (err) {
    const details = err instanceof SolanaWriteError
      ? err.details
      : normalizeErrorDetails(err);
    logger.error(`[Solana] approveEntity error — ${entityPubkeyStr} ${details ?? ''}`.trim());
    throw new SolanaWriteError(
      `Échec on-chain de approveEntity pour ${entityPubkeyStr}`,
      err,
      details,
    );
  }
}

// ── create_patient_profile ────────────────────────────────────────────────────

export async function buildCreatePatientProfileTx(
  patientIdHash: Buffer,
  staffPubkeyStr: string,
): Promise<string | null> {
  if (!isSolanaConfigured()) {
    logger.warn('[Solana] buildCreatePatientProfileTx ignoré — mode simulation');
    return null;
  }
  try {
    const staffPubkey = new PublicKey(staffPubkeyStr);
    const [configPDA] = deriveConfigPDA();
    const [staffRolePDA] = deriveEntityRolePDA(staffPubkey);
    const [patientPDA] = derivePatientProfilePDA(patientIdHash);

    // create_patient_profile(patient_id_hash: [u8;32])
    const data = Buffer.concat([DISC.create_patient_profile, patientIdHash]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: staffPubkey,     isSigner: true,  isWritable: true  }, // staff pays rent/signs
        { pubkey: configPDA,       isSigner: false, isWritable: false },
        { pubkey: staffRolePDA,    isSigner: false, isWritable: false },
        { pubkey: patientPDA,      isSigner: false, isWritable: true  },
        { pubkey: SYSTEM_PROGRAM,  isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    return buildUserSignedTx(tx, staffPubkey);
  } catch (err) {
    logger.error('[Solana] buildCreatePatientProfileTx error', err);
    return null;
  }
}

// ── add_prescription ──────────────────────────────────────────────────────────

export async function buildAddPrescriptionTx(
  patientIdHash: Buffer,
  rxHash: Buffer,
  pointerHash: Buffer,
  doctorPubkeyStr: string,
): Promise<string | null> {
  if (!isSolanaConfigured()) {
    logger.warn('[Solana] buildAddPrescriptionTx ignoré — mode simulation');
    return null;
  }
  try {
    const admin = getAdminKeypair();
    const doctorPubkey = new PublicKey(doctorPubkeyStr);
    const [doctorRolePDA] = deriveEntityRolePDA(doctorPubkey);
    const [patientPDA] = derivePatientProfilePDA(patientIdHash);
    const [prescriptionPDA] = derivePrescriptionPDA(patientPDA, rxHash);

    // add_prescription(patient_id_hash, rx_hash, pointer_hash)
    const data = Buffer.concat([DISC.add_prescription, patientIdHash, rxHash, pointerHash]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: admin.publicKey,   isSigner: true,  isWritable: true  },
        { pubkey: doctorPubkey,      isSigner: true,  isWritable: false },
        { pubkey: doctorRolePDA,     isSigner: false, isWritable: false },
        { pubkey: patientPDA,        isSigner: false, isWritable: false },
        { pubkey: prescriptionPDA,   isSigner: false, isWritable: true  },
        { pubkey: SYSTEM_PROGRAM,    isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    return buildPartialTx(tx);
  } catch (err) {
    logger.error('[Solana] buildAddPrescriptionTx error', err);
    return null;
  }
}

// ── issue_qr_token ────────────────────────────────────────────────────────────

export async function buildIssueQrTokenTx(
  prescriptionPDA: PublicKey,
  tokenHash: Buffer,
  doctorPubkeyStr: string,
): Promise<string | null> {
  if (!isSolanaConfigured()) {
    logger.warn('[Solana] buildIssueQrTokenTx ignoré — mode simulation');
    return null;
  }
  try {
    const admin = getAdminKeypair();
    const doctorPubkey = new PublicKey(doctorPubkeyStr);
    const [doctorRolePDA] = deriveEntityRolePDA(doctorPubkey);
    const [qrPDA] = deriveQrTokenPDA(prescriptionPDA, tokenHash);

    // issue_qr_token(token_hash: [u8;32])
    const data = Buffer.concat([DISC.issue_qr_token, tokenHash]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: admin.publicKey, isSigner: true,  isWritable: true  },
        { pubkey: doctorPubkey,    isSigner: true,  isWritable: false },
        { pubkey: doctorRolePDA,   isSigner: false, isWritable: false },
        { pubkey: prescriptionPDA, isSigner: false, isWritable: true  },
        { pubkey: qrPDA,           isSigner: false, isWritable: true  },
        { pubkey: SYSTEM_PROGRAM,  isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    return buildPartialTx(tx);
  } catch (err) {
    logger.error('[Solana] buildIssueQrTokenTx error', err);
    return null;
  }
}

// ── dispense_with_qr ──────────────────────────────────────────────────────────

export async function buildDispenseWithQrTx(
  qrTokenPDA: PublicKey,
  dispenseHash: Buffer,
  pharmacistPubkeyStr: string,
): Promise<string | null> {
  if (!isSolanaConfigured()) {
    logger.warn('[Solana] buildDispenseWithQrTx ignoré — mode simulation');
    return null;
  }
  try {
    const admin = getAdminKeypair();
    const pharmacistPubkey = new PublicKey(pharmacistPubkeyStr);
    const [pharmacistRolePDA] = deriveEntityRolePDA(pharmacistPubkey);

    // On doit retrouver la prescriptionPDA depuis le compte qrToken on-chain
    const conn = getConnection();
    const qrInfo = await conn.getAccountInfo(qrTokenPDA);
    if (!qrInfo) throw new Error('QrToken PDA introuvable on-chain');
    // prescriptionPDA = bytes 8..40 du compte QrToken (après discriminator)
    const prescriptionPDA = new PublicKey(qrInfo.data.slice(8, 40));
    const [dispensePDA] = deriveDispensePDA(prescriptionPDA, pharmacistPubkey);

    // dispense_with_qr(dispense_hash: [u8;32])
    const data = Buffer.concat([DISC.dispense_with_qr, dispenseHash]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: admin.publicKey,    isSigner: true,  isWritable: true  },
        { pubkey: pharmacistPubkey,   isSigner: true,  isWritable: false },
        { pubkey: pharmacistRolePDA,  isSigner: false, isWritable: false },
        { pubkey: qrTokenPDA,         isSigner: false, isWritable: true  },
        { pubkey: dispensePDA,        isSigner: false, isWritable: true  },
        { pubkey: SYSTEM_PROGRAM,     isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    return buildPartialTx(tx);
  } catch (err) {
    logger.error('[Solana] buildDispenseWithQrTx error', err);
    return null;
  }
}

// ── create_invoice ────────────────────────────────────────────────────────────

export async function buildCreateInvoiceTx(
  patientIdHash: Buffer,
  invoiceHash: Buffer,
  amount: number,
  currencyCode: string,
  hospitalPubkeyStr: string,
): Promise<string | null> {
  if (!isSolanaConfigured()) {
    logger.warn('[Solana] buildCreateInvoiceTx ignoré — mode simulation');
    return null;
  }
  try {
    const admin = getAdminKeypair();
    const hospitalPubkey = new PublicKey(hospitalPubkeyStr);
    const [hospitalRolePDA] = deriveEntityRolePDA(hospitalPubkey);
    const [patientPDA] = derivePatientProfilePDA(patientIdHash);
    const [invoicePDA] = deriveInvoicePDA(patientPDA, invoiceHash);

    const currencyBytes = Buffer.alloc(3);
    Buffer.from(currencyCode.slice(0, 3).toUpperCase()).copy(currencyBytes);

    // create_invoice(patient_id_hash, invoice_hash, amount: u64, currency_code: [u8;3])
    const data = Buffer.concat([
      DISC.create_invoice,
      patientIdHash,
      invoiceHash,
      writeU64LE(amount),
      currencyBytes,
    ]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: admin.publicKey,  isSigner: true,  isWritable: true  },
        { pubkey: hospitalPubkey,   isSigner: true,  isWritable: false },
        { pubkey: hospitalRolePDA,  isSigner: false, isWritable: false },
        { pubkey: patientPDA,       isSigner: false, isWritable: false },
        { pubkey: invoicePDA,       isSigner: false, isWritable: true  },
        { pubkey: SYSTEM_PROGRAM,   isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    return buildPartialTx(tx);
  } catch (err) {
    logger.error('[Solana] buildCreateInvoiceTx error', err);
    return null;
  }
}

// ── auto_or_pending_claim ─────────────────────────────────────────────────────

export async function buildAutoOrPendingClaimTx(
  invoicePDA: PublicKey,
  insurerPubkeyStr: string,
  hospitalPubkeyStr: string,
): Promise<string | null> {
  if (!isSolanaConfigured()) {
    logger.warn('[Solana] buildAutoOrPendingClaimTx ignoré — mode simulation');
    return null;
  }
  try {
    const admin = getAdminKeypair();
    const hospitalPubkey = new PublicKey(hospitalPubkeyStr);
    const insurerPubkey = new PublicKey(insurerPubkeyStr);
    const [hospitalRolePDA] = deriveEntityRolePDA(hospitalPubkey);
    const [configPDA] = deriveConfigPDA();
    const [claimPDA] = deriveClaimPDA(invoicePDA, insurerPubkey);

    // auto_or_pending_claim(insurer: Pubkey)
    const data = Buffer.concat([DISC.auto_or_pending_claim, writePubkey(insurerPubkey)]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: admin.publicKey,  isSigner: true,  isWritable: true  },
        { pubkey: hospitalPubkey,   isSigner: true,  isWritable: false },
        { pubkey: hospitalRolePDA,  isSigner: false, isWritable: false },
        { pubkey: configPDA,        isSigner: false, isWritable: false },
        { pubkey: invoicePDA,       isSigner: false, isWritable: true  },
        { pubkey: claimPDA,         isSigner: false, isWritable: true  },
        { pubkey: insurerPubkey,    isSigner: false, isWritable: false },
        { pubkey: SYSTEM_PROGRAM,   isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    return buildPartialTx(tx);
  } catch (err) {
    logger.error('[Solana] buildAutoOrPendingClaimTx error', err);
    return null;
  }
}

// ── insurer_decide_claim ──────────────────────────────────────────────────────

export async function buildInsurerDecideClaimTx(
  invoicePDA: PublicKey,
  insurerPubkeyStr: string,
  approve: boolean,
  reasonCode: number,
): Promise<string | null> {
  if (!isSolanaConfigured()) {
    logger.warn('[Solana] buildInsurerDecideClaimTx ignoré — mode simulation');
    return null;
  }
  try {
    const admin = getAdminKeypair();
    const insurerPubkey = new PublicKey(insurerPubkeyStr);
    const [insurerRolePDA] = deriveEntityRolePDA(insurerPubkey);
    const [claimPDA] = deriveClaimPDA(invoicePDA, insurerPubkey);

    // insurer_decide_claim(approve: bool, reason_code: u16)
    const data = Buffer.concat([
      DISC.insurer_decide_claim,
      writeBool(approve),
      writeU16LE(reasonCode),
    ]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: admin.publicKey, isSigner: true,  isWritable: true  },
        { pubkey: insurerPubkey,   isSigner: true,  isWritable: false },
        { pubkey: insurerRolePDA,  isSigner: false, isWritable: false },
        { pubkey: invoicePDA,      isSigner: false, isWritable: true  },
        { pubkey: claimPDA,        isSigner: false, isWritable: true  },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    return buildPartialTx(tx);
  } catch (err) {
    logger.error('[Solana] buildInsurerDecideClaimTx error', err);
    return null;
  }
}

// ── Read helpers ──────────────────────────────────────────────────────────────

export async function getEntityOnChainState(pubkeyStr: string): Promise<EntityOnChainState> {
  try {
    const pubkey = new PublicKey(pubkeyStr);
    const [rolePDA] = deriveEntityRolePDA(pubkey);
    const info = await getConnection().getAccountInfo(rolePDA);
    if (!info || info.data.length < 42) {
      return {
        exists: false,
        approved: false,
        rolePda: rolePDA.toBase58(),
        status: 'missing',
      };
    }
    // EntityStatus is at offset 8 (discriminator) + 32 (entity pubkey) + 1 (role enum) = 41
    // status: 0=Pending, 1=Approved, 2=Revoked
    const status = info.data[41];
    const normalizedStatus: EntityStatus =
      status === 1 ? 'approved' :
      status === 2 ? 'revoked' :
      'pending';
    return {
      exists: true,
      approved: normalizedStatus === 'approved',
      rolePda: rolePDA.toBase58(),
      status: normalizedStatus,
    };
  } catch {
    return {
      exists: false,
      approved: false,
      rolePda: '',
      status: 'missing',
    };
  }
}

export async function isEntityApproved(pubkeyStr: string): Promise<boolean> {
  const state = await getEntityOnChainState(pubkeyStr);
  return state.approved;
}
