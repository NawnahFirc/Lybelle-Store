/* Storage for the pricing config, the launch-promo counter and a short log
 * of recent orders (no customer details are stored).
 *
 *  - Production: Upstash Redis / Vercel KV over REST. Set either
 *    UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN or
 *    KV_REST_API_URL + KV_REST_API_TOKEN.
 *  - Local `npm run dev`: a JSON file in .data/ (gitignored).
 *  - Neither: storage is "none". The site then sells at normal prices and
 *    never advertises a launch offer it cannot count.
 *
 * The promo claim is atomic in Redis (one Lua script), so two customers
 * checking out at the same second cannot both become order #100.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const PREFIX = process.env.LYBELLE_KV_PREFIX || "lybelle";
const K = {
  config: `${PREFIX}:config`,
  used: `${PREFIX}:promo:used`,
  claims: `${PREFIX}:promo:claims`,
  orders: `${PREFIX}:orders`,
  ip: (ip) => `${PREFIX}:promo:ip:${ip}`
};
const ORDER_LOG = 500;

const CLAIM_LUA = `
local existing = redis.call('HGET', KEYS[2], ARGV[1])
if existing then return {tonumber(existing), 1} end
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
if used >= tonumber(ARGV[2]) then return {0, 3} end
local ipc = tonumber(redis.call('GET', KEYS[3]) or '0')
if ipc >= tonumber(ARGV[3]) then return {0, 2} end
local n = redis.call('INCR', KEYS[1])
redis.call('HSET', KEYS[2], ARGV[1], n)
redis.call('INCR', KEYS[3])
redis.call('EXPIRE', KEYS[3], tonumber(ARGV[4]))
return {n, 0}`;

const CLAIM_REASON = { 0: "claimed", 1: "reused", 2: "rate_limited", 3: "limit_reached" };

function redisStore(url, token) {
  const call = async (command) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(command)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(`redis: ${data.error || res.status}`);
    return data.result;
  };
  return {
    kind: "redis",
    async getConfig() { const raw = await call(["GET", K.config]); return raw ? JSON.parse(raw) : null; },
    async setConfig(cfg) { await call(["SET", K.config, JSON.stringify(cfg)]); },
    async getUsed() { return Number(await call(["GET", K.used])) || 0; },
    async setUsed(n) { await call(["SET", K.used, String(n)]); },
    async claimPromo({ draftId, limit, ip, ipLimit, ipTtl }) {
      const [n, code] = await call(["EVAL", CLAIM_LUA, "3", K.used, K.claims, K.ip(ip), draftId, String(limit), String(ipLimit), String(ipTtl)]);
      return { number: Number(n) || null, reason: CLAIM_REASON[code] || "claimed" };
    },
    async recordOrder(order) {
      await call(["LPUSH", K.orders, JSON.stringify(order)]);
      await call(["LTRIM", K.orders, "0", String(ORDER_LOG - 1)]);
    },
    async listOrders(n = 50) {
      const rows = await call(["LRANGE", K.orders, "0", String(n - 1)]);
      return (rows || []).map((r) => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);
    }
  };
}

function fileStore(path) {
  let queue = Promise.resolve();
  const locked = (fn) => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };
  const load = async () => {
    try { return JSON.parse(await readFile(path, "utf8")); }
    catch { return { config: null, used: 0, claims: {}, ip: {}, orders: [] }; }
  };
  const save = async (db) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(db, null, 2)); };
  return {
    kind: "file",
    getConfig: () => locked(async () => (await load()).config),
    setConfig: (cfg) => locked(async () => { const db = await load(); db.config = cfg; await save(db); }),
    getUsed: () => locked(async () => Number((await load()).used) || 0),
    setUsed: (n) => locked(async () => { const db = await load(); db.used = n; await save(db); }),
    claimPromo: ({ draftId, limit, ip, ipLimit, ipTtl }) => locked(async () => {
      const db = await load();
      db.claims ||= {}; db.ip ||= {};
      if (db.claims[draftId]) return { number: db.claims[draftId], reason: "reused" };
      if ((Number(db.used) || 0) >= limit) return { number: null, reason: "limit_reached" };
      const now = Date.now();
      const slot = db.ip[ip] && db.ip[ip].until > now ? db.ip[ip] : { count: 0, until: now + ipTtl * 1000 };
      if (slot.count >= ipLimit) return { number: null, reason: "rate_limited" };
      db.used = (Number(db.used) || 0) + 1;
      db.claims[draftId] = db.used;
      slot.count += 1; db.ip[ip] = slot;
      await save(db);
      return { number: db.used, reason: "claimed" };
    }),
    recordOrder: (order) => locked(async () => { const db = await load(); db.orders = [order, ...(db.orders || [])].slice(0, ORDER_LOG); await save(db); }),
    listOrders: (n = 50) => locked(async () => ((await load()).orders || []).slice(0, n))
  };
}

function noStore() {
  const unavailable = async () => { throw Object.assign(new Error("storage not configured"), { code: "NO_STORE" }); };
  return {
    kind: "none",
    getConfig: async () => null,
    setConfig: unavailable,
    getUsed: async () => 0,
    setUsed: unavailable,
    claimPromo: async () => ({ number: null, reason: "unavailable" }),
    recordOrder: async () => {},
    listOrders: async () => []
  };
}

let cached;
export function getStore() {
  if (cached) return cached;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) cached = redisStore(url.replace(/\/$/, ""), token);
  else if (!process.env.VERCEL) cached = fileStore(process.env.LYBELLE_DATA_FILE || join(process.cwd(), ".data", "lybelle-store.json"));
  else cached = noStore();
  return cached;
}
