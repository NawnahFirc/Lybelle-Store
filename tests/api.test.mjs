import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 4300 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), "lybelle-api-"));
let server;

before(async () => {
  server = spawn(process.execPath, ["dev-server.mjs", "--port", String(PORT), "--host", "127.0.0.1"], {
    env: { ...process.env, LYBELLE_DATA_FILE: join(dir, "store.json"), LYBELLE_ADMIN_PASSWORD: "test-secret", LYBELLE_PROMO_IP_LIMIT: "500", VERCEL: "" },
    stdio: ["ignore", "pipe", "inherit"]
  });
  await new Promise((resolve) => server.stdout.once("data", resolve));
});
after(() => { server.kill(); rmSync(dir, { recursive: true, force: true }); });

const json = (path, opts = {}) => fetch(BASE + path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } })
  .then(async (r) => ({ status: r.status, body: await r.json() }));
const admin = (method, body) => json("/api/admin", { method, body: body && JSON.stringify(body), headers: { Authorization: "Bearer test-secret" } });
const order = (cart, draftId, coupon) => json("/api/orders", { method: "POST", body: JSON.stringify({ cart, draftId, coupon }) });

test("public pricing hides coupons and shows the offer", async () => {
  const r = await json("/api/pricing");
  assert.equal(r.status, 200);
  assert.equal(r.body.config.coupons, undefined);
  assert.equal(r.body.promo.active, true);
});

test("admin needs the password", async () => {
  const r = await json("/api/admin");
  assert.equal(r.status, 401);
});

test("first 100 orders get the offer, then it stops; resubmits reuse their slot", async () => {
  await admin("PUT", { used: 98 });
  const a = await order({ noctiglyc: 1 }, "draft-aaaaaaaa");
  assert.equal(a.body.order.promoNumber, 99);
  assert.equal(a.body.quote.total, 279 + 35);
  const again = await order({ noctiglyc: 1 }, "draft-aaaaaaaa");
  assert.equal(again.body.order.promoNumber, 99, "same checkout keeps its slot");
  const b = await order({ "selenium:bundle6": 1 }, "draft-bbbbbbbb");
  assert.equal(b.body.order.promoNumber, 100);
  assert.equal(b.body.promo.active, false, "offer closes after #100");
  const c = await order({ noctiglyc: 1 }, "draft-cccccccc");
  assert.equal(c.body.order.promoNumber, null);
  assert.equal(c.body.promoNotice, "ended");
  assert.equal(c.body.quote.total, 349 + 35);
  const late = await order({ noctiglyc: 1 }, "draft-aaaaaaaa");
  assert.equal(late.body.order.promoNumber, 99, "a slot already held survives the offer closing");
  const snap = await admin("GET");
  assert.equal(snap.body.used, 100);
});

test("parallel checkouts never exceed the limit", async () => {
  await admin("PUT", { used: 95 });
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => order({ noctiglyc: 1 }, `para-${String(i).padStart(8, "0")}`)));
  const numbers = results.map((r) => r.body.order.promoNumber).filter(Boolean);
  assert.equal(numbers.length, 5);
  assert.deepEqual([...numbers].sort((x, y) => x - y), [96, 97, 98, 99, 100]);
});

test("admin can change prices and the box complement; validation errors return 422", async () => {
  const bad = await admin("PUT", { config: { promo: { percent: 0 } } });
  assert.equal(bad.status, 422);
  const ok = await admin("PUT", { config: { plans: { noctiglyc: { box: { price: 729, complement: "huile" } } } }, used: 0 });
  assert.equal(ok.status, 200);
  const pub = await json("/api/pricing");
  assert.equal(pub.body.config.plans.noctiglyc.box.price, 729);
  assert.equal(pub.body.config.plans.noctiglyc.box.complement, "huile");
});

test("coupon check goes through the server", async () => {
  const r = await json("/api/quote", { method: "POST", body: JSON.stringify({ cart: { huile: 1 }, coupon: "LYBELLE10" }) });
  assert.equal(r.body.quote.couponDiscount, 19);
});

test("orders reject a tampered or empty cart", async () => {
  const r = await order({ "fake:box": 3 }, "draft-zzzzzzzz");
  assert.equal(r.status, 400);
});
