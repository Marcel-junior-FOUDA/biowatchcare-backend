import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import {
  AnchorProvider,
  Program,
  Wallet,
  BN,
} from '@coral-xyz/anchor';
import { config } from '../config';
import { logger } from '../logger';
import idl from './biowatchcare.idl.json';
import type { Idl } from '@coral-xyz/anchor';

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

// ── Singletons ────────────────────────────────────────────────────────────────

let _connection: Connection;
let _adminKeypair: Keypair;
let _provider: AnchorProvider;
let _program: Program;

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
      skipPreflight: false,
    });
  }
  return _provider;
}

function getProgram(): Program {
  if (!_program) {
    _program = new Program(idl as unknown as Idl, getProvider());
  }
  return _program;
}

export function isSolanaConfigured(): boolean {
  return config.solana.adminPrivateKey.length > 0;
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

// ── Role mapping ─────────────────────────────────────────────────────────────

function roleVariant(role: string): Record<string, object> {
  switch (role) {
    case 'hospital_admin': return { hospital: {} };
    case 'insurer':        return { insurer: {} };
    case 'doctor':         return { doctor: {} };
    case 'pharmacist':     return { pharmacist: {} };
    default: throw new Error(`Rôle inconnu pour Solana : ${role}`);
  }
}

// ── Partial-signature helpers ─────────────────────────────────────────────────

/**
 * Builds a transaction, admin-signs it, and returns the base64-encoded
 * partially-signed transaction for the Flutter client to co-sign and broadcast.
 */
async function buildPartialTx(
  instruction: Transaction,
  entityKeypairOrPubkey: PublicKey,
): Promise<string> {
  const connection = getConnection();
  const admin = getAdminKeypair();
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash('confirmed');

  instruction.recentBlockhash = blockhash;
  instruction.lastValidBlockHeight = lastValidBlockHeight;
  instruction.feePayer = admin.publicKey;

  // Admin signs, entity signature will be added by Flutter
  instruction.partialSign(admin);

  // Return base64-encoded partially-signed transaction
  const serialized = instruction.serialize({ requireAllSignatures: false });
  return serialized.toString('base64');
}

// ── On-chain write operations ─────────────────────────────────────────────────

/**
 * register_entity — admin-only, no co-signature needed.
 * Called when a user sets their Solana key for the first time.
 */
export async function registerEntity(
  entityPubkeyStr: string,
  role: string,
  metadataHash: Buffer,
): Promise<string | null> {
  if (!isSolanaConfigured()) {
    logger.warn('[Solana] registerEntity ignoré — mode simulation');
    return null;
  }
  try {
    const program = getProgram();
    const admin = getAdminKeypair();
    const entityPubkey = new PublicKey(entityPubkeyStr);
    const [configPDA] = deriveConfigPDA();
    const [rolePDA] = deriveEntityRolePDA(entityPubkey);

    const sig = await (program.methods as any)
      .registerEntity(roleVariant(role), entityPubkey, [...metadataHash])
      .accounts({
        admin: admin.publicKey,
        config: configPDA,
        roleAccount: rolePDA,
        systemProgram: '11111111111111111111111111111111',
      })
      .signers([admin])
      .rpc();

    logger.info(`[Solana] registerEntity OK — ${entityPubkeyStr} sig=${sig}`);
    return sig;
  } catch (err) {
    logger.error('[Solana] registerEntity error', err);
    return null;
  }
}

/**
 * approve_entity — admin-only.
 * Called after register_entity to approve the entity on-chain.
 */
export async function approveEntity(
  entityPubkeyStr: string,
): Promise<string | null> {
  if (!isSolanaConfigured()) {
    logger.warn('[Solana] approveEntity ignoré — mode simulation');
    return null;
  }
  try {
    const program = getProgram();
    const admin = getAdminKeypair();
    const entityPubkey = new PublicKey(entityPubkeyStr);
    const [configPDA] = deriveConfigPDA();
    const [rolePDA] = deriveEntityRolePDA(entityPubkey);

    const sig = await (program.methods as any)
      .approveEntity()
      .accounts({
        admin: admin.publicKey,
        config: configPDA,
        roleAccount: rolePDA,
      })
      .signers([admin])
      .rpc();

    logger.info(`[Solana] approveEntity OK — ${entityPubkeyStr} sig=${sig}`);
    return sig;
  } catch (err) {
    logger.error('[Solana] approveEntity error', err);
    return null;
  }
}

/**
 * create_patient_profile — requires admin + staff (hospital/insurer) signature.
 * Returns a base64 partially-signed transaction for Flutter to co-sign.
 */
export async function buildCreatePatientProfileTx(
  patientIdHash: Buffer,
  staffPubkeyStr: string,
): Promise<string | null> {
  if (!isSolanaConfigured()) {
    logger.warn('[Solana] buildCreatePatientProfileTx ignoré — mode simulation');
    return null;
  }
  try {
    const program = getProgram();
    const admin = getAdminKeypair();
    const staffPubkey = new PublicKey(staffPubkeyStr);
    const [configPDA] = deriveConfigPDA();
    const [staffRolePDA] = deriveEntityRolePDA(staffPubkey);
    const [patientPDA] = derivePatientProfilePDA(patientIdHash);

    const ix = await (program.methods as any)
      .createPatientProfile([...patientIdHash])
      .accounts({
        admin: admin.publicKey,
        staff: staffPubkey,
        config: configPDA,
        staffRole: staffRolePDA,
        patient: patientPDA,
        systemProgram: '11111111111111111111111111111111',
      })
      .transaction();

    return buildPartialTx(ix, staffPubkey);
  } catch (err) {
    logger.error('[Solana] buildCreatePatientProfileTx error', err);
    return null;
  }
}

/**
 * add_prescription — requires admin + doctor signature.
 * Returns a base64 partially-signed transaction for Flutter to co-sign.
 */
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
    const program = getProgram();
    const admin = getAdminKeypair();
    const doctorPubkey = new PublicKey(doctorPubkeyStr);
    const [doctorRolePDA] = deriveEntityRolePDA(doctorPubkey);
    const [patientPDA] = derivePatientProfilePDA(patientIdHash);
    const [prescriptionPDA] = derivePrescriptionPDA(patientPDA, rxHash);

    const ix = await (program.methods as any)
      .addPrescription([...patientIdHash], [...rxHash], [...pointerHash])
      .accounts({
        admin: admin.publicKey,
        doctor: doctorPubkey,
        doctorRole: doctorRolePDA,
        patient: patientPDA,
        prescription: prescriptionPDA,
        systemProgram: '11111111111111111111111111111111',
      })
      .transaction();

    return buildPartialTx(ix, doctorPubkey);
  } catch (err) {
    logger.error('[Solana] buildAddPrescriptionTx error', err);
    return null;
  }
}

