const { searchCatalog } = require('../catalog/catalogBuilder');
const { buildContext, ackResponse, sendCallback } = require('../utils/beckn');

/**
 * Handle POST /ondc/search
 * - ACK immediately
 * - Build catalog response async
 * - POST /on_search to bap_uri
 */
async function handleSearch(req, res) {
  const { context, message } = req.body;
  if (!context || !message) return res.status(400).json({ error: 'Invalid request' });

  res.json(ackResponse());

  try {
    const intent = message.intent || {};
    const query = intent.item?.descriptor?.name || '';
    const category = intent.category?.descriptor?.name || intent.item?.category_id || '';
    const city = context.city || '';

    const providers = await searchCatalog({ query, category, city });

    const responseContext = buildContext({
      action: 'on_search',
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
      catalog: {
        'bpp/descriptor': {
          name: 'FLYP NOW Network',
          short_desc: 'Supply Chain OS — Retail, Distribution, Manufacturing',
          images: [{ url: 'https://flypnow.in/logo.png' }],
        },
        'bpp/fulfillments': [{ id: 'f1', type: 'Delivery' }],
        'bpp/providers': providers,
      },
    };

    await sendCallback(context.bap_uri, 'on_search', responseContext, responseMessage);
  } catch (err) {
    console.error('[search] Error building response:', err.message);
  }
}

module.exports = { handleSearch };
