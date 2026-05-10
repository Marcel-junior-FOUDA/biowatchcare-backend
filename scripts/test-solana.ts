import 'dotenv/config';
import crypto from 'crypto';
import { registerEntity, approveEntity, isSolanaConfigured } from '../src/services/solana.service';

async function main() {
  console.log('Solana configuré:', isSolanaConfigured());

  // Utiliser une vraie clé de test (doctor@biowatchcare.app)
  // On utilise une clé Ed25519 quelconque pour tester
  const { Keypair } = await import('@solana/web3.js');
  const testKp = Keypair.generate();
  const testPubkey = testKp.publicKey.toBase58();
  console.log('Test pubkey:', testPubkey);

  const metadataHash = crypto.createHash('sha256').update(`test-id:doctor:test@biowatchcare.app`).digest();

  console.log('\n→ register_entity...');
  const sig1 = await registerEntity(testPubkey, 'doctor', metadataHash);
  console.log('  sig:', sig1 ?? 'ECHEC');

  if (sig1) {
    console.log('\n→ approve_entity...');
    const sig2 = await approveEntity(testPubkey);
    console.log('  sig:', sig2 ?? 'ECHEC');
    console.log('\n✅ Transactions on-chain réelles envoyées avec succès !');
    console.log('   Explorer: https://explorer.solana.com/tx/' + sig1 + '?cluster=devnet');
  }
}

main().catch((err) => {
  console.error('Erreur:', err);
  process.exit(1);
});
