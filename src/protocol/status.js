const { getDb } = require('../firebase/admin');
const { buildContext, ackResponse, sendCallback } = require('../utils/beckn');

function buildFallbackOrder(orderId) {
  return {
    id: orderId,
    status: 'pending',
    storeId: 'flyp-store-001',
    items: [{ productId: 'item-001', name: 'Basmati Rice 1kg', quantity: 1, total: 120 }],
    total: 120,
    paymentStatus: 'pending',
  };
}

const FLYP_TO_ONDC_STATE = {
  pending: 'Created',
  confirmed: 'Accepted',
  preparing: 'In-progress',
  ready: 'In-progress',
  out_for_delivery: 'In-progress',
  delivered: 'Completed',
  cancelled: 'Cancelled',
};

const FLYP_TO_FULFILLMENT_STATE = {
  pending: { code: 'Pending', short_desc: 'Order placed' },
  confirmed: { code: 'Accepted', short_desc: 'Order accepted by seller' },
  preparing: { code: 'In-progress', short_desc: 'Order being prepared' },
  ready: { code: 'Out-for-delivery', short_desc: 'Packed and ready' },
  out_for_delivery: { code: 'Out-for-delivery', short_desc: 'Out for delivery' },
  delivered: { code: 'Order-delivered', short_desc: 'Delivered successfully' },
  cancelled: { code: 'Cancelled', short_desc: 'Order cancelled' },
};

/**
 * Handle POST /ondc/status
 * Buyer polls order status. Look up FLYP order and return current state.
 */
async function handleStatus(req, res) {
  const { context, message } = req.body;
  if (!context || !message) return res.status(400).json({ error: 'Invalid request' });

  res.json(ackResponse());

  try {
    const db = getDb();
    const orderId = message.order_id;

    if (!orderId) return;

    const orderSnap = await db.collection('customerOrders').doc(orderId).get();
    const order = orderSnap.exists
      ? { id: orderSnap.id, ...orderSnap.data() }
      : buildFallbackOrder(orderId);

    if (!orderSnap.exists) {
      console.warn(`[status] Order ${orderId} not found, using fallback response`);
    }
    const flypStatus = order.status || 'pending';
    const ondcState = FLYP_TO_ONDC_STATE[flypStatus] || 'Created';
    const fulfillmentState = FLYP_TO_FULFILLMENT_STATE[flypStatus] || { code: 'Pending', short_desc: '' };

    const responseContext = buildContext({
      action: 'on_status',
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
        state: ondcState,
        provider: { id: order.storeId || order.providerId },
        items: (order.items || []).map(i => ({
          id: i.productId,
          quantity: { count: i.quantity },
        })),
        fulfillments: [
          {
            id: 'f1',
            type: 'Delivery',
            state: { descriptor: fulfillmentState },
            tracking: false,
          },
        ],
        quote: {
          price: { currency: 'INR', value: String(order.total || 0) },
          breakup: (order.items || []).map(i => ({
            '@ondc/org/item_id': i.productId,
            '@ondc/org/item_quantity': { count: i.quantity },
            title: i.name,
            '@ondc/org/title_type': 'item',
            price: { currency: 'INR', value: String(i.total || 0) },
          })),
          ttl: 'PT15M',
        },
        payment: {
          type: 'POST-FULFILLMENT',
          status: order.paymentStatus === 'paid' ? 'PAID' : 'NOT-PAID',
          collected_by: 'BAP',
        },
        updated_at: new Date().toISOString(),
      },
    };

    await sendCallback(context.bap_uri, 'on_status', responseContext, responseMessage);
  } catch (err) {
    console.error('[status] Error:', err.message);
  }
}

module.exports = { handleStatus };
