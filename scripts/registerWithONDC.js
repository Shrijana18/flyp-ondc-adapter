/**
 * Register FLYP NOW as a BPP on ONDC Preprod Registry.
 * Run after deploying the server and setting DNS:
 *   node scripts/registerWithONDC.js
 */
require('dotenv').config();
const { registerWithRegistry } = require('../src/registry/subscribe');

async function main() {
  const required = [
    'SUBSCRIBER_ID', 'SUBSCRIBER_URI', 'REGISTRY_URL',
    'SIGNING_PRIVATE_KEY', 'SIGNING_PUBLIC_KEY',
    'FIREBASE_PROJECT_ID', 'FIREBASE_PRIVATE_KEY', 'FIREBASE_CLIENT_EMAIL',
  ];

  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error('\n❌ Missing required environment variables:\n');
    missing.forEach(k => console.error(`   - ${k}`));
    console.error('\nCopy .env.example to .env and fill in the values.\n');
    process.exit(1);
  }

  console.log('\n📡 Registering FLYP NOW with ONDC Registry...');
  console.log(`   Subscriber ID  : ${process.env.SUBSCRIBER_ID}`);
  console.log(`   Subscriber URI : ${process.env.SUBSCRIBER_URI}`);
  console.log(`   Registry URL   : ${process.env.REGISTRY_URL}`);
  console.log(`   Callback URL   : https://${process.env.SUBSCRIBER_ID}${process.env.SUBSCRIBER_URI}\n`);

  try {
    const result = await registerWithRegistry();
    console.log('\n✅ Registration submitted. ONDC will send an on_subscribe challenge to your server.');
    console.log('   Your server handles it automatically at POST /ondc/on_subscribe');
    console.log('\n   Next: Go to ONDC portal → Step 1.b and fill:');
    console.log(`   Subscriber ID  : ${process.env.SUBSCRIBER_ID}`);
    console.log(`   Subscriber URI : ${process.env.SUBSCRIBER_URI}\n`);
  } catch (err) {
    console.error('\n❌ Registration failed:', err.message);
    process.exit(1);
  }
}

main();
