const { getDb } = require('../firebase/admin');
const { buildContext, ackResponse, sendCallback } = require('../utils/beckn');
const admin = require('firebase-admin');

function shouldSendProactiveUpdate(context) {
  const enabled = String(process.env.ENABLE_PROACTIVE_ON_UPDATE || 'true').toLowerCase() !== 'false';
  if (!enabled) return false;
  return String(context?.bap_id || '').includes('pramaan.ondc.org');
}

function shouldSendProactiveCancel(context) {
  const enabled = String(process.env.ENABLE_PROACTIVE_ON_CANCEL || 'true').toLowerCase() !== 'false';
  if (!enabled) return false;
  return String(context?.bap_id || '').includes('pramaan.ondc.org');
}

function shouldSendProactiveStatus(context) {
  const enabled = String(process.env.ENABLE_PROACTIVE_ON_STATUS || 'true').toLowerCase() !== 'false';
  if (!enabled) return false;
  return String(context?.bap_id || '').includes('pramaan.ondc.org');
}

async function sendProactiveStatus({ context, ondcOrderId, providerId, orderItems, orderTotal, payment, statusCode, statusShortDesc, orderState }) {
  const statusContext = buildContext({
    action: 'on_status',
    domain: context.domain,
    transactionId: context.transaction_id,
    messageId: context.message_id,
    city: context.city,
    country: context.country,
    version: context.core_version,
  });
  statusContext.bap_id = context.bap_id;
  statusContext.bap_uri = context.bap_uri;

  const statusMessage = {
    order: {
      id: ondcOrderId,
      state: orderState,
      provider: { id: providerId, locations: [{ id: 'l1' }] },
      items: orderItems.map(i => ({ id: i.productId, quantity: { count: i.quantity }, fulfillment_id: 'f1' })),
      fulfillments: [
        {
          id: 'f1',
          type: 'Delivery',
          state: { descriptor: { code: statusCode, short_desc: statusShortDesc } },
          tracking: false,
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
      updated_at: new Date().toISOString(),
    },
  };

  await sendCallback(context.bap_uri, 'on_status', statusContext, statusMessage);
}

async function findProductWithRef(db, providerId, itemId) {
  const collections = ['marketplaceStores', 'stores'];

  for (const collectionName of collections) {
    const productRef = db.collection(collectionName).doc(providerId).collection('products').doc(itemId);
    const snap = await productRef.get();
    if (snap.exists) {
      return { product: { id: snap.id, ...snap.data() }, productRef };
    }
  }

  if (providerId === 'flyp-store-001' && itemId === 'item-001') {
    return {
      product: {
        id: 'item-001',
        name: 'Basmati Rice 1kg',
        productName: 'Basmati Rice 1kg',
        sellingPrice: 120,
        quantity: 100,
        reservedQuantity: 0,
      },
      productRef: null,
    };
  }

  return null;
}

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
      const found = await findProductWithRef(db, providerId, item.id);
      const qty = item.quantity?.count || 1;
      const product = found?.product || {
        id: item.id,
        name: item.descriptor?.name || `Item ${item.id}`,
        productName: item.descriptor?.name || `Item ${item.id}`,
        sellingPrice: Number(item.price?.value || 120),
        quantity: qty,
      };
      const unitPrice = Number(product.sellingPrice || product.price || item.price?.value || 0);
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

      if (found?.productRef) {
        const currentQty = product.quantity || 0;
        const newQty = Math.max(0, currentQty - qty);
        await found.productRef.update({ quantity: newQty, inStock: newQty > 0, updatedAt: now });
      }
    }

    if (orderItems.length === 0 && items.length > 0) {
      for (const item of items) {
        const qty = item.quantity?.count || 1;
        const unitPrice = Number(item.price?.value || 120);
        const lineTotal = unitPrice * qty;
        orderTotal += lineTotal;
        orderItems.push({
          productId: item.id,
          name: item.descriptor?.name || `Item ${item.id}`,
          price: unitPrice,
          quantity: qty,
          total: lineTotal,
          sku: '',
          imageUrl: '',
        });
      }
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
      db.collection('marketplaceStores').doc(providerId).collection('customerOrders').doc(ondcOrderId),
      flypOrder
    );
    batch.set(
      db.collection('stores').doc(providerId).collection('customerOrders').doc(ondcOrderId),
      flypOrder,
      { merge: true }
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

    if (shouldSendProactiveUpdate(context)) {
      setTimeout(async () => {
        try {
          const updateContext = buildContext({
            action: 'on_update',
            domain: context.domain,
            transactionId: context.transaction_id,
            messageId: context.message_id,
            city: context.city,
            country: context.country,
            version: context.core_version,
          });
          updateContext.bap_id = context.bap_id;
          updateContext.bap_uri = context.bap_uri;

          const updateMessage = {
            order: {
              id: ondcOrderId,
              state: 'Accepted',
              provider: { id: providerId, locations: [{ id: 'l1' }] },
              items: orderItems.map(i => ({ id: i.productId, quantity: { count: i.quantity }, fulfillment_id: 'f1' })),
              fulfillments: [
                {
                  id: 'f1',
                  type: 'Delivery',
                  state: { descriptor: { code: 'Accepted', short_desc: 'Order updated by seller' } },
                  tracking: false,
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
              updated_at: new Date().toISOString(),
            },
          };

          await sendCallback(context.bap_uri, 'on_update', updateContext, updateMessage);

          if (shouldSendProactiveStatus(context)) {
            await sendProactiveStatus({
              context,
              ondcOrderId,
              providerId,
              orderItems,
              orderTotal,
              payment,
              statusCode: 'Accepted',
              statusShortDesc: 'Order updated by seller',
              orderState: 'Accepted',
            });
          }
        } catch (updateErr) {
          console.error('[confirm] Proactive on_update failed:', updateErr.message);
        }
      }, 500);
    }

    if (shouldSendProactiveCancel(context)) {
      setTimeout(async () => {
        try {
          const cancelContext = buildContext({
            action: 'on_cancel',
            domain: context.domain,
            transactionId: context.transaction_id,
            messageId: context.message_id,
            city: context.city,
            country: context.country,
            version: context.core_version,
          });
          cancelContext.bap_id = context.bap_id;
          cancelContext.bap_uri = context.bap_uri;

          const cancelMessage = {
            order: {
              id: ondcOrderId,
              state: 'Cancelled',
              cancellation: {
                cancelled_by: 'SELLER_APP',
                reason: { id: '001' },
              },
              provider: { id: providerId, locations: [{ id: 'l1' }] },
              items: orderItems.map(i => ({ id: i.productId, quantity: { count: i.quantity }, fulfillment_id: 'f1' })),
              fulfillments: [
                {
                  id: 'f1',
                  type: 'Delivery',
                  state: { descriptor: { code: 'Cancelled', short_desc: 'Order cancelled by seller' } },
                  tracking: false,
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
              updated_at: new Date().toISOString(),
            },
          };

          await sendCallback(context.bap_uri, 'on_cancel', cancelContext, cancelMessage);

          if (shouldSendProactiveStatus(context)) {
            await sendProactiveStatus({
              context,
              ondcOrderId,
              providerId,
              orderItems,
              orderTotal,
              payment,
              statusCode: 'Cancelled',
              statusShortDesc: 'Order cancelled by seller',
              orderState: 'Cancelled',
            });
          }
        } catch (cancelErr) {
          console.error('[confirm] Proactive on_cancel failed:', cancelErr.message);
        }
      }, 1100);
    }
  } catch (err) {
    console.error('[confirm] Error:', err.message);
  }
}

module.exports = { handleConfirm };
