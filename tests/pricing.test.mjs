import { test } from "node:test";
import assert from "node:assert/strict";
import "../pricing.js";

const P = globalThis.LybellePricing;
const cfg = () => P.normaliseConfig({});

test("brief prices: base, 6-month bundles and savings", () => {
  const c = cfg();
  const noct = P.planOptions(c, "noctiglyc", false);
  assert.deepEqual(noct.map((o) => [o.plan, o.value, o.price, o.bundleSaving]), [
    ["start", 349, 349, 0],
    ["bundle6", 698, 599, 99],
    ["box", 827, 699, 128]
  ]);
  const sel = P.planOptions(c, "selenium", false);
  assert.deepEqual(sel.slice(0, 2).map((o) => [o.value, o.price, o.bundleSaving]), [[329, 329, 0], [658, 569, 89]]);
});

test("Necessity Box price stays inside 699-749 and contains 2 bottles + complement", () => {
  const c = cfg();
  for (const id of ["selenium", "noctiglyc"]) {
    const box = P.planOptions(c, id, false).find((o) => o.plan === "box");
    assert.ok(box.price >= 699 && box.price <= 749);
    assert.equal(box.items[0].qty, 2);
    assert.equal(box.items.length, 2);
    assert.notEqual(box.complement, id);
  }
});

test("launch promo is 20% on top of plan prices, base prices untouched", () => {
  const c = cfg();
  const q = P.quote({ noctiglyc: 1, "selenium:bundle6": 1 }, c, { promoActive: true });
  assert.equal(q.lines[0].unitPrice, 349);
  assert.equal(q.lines[0].unitFinal, 279);
  assert.equal(q.lines[1].unitFinal, 455);
  assert.equal(c.products.noctiglyc.base, 349);
  assert.equal(q.promoDiscount, 70 + 114);
});

test("6-month and box ship free even when the promo takes them under the threshold", () => {
  const c = cfg();
  const q = P.quote({ "noctiglyc:bundle6": 1 }, c, { promoActive: true });
  assert.equal(q.merchandise, 479);
  assert.equal(q.shipping, 0);
  assert.equal(q.freeDelivery, "plan");
  const single = P.quote({ noctiglyc: 1 }, c, { promoActive: false });
  assert.equal(single.shipping, 35);
  assert.equal(single.toFreeDelivery, 500 - 349);
  const two = P.quote({ noctiglyc: 1, huile: 1 }, c, {});
  assert.equal(two.shipping, 0);
  assert.equal(two.freeDelivery, "threshold");
});

test("coupons only apply to lines without the launch promo", () => {
  const c = cfg();
  const q = P.quote({ noctiglyc: 1, huile: 1 }, c, { promoActive: true, coupon: "bienvenue" });
  assert.equal(q.couponDiscount, Math.round(189 * 0.15));
  const blocked = P.quote({ noctiglyc: 1 }, c, { promoActive: true, coupon: "BIENVENUE" });
  assert.equal(blocked.couponDiscount, 0);
  assert.equal(blocked.couponBlockedByPromo, true);
});

test("promo state: limit, dates, disabled", () => {
  const c = cfg();
  assert.equal(P.promoState(c, 99, Date.now()).active, true);
  assert.equal(P.promoState(c, 100, Date.now()).reason, "ended");
  const dated = P.normaliseConfig({ promo: { startsAt: "2030-01-01T00:00:00Z" } });
  assert.equal(P.promoState(dated, 0, Date.now()).reason, "scheduled");
  const off = P.normaliseConfig({ promo: { enabled: false } });
  assert.equal(P.promoState(off, 0).reason, "disabled");
});

test("validation rejects bad admin input and keeps defaults", () => {
  const r = P.validateConfig({ products: { noctiglyc: { base: -5 } }, plans: { selenium: { box: { complement: "selenium" } } }, promo: { percent: 200 } });
  assert.equal(r.errors.length, 3);
  assert.equal(r.config.products.noctiglyc.base, 349);
  assert.equal(r.config.plans.selenium.box.complement, "huile");
});

test("invalid cart keys are dropped", () => {
  const q = P.quote({ "noctiglyc:box": 1, "huile:bundle6": 2, nope: 1, "selenium:weird": 1 }, cfg(), {});
  assert.deepEqual(q.lines.map((l) => l.key), ["noctiglyc:box"]);
});
