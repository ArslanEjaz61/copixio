import "server-only";
// Coin catalogue for the Favourites search (27 Nov): every coin the user could get a signal for, from the public markets
// of Binance (spot + futures), KuCoin, and every other exchange the user connected. Cached 6 h in memory; one failing
// exchange never blocks the rest. base -> Set of exchange names.
import { marketBases } from "./exchanges/ccxt";
import { exchangeMeta } from "./exchanges/list";

const TTL = 6 * 3600e3;
const cache = new Map(); // key -> { at, bases: Map<base, Set<name>>, ttl }
const inflight = new Map(); // key -> Promise (one fetch per exchange at a time)

async function json(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(12000), cache: "no-store" });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}
const add = (m, base, name) => { if (!base) return; if (!m.has(base)) m.set(base, new Set()); m.get(base).add(name); };
const QUOTES = new Set(["USDT", "USDC", "USD", "BUSD", "FDUSD"]);

const SOURCES = {
  binance: async (m) => {
    const [spot, fut] = await Promise.allSettled([json("https://api.binance.com/api/v3/exchangeInfo?permissions=SPOT"), json("https://fapi.binance.com/fapi/v1/exchangeInfo")]);
    if (spot.status === "fulfilled") for (const s of spot.value.symbols || []) if (s.status === "TRADING" && QUOTES.has(s.quoteAsset)) add(m, s.baseAsset, "Binance");
    if (fut.status === "fulfilled") for (const s of fut.value.symbols || []) if (s.status === "TRADING" && QUOTES.has(s.quoteAsset) && s.contractType === "PERPETUAL") add(m, s.baseAsset, "Binance futures");
    if (spot.status === "rejected" && fut.status === "rejected") throw spot.reason;
  },
  kucoin: async (m) => {
    const j = await json("https://api.kucoin.com/api/v2/symbols");
    for (const s of j.data || []) if (s.enableTrading && QUOTES.has(s.quoteCurrency)) add(m, s.baseCurrency, "KuCoin");
  },
};

function load(id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < (hit.ttl || TTL)) return Promise.resolve(hit.bases);
  if (!inflight.has(id)) inflight.set(id, fetchList(id, hit).finally(() => inflight.delete(id)));
  return inflight.get(id);
}
async function fetchList(id, hit) {
  const m = new Map();
  try {
    if (SOURCES[id]) await SOURCES[id](m);
    else if (exchangeMeta(id).ccxt) for (const b of await marketBases(id)) add(m, b, exchangeMeta(id).name);
    else return new Map(); // MetaTrader 5 etc.: no coin list
  } catch {
    if (hit?.bases.size) { cache.set(id, { ...hit, at: Date.now(), ttl: 60e3 }); return hit.bases; } // keep the old list, ask again in 1 min
    cache.set(id, { at: Date.now(), bases: new Map(), ttl: 60e3 }); // not answering: do not ask again for 1 min
    return new Map();
  }
  cache.set(id, { at: Date.now(), bases: m });
  return m;
}

// Binance + KuCoin always (the groups' signals come as plain tickers and most are listed there), plus the exchanges the
// user connected.
export async function catalog(userExchangeIds = []) {
  const ids = [...new Set(["binance", "kucoin", ...userExchangeIds])];
  const all = new Map();
  for (const m of await Promise.all(ids.map(load))) for (const [b, names] of m) for (const n of names) add(all, b, n);
  return all;
}

// What the user typed -> a coin ticker: "btcusdt", "BTC/USDT", "BTCUSDT.P", "BINANCE:BTCUSDT", "btc-usdt-swap" -> "BTC".
// A bare quote ("USDT") or a ticker that would be too short after stripping ("LUSD" -> "L") is kept as typed.
const QUOTE_END = /(USDT|USDC|FDUSD|BUSD|USD)$/;
export function coinTerm(q, all = null) {
  const raw = String(q || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (all && raw && all.has(raw)) return raw; // a real coin that ends in USD (PYUSD, RLUSD) stays whole
  let s = String(q || "").trim().toUpperCase().replace(/^[A-Z0-9_]+:/, "").replace(/(\.P|PERP|-SWAP|_PERP)$/, "");
  const parts = s.split(/[\/\-_\s]+/).filter(Boolean);
  if (parts.length > 1 && QUOTE_END.test(parts[1])) s = parts[0];
  s = s.replace(/[^A-Z0-9]/g, "");
  const bare = s.replace(QUOTE_END, "");
  return bare.length >= 2 ? bare : s;
}

// Search by ticker: exact first, then starts-with, then contains.
export function search(all, q, limit = 30) {
  const s = coinTerm(q, all);
  if (!s) return [];
  const exact = [], starts = [], has = [];
  for (const b of all.keys()) { if (b === s) exact.push(b); else if (b.startsWith(s)) starts.push(b); else if (b.includes(s)) has.push(b); }
  starts.sort((a, b) => a.length - b.length || a.localeCompare(b)); has.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return [...exact, ...starts, ...has].slice(0, limit).map((base) => ({ base, venues: [...all.get(base)] }));
}
