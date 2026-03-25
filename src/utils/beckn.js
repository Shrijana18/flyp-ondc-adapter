const { v4: uuidv4 } = require('uuid');

const SUBSCRIBER_ID = () => process.env.SUBSCRIBER_ID || 'ondc.flypnow.in';
const SUBSCRIBER_URI = () => process.env.SUBSCRIBER_URI || '/ondc';

/**
 * Build a standard Beckn context object for responses
 */
function buildContext({ action, domain, transactionId, messageId, city, country, version }) {
  return {
    domain: domain || 'ONDC:RET10',
    action,
    country: country || process.env.DEFAULT_COUNTRY_CODE || 'IND',
    city: city || process.env.DEFAULT_CITY_CODE || 'std:080',
    core_version: version || '1.2.0',
    bap_id: undefined,
    bap_uri: undefined,
    bpp_id: SUBSCRIBER_ID(),
    bpp_uri: `https://${SUBSCRIBER_ID()}${SUBSCRIBER_URI()}`,
    transaction_id: transactionId || uuidv4(),
    message_id: messageId || uuidv4(),
    timestamp: new Date().toISOString(),
    ttl: process.env.DEFAULT_TTL || 'PT30S',
  };
}

/**
 * Build a standard ACK response (synchronous)
 */
function ackResponse() {
  return { message: { ack: { status: 'ACK' } } };
}

/**
 * Build a standard NACK response with error
 */
function nackResponse(code, message) {
  return {
    message: { ack: { status: 'NACK' } },
    error: { type: 'DOMAIN-ERROR', code: String(code), message },
  };
}

/**
 * Send async callback to BAP (Buyer App)
 * ONDC is async: we ACK immediately, then POST the full response to bap_uri/action
 */
async function sendCallback(bapUri, action, context, message) {
  const axios = require('axios');
  const { signRequest } = require('../crypto/signing');

  const payload = { context: { ...context, action }, message };
  const body = JSON.stringify(payload);
  const authHeader = signRequest(body);

  try {
    const res = await axios.post(`${bapUri}/${action}`, payload, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      timeout: 10000,
    });
    console.log(`[beckn] Callback ${action} → ${bapUri} : ${res.status}`);
  } catch (err) {
    console.error(`[beckn] Callback ${action} failed:`, err.message);
  }
}

module.exports = { buildContext, ackResponse, nackResponse, sendCallback };
