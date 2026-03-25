const { buildContext, ackResponse, sendCallback } = require('../utils/beckn');

async function handleSupport(req, res) {
  const { context, message } = req.body;
  if (!context || !message) return res.status(400).json({ error: 'Invalid request' });

  res.json(ackResponse());

  try {
    const orderId = message.ref_id || message.order_id || message.refid || '';

    const responseContext = buildContext({
      action: 'on_support',
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
      support: {
        ref_id: orderId,
        phone: '+919999999999',
        email: 'support@flypnow.in',
        url: 'https://ondc.flypnow.in/support',
      },
    };

    await sendCallback(context.bap_uri, 'on_support', responseContext, responseMessage);
  } catch (err) {
    console.error('[support] Error:', err.message);
  }
}

module.exports = { handleSupport };
