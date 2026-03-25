const { buildContext, ackResponse, sendCallback } = require('../utils/beckn');

async function handleTrack(req, res) {
  const { context, message } = req.body;
  if (!context || !message) return res.status(400).json({ error: 'Invalid request' });

  res.json(ackResponse());

  try {
    const orderId = message.order_id || 'unknown';

    const responseContext = buildContext({
      action: 'on_track',
      domain: context.domain,
      transactionId: context.transaction_id,
      messageId: context.message_id,
      city: context.city,
      country: context.country,
      version: context.core_version,
    });
    responseContext.bap_id = context.bap_id;
    responseContext.bap_uri = context.bap_uri;

    const responseMessage = {
      tracking: {
        id: orderId,
        url: `https://ondc.flypnow.in/track/${orderId}`,
        status: 'active',
      },
    };

    await sendCallback(context.bap_uri, 'on_track', responseContext, responseMessage);
  } catch (err) {
    console.error('[track] Error:', err.message);
  }
}

module.exports = { handleTrack };
