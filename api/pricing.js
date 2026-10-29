/* GET /api/pricing: public prices, plans and whether the launch offer is on. */
import { Pricing, loadPricing, send } from "./_lib/http.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "method not allowed" });
  try {
    const { config, promo } = await loadPricing();
    send(res, 200, {
      config: Pricing.publicConfig(config),
      promo: { active: promo.active, reason: promo.reason, percent: promo.percent }
    });
  } catch (err) {
    send(res, 500, { error: "pricing unavailable" });
  }
}
