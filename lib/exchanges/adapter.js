// One interface for Binance and KuCoin spot, used by the trader worker.
// - quantities/prices are sent as fixed-point strings on the exchange's step (never "1e-7");
// - every order carries our client id, and every kind of order can be looked up again by it ("did it land?");
// - fees: a fee taken in the base coin only reduces the quantity we hold (it is NOT added to feeUsdt again);
//   USDT fees and BNB fees (converted at the BNB price) are summed in feeUsdt.
import * as BN from "./binance.js";
import * as KC from "./kucoin.js";
import { unseal } from "../seal.js";

const decimals = (step) => { const s = String(step || "1"); if (/e-/i.test(s)) return Number(s.split(/e-/i)[1]); const i = s.indexOf("."); return i < 0 ? 0 : Math.max(0, s.replace(/0+$/, "").length - i - 1); };
export const floorTo = (x, step) => { const d = decimals(step), st = Number(step) || 1; return Number((Math.floor(Number(x) / st + 1e-9) * st).toFixed(d)); };
export const roundTo = (x, step) => { const d = decimals(step), st = Number(step) || 1; return Number((Math.round(Number(x) / st) * st).toFixed(d)); };
export const fmt = (x, step) => Number(x).toFixed(decimals(step));
const gateway = (msg) => Object.assign(new Error(msg), { gateway: true });

export function adapterFor(conn) {
  const key = unseal(conn.keySealed), secret = unseal(conn.secretSealed);
  if (conn.exchange === "binance") return binance(conn.env, { key, secret });
  return kucoin({ key, secret, passphrase: unseal(conn.passphraseSealed) });
}

// ------------------------------------------------------------------ Binance
function binance(env, cred) {
  const S = (method, path, params) => BN.signed(env, method, path, params, cred);
  let bnbPx = { at: 0, v: 0 };
  const bnb = async () => { if (Date.now() - bnbPx.at > 60000) bnbPx = { at: Date.now(), v: await BN.price("BNBUSDT").catch(() => bnbPx.v) }; return bnbPx.v; };
  // exact fills of one order from /myTrades
  async function fillsOf(symbol, orderId, base) {
    const tr = await S("GET", "/api/v3/myTrades", { symbol, orderId: String(orderId) });
    let qty = 0, quote = 0, baseFee = 0, feeUsdt = 0;
    for (const f of tr || []) {
      qty += Number(f.qty); quote += Number(f.quoteQty);
      const c = Number(f.commission);
      if (f.commissionAsset === base) baseFee += c; else if (f.commissionAsset === "USDT") feeUsdt += c; else if (f.commissionAsset === "BNB") feeUsdt += c * (await bnb());
    }
    return qty > 0 ? { orderId: String(orderId), qty, avg: quote / qty, quote, baseFee, feeUsdt } : null;
  }
  async function fromResp(o, base) {
    const fills = o.fills || [];
    const qty = Number(o.executedQty || 0), quote = Number(o.cummulativeQuoteQty || 0);
    let baseFee = 0, feeUsdt = 0;
    for (const f of fills) {
      const c = Number(f.commission);
      if (f.commissionAsset === base) baseFee += c; else if (f.commissionAsset === "USDT") feeUsdt += c; else if (f.commissionAsset === "BNB") feeUsdt += c * (await bnb());
    }
    return { orderId: String(o.orderId), qty, avg: qty ? quote / qty : 0, quote, baseFee, feeUsdt };
  }
  async function byClient(symbol, clientId) {
    try { return await S("GET", "/api/v3/order", { symbol, origClientOrderId: clientId }); }
    catch (e) { if (e.code === -2013) return null; throw e; }
  }
  return {
    name: "binance",
    symbolFor: (base) => `${base}USDT`,
    info: (symbol) => BN.symbolInfo(symbol),
    price: (symbol) => BN.price(symbol, env),
    usdtFree: () => BN.usdtFree(env, cred),
    baseFree: (base) => BN.baseFree(env, cred, base),
    async buy(symbol, base, usdt, clientId) {
      const o = await S("POST", "/api/v3/order", { symbol, side: "BUY", type: "MARKET", quoteOrderQty: usdt.toFixed(2), newClientOrderId: clientId, newOrderRespType: "FULL" });
      const f = await fromResp(o, base); return { ...f, net: f.qty - f.baseFee };
    },
    async findBuy(symbol, base, clientId) {
      const o = await byClient(symbol, clientId);
      if (!o || !(Number(o.executedQty) > 0)) return null;
      const f = await fillsOf(symbol, o.orderId, base); return f ? { ...f, net: f.qty - f.baseFee } : null;
    },
    async sell(symbol, base, qty, step, clientId) {
      const o = await S("POST", "/api/v3/order", { symbol, side: "SELL", type: "MARKET", quantity: fmt(qty, step), newClientOrderId: clientId, newOrderRespType: "FULL" });
      const f = await fromResp(o, base); return { orderId: f.orderId, qty: f.qty, avg: f.avg, usdt: f.quote, feeUsdt: f.feeUsdt };
    },
    async findSell(symbol, base, clientId) {
      const o = await byClient(symbol, clientId);
      if (!o || !(Number(o.executedQty) > 0)) return null;
      const f = await fillsOf(symbol, o.orderId, base); return f ? { orderId: f.orderId, qty: f.qty, avg: f.avg, usdt: f.quote, feeUsdt: f.feeUsdt } : null;
    },
    async placeStop(symbol, qty, stop, info, clientId) {
      const o = await S("POST", "/api/v3/order", { symbol, side: "SELL", type: "STOP_LOSS_LIMIT", timeInForce: "GTC", quantity: fmt(qty, info.step),
        stopPrice: fmt(roundTo(stop, info.tick), info.tick), price: fmt(roundTo(stop * 0.995, info.tick), info.tick), newClientOrderId: clientId });
      return String(o.orderId);
    },
    async findStop(symbol, clientId) { const o = await byClient(symbol, clientId); return o && o.status === "NEW" ? String(o.orderId) : null; },
    cancelStop: (symbol, id) => S("DELETE", "/api/v3/order", { symbol, orderId: String(id) }).catch((e) => { if (e.code !== -2011) throw e; }),
    // the stop's fill (complete, or partial and no longer working), or null
    async stopFill(symbol, base, id) {
      const o = await S("GET", "/api/v3/order", { symbol, orderId: String(id) });
      if (!(Number(o.executedQty) > 0)) return null;
      if (o.status !== "FILLED" && !["CANCELED", "EXPIRED", "REJECTED"].includes(o.status)) return null; // still filling
      const f = await fillsOf(symbol, o.orderId, base);
      return f ? { qty: f.qty, avg: f.avg, usdt: f.quote, feeUsdt: f.feeUsdt } : null;
    },
  };
}

