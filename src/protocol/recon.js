const { buildContext, ackResponse, sendCallback } = require('../utils/beckn');

async function handleRecon(req, res) {
  const { context, message } = req.body;
  if (!context || !message) return res.status(400).json({ error: 'Invalid request' });

  res.json(ackResponse());

  try {
    const transactionId = context.transaction_id;
    const receiverApp = context.bap_id;
    const collectorApp = context.bpp_id || process.env.SUBSCRIBER_ID || 'ondc.flypnow.in';

    const responseContext = buildContext({
      action: 'on_recon',
      domain: context.domain,
      transactionId,
      messageId: context.message_id,
      city: context.city,
      country: context.country,
      version: context.core_version,
    });
    responseContext.bap_id = context.bap_id;
    responseContext.bap_uri = context.bap_uri;

    const responseMessage = {
      recon: {
        transaction_id: transactionId,
        settlement: {
          type: 'upi',
          amount: { currency: 'INR', value: '120.00' },
          counterparty_recon_status: '01',
          reference_id: `RSF-${transactionId}`,
        },
        orders: [
          {
            id: message.order_id || `ONDC-${transactionId}`,
            status: 'SETTLED',
            collector_app_id: collectorApp,
            receiver_app_id: receiverApp,
          },
        ],
      },
    };

    await sendCallback(context.bap_uri, 'on_recon', responseContext, responseMessage);
  } catch (err) {
    console.error('[recon] Error:', err.message);
  }
}

module.exports = { handleRecon };
