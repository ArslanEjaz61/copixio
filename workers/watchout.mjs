// pm2 "copixio-watchout" (25 Nov): "Watchout coins" for the Smartbot dashboard -- coins whose futures open interest
// grew 50% or more over the last 24 hours (rolling), by USD value (as Coinglass and CEX Screener show it).
// It runs HERE, not on the Smartbot server, so its Binance requests never count against the alert engine's IP limit.
//
//  - Binance USDT perpetuals: /futures/data/openInterestHist, 5-minute rows; the newest published row against the row
//    exactly 24 h before it (sumOpenInterestValue = USD, sumOpenInterest = coins). The same Binance figures Coinglass
//    shows in its Binance row. One request per coin, spread over the 5 minutes (about 2 a second).
//  - KuCoin USDT perpetuals whose coin is NOT on Binance futures: KuCoin has no OI history, so this process samples
//    /contracts/active every 5 minutes (one request for all coins) and keeps 26 h; the 24 h change starts 24 h after
//    the first sample. USD value = openInterest (lots) x multiplier x mark price.
// Result in Redis "wo:list" (JSON), served by /api/watchout to the Smartbot dashboard with a shared key.
try { process.loadEnvFile(new URL("../.env", import.meta.url)); } catch { /* env from pm2 */ }
import { redis } from "../lib/redis.js";

const MIN_PCT = Number(process.env.WATCHOUT_MIN_PCT || 50);
const STEP = 300e3;
const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJ(u, ms = 15000) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(ms) });
      if (r.status === 429 || r.status === 418) { log(`rate limited ${r.status} on ${u.split("?")[0]}; waiting`); await sleep(60000 * (i + 1)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await sleep(2000 * (i + 1)); }
  }
  return null;
}
const pct = (a, b) => (Number(b) > 0 && Number.isFinite(Number(a)) ? (Number(a) / Number(b) - 1) * 100 : null);

