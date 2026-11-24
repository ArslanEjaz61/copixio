// USDT-margined perpetual futures through ccxt (24 Nov): Binance (live and demo), KuCoin, OKX, Bitget, HTX.
// Isolated margin, the group's leverage, one position per coin and side. Long and short.
// - quantities are in CONTRACTS (ccxt amount); notional = contracts x contractSize x price;
// - every order carries our client id and is looked up by it after an unclear answer;
// - closes are reduce-only market orders, so a close can never open a position the other way;
// - no stop order rests on the exchange: the trader watches the price every few seconds (as for the ccxt spot exchanges).
import ccxt from "ccxt";
import { exchangeMeta, FUTURES_IDS } from "./list.js";
import { unseal } from "../seal.js";

const TIMEOUT = 15000;
const MARKETS_TTL = 30 * 60e3;
// our exchange id -> ccxt class and options
export const FUTURES = {
  binance: { cls: "binanceusdm" },
  kucoin: { cls: "kucoinfutures" },
  okx: { cls: "okx", type: "swap" },
  bitget: { cls: "bitget", type: "swap" },
  htx: { cls: "htx", type: "swap" },
};
export const futuresOk = (id) => !!FUTURES[id] && FUTURES_IDS.includes(id);
const shared = new Map();

function make(id, env, cred = {}) {
  const m = FUTURES[id];
  const ex = new ccxt[m.cls]({ apiKey: cred.key, secret: cred.secret, password: cred.passphrase, enableRateLimit: true, timeout: TIMEOUT, options: { defaultType: m.type || "swap" } });
  if (env === "demo" && typeof ex.enableDemoTrading === "function") ex.enableDemoTrading(true); // Binance demo futures
  return ex;
}
async function publicEx(id, env) {
  const k = `${id}|${env}`;
  const s = shared.get(k);
  if (s && Date.now() - s.at < MARKETS_TTL) return s.ex;
  const ex = make(id, env);
  await ex.loadMarkets();
  shared.set(k, { at: Date.now(), ex });
  return ex;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cidFor = (clientId) => String(clientId).replace(/[^A-Za-z0-9]/g, "").slice(0, 32);

export function futuresFor(conn) {
  const id = conn.exchange;
  if (!FUTURES[id]) return null;
  const cred = { key: unseal(conn.keySealed), secret: unseal(conn.secretSealed), passphrase: conn.passphraseSealed ? unseal(conn.passphraseSealed) : undefined };
  const env = conn.env || "live";
  let exP = null;
  const ex = () => (exP ||= (async () => { const pub = await publicEx(id, env); const e = make(id, env, cred); e.setMarkets(pub.markets, pub.currencies); return e; })().catch((e) => { exP = null; throw e; }));
  const name = exchangeMeta(id).name;

  async function feeOf(e, o) {
    let fees = o.fees?.length ? o.fees : o.fee ? [o.fee] : [];
    if (!fees.length && e.has.fetchOrderTrades) {
      const tr = await e.fetchOrderTrades(o.id, o.symbol).catch(() => []);
      fees = tr.flatMap((t) => (t.fees?.length ? t.fees : t.fee ? [t.fee] : []));
    }
    return fees.reduce((a, f) => a + (f?.currency === "USDT" || !f?.currency ? Number(f?.cost || 0) : 0), 0);
  }
  // the filled order: { orderId, qty (contracts), avg, usdt (notional), feeUsdt }
  async function settle(e, oid, symbol, cs) {
    for (let i = 0; i < 20; i++) {
      const o = await e.fetchOrder(oid, symbol).catch(() => null);
      if (o && Number(o.filled) > 0 && (o.status === "closed" || o.status === "canceled" || i >= 6)) {
        const qty = Number(o.filled), avg = Number(o.average || o.price || 0);
        return { orderId: String(o.id), qty, avg, usdt: qty * cs * avg, feeUsdt: await feeOf(e, o) };
      }
      await sleep(500);
    }
    throw Object.assign(new Error(`${name} did not report the fill in time`), { gateway: true });
  }
  async function byClient(e, symbol, clientId) {
    const cid = cidFor(clientId);
    try { const o = await e.fetchOrder(undefined, symbol, { clientOrderId: cid }); if (o?.id) return o; } catch { /* scan */ }
    for (const f of ["fetchClosedOrders", "fetchOrders"]) {
      if (!e.has[f]) continue;
      const list = await e[f](symbol, Date.now() - 2 * 864e5, 100).catch(() => []);
      const hit = list.find((o) => String(o.clientOrderId) === cid || o.info?.clientOid === cid || o.info?.clOrdId === cid);
      if (hit) return hit;
    }
    return null;
  }

  return {
    name: id, market: "futures",
    symbolFor: (base) => `${base}/USDT:USDT`,
    async info(symbol) {
      const pub = await publicEx(id, env);
      const m = pub.markets[symbol];
      if (!m || m.active === false || !m.swap || !m.linear) return null;
      const tick = (p) => (pub.precisionMode === ccxt.TICK_SIZE ? Number(p) : pub.precisionMode === ccxt.DECIMAL_PLACES ? 10 ** -Number(p) : null);
      return { step: String(tick(m.precision?.amount) || 1), tick: String(tick(m.precision?.price) || 1e-8), contractSize: Number(m.contractSize || 1),
        minQty: Number(m.limits?.amount?.min || 0), minNotional: Number(m.limits?.cost?.min || 5), maxLeverage: Number(m.limits?.leverage?.max || 0) || null };
    },
    async price(symbol) {
      const t = await (await publicEx(id, env)).fetchTicker(symbol);
      const last = Number(t.last || t.close), bid = Number(t.bid), ask = Number(t.ask);
      if (bid > 0 && ask >= bid && !(last >= bid * 0.98 && last <= ask * 1.02)) return (bid + ask) / 2;
      return last;
    },
    async usdtFree() { const b = await (await ex()).fetchBalance(); return Number(b?.free?.USDT ?? b?.USDT?.free ?? 0); },
    // isolated margin + leverage for the pair ("no change needed" answers are fine)
    async prepare(symbol, leverage) {
      const e = await ex();
      if (e.has.setMarginMode) await e.setMarginMode("isolated", symbol, { leverage }).catch((err) => { if (!/no need|not modified|already|same|No need to change/i.test(String(err.message))) throw err; });
      if (e.has.setLeverage) await e.setLeverage(leverage, symbol, { marginMode: "isolated" }).catch((err) => { if (!/no need|not modified|already|same/i.test(String(err.message))) throw err; });
    },
    async open(symbol, side, contracts, clientId, info, leverage) {
      const e = await ex();
      const params = { clientOrderId: cidFor(clientId), marginMode: "isolated", leverage };
      const o = await e.createOrder(symbol, "market", side === "short" ? "sell" : "buy", Number(e.amountToPrecision(symbol, contracts)), undefined, params);
      return settle(e, o.id, symbol, info.contractSize);
    },
    async findOpen(symbol, clientId, info) {
      const e = await ex();
      const o = await byClient(e, symbol, clientId);
      if (!o || !(Number(o.filled) > 0)) return null;
      return settle(e, o.id, symbol, info.contractSize);
    },
    async close(symbol, side, contracts, clientId, info) {
      const e = await ex();
      const params = { clientOrderId: cidFor(clientId), reduceOnly: true, marginMode: "isolated" };
      const o = await e.createOrder(symbol, "market", side === "short" ? "buy" : "sell", Number(e.amountToPrecision(symbol, contracts)), undefined, params);
      return settle(e, o.id, symbol, info.contractSize);
    },
    async findClose(symbol, clientId, info) { return this.findOpen(symbol, clientId, info); },
    // contracts still held on this side (null when the exchange does not say)
    async held(symbol, side) {
      const e = await ex();
      if (!e.has.fetchPositions) return null;
      const ps = await e.fetchPositions([symbol]).catch(() => null);
      if (!ps) return null;
      return ps.filter((p) => p.symbol === symbol && (p.side || (Number(p.contracts) >= 0 ? "long" : "short")) === side).reduce((a, p) => a + Math.abs(Number(p.contracts || 0)), 0);
    },
  };
}
