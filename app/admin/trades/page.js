import Link from "next/link";
import { Group, Trade, User } from "@/lib/models";
import { px, requireAdmin, usd, when } from "@/lib/admin";

export const metadata = { title: "Trades" };
export const dynamic = "force-dynamic";

const LIVE = ["opening", "open", "closing"];
const exName = (t) => `${t.exchange === "binance" ? "Binance" : "KuCoin"}${t.env === "demo" ? " demo" : ""}`;

export default async function AdminTrades({ searchParams }) {
  await requireAdmin();
  const { tab = "open" } = await searchParams;
  const k = ["open", "closed", "failed"].includes(tab) ? tab : "open";
  const since = new Date(Date.now() - 30 * 864e5);
  const q = k === "open" ? { status: { $in: LIVE } } : k === "closed" ? { status: "closed", closedAt: { $gte: since } } : { status: "failed", createdAt: { $gte: since } };
  const [trades, counts] = await Promise.all([
    Trade.find(q).sort({ createdAt: -1 }).limit(500).lean(),
    Promise.all([Trade.countDocuments({ status: { $in: LIVE } }), Trade.countDocuments({ status: "closed", closedAt: { $gte: since } }), Trade.countDocuments({ status: "failed", createdAt: { $gte: since } })]),
  ]);
  const [users, groups] = await Promise.all([
    User.find({ _id: { $in: [...new Set(trades.map((t) => String(t.userId)))] } }, { name: 1, email: 1 }).lean(),
    Group.find({ _id: { $in: [...new Set(trades.map((t) => String(t.groupId)))] } }, { title: 1 }).lean(),
  ]);
  const un = new Map(users.map((u) => [String(u._id), u])), gn = new Map(groups.map((g) => [String(g._id), g.title]));
  const pnl = trades.reduce((a, t) => a + (t.pnlUsdt || 0), 0);
  const wins = trades.filter((t) => t.pnlUsdt > 0).length;

  return (
    <>
      <div className="ap-top"><div><h1>Trades</h1><p>Every trade the bot placed for every user. Times in UTC.</p></div>
        <nav className="ad-seg" aria-label="Which trades">
          {[["open", "Open", counts[0]], ["closed", "Closed · 30 days", counts[1]], ["failed", "Not opened · 30 days", counts[2]]].map(([v, l, n]) => <a key={v} href={`/admin/trades?tab=${v}`} aria-current={k === v ? "page" : undefined}>{l}<small>{n}</small></a>)}
        </nav>
      </div>
      {k === "closed" && trades.length > 0 && (
        <section className="panel"><div className="ad-kpis" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>
          <div><span className="lab">Users&apos; P&amp;L · 30 days</span><b className={pnl >= 0 ? "pos" : "neg"}>{usd(pnl, true)}</b><span className="sub">USDT</span></div>
          <div><span className="lab">Closed trades</span><b>{trades.length}</b></div>
          <div><span className="lab">Win rate</span><b>{Math.round((wins / trades.length) * 100)}%</b></div>
        </div></section>
      )}
      <section className="panel">
        {trades.length === 0 ? <div className="empty"><b>{k === "open" ? "No open trades" : k === "closed" ? "No closed trades in 30 days" : "Nothing failed in 30 days"}</b></div> : (
          <div className="tbl"><table>
            <thead><tr><th>{k === "closed" ? "Closed" : "Opened"}</th><th>User</th><th>Coin</th><th>Group</th><th className="r">Size</th><th className="r">Entry</th><th className="r">{k === "open" ? "Stop" : "Exit"}</th>{k !== "failed" && <th className="r">P&amp;L</th>}<th>{k === "failed" ? "Why" : "Status"}</th></tr></thead>
            <tbody>{trades.map((t) => (
              <tr key={String(t._id)}>
                <td className="hint">{when(k === "closed" ? t.closedAt : t.openedAt || t.createdAt)}</td>
                <td><Link href={`/admin/users/${t.userId}`}><b>{un.get(String(t.userId))?.name || "–"}</b></Link><span className="hint">{un.get(String(t.userId))?.email || ""}</span></td>
                <td><b>{t.base}</b><span className="hint">{exName(t)}</span></td>
                <td>{gn.get(String(t.groupId)) || "–"}</td>
                <td className="r num">{usd(t.costUsdt)}</td>
                <td className="r num">{px(t.entryPrice)}</td>
                <td className="r num">{px(k === "open" ? t.stopPrice : t.exitPrice)}</td>
                {k !== "failed" && <td className={`r num ${t.pnlUsdt > 0 ? "pos" : t.pnlUsdt < 0 ? "neg" : ""}`}>{t.status === "closed" ? usd(t.pnlUsdt, true) : "–"}</td>}
                <td>{k === "failed" ? <span className="hint">{t.error || "–"}</span> : t.status === "closed" ? <span className={`pill ${t.pnlUsdt >= 0 ? "ok" : "bad"}`}>{t.outcome || "Closed"}</span> : <span className="pill info">{t.status}</span>}</td>
              </tr>))}
            </tbody></table></div>
        )}
      </section>
    </>
  );
}