/**
 * issue_qr_token — requires admin + doctor signature.
 * Returns a base64 partially-signed transaction for Flutter to co-sign.
 */
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
    const program = getProgram();
    const admin = getAdminKeypair();
    const doctorPubkey = new PublicKey(doctorPubkeyStr);
    const [doctorRolePDA] = deriveEntityRolePDA(doctorPubkey);
    const [qrPDA] = deriveQrTokenPDA(prescriptionPDA, tokenHash);

    const ix = await (program.methods as any)
      .issueQrToken([...tokenHash])
      .accounts({
        admin: admin.publicKey,
        doctor: doctorPubkey,
        doctorRole: doctorRolePDA,
        prescription: prescriptionPDA,
        qrToken: qrPDA,
        systemProgram: '11111111111111111111111111111111',
      })
      .transaction();

    return buildPartialTx(ix, doctorPubkey);
  } catch (err) {
    logger.error('[Solana] buildIssueQrTokenTx error', err);
    return null;
  }
}

/**
 * dispense_with_qr — requires admin + pharmacist signature.
 * Returns a base64 partially-signed transaction for Flutter to co-sign.
 */
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
    const program = getProgram();
    const admin = getAdminKeypair();
    const pharmacistPubkey = new PublicKey(pharmacistPubkeyStr);
    const [pharmacistRolePDA] = deriveEntityRolePDA(pharmacistPubkey);
    const qrAccount = await (program.account as any).qrToken.fetch(qrTokenPDA);
    const prescriptionPDA: PublicKey = qrAccount.prescription;
    const [dispensePDA] = deriveDispensePDA(prescriptionPDA, pharmacistPubkey);

    const ix = await (program.methods as any)
      .dispenseWithQr([...dispenseHash])
      .accounts({
        admin: admin.publicKey,
        pharmacist: pharmacistPubkey,
        pharmacistRole: pharmacistRolePDA,
        qrToken: qrTokenPDA,
        dispense: dispensePDA,
        systemProgram: '11111111111111111111111111111111',
      })
      .transaction();

    return buildPartialTx(ix, pharmacistPubkey);
  } catch (err) {
    logger.error('[Solana] buildDispenseWithQrTx error', err);
    return null;
  }
}

