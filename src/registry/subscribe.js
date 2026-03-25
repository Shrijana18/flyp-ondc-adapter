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

  const baseUrl = `https://${subscriberId}`;
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
          legal_entity_name: process.env.LEGAL_ENTITY_NAME || 'FLYP NOW',
          business_address: process.env.BUSINESS_ADDRESS || 'Mumbai, Maharashtra, India',
          city_code: [process.env.DEFAULT_CITY_CODE || 'std:080'],
          gst_no: process.env.GST_NO || '27AAPFU0939F1ZV',
        },
        pan: {
          name_as_per_pan: process.env.LEGAL_ENTITY_NAME || 'FLYP NOW',
          pan_no: process.env.PAN_NO || 'AAPFU0939F',
          date_of_incorporation: process.env.DATE_OF_INCORPORATION || '2020-01-01',
        },
        name_of_authorised_signatory: process.env.AUTHORISED_SIGNATORY || 'Shri Janakwade',
        address_of_authorised_signatory: process.env.BUSINESS_ADDRESS || 'Mumbai, Maharashtra, India',
        email_id: process.env.ONDC_EMAIL || 'ondc@flypnow.in',
        mobile_no: parseInt(process.env.ONDC_MOBILE || '9000000000'),
        country: 'IND',
        subscriber_id: subscriberId,
        unique_key_id: uniqueKeyId,
        callback_url: baseUrl,
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
    console.log('[registry] on_subscribe challenge received for:', subscriber_id, '| challenge:', challenge);

    if (!challenge) {
      return res.status(400).json({ error: 'challenge missing' });
    }

    return res.json({ answer: challenge });
  } catch (err) {
    console.error('[registry] on_subscribe error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { registerWithRegistry, handleOnSubscribe };
