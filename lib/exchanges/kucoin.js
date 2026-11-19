// KuCoin spot REST client (API key version 2). Key check for the web app, orders for the trader worker.
import crypto from "node:crypto";

const HOST = "https://api.kucoin.com";

async function request(method, path, body, cred) {
  const ts = String(Date.now());
  const payload = body ? JSON.stringify(body) : "";
  const headers = { "Content-Type": "application/json" };
  if (cred) {
    const sign = crypto.createHmac("sha256", cred.secret).update(ts + method + path + payload).digest("base64");
    const pass = crypto.createHmac("sha256", cred.secret).update(cred.passphrase).digest("base64");
    Object.assign(headers, { "KC-API-KEY": cred.key, "KC-API-SIGN": sign, "KC-API-TIMESTAMP": ts, "KC-API-PASSPHRASE": pass, "KC-API-KEY-VERSION": "2" });
  }
  let r;
  try { r = await fetch(HOST + path, { method, headers, body: payload || undefined, signal: AbortSignal.timeout(10000) }); }
  catch (e) { const err = new Error("KuCoin is not answering right now"); err.gateway = true; err.cause = e; throw err; }
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = { msg: text.slice(0, 200) }; }
  if (r.status >= 500 || r.status === 429) { const e = new Error(`KuCoin is not answering (${r.status})`); e.gateway = true; e.code = String(r.status); throw e; }
  if (j.code !== "200000") { const e = new Error(j.msg || `HTTP ${r.status}`); e.code = String(j.code || r.status); throw e; }
  return j.data;
}

const MSG = {
  "400003": "KuCoin does not recognise this API key. Check that you copied the whole key.",
  "400004": "The passphrase is wrong. It is the one you typed when you created the key on KuCoin.",
  "400005": "KuCoin accepted the key but not the secret. Copy the secret again.",
  "400006": "KuCoin refused this key from our server's IP. Add the IP shown on this page to the key, or remove the IP limit.",
  "400007": "This key does not have the permission Copixio needs. On KuCoin, give the key the “Spot Trading” permission.",
};

export async function checkKey(key, secret, passphrase) {
  const cred = { key: key.trim(), secret: secret.trim(), passphrase: passphrase.trim() };
  try {
    const info = await request("GET", "/api/v1/user/api-key", null, cred);
    const perms = String(info?.permission || "").toLowerCase();
    if (/withdraw/.test(perms)) return { ok: false, error: "This key can withdraw funds, so Copixio will not use it. On KuCoin, create a key without the “Withdrawal” permission." };
    if (/transfer/.test(perms)) return { ok: false, error: "This key can move funds between accounts, so Copixio will not use it. On KuCoin, create a key without the “Transfer” permissions." };
    if (!/spot/.test(perms)) return { ok: false, error: "This key cannot trade spot. On KuCoin, give the key the “Spot Trading” permission." };
    const accs = await request("GET", "/api/v1/accounts?currency=USDT&type=trade", null, cred);
    const free = (accs || []).reduce((a, x) => a + Number(x.available || 0), 0);
    return { ok: true, env: "live", usdtFree: free, ipRestricted: !!(info?.ipWhitelist && String(info.ipWhitelist).trim()) };
  } catch (e) {
    if (e.gateway) return { ok: false, error: "KuCoin is not answering right now. Try again in a minute." };
    return { ok: false, error: MSG[e.code] || `KuCoin refused the check: ${e.message}` };
  }
}

// ---- market data
let infoCache = { at: 0, map: null };
export async function symbolInfo(symbol) {
  if (!infoCache.map || Date.now() - infoCache.at > 3600e3) {
    const list = await request("GET", "/api/v2/symbols");
    const m = new Map();
    for (const s of list || []) {
      if (s.quoteCurrency !== "USDT" || !s.enableTrading) continue;
      m.set(s.symbol, { base: s.baseCurrency, step: s.baseIncrement, tick: s.priceIncrement, minQty: Number(s.baseMinSize || 0), minNotional: Number(s.minFunds || 0.1), quoteStep: s.quoteIncrement });
    }
    infoCache = { at: Date.now(), map: m };
  }
  return infoCache.map.get(symbol) || null;
}

export async function price(symbol) {
  const j = await request("GET", `/api/v1/market/orderbook/level1?symbol=${symbol}`);
  return Number(j?.price);
}

export async function balance(cred, currency) {
  const accs = await request("GET", `/api/v1/accounts?currency=${currency}&type=trade`, null, cred);
  return (accs || []).reduce((a, x) => a + Number(x.available || 0), 0);
}

// ---- orders
export const marketBuyFunds = (cred, symbol, funds, clientOid) =>
  request("POST", "/api/v1/orders", { clientOid, side: "buy", symbol, type: "market", funds: String(funds) }, cred);
export const marketSell = (cred, symbol, size, clientOid) =>
  request("POST", "/api/v1/orders", { clientOid, side: "sell", symbol, type: "market", size: String(size) }, cred);
export const orderByClientOid = (cred, clientOid) => request("GET", `/api/v1/order/client-order/${encodeURIComponent(clientOid)}`, null, cred);
export const fillsOfOrder = (cred, orderId) => request("GET", `/api/v1/fills?orderId=${encodeURIComponent(orderId)}`, null, cred);
// a stop-limit sell that sits on KuCoin (protects the position even if the worker is down)
export const stopSell = (cred, symbol, size, stopPrice, limitPrice, clientOid) =>
  request("POST", "/api/v1/stop-order", { clientOid, side: "sell", symbol, type: "limit", stop: "loss", stopPrice: String(stopPrice), price: String(limitPrice), size: String(size) }, cred);
export const stopByClientOid = (cred, clientOid) => request("GET", `/api/v1/stop-order/queryOrderByClientOid?clientOid=${encodeURIComponent(clientOid)}`, null, cred);
export const cancelStop = (cred, orderId) => request("DELETE", `/api/v1/stop-order/${encodeURIComponent(orderId)}`, null, cred);
