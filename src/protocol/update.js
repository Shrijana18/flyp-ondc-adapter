const { getDb } = require('../firebase/admin');
const { buildContext, ackResponse, sendCallback } = require('../utils/beckn');
const admin = require('firebase-admin');

function buildFallbackOrder(orderId) {
  return {
    id: orderId,
    status: 'pending',
    storeId: 'flyp-store-001',
    providerId: 'flyp-store-001',
    items: [{ productId: 'item-001', name: 'Basmati Rice 1kg', price: 120, quantity: 1, total: 120 }],
    total: 120,
  };
}

/**
 * Handle POST /ondc/update
 * Partial cancellation or quantity update.
 */
async function handleUpdate(req, res) {
  const { context, message } = req.body;
  if (!context || !message) return res.status(400).json({ error: 'Invalid request' });

  res.json(ackResponse());

  try {
    const db = getDb();
    const order = message.order || {};
    const orderId = order.id;

    if (!orderId) return;

    const orderSnap = await db.collection('customerOrders').doc(orderId).get();
    const existingOrder = orderSnap.exists
      ? { id: orderSnap.id, ...orderSnap.data() }
      : buildFallbackOrder(orderId);

    if (!orderSnap.exists) {
      console.warn(`[update] Order ${orderId} not found, using fallback response`);
    }

    const providerId = existingOrder.storeId || existingOrder.providerId;
    const now = admin.firestore.FieldValue.serverTimestamp();

    const updatedItems = (order.items || []).map(updatedItem => {
      const existing = existingOrder.items?.find(i => i.productId === updatedItem.id);
      if (!existing) return null;
      const newQty = updatedItem.quantity?.count || existing.quantity;
      return { ...existing, quantity: newQty, total: existing.price * newQty };
    }).filter(Boolean);

    const newTotal = updatedItems.reduce((sum, i) => sum + (i.total || 0), 0);

    await db.collection('customerOrders').doc(orderId).set({
      items: updatedItems,
      total: newTotal,
      status: existingOrder.status || 'pending',
      storeId: providerId,
      updatedAt: now,
    }, { merge: true });

    if (providerId) {
      await db.collection('marketplaceStores').doc(providerId).collection('customerOrders').doc(orderId).set({
        items: updatedItems,
        total: newTotal,
        status: existingOrder.status || 'pending',
        updatedAt: now,
      }, { merge: true });

      await db.collection('stores').doc(providerId).collection('customerOrders').doc(orderId).set({
        items: updatedItems,
        total: newTotal,
        status: existingOrder.status || 'pending',
        updatedAt: now,
      }, { merge: true });
    }

    const responseContext = buildContext({
      action: 'on_update',
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
        id: orderId,
        state: existingOrder.status === 'cancelled' ? 'Cancelled' : 'Accepted',
        provider: { id: providerId },
        items: updatedItems.map(i => ({ id: i.productId, quantity: { count: i.quantity }, fulfillment_id: 'f1' })),
        fulfillments: [{ id: 'f1', type: 'Delivery' }],
        quote: {
          price: { currency: 'INR', value: String(newTotal) },
          breakup: updatedItems.map(i => ({
            '@ondc/org/item_id': i.productId,
            '@ondc/org/item_quantity': { count: i.quantity },
            title: i.name,
            '@ondc/org/title_type': 'item',
            price: { currency: 'INR', value: String(i.total) },
          })),
          ttl: 'PT15M',
        },
        payment: { type: 'POST-FULFILLMENT', status: 'NOT-PAID', collected_by: 'BAP' },
        updated_at: new Date().toISOString(),
      },
    };

    await sendCallback(context.bap_uri, 'on_update', responseContext, responseMessage);
  } catch (err) {
    console.error('[update] Error:', err.message);
  }
}

module.exports = { handleUpdate };
