# LYBELLE Storefront

A bilingual French/Arabic storefront for LYBELLE, rebuilt from the initial single-file concept and the supplied SEO/marketing brief.

## Included

- Responsive premium storefront with FR/AR language switching and RTL layout
- Supplied product photography stored in `assets/` and linked with relative paths for dependable GitHub/Vercel deployment
- Working product catalogue, filters, search, favourites and persistent cart
- Guided three-step routine finder with responsible FR/AR recommendations
- Side-by-side product comparison for up to three products
- Recently viewed products, deep product sharing and one-click reordering
- Smart complementary-product suggestion inside the cart
- Persistent checkout details on the customer's own device and a richer WhatsApp order summary
- Mobile cart bar, focus trapping, reduced-motion support and bilingual accessibility labels
- Sticky product ribbon that remains visible while scrolling
- Floating WhatsApp ordering at **+212 604-442881**
- Checkout form that prepares a complete WhatsApp order message
- Product modals, discount handling, delivery threshold and accessible controls
- SEO metadata and product structured data without unverified ratings

## Run locally

```bash
npm run dev -- --port 4173 --host 0.0.0.0
```

Then open the printed local URL.

Keep `index.html` beside the `assets` folder when reviewing or deploying the site.

## Image placement

- Supplied Selenium X + Hair Oil image: main hero and hair-ritual feature
- Supplied Hair Oil image: Hair Oil product card, modal and visual gallery
- Supplied Gel Intime images: clean single-product card plus the duo offer and visual gallery
- Supplied Noctiglyc image: product card, modal and night-routine content
- Supplied Selenium X + Hair Oil image: hero and complete hair-ritual offer

## Production notes

- The current order flow intentionally uses WhatsApp and does not charge a customer.
- Replace the relative canonical and social-image metadata once the final public domain is known.
- Product prices, stock and label-authorized claims should be reviewed by the LYBELLE manager before launch.
- Shopify can be connected later for inventory, online payment and order management; the current connected Shopify session requires reauthentication.

## Manager configuration

The WhatsApp number is defined once in `STORE_CONFIG` inside `index.html`:

```js
whatsappNumber: "212604442881"
```
