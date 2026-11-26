import { db } from "@/lib/db";
import { Trade } from "@/lib/models";
import { redis } from "@/lib/redis";
import { apiUser, ok } from "@/lib/session-user";

export const dynamic = "force-dynamic";

// Live P&L of the signed-in user's open trades. The price is the one the trader read on its last check of each trade
// (cx:px:<trade>, kept 2 min); fees already paid are taken off, the closing fee is not known yet.
export async function GET(req) {
  const [user, deny] = await apiUser(req);
  if (deny) return deny;
  await db();
  const open = await Trade.find({ userId: user._id, status: { $in: ["open", "closing"] }, exchange: { $ne: "mt5" } }).lean();
  const raw = open.length ? await redis().mget(open.map((t) => `cx:px:${t._id}`)).catch(() => []) : [];
  const rows = open.map((t, i) => {
    let px = null, at = null;
    try { ({ px, at } = JSON.parse(raw[i] || "null") || {}); } catch { /* unreadable: no price */ }
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
