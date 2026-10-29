/* POST /api/quote: price a cart without placing an order. Used to check a
 * coupon code, since the codes themselves never reach the browser. */
import { Pricing, cleanCart, loadPricing, readJson, send } from "./_lib/http.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
  try {
    const body = await readJson(req);
    const { config, promo } = await loadPricing();
    const quote = Pricing.quote(cleanCart(body.cart), config, { promoActive: promo.active, coupon: body.coupon });
    send(res, 200, { quote, promo: { active: promo.active, reason: promo.reason, percent: promo.percent } });
  } catch (err) {
    send(res, err.status || 400, { error: "invalid request" });
  }
}