// ------------------------------------------------------------------ KuCoin
function kucoin(cred) {
  // fills of one order; KuCoin reports them a moment after a market order, so wait up to ~10 s
  async function settle(orderId, { wait = true } = {}) {
    for (let i = 0; i < (wait ? 20 : 1); i++) {
      const o = await KC.fillsOfOrder(cred, orderId).catch(() => null);
      const items = o?.items || [];
      if (items.length) {
        const qty = items.reduce((a, x) => a + Number(x.size), 0), quote = items.reduce((a, x) => a + Number(x.funds), 0);
        const feeUsdt = items.reduce((a, x) => a + (x.feeCurrency === "USDT" ? Number(x.fee) : 0), 0);
        const baseFee = items.reduce((a, x) => a + (x.feeCurrency !== "USDT" ? Number(x.fee) : 0), 0);
        return { orderId, qty, avg: quote / qty, quote, baseFee, feeUsdt };
      }
      if (wait) await new Promise((r) => setTimeout(r, 500));
    }
    throw gateway("KuCoin did not report the fill in time"); // the order exists: the caller looks it up again
  }
  const byClient = (clientId) => KC.orderByClientOid(cred, clientId).catch((e) => { if (["400100", "404", "400"].includes(String(e.code))) return null; throw e; });
  return {
    name: "kucoin",
    symbolFor: (base) => `${base}-USDT`,
    info: (symbol) => KC.symbolInfo(symbol),
    price: (symbol) => KC.price(symbol),
    usdtFree: () => KC.balance(cred, "USDT"),
    baseFree: (base) => KC.balance(cred, base),
    async buy(symbol, base, usdt, clientId) { const r = await KC.marketBuyFunds(cred, symbol, usdt.toFixed(2), clientId); const f = await settle(r.orderId); return { ...f, net: f.qty - f.baseFee }; },
    async findBuy(symbol, base, clientId) { const o = await byClient(clientId); if (!o || !(Number(o.dealSize) > 0)) return null; const f = await settle(o.id); return { ...f, net: f.qty - f.baseFee }; },
    async sell(symbol, base, qty, step, clientId) { const r = await KC.marketSell(cred, symbol, fmt(qty, step), clientId); const f = await settle(r.orderId); return { orderId: f.orderId, qty: f.qty, avg: f.avg, usdt: f.quote, feeUsdt: f.feeUsdt }; },
    async findSell(symbol, base, clientId) { const o = await byClient(clientId); if (!o || !(Number(o.dealSize) > 0)) return null; const f = await settle(o.id); return { orderId: f.orderId, qty: f.qty, avg: f.avg, usdt: f.quote, feeUsdt: f.feeUsdt }; },
    async placeStop(symbol, qty, stop, info, clientId) {
      const r = await KC.stopSell(cred, symbol, fmt(qty, info.step), fmt(roundTo(stop, info.tick), info.tick), fmt(roundTo(stop * 0.995, info.tick), info.tick), clientId);
      return `${r.orderId}|${clientId}`;
    },
    async findStop(symbol, clientId) { const o = await KC.stopByClientOid(cred, clientId).catch(() => null); const x = Array.isArray(o) ? o[0] : o; return x?.id ? `${x.id}|${clientId}` : null; },
    cancelStop: (symbol, id) => KC.cancelStop(cred, String(id).split("|")[0]).catch(() => {}),
    async stopFill(symbol, base, id) {
      const clientId = String(id).split("|")[1];
      const o = await byClient(clientId);
      if (!o || o.isActive || !(Number(o.dealSize) > 0)) return null;
      const f = await settle(o.id);
      return { qty: f.qty, avg: f.avg, usdt: f.quote, feeUsdt: f.feeUsdt };
    },
  };
}
