// Binance spot REST client (live: api.binance.com, demo: demo-api.binance.com). Used by the web app (key check) and the
// trader worker (orders). Every failure becomes an Error with .code (Binance code or HTTP status) and a plain message.
import crypto from "node:crypto";

export const HOSTS = { live: "https://api.binance.com", demo: "https://demo-api.binance.com" };
const PUBLIC = "https://api.binance.com"; // market data for both: the demo book mirrors the live pairs

let offset = { live: 0, demo: 0 }; // server time - local time, refreshed on -1021

async function fetchJson(url, init = {}) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
      const text = await r.text();
      let body; try { body = JSON.parse(text); } catch { body = { msg: text.slice(0, 200) }; }
      if (r.status >= 500 || r.status === 429 || r.status === 418) {
        const e = new Error(`Binance is not answering (${r.status})`); e.code = r.status; e.gateway = true; throw e;
      }
      if (!r.ok || (body && typeof body.code === "number" && body.code < 0)) {
        const e = new Error(body?.msg || `HTTP ${r.status}`); e.code = body?.code ?? r.status; throw e;
      }
      return body;
    } catch (e) {
      lastErr = e;
      const retry = e.gateway || e.name === "TimeoutError" || /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(String(e.message));
      if (!retry || (init.method && init.method !== "GET")) throw e; // never repeat an order blindly
      await new Promise((res) => setTimeout(res, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

async function syncTime(env) {
  const j = await fetchJson(`${HOSTS[env]}/api/v3/time`);
  offset[env] = j.serverTime - Date.now();
}

export async function signed(env, method, path, params, cred) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const q = new URLSearchParams({ ...params, timestamp: String(Date.now() + offset[env]), recvWindow: "10000" }).toString();
    const sig = crypto.createHmac("sha256", cred.secret).update(q).digest("hex");
    try {
      return await fetchJson(`${HOSTS[env]}${path}?${q}&signature=${sig}`, { method, headers: { "X-MBX-APIKEY": cred.key } });
    } catch (e) {
      if (e.code === -1021 && attempt === 0) { await syncTime(env); continue; } // clock drift: sync once and retry
      throw e;
    }
  }
}

const KEY_FAIL = new Set([-2014, -2015]);

// Check a key: which environment it belongs to, can it trade, can it withdraw (refused), free USDT.
export async function checkKey(key, secret) {
  const cred = { key: key.trim(), secret: secret.trim() };
  let last = null;
  for (const env of ["live", "demo"]) {
    try {
      const acc = await signed(env, "GET", "/api/v3/account", { omitZeroBalances: "true" }, cred);
      if (!acc.canTrade) return { ok: false, error: "This key cannot trade. On Binance, edit the key and tick “Enable Spot & Margin Trading”." };
      let ipRestricted = null;
      if (env === "live") {
        const r = await signed(env, "GET", "/sapi/v1/account/apiRestrictions", {}, cred);
        if (r.enableWithdrawals) return { ok: false, error: "This key can withdraw funds, so Copixio will not use it. On Binance, untick “Enable Withdrawals” and add the key again." };
        if (r.permitsUniversalTransfer || r.enableInternalTransfer)
          return { ok: false, error: "This key can move funds between accounts, so Copixio will not use it. On Binance, untick “Permits Universal Transfer” and “Enable Internal Transfer”." };
        if (!r.enableSpotAndMarginTrading) return { ok: false, error: "This key cannot trade spot. On Binance, edit the key and tick “Enable Spot & Margin Trading”." };
        ipRestricted = !!r.ipRestrict;
      }
      const usdt = (acc.balances || []).find((b) => b.asset === "USDT");
      return { ok: true, env, usdtFree: Number(usdt?.free || 0), ipRestricted };
    } catch (e) {
      if (e.code === -1022) return { ok: false, error: "Binance accepted the key but not the secret. Copy the secret key again (it is shown only once when the key is created)." };
      if (KEY_FAIL.has(e.code)) { last = e; continue; } // not a key of this environment (or IP not allowed): try the other
      if (e.gateway) return { ok: false, error: "Binance is not answering right now. Try again in a minute." };
      return { ok: false, error: `Binance refused the check: ${e.message}` };
    }
  }
  return { ok: false, error: last && /IP/i.test(last.message)
    ? "Binance refused this key from our server's IP. Add the IP shown on this page to the key's IP list, or set it to unrestricted."
    : "Binance does not recognise this API key on the live or the demo exchange. Check that you copied the whole key." };
}

// ---- market data (public, live host)
let infoCache = { at: 0, map: null };
export async function symbolInfo(symbol) {
  if (!infoCache.map || Date.now() - infoCache.at > 3600e3) {
    const j = await fetchJson(`${PUBLIC}/api/v3/exchangeInfo?permissions=SPOT`);
    const m = new Map();
    for (const s of j.symbols || []) {
      if (s.status !== "TRADING" || s.quoteAsset !== "USDT") continue;
      const f = Object.fromEntries(s.filters.map((x) => [x.filterType, x]));
      m.set(s.symbol, { base: s.baseAsset, step: f.LOT_SIZE?.stepSize, tick: f.PRICE_FILTER?.tickSize, minQty: Number(f.LOT_SIZE?.minQty || 0), minNotional: Number(f.NOTIONAL?.minNotional || f.MIN_NOTIONAL?.minNotional || 5) });
    }
    infoCache = { at: Date.now(), map: m };
  }
  return infoCache.map.get(symbol) || null;
}

export async function price(symbol, env = "live") {
  const host = env === "demo" ? HOSTS.demo : PUBLIC;
  const j = await fetchJson(`${host}/api/v3/ticker/price?symbol=${symbol}`);
  return Number(j.price);
}

export async function usdtFree(env, cred) {
  const acc = await signed(env, "GET", "/api/v3/account", { omitZeroBalances: "true" }, cred);
  return Number((acc.balances || []).find((b) => b.asset === "USDT")?.free || 0);
}

export async function baseFree(env, cred, asset) {
  const acc = await signed(env, "GET", "/api/v3/account", { omitZeroBalances: "true" }, cred);
  const b = (acc.balances || []).find((x) => x.asset === asset);
  return Number(b?.free || 0);
}

// ---- orders (never retried blindly; the caller checks by clientOrderId)
export const marketBuyQuote = (env, cred, symbol, quoteUsdt, clientId) =>
  signed(env, "POST", "/api/v3/order", { symbol, side: "BUY", type: "MARKET", quoteOrderQty: String(quoteUsdt), newClientOrderId: clientId, newOrderRespType: "FULL" }, cred);
export const marketSell = (env, cred, symbol, qty, clientId) =>
  signed(env, "POST", "/api/v3/order", { symbol, side: "SELL", type: "MARKET", quantity: String(qty), newClientOrderId: clientId, newOrderRespType: "FULL" }, cred);
export const stopLossLimit = (env, cred, symbol, qty, stop, limit, clientId) =>
  signed(env, "POST", "/api/v3/order", { symbol, side: "SELL", type: "STOP_LOSS_LIMIT", timeInForce: "GTC", quantity: String(qty), stopPrice: String(stop), price: String(limit), newClientOrderId: clientId }, cred);
export const cancelOrder = (env, cred, symbol, orderId) => signed(env, "DELETE", "/api/v3/order", { symbol, orderId: String(orderId) }, cred);
export const getOrder = (env, cred, symbol, clientId) => signed(env, "GET", "/api/v3/order", { symbol, origClientOrderId: clientId }, cred);
