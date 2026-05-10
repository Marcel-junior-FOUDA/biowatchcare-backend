/**
 * Génère une keypair Solana admin et l'alimente en SOL devnet via airdrop.
 * Usage : npx ts-node scripts/gen-admin-keypair.ts
 */
import 'dotenv/config';
import { Keypair, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const keypair = Keypair.generate();
  const privateKeyArray = Array.from(keypair.secretKey);
  const publicKey = keypair.publicKey.toBase58();

  console.log('\n=== Keypair admin Solana générée ===');
  console.log(`Public key  : ${publicKey}`);
  console.log(`\nAjoute ceci dans ton .env :`);
  console.log(`SOLANA_ADMIN_PRIVATE_KEY=${JSON.stringify(privateKeyArray)}`);

  // Sauvegarder dans un fichier local (ne pas committer)
  const outPath = path.join(__dirname, '../.solana-admin-keypair.json');
  fs.writeFileSync(outPath, JSON.stringify({ publicKey, secretKey: privateKeyArray }, null, 2));
  console.log(`\nKeypair sauvegardée dans : .solana-admin-keypair.json (ne pas committer)`);

  // Airdrop sur devnet
  const rpcUrl = process.env['SOLANA_RPC_URL'] ?? 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');

  console.log('\nDemande d\'airdrop 2 SOL sur devnet...');
  try {
    const sig = await connection.requestAirdrop(keypair.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, 'confirmed');
    const balance = await connection.getBalance(keypair.publicKey);
    console.log(`✅ Airdrop reçu. Balance : ${balance / LAMPORTS_PER_SOL} SOL`);
  } catch (err) {
    console.warn('⚠ Airdrop échoué (rate limit ou réseau) — réessaie manuellement :');
    console.warn(`  solana airdrop 2 ${publicKey} --url devnet`);
  }

  console.log('\n⚠  Mets à jour ton .env MAINTENANT avec SOLANA_ADMIN_PRIVATE_KEY ci-dessus.');
}

main().catch(console.error);
