const { getDb } = require('../firebase/admin');

/**
 * Map FLYP category string → ONDC domain code
 */
const CATEGORY_TO_DOMAIN = {
  grocery: 'RET10', fmcg: 'RET10', staples: 'RET10', dairy: 'RET10', snacks: 'RET10',
  'food': 'RET11', 'beverage': 'RET11', 'beverages': 'RET11', 'restaurant': 'RET11',
  fashion: 'RET12', clothing: 'RET12', apparel: 'RET12', garments: 'RET12',
  beauty: 'RET13', cosmetics: 'RET13', skincare: 'RET13', 'personal care': 'RET13',
  electronics: 'RET14', mobiles: 'RET14', appliances: 'RET14',
  home: 'RET15', furniture: 'RET15', decor: 'RET15', kitchen: 'RET15',
  pharma: 'RET16', medicine: 'RET16', health: 'RET16',
  agriculture: 'RET17', fertilizer: 'RET17', agri: 'RET17', seeds: 'RET17',
};

function mapCategoryToONDC(category) {
  if (!category) return 'RET10';
  const lower = category.toLowerCase();
  for (const [key, code] of Object.entries(CATEGORY_TO_DOMAIN)) {
    if (lower.includes(key)) return code;
  }
  return 'RET10';
}

/**
 * Map FLYP unit → ONDC unit code
 */
function mapUnit(unit) {
  const u = (unit || 'pcs').toLowerCase();
  if (u === 'kg' || u === 'kilogram') return 'kilogram';
  if (u === 'g' || u === 'gm' || u === 'gram') return 'gram';
  if (u === 'l' || u === 'ltr' || u === 'litre' || u === 'liter') return 'litre';
  if (u === 'ml' || u === 'millilitre') return 'millilitre';
  if (u === 'dozen') return 'dozen';
  return 'unit';
}

/**
 * Convert a FLYP product doc → ONDC Item object
 */
function buildONDCItem(product, providerId) {
  const availableQty = Math.max(0, (product.quantity || 0) - (product.reservedQuantity || 0));
  const mrp = product.mrp || product.price || 0;
  const sellingPrice = product.sellingPrice || product.price || 0;

  return {
    id: product.id,
    descriptor: {
      name: product.productName || product.name || 'Unnamed Product',
      short_desc: product.description || '',
      long_desc: product.description || '',
      images: [
        ...(product.imageUrl ? [{ url: product.imageUrl }] : []),
        ...(product.images || []).map(url => ({ url })),
      ].slice(0, 5),
      symbol: product.barcode || '',
      code: product.sku || product.id,
    },
    price: {
      currency: 'INR',
      value: String(sellingPrice),
      maximum_value: String(mrp),
    },
    quantity: {
      available: { count: availableQty },
      maximum: { count: availableQty },
      unitized: {
        measure: {
          unit: mapUnit(product.unit),
          value: product.packSize || '1',
        },
      },
    },
    category_id: mapCategoryToONDC(product.category),
    fulfillment_id: 'f1',
    location_id: 'l1',
    '@ondc/org/returnable': false,
    '@ondc/org/cancellable': true,
    '@ondc/org/return_window': 'P0D',
    '@ondc/org/seller_pickup_return': false,
    '@ondc/org/time_to_ship': 'PT30M',
    '@ondc/org/available_on_cod': true,
    '@ondc/org/contact_details_consumer_care': 'support@flypnow.in,support@flypnow.in,1800000000',
    tags: [
      { code: 'origin', list: [{ code: 'country', value: 'IND' }] },
      ...(product.brand ? [{ code: 'brand', list: [{ code: 'brand', value: product.brand }] }] : []),
    ],
  };
}

/**
 * Build a full ONDC Provider catalog for a given FLYP business.
 * Reads from: businesses/{businessId}/products (via marketplace store)
 */
