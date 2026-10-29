/* LYBELLE pricing engine.
 *
 * One file, shared by the storefront (loaded as a classic <script>) and the
 * API routes (imported for its side effect). It keeps four layers apart:
 *
 *   1. base price     the product's own price, never reduced by a promotion
 *   2. plan price     what a plan (3 months, 6 months, Necessity Box) costs
 *   3. launch promo   a temporary percentage, claimed server-side per order
 *   4. final price    what the customer pays, plus delivery
 *
 * Nothing here talks to the network or storage. The server decides whether
 * the launch promotion is active for an order and passes that in.
 */
(function (root) {
  "use strict";

  var PLAN_IDS = ["start", "bundle6", "box"];

  /* What each plan puts in the box, per unit of the plan. */
  var PLAN_SHAPE = {
    start:   { bottles: 1, months: 3, complement: false },
    bundle6: { bottles: 2, months: 6, complement: false },
    box:     { bottles: 2, months: 6, complement: true }
  };

  var DEFAULT_CONFIG = {
    version: 1,
    currency: "DH",
    delivery: { fee: 35, freeThreshold: 500 },
    products: {
      selenium:  { base: 329 },
      noctiglyc: { base: 349 },
      huile:     { base: 189 },
      gel:       { base: 129 },
      duo:       { base: 219 },
      rituel:    { base: 399 }
    },
    /* Products sold as 3 / 6 months / Necessity Box. */
    plans: {
      selenium:  { enabled: true, bundle6: { price: 569 }, box: { price: 749, complement: "huile" } },
      noctiglyc: { enabled: true, bundle6: { price: 599 }, box: { price: 699, complement: "gel" } }
    },
    /* Plans that always ship free, whatever the basket total. */
    planFreeDelivery: { start: false, bundle6: true, box: true },
    promo: {
      enabled: true,
      percent: 20,
      limit: 100,
      startsAt: null,
      endsAt: null,
      plans: ["start", "bundle6", "box"],
      products: ["selenium", "noctiglyc"]
    },
    /* Code -> percent. Codes never stack with the launch promotion. */
    coupons: { LYBELLE10: 10, BIENVENUE: 15 }
  };

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }

  function int(value, min, max, fallback) {
    var n = Number(value);
    if (!isFinite(n)) return fallback;
    n = Math.round(n);
    if (n < min || n > max) return fallback;
    return n;
  }

  function isoOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    var t = Date.parse(value);
    return isNaN(t) ? undefined : new Date(t).toISOString();
  }

  /* Merge a stored or submitted config over the defaults and check every
   * field. Returns the clean config plus a list of what was rejected, so the
   * admin page can say why a value did not save. */
  function validateConfig(input) {
    var raw = isObj(input) ? input : {};
    var cfg = clone(DEFAULT_CONFIG);
    var errors = [];
    var productIds = Object.keys(cfg.products);

    function take(path, value, min, max) {
      if (value === undefined) return undefined;
      var n = int(value, min, max, null);
      if (n === null) { errors.push(path + " doit être un nombre entier entre " + min + " et " + max); return undefined; }
      return n;
    }

    if (isObj(raw.delivery)) {
      var fee = take("delivery.fee", raw.delivery.fee, 0, 1000);
      var thr = take("delivery.freeThreshold", raw.delivery.freeThreshold, 0, 100000);
      if (fee !== undefined) cfg.delivery.fee = fee;
      if (thr !== undefined) cfg.delivery.freeThreshold = thr;
    }

    if (isObj(raw.products)) {
      productIds.forEach(function (id) {
        if (!isObj(raw.products[id])) return;
        var base = take("products." + id + ".base", raw.products[id].base, 1, 100000);
        if (base !== undefined) cfg.products[id].base = base;
      });
    }

    if (isObj(raw.plans)) {
      Object.keys(cfg.plans).forEach(function (id) {
        var src = raw.plans[id];
        if (!isObj(src)) return;
        var dst = cfg.plans[id];
        if (typeof src.enabled === "boolean") dst.enabled = src.enabled;
        if (isObj(src.bundle6)) {
          var b6 = take("plans." + id + ".bundle6.price", src.bundle6.price, 1, 100000);
          if (b6 !== undefined) dst.bundle6.price = b6;
        }
        if (isObj(src.box)) {
          var bx = take("plans." + id + ".box.price", src.box.price, 1, 100000);
          if (bx !== undefined) dst.box.price = bx;
          if (src.box.complement !== undefined) {
            if (productIds.indexOf(src.box.complement) === -1 || src.box.complement === id) {
              errors.push("plans." + id + ".box.complement doit être un autre produit LYBELLE");
            } else {
              dst.box.complement = src.box.complement;
            }
          }
        }
      });
    }

    if (isObj(raw.planFreeDelivery)) {
      PLAN_IDS.forEach(function (plan) {
        if (typeof raw.planFreeDelivery[plan] === "boolean") cfg.planFreeDelivery[plan] = raw.planFreeDelivery[plan];
      });
    }

    if (isObj(raw.promo)) {
      var p = raw.promo, d = cfg.promo;
      if (typeof p.enabled === "boolean") d.enabled = p.enabled;
      var pct = take("promo.percent", p.percent, 1, 90);
      if (pct !== undefined) d.percent = pct;
      var lim = take("promo.limit", p.limit, 0, 100000);
      if (lim !== undefined) d.limit = lim;
      ["startsAt", "endsAt"].forEach(function (k) {
        if (p[k] === undefined) return;
        var iso = isoOrNull(p[k]);
        if (iso === undefined) errors.push("promo." + k + " n'est pas une date valide");
        else d[k] = iso;
      });
      if (d.startsAt && d.endsAt && Date.parse(d.endsAt) <= Date.parse(d.startsAt)) {
        errors.push("promo.endsAt doit être après promo.startsAt");
      }
      if (Array.isArray(p.plans)) d.plans = p.plans.filter(function (x) { return PLAN_IDS.indexOf(x) !== -1; });
      if (Array.isArray(p.products)) d.products = p.products.filter(function (x) { return productIds.indexOf(x) !== -1; });
    }

    if (isObj(raw.coupons)) {
      var coupons = {};
      Object.keys(raw.coupons).forEach(function (code) {
        var clean = String(code).trim().toUpperCase();
        if (!/^[A-Z0-9]{3,20}$/.test(clean)) { errors.push("code promo invalide : " + code); return; }
        var pc = int(raw.coupons[code], 1, 90, null);
        if (pc === null) { errors.push("le code " + clean + " doit valoir entre 1 et 90 %"); return; }
        coupons[clean] = pc;
      });
      cfg.coupons = coupons;
    }

    return { config: cfg, errors: errors };
  }

  function normaliseConfig(input) { return validateConfig(input).config; }

  /* ---------- launch promotion state ---------- */

  function promoState(config, used, now) {
    var p = config.promo;
    var t = typeof now === "number" ? now : Date.now();
    var count = Math.max(0, Number(used) || 0);
    if (!p.enabled || p.limit <= 0) return { active: false, reason: "disabled", percent: p.percent };
    if (p.startsAt && t < Date.parse(p.startsAt)) return { active: false, reason: "scheduled", percent: p.percent };
    if (p.endsAt && t > Date.parse(p.endsAt)) return { active: false, reason: "ended", percent: p.percent };
    if (count >= p.limit) return { active: false, reason: "ended", percent: p.percent };
    return { active: true, reason: "active", percent: p.percent, remaining: p.limit - count };
  }

  /* ---------- cart keys ---------- */

  function lineKey(productId, plan) { return !plan || plan === "start" ? productId : productId + ":" + plan; }

  function parseKey(key) {
    var parts = String(key).split(":");
    return { productId: parts[0], plan: parts[1] || "start" };
  }

  function hasPlans(config, productId) {
    var p = config.plans[productId];
    return Boolean(p && p.enabled);
  }

  /* Contents and price of one unit of a plan, or null if it is not sold. */
  function planUnit(config, productId, plan) {
    var product = config.products[productId];
    if (!product) return null;
    if (plan === "start") {
      return { items: [{ id: productId, qty: 1 }], value: product.base, price: product.base };
    }
    if (!hasPlans(config, productId)) return null;
    var def = config.plans[productId];
    if (plan === "bundle6") {
      return { items: [{ id: productId, qty: 2 }], value: product.base * 2, price: def.bundle6.price };
    }
    if (plan === "box") {
      var comp = def.box.complement;
      var compProduct = config.products[comp];
      if (!compProduct) return null;
      return {
        items: [{ id: productId, qty: 2 }, { id: comp, qty: 1 }],
        value: product.base * 2 + compProduct.base,
        price: def.box.price
      };
    }
    return null;
  }

  function isValidKey(config, key) {
    var k = parseKey(key);
    return PLAN_IDS.indexOf(k.plan) !== -1 && Boolean(planUnit(config, k.productId, k.plan));
  }

  function promoApplies(config, productId, plan) {
    return config.promo.plans.indexOf(plan) !== -1 && config.promo.products.indexOf(productId) !== -1;
  }

  /* The three options shown in the selector, with every layer priced. */
  function planOptions(config, productId, promoActive) {
    if (!hasPlans(config, productId)) return [];
    return PLAN_IDS.map(function (plan) {
      var unit = planUnit(config, productId, plan);
      if (!unit) return null;
      var promo = promoActive && promoApplies(config, productId, plan) ? Math.round(unit.price * config.promo.percent / 100) : 0;
      return {
        plan: plan,
        key: lineKey(productId, plan),
        months: PLAN_SHAPE[plan].months,
        bottles: PLAN_SHAPE[plan].bottles,
        items: unit.items,
        complement: plan === "box" ? config.plans[productId].box.complement : null,
        value: unit.value,
        price: unit.price,
        bundleSaving: unit.value - unit.price,
        promo: promo,
        final: unit.price - promo,
        freeDelivery: Boolean(config.planFreeDelivery[plan])
      };
    }).filter(Boolean);
  }

  /* ---------- quote ---------- */

  function quote(cart, config, opts) {
    var options = opts || {};
    var promoActive = Boolean(options.promoActive);
    var lines = [];
    Object.keys(cart || {}).forEach(function (key) {
      var qty = int(cart[key], 1, 99, 0);
      if (!qty || !isValidKey(config, key)) return;
      var k = parseKey(key);
      var unit = planUnit(config, k.productId, k.plan);
      var eligible = promoActive && promoApplies(config, k.productId, k.plan);
      var unitPromo = eligible ? Math.round(unit.price * config.promo.percent / 100) : 0;
      lines.push({
        key: key,
        productId: k.productId,
        plan: k.plan,
        qty: qty,
        items: unit.items,
        unitValue: unit.value,
        unitPrice: unit.price,
        unitPromo: unitPromo,
        unitFinal: unit.price - unitPromo,
        promoEligible: eligible,
        lineValue: unit.value * qty,
        lineBundleSaving: (unit.value - unit.price) * qty,
        linePromo: unitPromo * qty,
        lineFinal: (unit.price - unitPromo) * qty,
        freeDelivery: Boolean(config.planFreeDelivery[k.plan])
      });
    });

    var sum = function (field) { return lines.reduce(function (s, l) { return s + l[field]; }, 0); };
    var value = sum("lineValue");
    var bundleSaving = sum("lineBundleSaving");
    var promoDiscount = sum("linePromo");
    var afterPromo = sum("lineFinal");

    var code = String(options.coupon || "").trim().toUpperCase();
    var couponRate = code && config.coupons[code] ? config.coupons[code] : 0;
    var couponBase = lines.filter(function (l) { return !l.promoEligible; }).reduce(function (s, l) { return s + l.lineFinal; }, 0);
    var couponDiscount = Math.round(couponBase * couponRate / 100);

    var merchandise = afterPromo - couponDiscount;
    var byPlan = lines.some(function (l) { return l.freeDelivery; });
    var byThreshold = merchandise >= config.delivery.freeThreshold;
    var shipping = lines.length === 0 || byPlan || byThreshold ? 0 : config.delivery.fee;

    return {
      currency: config.currency,
      lines: lines,
      count: lines.reduce(function (s, l) { return s + l.qty; }, 0),
      value: value,
      bundleSaving: bundleSaving,
      promoDiscount: promoDiscount,
      promoApplied: promoDiscount > 0,
      coupon: couponRate ? code : "",
      couponRate: couponRate,
      couponValid: Boolean(couponRate),
      couponDiscount: couponDiscount,
      couponBlockedByPromo: Boolean(couponRate) && couponBase === 0 && lines.length > 0,
      merchandise: merchandise,
      shipping: shipping,
      freeDelivery: lines.length > 0 && shipping === 0 ? (byPlan ? "plan" : "threshold") : null,
      toFreeDelivery: lines.length && !byPlan && !byThreshold ? config.delivery.freeThreshold - merchandise : 0,
      savings: bundleSaving + promoDiscount + couponDiscount,
      total: merchandise + shipping
    };
  }

  /* What the public storefront may see. Coupon codes and the order counter
   * stay on the server. */
  function publicConfig(config) {
    var c = clone(config);
    delete c.coupons;
    return c;
  }

  root.LybellePricing = {
    PLAN_IDS: PLAN_IDS.slice(),
    PLAN_SHAPE: PLAN_SHAPE,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    validateConfig: validateConfig,
    normaliseConfig: normaliseConfig,
    promoState: promoState,
    lineKey: lineKey,
    parseKey: parseKey,
    hasPlans: hasPlans,
    planUnit: planUnit,
    isValidKey: isValidKey,
    planOptions: planOptions,
    quote: quote,
    publicConfig: publicConfig
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
