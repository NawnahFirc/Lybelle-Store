# LYBELLE Store

Premium bilingual French/Arabic storefront for LYBELLE.

## Features

- Responsive FR/AR storefront with RTL support
- Product catalogue, search, favourites and persistent cart
- 3 months / 6 months / Necessity Box plans for the 90-capsule products
- Launch offer (20 % on the first 100 eligible orders), counted on the server
- Admin page at `/admin` for prices, plans, the launch offer, delivery and codes
- Guided routine finder and product comparison
- Recently viewed products and reorder flow
- WhatsApp checkout using +212 662-642955, priced by the server
- Vercel deployment (static page + `api/` functions)

## Local development

```bash
echo "LYBELLE_ADMIN_PASSWORD=choose-a-password" > .env.local
npm run dev        # http://localhost:4173, admin at /admin
npm test           # pricing engine + API tests
```

Locally, prices and the launch-offer counter are stored in `.data/lybelle-store.json` (gitignored).

## Pricing system

All pricing lives in `pricing.js`, shared by the page and the API. It keeps four layers apart:
base price → plan price (6 months, Necessity Box) → temporary launch offer → final price + delivery.
Base prices are never reduced by a promotion.

| Plan | Contents | Default price |
| --- | --- | --- |
| 3 months (start) | 1 bottle, 90 capsules | Noctiglyc 349 DH · Selenium X 329 DH |
| 6 months (best value) | 2 bottles | Noctiglyc 599 DH · Selenium X 569 DH, free delivery |
| Necessity Box (complete wellness) | 2 bottles + 1 complementary product | Noctiglyc 699 DH (+ Astringel) · Selenium X 749 DH (+ Huile Capillaire), free delivery |

Defaults are in `DEFAULT_CONFIG` in `pricing.js`; everything is editable from `/admin` without a deploy.

Cart keys: `noctiglyc` (single bottle / 3 months), `noctiglyc:bundle6`, `noctiglyc:box`. Every plan feeds the one persistent cart.

### Launch offer (first 100 orders)

- The browser never decides who gets the offer. At checkout, `POST /api/orders` re-prices the cart and, if it contains an eligible item, claims a numbered slot atomically (a Redis Lua script). Order #101 is priced normally and the customer is told the offer just ended.
- Editing the form and resubmitting reuses the same slot (one draft id per checkout).
- A visitor can claim at most 8 new slots a day (`LYBELLE_PROMO_IP_LIMIT`).
- Orders are only *sent* when the customer taps the WhatsApp link, so a slot can be used by someone who never sends. Correct "Déjà utilisées" in `/admin` when you reconcile.
- No customer details are stored on the server; they only travel in the WhatsApp message. `/admin` lists recent priced orders (reference, items, total, offer number).

## Deploying on Vercel

1. Add a Redis store: Vercel dashboard → Storage → Upstash Redis (or Vercel KV). It sets `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`).
2. Add `LYBELLE_ADMIN_PASSWORD` in Project → Settings → Environment Variables.
3. Deploy.

Without Redis the site still works at normal prices, but it will not show or grant the launch offer (it cannot count orders), and `/admin` is read-only.

## API

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/pricing` | GET | Public prices, plans, delivery, offer state |
| `/api/quote` | POST | Price a cart; used to check a promo code (codes stay server-side) |
| `/api/orders` | POST | Server-priced order + launch-offer claim; returns the quote used for WhatsApp |
| `/api/admin` | GET / PUT | Read / change the config and the counter (`Authorization: Bearer <password>`) |