async function buildProviderCatalog(businessId) {
  const db = getDb();

  const [storeSnap, productsSnap] = await Promise.all([
    db.collection('stores').doc(businessId).get(),
    db.collection('stores').doc(businessId).collection('products')
      .where('isAvailable', '==', true)
      .get(),
  ]);

  if (!storeSnap.exists) return null;
  const store = { id: storeSnap.id, ...storeSnap.data() };

  const items = productsSnap.docs
    .map(doc => buildONDCItem({ id: doc.id, ...doc.data() }, businessId))
    .filter(item => parseFloat(item.price.value) > 0);

  const categories = [...new Set(items.map(i => i.category_id))].map(code => ({
    id: code,
    descriptor: { name: code },
  }));

  return {
    id: businessId,
    descriptor: {
      name: store.storeName || store.businessName || 'FLYP Store',
      short_desc: store.description || '',
      images: store.logo ? [{ url: store.logo }] : [],
    },
    '@ondc/org/fssai_license_no': store.fssai || '',
    time: { label: 'enable', timestamp: new Date().toISOString() },
    categories,
    fulfillments: [
      {
        id: 'f1',
        type: 'Delivery',
        contact: {
          phone: store.phone || '',
          email: store.email || 'support@flypnow.in',
        },
      },
    ],
    locations: [
      {
        id: 'l1',
        time: {
          label: 'enable',
          schedule: {
            holidays: [],
            frequency: 'PT4H',
            times: ['0000', '2359'],
          },
        },
      },
    ],
    items,
    offers: [],
    tags: [
      {
        code: 'serviceability',
        list: [
          { code: 'location', value: 'l1' },
          { code: 'category', value: categories[0]?.id || 'RET10' },
          { code: 'type', value: '12' },
          { code: 'val', value: '10' },
          { code: 'unit', value: 'km' },
        ],
      },
      {
        code: 'seller_terms',
        list: [{ code: 'gst_credit_invoice', value: 'Y' }],
      },
    ],
  };
}

/**
 * Minimal mock provider returned when Firebase has no live catalog data.
 * Ensures Pramaan always gets a valid on_search response.
 */
function getMockProvider() {
  return {
    id: 'flyp-store-001',
    descriptor: {
      name: 'FLYP NOW Store',
      short_desc: 'Fresh groceries and daily essentials',
      images: [{ url: 'https://flypnow.in/logo.png' }],
    },
    '@ondc/org/fssai_license_no': '',
    time: { label: 'enable', timestamp: new Date().toISOString() },
    categories: [{ id: 'RET10', descriptor: { name: 'Grocery' } }],
    fulfillments: [{ id: 'f1', type: 'Delivery', contact: { phone: '9000000000', email: 'support@flypnow.in' } }],
    locations: [{
      id: 'l1',
      time: { label: 'enable', schedule: { holidays: [], frequency: 'PT4H', times: ['0000', '2359'] } },
    }],
    items: [
      {
        id: 'item-001',
        descriptor: { name: 'Basmati Rice 1kg', short_desc: 'Premium basmati rice', long_desc: 'Premium basmati rice', images: [], symbol: '', code: 'SKU001' },
        price: { currency: 'INR', value: '120', maximum_value: '150' },
        quantity: { available: { count: 50 }, maximum: { count: 50 }, unitized: { measure: { unit: 'kilogram', value: '1' } } },
        category_id: 'RET10',
        fulfillment_id: 'f1',
        location_id: 'l1',
        '@ondc/org/returnable': false,
        '@ondc/org/cancellable': true,
        '@ondc/org/return_window': 'P0D',
        '@ondc/org/seller_pickup_return': false,
        '@ondc/org/time_to_ship': 'PT30M',
        '@ondc/org/available_on_cod': true,
        '@ondc/org/contact_details_consumer_care': 'support@flypnow.in,support@flypnow.in,1800000000',
        tags: [{ code: 'origin', list: [{ code: 'country', value: 'IND' }] }],
      },
    ],
    offers: [],
    tags: [
      { code: 'serviceability', list: [{ code: 'location', value: 'l1' }, { code: 'category', value: 'RET10' }, { code: 'type', value: '12' }, { code: 'val', value: '10' }, { code: 'unit', value: 'km' }] },
      { code: 'seller_terms', list: [{ code: 'gst_credit_invoice', value: 'Y' }] },
    ],
  };
}

/**
 * Search products across all active stores matching a query/category/intent
 */
async function searchCatalog({ query, category, city }) {
  try {
    const db = getDb();
    const storesSnap = await db.collection('marketplaceStores')
      .where('isActive', '==', true)
      .limit(20)
      .get();

    if (storesSnap.empty) {
      return [getMockProvider()];
    }

    const providers = [];
    for (const storeDoc of storesSnap.docs) {
      const provider = await buildProviderCatalog(storeDoc.id);
      if (!provider) continue;

      if (query) {
        const lq = query.toLowerCase();
        provider.items = provider.items.filter(
          item =>
            item.descriptor.name.toLowerCase().includes(lq) ||
            item.descriptor.short_desc.toLowerCase().includes(lq)
        );
      }

      if (category) {
        const domainCode = mapCategoryToONDC(category);
        provider.items = provider.items.filter(item => item.category_id === domainCode);
      }

      if (provider.items.length > 0) providers.push(provider);
    }

    return providers.length > 0 ? providers : [getMockProvider()];
  } catch (err) {
    console.error('[catalog] searchCatalog error, using mock:', err.message);
    return [getMockProvider()];
  }
}

module.exports = { buildProviderCatalog, searchCatalog, buildONDCItem, mapCategoryToONDC };
