const { getDb } = require('../firebase/admin');
const { buildContext, ackResponse, sendCallback } = require('../utils/beckn');
const admin = require('firebase-admin');

/**
 * Handle POST /ondc/confirm
 * Payment done. Create actual order in FLYP system.
 * Map ONDC order → stores/{providerId}/customerOrders
 */
async function handleConfirm(req, res) {
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
    const payment = order.payment || {};

    if (!providerId) return;

    const ondcOrderId = order.id || `ONDC-${context.transaction_id}`;
    const now = admin.firestore.FieldValue.serverTimestamp();

    const orderItems = [];
    let orderTotal = 0;

    for (const item of items) {
      const productSnap = await db
        .collection('stores').doc(providerId)
        .collection('products').doc(item.id)
        .get();

      if (!productSnap.exists) continue;

      const product = { id: productSnap.id, ...productSnap.data() };
      const qty = item.quantity?.count || 1;
      const unitPrice = product.sellingPrice || product.price || 0;
      const lineTotal = unitPrice * qty;
      orderTotal += lineTotal;

      orderItems.push({
        productId: item.id,
        name: product.productName || product.name,
        price: unitPrice,
        quantity: qty,
        total: lineTotal,
        sku: product.sku || '',
        imageUrl: product.imageUrl || '',
      });

      const currentQty = product.quantity || 0;
      const newQty = Math.max(0, currentQty - qty);
      await db.collection('stores').doc(providerId)
        .collection('products').doc(item.id)
        .update({ quantity: newQty, inStock: newQty > 0, updatedAt: now });
    }

    const flypOrder = {
      orderId: ondcOrderId,
      ondcTransactionId: context.transaction_id,
      source: 'ondc',
      status: 'pending',
      items: orderItems,
      total: orderTotal,
      billing: {
        name: billing.name || '',
        phone: billing.phone || '',
        email: billing.email || '',
        address: billing.address || {},
      },
      deliveryAddress: fulfillment.end?.location?.address || {},
      deliveryPhone: fulfillment.end?.contact?.phone || billing.phone || '',
      paymentStatus: payment.status === 'PAID' ? 'paid' : 'pending',
      paymentType: 'ONDC',
      statusHistory: { pending: now },
      createdAt: now,
      updatedAt: now,
    };

    const batch = db.batch();

    batch.set(
      db.collection('stores').doc(providerId).collection('customerOrders').doc(ondcOrderId),
      flypOrder
    );
    batch.set(
      db.collection('customerOrders').doc(ondcOrderId),
      { ...flypOrder, storeId: providerId }
    );

    await batch.commit();
    console.log(`[confirm] Created FLYP order ${ondcOrderId} for provider ${providerId}`);

    const responseContext = buildContext({
      action: 'on_confirm',
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
        id: ondcOrderId,
        state: 'Created',
        provider: { id: providerId, locations: [{ id: 'l1' }] },
        items: items.map(i => ({ id: i.id, quantity: i.quantity, fulfillment_id: 'f1' })),
        billing,
        fulfillments: [
          {
            id: 'f1',
            type: 'Delivery',
            state: { descriptor: { code: 'Pending', short_desc: 'Order created' } },
            tracking: false,
            end: fulfillment.end || {},
            '@ondc/org/TAT': 'PT60M',
          },
        ],
        quote: {
          price: { currency: 'INR', value: String(orderTotal) },
          breakup: orderItems.map(i => ({
            '@ondc/org/item_id': i.productId,
            '@ondc/org/item_quantity': { count: i.quantity },
            title: i.name,
            '@ondc/org/title_type': 'item',
            price: { currency: 'INR', value: String(i.total) },
          })),
          ttl: 'PT15M',
        },
        payment: {
          ...payment,
          status: 'NOT-PAID',
          type: 'POST-FULFILLMENT',
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    };

    await sendCallback(context.bap_uri, 'on_confirm', responseContext, responseMessage);
  } catch (err) {
    console.error('[confirm] Error:', err.message);
  }
}

module.exports = { handleConfirm };
