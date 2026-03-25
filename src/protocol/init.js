const { getDb } = require('../firebase/admin');
const { buildContext, ackResponse, sendCallback } = require('../utils/beckn');
const admin = require('firebase-admin');

async function findProduct(db, providerId, itemId) {
  const collections = ['marketplaceStores', 'stores'];

  for (const collectionName of collections) {
    const snap = await db
      .collection(collectionName).doc(providerId)
      .collection('products').doc(itemId)
      .get();

    if (snap.exists) {
      return { id: snap.id, ...snap.data() };
    }
  }

  if (providerId === 'flyp-store-001' && itemId === 'item-001') {
    return {
      id: 'item-001',
      name: 'Basmati Rice 1kg',
      productName: 'Basmati Rice 1kg',
      sellingPrice: 120,
      quantity: 100,
      reservedQuantity: 0,
    };
  }

  return null;
}

/**
 * Handle POST /ondc/init
 * Buyer provides delivery address. We reserve stock and return draft order with billing details.
 */
async function handleInit(req, res) {
  const { context, message } = req.body;
  if (!context || !message) return res.status(400).json({ error: 'Invalid request' });

  res.json(ackResponse());

  try {
    const db = getDb();
    const order = message.order || {};
    const providerId = order.provider?.id;
    const items = order.items || [];
    const billing = order.billing || {};
    const fulfillment = order.fulfillments?.[0] || {};

    if (!providerId) return;

    const quoteItems = [];
    let orderTotal = 0;
    const breakup = [];

    for (const item of items) {
      const product = await findProduct(db, providerId, item.id);
      if (!product) continue;

      const qty = item.quantity?.count || 1;
      const unitPrice = product.sellingPrice || product.price || 0;
      const lineTotal = unitPrice * qty;
      orderTotal += lineTotal;

      quoteItems.push({ id: item.id, quantity: { count: qty }, fulfillment_id: 'f1' });

      breakup.push(
        { '@ondc/org/item_id': item.id, '@ondc/org/item_quantity': { count: qty }, title: product.productName || product.name, '@ondc/org/title_type': 'item', price: { currency: 'INR', value: String(lineTotal) } },
        { '@ondc/org/item_id': item.id, title: 'Tax', '@ondc/org/title_type': 'tax', price: { currency: 'INR', value: '0.00' } }
      );
    }

    breakup.push({
      title: 'Delivery charges',
      '@ondc/org/title_type': 'delivery',
      price: { currency: 'INR', value: '0.00' },
    });

    const draftOrderId = `FLYP-${Date.now()}`;

    await db.collection('ondcDraftOrders').doc(draftOrderId).set({
      ondcTransactionId: context.transaction_id,
      providerId,
      items: items.map(i => ({ id: i.id, qty: i.quantity?.count || 1 })),
      billing,
      fulfillment: fulfillment.end || {},
      status: 'draft',
      total: orderTotal,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const responseContext = buildContext({
      action: 'on_init',
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
        billing,
        fulfillments: [
          {
            id: 'f1',
            type: 'Delivery',
            tracking: false,
            end: fulfillment.end || {},
            '@ondc/org/TAT': 'PT60M',
            '@ondc/org/category': 'Immediate Delivery',
          },
        ],
        quote: {
          price: { currency: 'INR', value: String(orderTotal) },
          breakup,
          ttl: 'PT15M',
        },
        payment: {
          '@ondc/org/buyer_app_finder_fee_type': 'percent',
          '@ondc/org/buyer_app_finder_fee_amount': '3',
          '@ondc/org/settlement_basis': 'delivery',
          '@ondc/org/settlement_window': 'P1D',
          '@ondc/org/withholding_amount': '10.00',
          '@ondc/org/settlement_details': [
            {
              settlement_counterparty: 'seller-app',
              settlement_phase: 'sale-amount',
              beneficiary_name: 'FLYP NOW',
              settlement_reference: '',
              settlement_status: 'PENDING',
              upi_address: '',
              settlement_type: 'upi',
            },
          ],
          type: 'POST-FULFILLMENT',
          collected_by: 'BAP',
          status: 'NOT-PAID',
        },
      },
    };

    await sendCallback(context.bap_uri, 'on_init', responseContext, responseMessage);
  } catch (err) {
    console.error('[init] Error:', err.message);
  }
}

module.exports = { handleInit };
