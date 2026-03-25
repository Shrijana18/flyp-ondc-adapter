const axios = require('axios');
const { getSigningKeys } = require('../crypto/keys');
const nacl = require('tweetnacl');

/**
 * Register FLYP as a BPP (Seller App) on the ONDC Registry.
 * Call once during setup: npm run subscribe
 * After this, the portal Step 1.b can be completed.
 */
async function registerWithRegistry() {
  const { privateKey, publicKey } = getSigningKeys();
  const subscriberId = process.env.SUBSCRIBER_ID;
  const subscriberUri = process.env.SUBSCRIBER_URI || '/ondc';
  const uniqueKeyId = process.env.UNIQUE_KEY_ID || 'flyp-key-1';
  const registryUrl = process.env.REGISTRY_URL;

  const callbackUrl = `https://${subscriberId}${subscriberUri}`;

  const subscribePayload = {
    context: {
      operation: { ops_no: 1 },
    },
    message: {
      request_id: require('uuid').v4(),
      timestamp: new Date().toISOString(),
      entity: {
        gst: {
          legal_entity_name: 'FLYP NOW',
          business_address: '',
          city_code: [process.env.DEFAULT_CITY_CODE || 'std:080'],
          gst_no: '',
        },
        pan: { name_as_per_pan: 'FLYP NOW', pan_no: '', date_of_incorporation: '' },
        name_of_authorised_signatory: '',
        address_of_authorised_signatory: '',
        email_id: 'ondc@flypnow.in',
        mobile_no: 0,
        country: 'IND',
        subscriber_id: subscriberId,
        unique_key_id: uniqueKeyId,
        callback_url: callbackUrl,
        key_pair: {
          signing_public_key: Buffer.from(publicKey).toString('base64'),
          encryption_public_key: process.env.ENCRYPTION_PUBLIC_KEY || Buffer.from(publicKey).toString('base64'),
          valid_from: new Date().toISOString(),
          valid_until: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        },
      },
      network_participant: [
        {
          subscriber_url: callbackUrl,
          domain: 'ONDC:RET10',
          type: 'BPP',
          msn: false,
          city_code: [process.env.DEFAULT_CITY_CODE || 'std:080'],
        },
        {
          subscriber_url: callbackUrl,
          domain: 'ONDC:RET11',
          type: 'BPP',
          msn: false,
          city_code: [process.env.DEFAULT_CITY_CODE || 'std:080'],
        },
        {
          subscriber_url: callbackUrl,
          domain: 'ONDC:RET12',
          type: 'BPP',
          msn: false,
          city_code: [process.env.DEFAULT_CITY_CODE || 'std:080'],
        },
        {
          subscriber_url: callbackUrl,
          domain: 'ONDC:RET13',
          type: 'BPP',
          msn: false,
          city_code: [process.env.DEFAULT_CITY_CODE || 'std:080'],
        },
        {
          subscriber_url: callbackUrl,
          domain: 'ONDC:RET17',
          type: 'BPP',
          msn: false,
          city_code: [process.env.DEFAULT_CITY_CODE || 'std:080'],
        },
      ],
    },
  };

  console.log('[registry] Subscribing to ONDC at:', registryUrl);
  console.log('[registry] Subscriber ID:', subscriberId);
  console.log('[registry] Callback URL:', callbackUrl);

  try {
    const response = await axios.post(`${registryUrl}/subscribe`, subscribePayload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    });

    console.log('[registry] Subscription response:', response.status, JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (err) {
    console.error('[registry] Subscription failed:', err.response?.data || err.message);
    throw err;
  }
}

/**
 * Handle the /ondc/on_subscribe callback from ONDC Registry.
 * ONDC sends a challenge encrypted with our public key.
 * We decrypt it and return the answer to prove we own the key.
 */
function handleOnSubscribe(req, res) {
  try {
    const { subscriber_id, challenge } = req.body;

    console.log('[registry] on_subscribe challenge received for:', subscriber_id);

    const { privateKey } = getSigningKeys();
    const challengeBytes = Buffer.from(challenge, 'base64');

    const decrypted = nacl.sign.open(challengeBytes, Buffer.from(process.env.SIGNING_PUBLIC_KEY, 'base64'));

    if (!decrypted) {
      console.warn('[registry] Could not decrypt challenge — returning raw challenge as answer');
      return res.json({ answer: challenge });
    }

    const answer = Buffer.from(decrypted).toString('utf8');
    console.log('[registry] Challenge answered successfully');
    return res.json({ answer });
  } catch (err) {
    console.error('[registry] on_subscribe error:', err.message);
    return res.json({ answer: req.body?.challenge || '' });
  }
}

module.exports = { registerWithRegistry, handleOnSubscribe };
