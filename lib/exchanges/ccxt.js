// Spot trading on the exchanges reached through ccxt (OKX, Bitget, MEXC, Coinbase, Kraken, HTX, Bitfinex, Upbit).
// Same interface as the Binance / KuCoin adapters in adapter.js. Differences:
// - no stop order rests on these exchanges: their trigger orders differ too much to trust blindly, so the trader
//   watches the price every few seconds and sells at market when the stop is touched (placeStop returns null);
// - every order carries our client id; "did it land?" is answered by fetching it by that id, or by scanning the
//   recent orders of the pair when the exchange cannot look up client ids.
import ccxt from "ccxt";
import { exchangeMeta } from "./list.js";

const TIMEOUT = 15000;
const MARKETS_TTL = 30 * 60e3;
const shared = new Map(); // exchange id -> { at, ex } public instance with loaded markets

function make(id, cred = {}) {
  const Cls = ccxt[exchangeMeta(id).ccxt];
  if (!Cls) throw new Error(`${id} is not supported`);
  return new Cls({ apiKey: cred.key, secret: cred.secret, password: cred.passphrase, enableRateLimit: true, timeout: TIMEOUT, options: { defaultType: "spot" } });
}

async function publicEx(id) {
  const s = shared.get(id);
  if (s && Date.now() - s.at < MARKETS_TTL) return s.ex;
  const ex = make(id);
  await ex.loadMarkets();
  shared.set(id, { at: Date.now(), ex });
  return ex;
}

async function privateEx(id, cred) {
  const pub = await publicEx(id);
  const ex = make(id, cred);
  ex.setMarkets(pub.markets, pub.currencies);
  return ex;
}

// A readable sentence for each kind of ccxt failure.
function explain(id, e) {
  const n = exchangeMeta(id).name;
  if (e instanceof ccxt.AuthenticationError) return `${n} did not accept this key. Check that the key${exchangeMeta(id).pass ? ", secret and passphrase are" : " and secret are"} copied whole, and that the key is not limited to other IP addresses.`;
  if (e instanceof ccxt.PermissionDenied) return `${n} refused: the key is missing a permission, or this server's IP is not on the key's allowed list.`;
  if (e instanceof ccxt.AccountSuspended) return `${n} says this account is suspended.`;
  if (e instanceof ccxt.NetworkError) return `${n} is not answering right now. Try again in a minute.`;
  return `${n} refused the check: ${String(e?.message || e).slice(0, 200)}`;
}

