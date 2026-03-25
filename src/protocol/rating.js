const { buildContext, ackResponse, sendCallback } = require('../utils/beckn');

async function handleRating(req, res) {
  const { context, message } = req.body;
  if (!context || !message) return res.status(400).json({ error: 'Invalid request' });

  res.json(ackResponse());

  try {
    const responseContext = buildContext({
      action: 'on_rating',
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
      feedback_form: {
        form: { url: 'https://ondc.flypnow.in/feedback', mime_type: 'text/html' },
        required: false,
      },
    };

    await sendCallback(context.bap_uri, 'on_rating', responseContext, responseMessage);
  } catch (err) {
    console.error('[rating] Error:', err.message);
  }
}

module.exports = { handleRating };
