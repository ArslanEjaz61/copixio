import { db } from "@/lib/db";
import { Trade } from "@/lib/models";
import { redis } from "@/lib/redis";
import { apiUser, ok } from "@/lib/session-user";
import { HOSTS } from "@/lib/exchanges/binance";
import { price as kcPrice } from "@/lib/exchanges/kucoin";

export const dynamic = "force-dynamic";

// Live P&L of the signed-in user's open trades, asked every second by the Trades page. Spot Binance / KuCoin prices
// come straight from the exchange (one batched call per exchange, cached 1 s for every user); others use the price of
// the trader's last check (cx:px:<trade>, kept 2 min). Fees already paid are taken off, the closing fee is not.
const cache = new Map(); // "env|symbol" -> { at, px }
async function freshPrices(trades) {
  const now = Date.now(), want = new Map();
  for (const t of trades) {
    if (t.market === "futures") continue;
    const k = `${t.exchange === "binance" ? t.env : t.exchange}|${t.symbol}`;
    if (!(cache.get(k)?.at > now - 1000)) want.set(k, t);
  }
  const bn = { live: [], demo: [] }, kc = [];
  for (const [k, t] of want) { if (t.exchange === "binance") (bn[t.env] || bn.live).push(t.symbol); else if (t.exchange === "kucoin") kc.push([k, t.symbol]); }
  await Promise.all([
    ...Object.entries(bn).filter(([, s]) => s.length).map(async ([env, syms]) => {
      const r = await fetch(`${HOSTS[env] || HOSTS.live}/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify([...new Set(syms)]))}`, { signal: AbortSignal.timeout(3000), cache: "no-store" }).catch(() => null);
      const j = r && r.ok ? await r.json().catch(() => null) : null;
      for (const x of Array.isArray(j) ? j : []) if (Number(x.price) > 0) cache.set(`${env}|${x.symbol}`, { at: now, px: Number(x.price) });
    }),
    ...kc.map(async ([k, sym]) => { const px = await kcPrice(sym).catch(() => 0); if (px > 0) cache.set(k, { at: now, px }); }),
  ]);
  if (cache.size > 2000) for (const [k, v] of cache) if (v.at < now - 60000) cache.delete(k);
  return (t) => cache.get(`${t.exchange === "binance" ? t.env : t.exchange}|${t.symbol}`);
}

export async function GET(req) {
  const [user, deny] = await apiUser(req);
  if (deny) return deny;
  await db();
  const open = await Trade.find({ userId: user._id, status: { $in: ["open", "closing"] }, exchange: { $ne: "mt5" } }).lean();
  const [raw, live] = open.length ? await Promise.all([redis().mget(open.map((t) => `cx:px:${t._id}`)).catch(() => []), freshPrices(open).catch(() => () => null)]) : [[], () => null];
  const rows = open.map((t, i) => {
    let px = null, at = null;
    try { ({ px, at } = JSON.parse(raw[i] || "null") || {}); } catch { /* unreadable: no price */ }
    const f = live(t);
    if (f && (!at || f.at >= at)) ({ px, at } = f);
    if (!(px > 0) || !(t.entryPrice > 0)) return { id: String(t._id), px: null };
    const fees = t.feesUsdt || 0, left = t.qtyLeft ?? t.qty ?? 0;
    let pnl, base;
    if (t.market === "futures") {
      const cs = t.contractSize || 1, qty = t.qty || left || 1;
      const closes = (t.fills || []).filter((f) => f.kind !== "OPEN");
      const closedQ = closes.reduce((a, f) => a + f.qty, 0), closedUsdt = closes.reduce((a, f) => a + f.usdt, 0);
      const entryClosed = (t.costUsdt || 0) * (closedQ / qty), entryLeft = (t.costUsdt || 0) * (left / qty), nowLeft = left * cs * px;
      const short = t.side === "short";
      pnl = (short ? entryClosed - closedUsdt + entryLeft - nowLeft : closedUsdt - entryClosed + nowLeft - entryLeft) - fees;
      base = t.marginUsdt || t.costUsdt;
    } else {
      const sold = (t.fills || []).filter((f) => f.kind !== "BUY").reduce((a, f) => a + f.usdt, 0);
      pnl = sold + left * px - (t.costUsdt || 0) - fees;
      base = t.costUsdt;
    }
    return { id: String(t._id), px, at, pnl, pct: base > 0 ? (pnl / base) * 100 : null, move: ((px / t.entryPrice - 1) * 100) * (t.side === "short" ? -1 : 1) };
  });
  return ok({ rows, now: Date.now() });
}
