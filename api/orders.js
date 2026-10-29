/* POST /api/orders: price an order on the server and, when it qualifies,
 * claim one of the launch-offer slots. The browser's numbers are never
 * trusted; the WhatsApp message is built from what this returns.
 *
 * Body: { cart: { "<product>[:<plan>]": qty }, coupon?: string, draftId: string }
 * draftId is generated per checkout, so editing the form and submitting
 * again reuses the same slot instead of using up a second one. */
import { Pricing, cleanCart, clientIp, loadPricing, orderId, readJson, send } from "./_lib/http.js";

const IP_LIMIT = Number(process.env.LYBELLE_PROMO_IP_LIMIT) || 8; // new claims per visitor per day
const IP_TTL = 24 * 60 * 60;

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
  let body;
  try { body = await readJson(req); } catch (err) { return send(res, err.status || 400, { error: "invalid request" }); }

  const cart = cleanCart(body.cart);
  const draftId = String(body.draftId || "");
  if (!/^[A-Za-z0-9-]{8,64}$/.test(draftId)) return send(res, 400, { error: "invalid draft" });

  try {
    const { store, config, promo } = await loadPricing();
    const coupon = body.coupon;

    /* Is the offer window open at all (switched on, inside its dates)?
     * The order limit is checked inside the atomic claim instead, so a
     * customer who already holds a slot keeps it when they resubmit. */
    const windowState = Pricing.promoState(config, 0, Date.now());
    let quote = Pricing.quote(cart, config, { promoActive: windowState.active && store.kind !== "none", coupon });
    if (!quote.lines.length) return send(res, 400, { error: "empty cart" });

    let promoNumber = null;
    let promoNotice = null;
    if (quote.promoApplied) {
      const claim = await store.claimPromo({ draftId, limit: config.promo.limit, ip: clientIp(req), ipLimit: IP_LIMIT, ipTtl: IP_TTL });
      if (claim.number) {
        promoNumber = claim.number;
      } else {
        promoNotice = claim.reason === "limit_reached" ? "ended" : "unavailable";
        quote = Pricing.quote(cart, config, { promoActive: false, coupon });
      }
    }

    const order = {
      id: orderId(),
      at: new Date().toISOString(),
      promoNumber,
      coupon: quote.coupon || null,
      lines: quote.lines.map((l) => ({ key: l.key, qty: l.qty, items: l.items, final: l.lineFinal })),
      value: quote.value,
      savings: quote.savings,
      shipping: quote.shipping,
      total: quote.total
    };
    await store.recordOrder(order).catch(() => {});

    const after = promoNumber ? await loadPricing().then((p) => p.promo).catch(() => promo) : promo;
    send(res, 200, {
      order: { id: order.id, promoNumber },
      quote,
      promoNotice,
      promo: { active: after.active, reason: after.reason, percent: after.percent }
    });
  } catch (err) {
    send(res, 500, { error: "order service unavailable" });
  }
}
