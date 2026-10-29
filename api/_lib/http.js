import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import "../../pricing.js";
import { getStore } from "./store.js";

export const Pricing = globalThis.LybellePricing;

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export async function readJson(req, limit = 32 * 1024) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("payload too large"), { status: 413 });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

export function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = fwd || req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown";
  /* Hash it: only used as a rate-limit bucket, never stored in the clear. */
  return createHash("sha256").update(String(ip)).digest("hex").slice(0, 24);
}

export async function loadPricing() {
  const store = getStore();
  const [stored, used] = await Promise.all([
    store.getConfig().catch(() => null),
    store.getUsed().catch(() => 0)
  ]);
  const config = Pricing.normaliseConfig(stored || {});
  let promo = Pricing.promoState(config, used, Date.now());
  /* Without storage the counter cannot be trusted, so the offer is off. */
  if (store.kind === "none" && promo.active) promo = { active: false, reason: "unavailable", percent: config.promo.percent };
  return { store, config, used, promo };
}

export function checkAdmin(req) {
  const secret = process.env.LYBELLE_ADMIN_PASSWORD || "";
  if (!secret) return { ok: false, status: 503, error: "LYBELLE_ADMIN_PASSWORD n'est pas configuré sur le serveur." };
  const header = String(req.headers.authorization || "");
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, status: 401, error: "Mot de passe incorrect." };
}

export function orderId() {
  return "LYB-" + Date.now().toString(36).toUpperCase().slice(-6) + randomBytes(2).toString("hex").toUpperCase();
}

/* Keep only well-formed cart entries; the engine re-checks every key. */
export function cleanCart(input) {
  const out = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  Object.entries(input).slice(0, 30).forEach(([key, qty]) => {
    if (typeof key !== "string" || key.length > 40) return;
    const n = Math.floor(Number(qty));
    if (n >= 1 && n <= 99) out[key] = n;
  });
  return out;
}
