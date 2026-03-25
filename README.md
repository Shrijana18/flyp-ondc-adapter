# FLYP NOW — ONDC Adapter (BPP / Seller App)

FLYP NOW's ONDC integration backend. Registers FLYP as a **Seller App (BPP)** on the ONDC network across all retail domains — enabling FLYP's retailers, distributors, and manufacturers to receive orders from any ONDC buyer app (Paytm, PhonePe, Meesho, etc.).

## Domains Supported

| Domain | Code |
|---|---|
| Grocery / FMCG | RET10 |
| Food & Beverages | RET11 |
| Fashion | RET12 |
| Beauty & Personal Care | RET13 |
| Agriculture / Fertilizer | RET17 |

---

## Setup

### 1. Install dependencies
```bash
cd flyp-ondc-adapter
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```

### 3. Generate Ed25519 signing keys
```bash
npm run generate-keys
```
Copy the output into your `.env` file.

### 4. Get Firebase Admin credentials
- Go to Firebase Console → Project Settings → Service Accounts
- Click **"Generate new private key"**
- Copy `project_id`, `client_email`, `private_key` into `.env`

### 5. Run locally
```bash
npm run dev
```
Server runs at `http://localhost:3000`

---

## Deploy to Railway

1. Push this folder to a new GitHub repo: `flyp-ondc-adapter`
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add all `.env` variables in Railway's **Variables** tab
4. Railway auto-assigns a URL like `flyp-ondc-adapter.up.railway.app`

---

## DNS Setup (Hostinger)

After Railway gives you a URL:

1. Go to Hostinger → `flypnow.in` → DNS / Nameservers
2. Add a **CNAME** record:
   - Name: `ondc`
   - Points to: `flyp-ondc-adapter.up.railway.app`
3. Wait 15–30 min for DNS propagation

Your server is now live at `https://ondc.flypnow.in`

---

## Register with ONDC Preprod

```bash
npm run subscribe
```

This calls the ONDC registry and registers `ondc.flypnow.in` as a BPP.
ONDC will challenge your server at `POST /ondc/on_subscribe` — handled automatically.

---

## Complete ONDC Portal Step 1.b

Fill in the form on the ONDC portal:
- **Registry**: Preprod
- **Subscriber ID**: `ondc.flypnow.in`
- **Subscriber URI**: `/ondc`

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/` | Service info |
| GET | `/health` | Health check |
| POST | `/ondc/on_subscribe` | Registry challenge (auto) |
| POST | `/ondc/search` | Receive search from buyer app |
| POST | `/ondc/select` | Buyer selects items |
| POST | `/ondc/init` | Buyer provides address |
| POST | `/ondc/confirm` | Order confirmed + created in FLYP |
| POST | `/ondc/status` | Order status poll |
| POST | `/ondc/cancel` | Order cancellation |
| POST | `/ondc/update` | Partial update |
| POST | `/ondc/issue` | IGM — raise issue |
| POST | `/ondc/issue_status` | IGM — issue status poll |
| POST | `/internal/order/:id/status` | FLYP app updates order status |

---

## How it connects to FLYP

- **Reads catalog** from: `stores/{businessId}/products` (Firebase)
- **Creates orders** in: `stores/{businessId}/customerOrders` + `customerOrders/{orderId}`
- **Orders appear** in FLYP main app exactly like any other order (source: `"ondc"`)
- **Stock updates** happen automatically on confirm/cancel
