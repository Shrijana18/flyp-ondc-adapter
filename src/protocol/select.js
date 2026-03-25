const { getDb } = require('../firebase/admin');
const { buildContext, ackResponse, sendCallback } = require('../utils/beckn');

/**
 * Handle POST /ondc/select
 * Buyer selects specific items + quantities from a provider.
 * We check stock and return a quote.
 */
async function handleSelect(req, res) {
  const { context, message } = req.body;
  if (!context || !message) return res.status(400).json({ error: 'Invalid request' });

  res.json(ackResponse());

  try {
    const db = getDb();
    const order = message.order || {};
    const providerId = order.provider?.id;
    const items = order.items || [];

    if (!providerId || items.length === 0) {
      return sendErrorCallback(context, 'on_select', '30004', 'Provider or items missing');
    }

    const quoteItems = [];
    let breakupItems = [];
    let orderTotal = 0;
    const fulfillmentErrors = [];

    for (const item of items) {
      const productSnap = await db
        .collection('stores').doc(providerId)
        .collection('products').doc(item.id)
        .get();

      if (!productSnap.exists) {
        fulfillmentErrors.push(`Item ${item.id} not found`);
        continue;
      }

      const product = { id: productSnap.id, ...productSnap.data() };
      const requestedQty = item.quantity?.count || 1;
      const availableQty = Math.max(0, (product.quantity || 0) - (product.reservedQuantity || 0));

      if (availableQty < requestedQty) {
        fulfillmentErrors.push(`Insufficient stock for ${product.name || item.id}`);
        continue;
      }

      const unitPrice = product.sellingPrice || product.price || 0;
      const lineTotal = unitPrice * requestedQty;
      orderTotal += lineTotal;

      quoteItems.push({
        id: item.id,
        quantity: { count: requestedQty },
        fulfillment_id: 'f1',
      });

      breakupItems.push(
        { '@ondc/org/item_id': item.id, '@ondc/org/item_quantity': { count: requestedQty }, title: product.productName || product.name, '@ondc/org/title_type': 'item', price: { currency: 'INR', value: String(lineTotal) } },
        { '@ondc/org/item_id': item.id, title: 'Tax', '@ondc/org/title_type': 'tax', price: { currency: 'INR', value: '0.00' } }
      );
    }

    if (fulfillmentErrors.length > 0 && quoteItems.length === 0) {
      return sendErrorCallback(context, 'on_select', '40002', fulfillmentErrors.join('; '));
    }

    const deliveryCharge = 0;
    breakupItems.push({
      title: 'Delivery charges',
      '@ondc/org/title_type': 'delivery',
      price: { currency: 'INR', value: String(deliveryCharge) },
    });

    const responseContext = buildContext({
      action: 'on_select',
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
      order: {
        provider: { id: providerId, locations: [{ id: 'l1' }] },
        items: quoteItems,
        fulfillments: [{ id: 'f1', type: 'Delivery', tracking: false }],
        quote: {
          price: { currency: 'INR', value: String(orderTotal + deliveryCharge) },
          breakup: breakupItems,
          ttl: 'PT15M',
        },
      },
    };

    await sendCallback(context.bap_uri, 'on_select', responseContext, responseMessage);
  } catch (err) {
    console.error('[select] Error:', err.message);
  }
}

async function sendErrorCallback(context, action, code, message) {
  const { buildContext, sendCallback } = require('../utils/beckn');
  const responseContext = buildContext({
    action,
    domain: context.domain,
    transactionId: context.transaction_id,
    messageId: context.message_id,
    city: context.city,
    country: context.country,
    version: context.core_version,
  });
  responseContext.bap_id = context.bap_id;
  responseContext.bap_uri = context.bap_uri;

  await sendCallback(context.bap_uri, action, responseContext, {
    error: { type: 'DOMAIN-ERROR', code, message },
  });
}

module.exports = { handleSelect };