/**
 * create_invoice — requires admin + hospital signature.
 * Returns a base64 partially-signed transaction for Flutter to co-sign.
 */
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
    const program = getProgram();
    const admin = getAdminKeypair();
    const hospitalPubkey = new PublicKey(hospitalPubkeyStr);
    const [hospitalRolePDA] = deriveEntityRolePDA(hospitalPubkey);
    const [patientPDA] = derivePatientProfilePDA(patientIdHash);
    const [invoicePDA] = deriveInvoicePDA(patientPDA, invoiceHash);

    const currencyBytes = Buffer.alloc(3);
    currencyBytes.write(currencyCode.slice(0, 3).toUpperCase());

    const ix = await (program.methods as any)
      .createInvoice(
        [...patientIdHash],
        [...invoiceHash],
        new BN(amount),
        [...currencyBytes],
      )
      .accounts({
        admin: admin.publicKey,
        hospital: hospitalPubkey,
        hospitalRole: hospitalRolePDA,
        patient: patientPDA,
        invoice: invoicePDA,
        systemProgram: '11111111111111111111111111111111',
      })
      .transaction();

    return buildPartialTx(ix, hospitalPubkey);
  } catch (err) {
    logger.error('[Solana] buildCreateInvoiceTx error', err);
    return null;
  }
}

/**
 * auto_or_pending_claim — requires admin + hospital signature.
 * Returns a base64 partially-signed transaction for Flutter to co-sign.
 */
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
    const program = getProgram();
    const admin = getAdminKeypair();
    const hospitalPubkey = new PublicKey(hospitalPubkeyStr);
    const insurerPubkey = new PublicKey(insurerPubkeyStr);
    const [hospitalRolePDA] = deriveEntityRolePDA(hospitalPubkey);
    const [configPDA] = deriveConfigPDA();
    const [claimPDA] = deriveClaimPDA(invoicePDA, insurerPubkey);

    const ix = await (program.methods as any)
      .autoOrPendingClaim(insurerPubkey)
      .accounts({
        admin: admin.publicKey,
        hospital: hospitalPubkey,
        hospitalRole: hospitalRolePDA,
        config: configPDA,
        invoice: invoicePDA,
        claim: claimPDA,
        insurer: insurerPubkey,
        systemProgram: '11111111111111111111111111111111',
      })
      .transaction();

    return buildPartialTx(ix, hospitalPubkey);
  } catch (err) {
    logger.error('[Solana] buildAutoOrPendingClaimTx error', err);
    return null;
  }
}

/**
 * insurer_decide_claim — requires admin + insurer signature.
 * Returns a base64 partially-signed transaction for Flutter to co-sign.
 */
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
    const program = getProgram();
    const admin = getAdminKeypair();
    const insurerPubkey = new PublicKey(insurerPubkeyStr);
    const [insurerRolePDA] = deriveEntityRolePDA(insurerPubkey);
    const [claimPDA] = deriveClaimPDA(invoicePDA, insurerPubkey);

    const ix = await (program.methods as any)
      .insurerDecideClaim(approve, reasonCode)
      .accounts({
        admin: admin.publicKey,
        insurer: insurerPubkey,
        insurerRole: insurerRolePDA,
        invoice: invoicePDA,
        claim: claimPDA,
      })
      .transaction();

    return buildPartialTx(ix, insurerPubkey);
  } catch (err) {
    logger.error('[Solana] buildInsurerDecideClaimTx error', err);
    return null;
  }
}

// ── On-chain read operations ──────────────────────────────────────────────────

export async function getEntityRole(
  entityPubkey: PublicKey,
): Promise<{ role: string; status: string; metadataHash: Uint8Array } | null> {
  try {
    const connection = getConnection();
    const [pda] = deriveEntityRolePDA(entityPubkey);
    const accountInfo = await connection.getAccountInfo(pda);
    if (!accountInfo) return null;

    const data = accountInfo.data.slice(8);
    const roleMap: Record<number, string> = {
      0: 'hospital', 1: 'insurer', 2: 'doctor', 3: 'pharmacist',
    };
    const statusMap: Record<number, string> = {
      0: 'pending', 1: 'approved', 2: 'revoked',
    };

    return {
      role:         roleMap[data[0]] ?? 'unknown',
      status:       statusMap[data[1]] ?? 'unknown',
      metadataHash: data.slice(2, 34),
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
