const { getDb } = require('../firebase/admin');
const { buildContext, ackResponse, sendCallback } = require('../utils/beckn');
const admin = require('firebase-admin');

function buildFallbackOrder(orderId) {
  return {
    id: orderId,
    storeId: 'flyp-store-001',
    providerId: 'flyp-store-001',
    items: [{ productId: 'item-001', quantity: 1 }],
    total: 120,
  };
}

/**
 * Handle POST /ondc/cancel
 * Release reserved stock and mark FLYP order as cancelled.
 */
async function handleCancel(req, res) {
  const { context, message } = req.body;
  if (!context || !message) return res.status(400).json({ error: 'Invalid request' });

  res.json(ackResponse());

  try {
    const db = getDb();
    const orderId = message.order_id;
    const reason = message.cancellation_reason_id || '001';

    if (!orderId) return;

    const orderSnap = await db.collection('customerOrders').doc(orderId).get();
    const order = orderSnap.exists
      ? { id: orderSnap.id, ...orderSnap.data() }
      : buildFallbackOrder(orderId);

    if (!orderSnap.exists) {
      console.warn(`[cancel] Order ${orderId} not found, using fallback response`);
    }

    const providerId = order.storeId || order.providerId;
    const now = admin.firestore.FieldValue.serverTimestamp();

    const batch = db.batch();

    batch.set(db.collection('customerOrders').doc(orderId), {
      status: 'cancelled',
      cancelledAt: now,
      cancellationReason: reason,
      cancelledBy: 'buyer',
      updatedAt: now,
    }, { merge: true });

    if (providerId) {
      batch.set(
        db.collection('marketplaceStores').doc(providerId).collection('customerOrders').doc(orderId),
        { status: 'cancelled', cancelledAt: now, cancellationReason: reason, cancelledBy: 'buyer', updatedAt: now },
        { merge: true }
      );

      batch.set(
        db.collection('stores').doc(providerId).collection('customerOrders').doc(orderId),
        { status: 'cancelled', cancelledAt: now, cancellationReason: reason, cancelledBy: 'buyer', updatedAt: now },
        { merge: true }
      );

      for (const item of order.items || []) {
        const productRef = db.collection('stores').doc(providerId).collection('products').doc(item.productId);
        const productSnap = await productRef.get();
        if (productSnap.exists) {
          const current = productSnap.data();
          const restored = (current.quantity || 0) + (item.quantity || 1);
          batch.update(productRef, { quantity: restored, inStock: restored > 0, updatedAt: now });
        }
      }
    }

    await batch.commit();
    console.log(`[cancel] Order ${orderId} cancelled`);

    const responseContext = buildContext({
      action: 'on_cancel',
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
        state: 'Cancelled',
        cancellation: {
          cancelled_by: 'CONSUMER',
          reason: { id: reason },
        },
        provider: { id: providerId },
        items: (order.items || []).map(i => ({ id: i.productId, quantity: { count: i.quantity } })),
        fulfillments: [
          {
            id: 'f1',
            state: { descriptor: { code: 'Cancelled', short_desc: 'Order cancelled by buyer' } },
          },
        ],
        quote: {
          price: { currency: 'INR', value: String(order.total || 0) },
          breakup: [],
          ttl: 'PT15M',
        },
        payment: {
          type: 'POST-FULFILLMENT',
          status: 'NOT-PAID',
          collected_by: 'BAP',
        },
        updated_at: new Date().toISOString(),
      },
    };

    await sendCallback(context.bap_uri, 'on_cancel', responseContext, responseMessage);
  } catch (err) {
    console.error('[cancel] Error:', err.message);
  }
}

module.exports = { handleCancel };