// Key check when it is added (and every few hours by the trader): it must read the balance, and it must not withdraw
// where the exchange lets us see the key's permissions.
export async function checkKey(id, key, secret, passphrase) {
  const cred = { key: key.trim(), secret: String(secret).trim().replace(/\\n/g, "\n"), passphrase: passphrase?.trim() };
  try {
    const ex = await privateEx(id, cred);
    if (id === "okx") {
      const r = await ex.privateGetAccountConfig();
      const perm = String(r?.data?.[0]?.perm || "");
      if (/withdraw/i.test(perm)) return { ok: false, error: "This OKX key can withdraw funds, so Copixio will not use it. Edit the key, turn Withdraw off and add it again." };
      if (perm && !/trade/i.test(perm)) return { ok: false, error: "This OKX key cannot trade. Edit the key and turn on Trade." };
    }
    const bal = await ex.fetchBalance();
    return { ok: true, env: "live", usdtFree: Number(bal?.free?.USDT || 0), ipRestricted: null };
  } catch (e) {
    return { ok: false, error: explain(id, e), down: e instanceof ccxt.NetworkError };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Our client ids as each exchange accepts them: Bitfinex takes only a number (cid), so the id is hashed to one.
const cidFor = (id, clientId) => {
  if (id !== "bitfinex") return clientId;
  let h = 0; for (const c of clientId) h = (h * 31 + c.charCodeAt(0)) % 2 ** 45;
  return String(h);
};
const noClientIds = new Set(); // exchanges that refused our client id format: sent without one from then on

export function ccxtAdapter(id, cred) {
  let exP = null;
  const ex = () => (exP ||= privateEx(id, cred).catch((e) => { exP = null; throw e; }));

  // fees of an order: a base-coin fee reduces what we hold; USDT fees add up; any other coin is valued in USDT
  async function feesOf(e, o, base) {
    let fees = o.fees?.length ? o.fees : o.fee ? [o.fee] : [];
    if (!fees.length && e.has.fetchOrderTrades) {
      const tr = await e.fetchOrderTrades(o.id, o.symbol).catch(() => []);
      fees = tr.flatMap((t) => (t.fees?.length ? t.fees : t.fee ? [t.fee] : []));
    }
    let baseFee = 0, feeUsdt = 0;
    for (const f of fees) {
      const c = Number(f?.cost || 0);
      if (!c) continue;
      if (f.currency === base) baseFee += c;
      else if (f.currency === "USDT") feeUsdt += c;
      else { const px = await e.fetchTicker(`${f.currency}/USDT`).then((t) => t.last).catch(() => 0); feeUsdt += c * (px || 0); }
    }
    return { baseFee, feeUsdt };
  }

  // the filled order, waiting up to ~10 s for the exchange to report it
  async function settle(e, id_, symbol, base) {
    for (let i = 0; i < 20; i++) {
      const o = await e.fetchOrder(id_, symbol).catch(() => null);
      if (o && Number(o.filled) > 0 && (o.status === "closed" || o.status === "canceled" || i >= 6)) {
        const qty = Number(o.filled), quote = Number(o.cost) || qty * Number(o.average || o.price || 0);
        const { baseFee, feeUsdt } = await feesOf(e, o, base);
        return { orderId: String(o.id), qty, avg: quote / qty, quote, baseFee, feeUsdt };
      }
      await sleep(500);
    }
    throw Object.assign(new Error(`${exchangeMeta(id).name} did not report the fill in time`), { gateway: true }); // the caller looks it up again
  }

  // place an order with our client id; a format refusal (raised before anything is placed) is retried once without it
  async function place(fn, clientId) {
    if (noClientIds.has(id)) return fn({});
    try { return await fn({ clientOrderId: cidFor(id, clientId) }); }
    catch (err) {
      if ((err instanceof ccxt.BadRequest || err instanceof ccxt.InvalidOrder) && /client|cl_?ord|cid|identifier/i.test(String(err.message))) {
        noClientIds.add(id);
        return fn({});
      }
      throw err;
    }
  }

  // an order of ours, by the client id it was sent with
  async function byClient(e, symbol, clientId_) {
    if (noClientIds.has(id)) return null;
    const clientId = cidFor(id, clientId_);
    try { const o = await e.fetchOrder(undefined, symbol, { clientOrderId: clientId }); if (o?.id) return o; } catch { /* not supported here: scan */ }
    const since = Date.now() - 3 * 864e5;
    for (const f of ["fetchClosedOrders", "fetchOrders", "fetchOpenOrders"]) {
      if (!e.has[f]) continue;
      const list = await e[f](symbol, since, 100).catch(() => []);
      const hit = list.find((o) => String(o.clientOrderId) === clientId || o.info?.clOrdId === clientId || o.info?.clientOid === clientId || o.info?.client_order_id === clientId);
      if (hit) return hit;
    }
    return null;
  }

  return {
    name: id,
    symbolFor: (base) => `${base}/USDT`,
    async info(symbol) {
      const pub = await publicEx(id);
      const m = pub.markets[symbol];
      if (!m || m.active === false || !m.spot) return null;
      const tick = (p) => (pub.precisionMode === ccxt.TICK_SIZE ? Number(p) : pub.precisionMode === ccxt.DECIMAL_PLACES ? 10 ** -Number(p) : null);
      const step = tick(m.precision?.amount) || 1e-8;
      return { base: m.base, step: String(step), tick: String(tick(m.precision?.price) || 1e-8), minQty: Number(m.limits?.amount?.min || 0), minNotional: Number(m.limits?.cost?.min || 5) };
    },
    async price(symbol) { const t = await (await publicEx(id)).fetchTicker(symbol); return Number(t.last || t.close); },
    async usdtFree() { const b = await (await ex()).fetchBalance(); return Number(b?.free?.USDT || 0); },
    async baseFree(base) { const b = await (await ex()).fetchBalance(); return Number(b?.free?.[base] || 0); },
    async buy(symbol, base, usdt, clientId) {
      const e = await ex();
      const cost = Number(usdt.toFixed(2));
      const px = e.has.createMarketBuyOrderWithCost ? null : await this.price(symbol);
      const o = await place((params) => (px === null
        ? e.createMarketBuyOrderWithCost(symbol, cost, params)
        : e.createOrder(symbol, "market", "buy", Number(e.amountToPrecision(symbol, cost / px)), undefined, params)), clientId);
      const f = await settle(e, o.id, symbol, base);
      return { ...f, net: f.qty - f.baseFee };
    },
    async findBuy(symbol, base, clientId) {
      const e = await ex();
      const o = await byClient(e, symbol, clientId);
      if (!o || !(Number(o.filled) > 0)) return null;
      const f = await settle(e, o.id, symbol, base);
      return { ...f, net: f.qty - f.baseFee };
    },
    async sell(symbol, base, qty, step, clientId) {
      const e = await ex();
      const o = await place((params) => e.createOrder(symbol, "market", "sell", Number(e.amountToPrecision(symbol, qty)), undefined, params), clientId);
      const f = await settle(e, o.id, symbol, base);
      return { orderId: f.orderId, qty: f.qty, avg: f.avg, usdt: f.quote, feeUsdt: f.feeUsdt };
    },
    async findSell(symbol, base, clientId) {
      const e = await ex();
      const o = await byClient(e, symbol, clientId);
      if (!o || !(Number(o.filled) > 0)) return null;
      const f = await settle(e, o.id, symbol, base);
      return { orderId: f.orderId, qty: f.qty, avg: f.avg, usdt: f.quote, feeUsdt: f.feeUsdt };
    },
    // stops are watched by the trader on these exchanges (see the note at the top)
    placeStop: async () => null,
    findStop: async () => null,
    cancelStop: async () => {},
    stopFill: async () => null,
  };
}
