/**
 * Generate Ed25519 key pair for ONDC signing.
 * Run once: node scripts/generateKeys.js
 * Copy the output into your .env file.
 */
const { generateKeyPair } = require('../src/crypto/keys');

const keys = generateKeyPair();

console.log('\n✅ Ed25519 Key Pair Generated\n');
console.log('Add these to your .env file:\n');
console.log(`SIGNING_PRIVATE_KEY=${keys.privateKey}`);
console.log(`SIGNING_PUBLIC_KEY=${keys.publicKey}`);
console.log(`ENCRYPTION_PRIVATE_KEY=${keys.privateKey}`);
console.log(`ENCRYPTION_PUBLIC_KEY=${keys.publicKey}`);
console.log('\n⚠️  Keep SIGNING_PRIVATE_KEY secret — never commit it to git.\n');
console.log('📋 Copy SIGNING_PUBLIC_KEY to register it with ONDC portal under:\n');
console.log('   Business Information → Network Settings → Signing Key\n');
