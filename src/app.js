require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const morgan = require('morgan');

const { initFirebase } = require('./firebase/admin');
const { handleOnSubscribe } = require('./registry/subscribe');

const { handleSearch } = require('./protocol/search');
const { handleSelect } = require('./protocol/select');
const { handleInit } = require('./protocol/init');
const { handleConfirm } = require('./protocol/confirm');
const { handleStatus } = require('./protocol/status');
const { handleCancel } = require('./protocol/cancel');
const { handleUpdate } = require('./protocol/update');
const { handleIssue, handleIssueStatus } = require('./igm/igmHandler');

const app = express();
const PORT = process.env.PORT || 3000;

const debugStore = { lastContext: null, lastCallbackResult: null };

app.use(cors());
app.use(morgan('combined'));
app.use(bodyParser.json({ limit: '5mb' }));

initFirebase();

// ────────────────────────────────────────────────
// Debug endpoints (temporary — remove after Pramaan passes)
// ────────────────────────────────────────────────
app.get('/debug/last-context', (req, res) => {
  res.json(debugStore.lastContext || { message: 'No search received yet' });
});

app.post('/debug/test-callback', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  const axios = require('axios');
  try {
    const result = await axios.post(url, { test: 'ping', ts: Date.now() }, { timeout: 8000 });
    res.json({ status: result.status, data: result.data });
  } catch (err) {
    res.json({ error: err.message, status: err.response?.status });
  }
});

// ────────────────────────────────────────────────
// Health check (public)
// ────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    service: 'FLYP NOW — ONDC Seller App (BPP)',
    version: '1.0.0',
    subscriberId: process.env.SUBSCRIBER_ID,
    status: 'online',
    env: process.env.NODE_ENV || 'preprod',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ────────────────────────────────────────────────
// ONDC Registry — Subscription callback
// ONDC calls this to verify we own the domain
// ────────────────────────────────────────────────
app.post('/ondc/on_subscribe', handleOnSubscribe);

// ────────────────────────────────────────────────
// Beckn Protocol Endpoints
// All incoming calls from Buyer Apps via ONDC Gateway
// ────────────────────────────────────────────────
app.post('/ondc/search', (req, res, next) => {
  debugStore.lastContext = req.body?.context || null;
  next();
}, handleSearch);
app.post('/ondc/select',        handleSelect);
app.post('/ondc/init',          handleInit);
app.post('/ondc/confirm',       handleConfirm);
app.post('/ondc/status',        handleStatus);
app.post('/ondc/cancel',        handleCancel);
app.post('/ondc/update',        handleUpdate);

// ────────────────────────────────────────────────
// IGM — Issue & Grievance Management
// Mandatory for ONDC compliance
// ────────────────────────────────────────────────
app.post('/ondc/issue',         handleIssue);
app.post('/ondc/issue_status',  handleIssueStatus);

// ────────────────────────────────────────────────
// Internal API — FLYP dashboard calls to update order status
// (Called by FLYP main app when seller changes order state)
// ────────────────────────────────────────────────
app.post('/internal/order/:orderId/status', async (req, res) => {
  try {
    const { getDb } = require('./firebase/admin');
    const admin = require('firebase-admin');
    const db = getDb();
    const { orderId } = req.params;
    const { status } = req.body;

    if (!status) return res.status(400).json({ error: 'status required' });

    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.collection('customerOrders').doc(orderId).update({
      status,
      [`statusHistory.${status}`]: now,
      updatedAt: now,
    });

    res.json({ success: true, orderId, status });
  } catch (err) {
    console.error('[internal] status update error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────
// 404 handler
// ────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ────────────────────────────────────────────────
// Error handler
// ────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[app] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 FLYP ONDC Adapter running on port ${PORT}`);
  console.log(`   Subscriber ID : ${process.env.SUBSCRIBER_ID || 'NOT SET'}`);
  console.log(`   Subscriber URI: ${process.env.SUBSCRIBER_URI || '/ondc'}`);
  console.log(`   Environment   : ${process.env.NODE_ENV || 'preprod'}`);
  console.log(`   Registry      : ${process.env.REGISTRY_URL || 'NOT SET'}\n`);
});

module.exports = app;
