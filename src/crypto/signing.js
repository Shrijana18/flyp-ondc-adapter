const nacl = require('tweetnacl');
const { getSigningKeys } = require('./keys');

/**
 * Sign a Beckn request body using Ed25519.
 * Returns the Authorization header value.
 * ONDC format: Signature keyId="...|...|ed25519",algorithm="ed25519",created="...",expires="...",headers="(created) (expires) digest",signature="..."
 */
function signRequest(body) {
  const { privateKey } = getSigningKeys();
  const subscriberId = process.env.SUBSCRIBER_ID;
  const uniqueKeyId = process.env.UNIQUE_KEY_ID || 'flyp-key-1';

  const created = Math.floor(Date.now() / 1000);
  const expires = created + 3600;

  const digest = computeDigest(body);
  const signingString = `(created): ${created}\n(expires): ${expires}\ndigest: BLAKE-512=${digest}`;

  const messageBytes = Buffer.from(signingString, 'utf8');
  const signature = nacl.sign.detached(messageBytes, privateKey);
  const signatureB64 = Buffer.from(signature).toString('base64');

  return (
    `Signature keyId="${subscriberId}|${uniqueKeyId}|ed25519",` +
    `algorithm="ed25519",` +
    `created="${created}",` +
    `expires="${expires}",` +
    `headers="(created) (expires) digest",` +
    `signature="${signatureB64}"`
  );
}

/**
 * Verify a Beckn request signature from an incoming Authorization header.
 * Returns true if valid, false otherwise.
 */
function verifyRequest(body, authHeader, senderPublicKeyB64) {
  try {
    if (!senderPublicKeyB64) return false;

    const sigMatch = authHeader.match(/signature="([^"]+)"/);
    const createdMatch = authHeader.match(/created="([^"]+)"/);
    const expiresMatch = authHeader.match(/expires="([^"]+)"/);

    if (!sigMatch || !createdMatch || !expiresMatch) return false;

    const created = createdMatch[1];
    const expires = expiresMatch[1];

    if (Date.now() / 1000 > parseInt(expires)) {
      console.warn('[signing] Request expired');
      return false;
    }

    const digest = computeDigest(body);
    const signingString = `(created): ${created}\n(expires): ${expires}\ndigest: BLAKE-512=${digest}`;
    const messageBytes = Buffer.from(signingString, 'utf8');

    const signatureBytes = Buffer.from(sigMatch[1], 'base64');
    const publicKeyBytes = Buffer.from(senderPublicKeyB64, 'base64');

    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
  } catch (err) {
    console.error('[signing] Verification error:', err.message);
    return false;
  }
}

/**
 * Compute BLAKE-512 digest of request body string.
 * ONDC uses BLAKE-512 for the body digest.
 * We approximate with a base64-encoded SHA-512 for now until node-forge BLAKE is wired.
 */
function computeDigest(body) {
  const crypto = require('crypto');
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return crypto.createHash('sha512').update(bodyStr).digest('base64');
}

module.exports = { signRequest, verifyRequest };