// ------------------------------------------------------------------ Binance
let perps = [], perpsAt = 0;
async function binancePerps() {
  if (perps.length && Date.now() - perpsAt < 36e5) return perps;
  const j = await getJ("https://fapi.binance.com/fapi/v1/exchangeInfo", 20000);
  const list = (j?.symbols || []).filter((s) => s.contractType === "PERPETUAL" && s.quoteAsset === "USDT" && s.status === "TRADING").map((s) => ({ symbol: s.symbol, base: s.baseAsset }));
  if (list.length > 100) { perps = list; perpsAt = Date.now(); }
  return perps;
}
async function binanceOne(sym) {
  const rows = await getJ(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${sym}&period=5m&limit=289`);
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const last = rows[rows.length - 1];
  const base = rows.find((r) => r.timestamp === last.timestamp - 864e5);
  if (!base) return null; // a coin listed less than 24 h ago has no 24 h figure
  const day0 = Math.floor(last.timestamp / 864e5) * 864e5;
  const mid = rows.find((r) => r.timestamp === day0);
  return {
    at: last.timestamp, oiUsd: Number(last.sumOpenInterestValue), oi: Number(last.sumOpenInterest),
    chg24Usd: pct(last.sumOpenInterestValue, base.sumOpenInterestValue), chg24Coins: pct(last.sumOpenInterest, base.sumOpenInterest),
    chgDayUsd: mid && mid !== last ? pct(last.sumOpenInterestValue, mid.sumOpenInterestValue) : null,
  };
}

// ------------------------------------------------------------------ KuCoin (sampled here)
const kcName = (c) => (c.baseCurrency === "XBT" ? "BTC" : c.baseCurrency);
async function kucoinSample(boundary) {
  const j = await getJ("https://api-futures.kucoin.com/api/v1/contracts/active", 20000);
  const list = (j?.data || []).filter((c) => c.quoteCurrency === "USDT" && !c.isInverse && c.status === "Open");
  if (!list.length) return null;
  const snap = {};
  for (const c of list) {
    const lots = Number(c.openInterest), mult = Number(c.multiplier), px = Number(c.markPrice);
    if (lots > 0 && mult > 0 && px > 0) snap[kcName(c)] = JSON.stringify([lots * mult * px, lots * mult, px, c.symbol]);
  }
  const key = `wo:kc:${boundary}`;
  await redis().hset(key, snap);
  await redis().expire(key, 26 * 3600);
  return snap;
}

// the chart the dashboard opens: Binance spot when it exists, else KuCoin spot (KC_XXXUSDT), else none
let spot = { bn: new Set(), kc: new Set(), at: 0 };
async function chartOf(base) {
  if (Date.now() - spot.at > 36e5) {
    const [b, k] = await Promise.all([getJ("https://api.binance.com/api/v3/exchangeInfo?permissions=SPOT", 20000), getJ("https://api.kucoin.com/api/v2/symbols", 20000)]);
    if (b?.symbols && k?.data) spot = { at: Date.now(), bn: new Set(b.symbols.filter((s) => s.status === "TRADING" && s.quoteAsset === "USDT").map((s) => s.baseAsset)), kc: new Set(k.data.filter((s) => s.enableTrading && s.quoteCurrency === "USDT").map((s) => s.baseCurrency)) };
  }
  const c = spot.bn.has(base) ? base : base.replace(/^1000+/, "");
  return spot.bn.has(c) ? `${c}USDT` : spot.kc.has(c) ? `KC_${c}USDT` : null;
}

// ------------------------------------------------------------------ one pass
let running = false;
async function pass() {
  if (running) return;
  running = true;
  const t0 = Date.now(), boundary = Math.floor(t0 / STEP) * STEP;
  try {
    const [list, tick] = await Promise.all([binancePerps(), getJ("https://fapi.binance.com/fapi/v1/ticker/24hr", 20000)]);
    const px = new Map((tick || []).map((t) => [t.symbol, { price: Number(t.lastPrice), chg: Number(t.priceChangePercent), volUsd: Number(t.quoteVolume) }]));
    const rows = [];
    let read = 0;
    // spread evenly so the pass ends about 3.5 minutes after it starts (~2.5 requests a second, well under Binance's
    // 1000 per 5 minutes for this endpoint)
    const deadline = t0 + 210e3;
    for (let i = 0; i < list.length; i++) {
      const s = list[i], st = Date.now();
      const r = await binanceOne(s.symbol).catch(() => null);
      if (r) { read++; rows.push({ symbol: s.symbol, base: s.base, exchange: "Binance", ...r, ...(px.get(s.symbol) || {}) }); }
      const left = list.length - i - 1;
      if (left) await sleep(Math.max(120, (deadline - Date.now()) / left - (Date.now() - st)));
    }
    // KuCoin-only coins
    const kcNow = await kucoinSample(boundary).catch(() => null);
    let kcRead = 0, kcWarm = false;
    if (kcNow) {
      let old = {};
      for (const d of [0, -STEP, STEP, -2 * STEP, 2 * STEP]) { old = await redis().hgetall(`wo:kc:${boundary - 864e5 + d}`); if (Object.keys(old || {}).length) break; }
      kcWarm = Object.keys(old || {}).length > 0;
      const onBinance = new Set(list.map((s) => s.base.replace(/^1000+/, "")));
      for (const [base, v] of Object.entries(kcNow)) {
        if (onBinance.has(base.replace(/^1000+/, "")) || !old?.[base]) continue;
        const [usd, coins, price, sym] = JSON.parse(v), [usd0, coins0] = JSON.parse(old[base]);
        kcRead++;
        rows.push({ symbol: `${base}USDT`, base, exchange: "KuCoin", kcContract: sym, at: boundary, oiUsd: usd, oi: coins, chg24Usd: pct(usd, usd0), chg24Coins: pct(coins, coins0), chgDayUsd: null, price });
      }
    }
    const hits = rows.filter((r) => r.chg24Usd !== null && r.chg24Usd >= MIN_PCT).sort((a, b) => b.chg24Usd - a.chg24Usd);
    for (const h of hits) h.chart = await chartOf(h.base).catch(() => null);
    const out = { at: Date.now(), windowEnd: Math.max(0, ...rows.filter((r) => r.exchange === "Binance").map((r) => r.at)), minPct: MIN_PCT, basis: "USD value, rolling 24 h",
      binanceCoins: list.length, binanceRead: read, kucoinRead: kcRead, kucoinWarm: kcWarm, coins: hits };
    await redis().set("wo:list", JSON.stringify(out));
    await redis().set("wo:all", JSON.stringify(rows.map((r) => [r.symbol, r.exchange, r.chg24Usd === null ? null : +r.chg24Usd.toFixed(2)])));
    log(`pass: Binance ${read}/${list.length}, KuCoin-only ${kcRead}${kcWarm ? "" : " (warming up: 24 h of samples needed)"}, ${hits.length} coins at +${MIN_PCT}% or more, ${Math.round((Date.now() - t0) / 1000)} s`);
  } catch (e) { log("pass:", e.message); }
  finally { running = false; }
}

// a pass every 5 minutes, starting 100 s after each boundary (Binance publishes the 5-minute OI row about 1-3 min late)
async function main() {
  log(`copixio-watchout up: OI +${MIN_PCT}% in 24 h (USD value)`);
  pass();
  for (;;) {
    const next = (Math.floor((Date.now() - 100e3) / STEP) + 1) * STEP + 100e3;
    await sleep(next - Date.now());
    await pass();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
