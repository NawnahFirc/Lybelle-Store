/* /api/admin: read and change prices, plans and the launch offer.
 * Protected by the LYBELLE_ADMIN_PASSWORD environment variable
 * (sent as "Authorization: Bearer <password>").
 *
 * GET  -> { config, used, promo, storage, orders }
 * PUT  -> body { config?, used? } -> same shape, or { errors } with 422 */
import { Pricing, checkAdmin, loadPricing, readJson, send } from "./_lib/http.js";

async function snapshot() {
  const { store, config, used, promo } = await loadPricing();
  const orders = await store.listOrders(30).catch(() => []);
  return { config, used, promo, storage: store.kind, orders };
}

export default async function handler(req, res) {
  const auth = checkAdmin(req);
  if (!auth.ok) {
    if (auth.status === 401) await new Promise((r) => setTimeout(r, 400));
    return send(res, auth.status, { error: auth.error });
  }

  try {
    if (req.method === "GET") return send(res, 200, await snapshot());

    if (req.method === "PUT") {
      const body = await readJson(req);
      const { store } = await loadPricing();
      if (store.kind === "none") {
        return send(res, 503, { error: "Aucun stockage configuré : ajoutez Upstash Redis / Vercel KV au projet pour enregistrer les réglages." });
      }
      const errors = [];
      let nextConfig = null;
      if (body.config !== undefined) {
        const result = Pricing.validateConfig(body.config);
        errors.push(...result.errors);
        nextConfig = result.config;
      }
      let nextUsed = null;
      if (body.used !== undefined) {
        const n = Number(body.used);
        if (!Number.isInteger(n) || n < 0 || n > 100000) errors.push("Le nombre de commandes promo utilisées doit être un entier positif.");
        else nextUsed = n;
      }
      if (errors.length) return send(res, 422, { errors });
      if (nextConfig) await store.setConfig(nextConfig);
      if (nextUsed !== null) await store.setUsed(nextUsed);
      return send(res, 200, await snapshot());
    }

    send(res, 405, { error: "method not allowed" });
  } catch (err) {
    send(res, err.status || 500, { error: err.code === "NO_STORE" ? "Stockage indisponible." : "Erreur serveur." });
  }
}
