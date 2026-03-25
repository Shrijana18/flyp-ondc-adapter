const nacl = require('tweetnacl');

/**
 * Load Ed25519 signing keys from environment variables.
 * Keys are stored as base64 strings in .env
 */
function getSigningKeys() {
  const privateKeyB64 = process.env.SIGNING_PRIVATE_KEY;
  const publicKeyB64 = process.env.SIGNING_PUBLIC_KEY;

  if (!privateKeyB64 || !publicKeyB64) {
    throw new Error('SIGNING_PRIVATE_KEY and SIGNING_PUBLIC_KEY must be set in .env');
  }

  return {
    privateKey: Buffer.from(privateKeyB64, 'base64'),
    publicKey: Buffer.from(publicKeyB64, 'base64'),
  };
}

/**
 * Generate a new Ed25519 key pair and print base64 values.
 * Run once with: node scripts/generateKeys.js
 */
function generateKeyPair() {
  const keyPair = nacl.sign.keyPair();
  return {
    privateKey: Buffer.from(keyPair.secretKey).toString('base64'),
    publicKey: Buffer.from(keyPair.publicKey).toString('base64'),
  };
}

module.exports = { getSigningKeys, generateKeyPair };
