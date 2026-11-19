import { db } from "@/lib/db";
import { Group, Signal, Trade } from "@/lib/models";
import { currentUser } from "@/lib/auth";
import CloseTrade from "@/components/app/CloseTrade";

export const metadata = { title: "Trades" };
export const dynamic = "force-dynamic";

const n = (x, d = 2) => (x === null || x === undefined ? "–" : Number(x).toFixed(d));
const p = (x) => (x === null || x === undefined ? "–" : Number(Number(x).toPrecision(6)));
const when = (d) => (d ? new Date(d).toISOString().slice(5, 16).replace("T", " ") + " UTC" : "–");

export default async function TradesPage({ searchParams }) {
  const user = await currentUser();
  const { tab = "open" } = await searchParams;
  await db();
  const groups = new Map((await Group.find({ userId: user._id }, { title: 1 }).lean()).map((g) => [String(g._id), g.title]));
  const monthAgo = new Date(Date.now() - 30 * 864e5);
  const [open, closed, signals] = await Promise.all([
    Trade.find({ userId: user._id, status: { $in: ["opening", "open", "closing"] } }).sort({ createdAt: -1 }).lean(),
    tab === "closed" ? Trade.find({ userId: user._id, status: { $in: ["closed", "failed"] }, createdAt: { $gte: monthAgo } }).sort({ createdAt: -1 }).limit(300).lean() : [],
    tab === "signals" ? Signal.find({ userId: user._id }).sort({ createdAt: -1 }).limit(150).lean() : [],
  ]);
  const closedPnl = closed.filter((t) => t.status === "closed").reduce((a, t) => a + (t.pnlUsdt || 0), 0);
  const wins = closed.filter((t) => t.status === "closed" && t.pnlUsdt > 0).length;
  const done = closed.filter((t) => t.status === "closed").length;

  return (
    <>
      <div className="ap-top"><div><h1>Trades</h1><p>Everything the bot placed for you, and every signal it read.</p></div>
        <nav className="seg" aria-label="View">
          {[["open", `Open (${open.length})`], ["closed", "Closed · 30 days"], ["signals", "Signal log"]].map(([k, l]) => (
            <a key={k} href={`/app/trades?tab=${k}`} className={tab === k ? "on" : ""} style={{ padding: "8px 14px", textDecoration: "none", fontWeight: 600, borderLeft: k === "open" ? 0 : "1px solid var(--line-2)", background: tab === k ? "var(--ink)" : "var(--surface)", color: tab === k ? "var(--on-ink)" : "var(--text)" }}>{l}</a>
          ))}
        </nav>
      </div>

      {tab === "open" && (
        <section className="panel">
          {open.length === 0 ? <div className="empty"><b>No open trades</b><span>When a group you switched on posts a signal that fits its rules, the trade shows up here.</span></div> : (
            <div className="tbl"><table>
              <thead><tr><th>Coin</th><th>Group</th><th className="r">Size</th><th className="r">Entry</th><th className="r">Stop</th><th>Targets</th><th>Opened</th><th></th></tr></thead>
              <tbody>{open.map((t) => (
                <tr key={String(t._id)}>
                  <td><b>{t.base}</b><div className="hint">{t.exchange === "binance" ? "Binance" : "KuCoin"}{t.env === "demo" ? " demo" : ""}</div></td>
                  <td>{groups.get(String(t.groupId)) || "–"}</td>
                  <td className="r num">{n(t.costUsdt)}</td>
                  <td className="r num">{p(t.entryPrice)}</td>
                  <td className="r num neg">{p(t.stopPrice)}</td>
                  <td className="num">{(t.targets || []).map((x, i) => <span key={i} style={{ marginRight: 8, textDecoration: x.done ? "line-through" : "none", color: x.done ? "var(--profit)" : undefined }}>{p(x.price)}</span>)}</td>
                  <td className="hint">{when(t.openedAt || t.createdAt)}</td>
                  <td>{t.status === "open" && !t.closeRequested ? <CloseTrade id={String(t._id)} base={t.base} /> : <span className="pill info">{t.status === "opening" ? "Opening" : "Closing"}</span>}</td>
                </tr>))}
              </tbody></table></div>
          )}
        </section>
      )}

      {tab === "closed" && (
        <>
          <section className="panel"><div className="kpis">
            <div><span className="lab">Result · 30 days</span><b className={`num ${closedPnl >= 0 ? "pos" : "neg"}`}>{closedPnl >= 0 ? "+" : ""}{n(closedPnl)} USDT</b></div>
            <div><span className="lab">Trades</span><b className="num">{done}</b></div>
            <div><span className="lab">Won</span><b className="num">{wins}</b></div>
            <div><span className="lab">Win rate</span><b className="num">{done ? Math.round((wins / done) * 100) : 0}%</b></div>
          </div></section>
          <section className="panel">
            {closed.length === 0 ? <div className="empty"><b>No closed trades in the last 30 days</b></div> : (
              <div className="tbl"><table>
                <thead><tr><th>Coin</th><th>Group</th><th className="r">Size</th><th className="r">Entry</th><th className="r">Exit</th><th className="r">Result</th><th>Outcome</th><th>Closed</th></tr></thead>
                <tbody>{closed.map((t) => (
                  <tr key={String(t._id)}>
                    <td><b>{t.base}</b><div className="hint">{t.exchange === "binance" ? "Binance" : "KuCoin"}{t.env === "demo" ? " demo" : ""}</div></td>
                    <td>{groups.get(String(t.groupId)) || "–"}</td>
                    <td className="r num">{n(t.costUsdt)}</td>
                    <td className="r num">{p(t.entryPrice)}</td>
                    <td className="r num">{p(t.exitPrice)}</td>
                    <td className={`r num ${t.pnlUsdt >= 0 ? "pos" : "neg"}`}>{t.status === "failed" ? "–" : `${t.pnlUsdt >= 0 ? "+" : ""}${n(t.pnlUsdt)}`}</td>
                    <td>{t.status === "failed" ? <span className="pill bad" title={t.error || ""}>Not opened</span> : <span className={`pill ${t.pnlUsdt >= 0 ? "ok" : "bad"}`}>{t.outcome}</span>}</td>
                    <td className="hint">{when(t.closedAt || t.updatedAt)}</td>
                  </tr>))}
                </tbody></table></div>
            )}
          </section>
        </>
      )}

      {tab === "signals" && (
        <section className="panel">
          {signals.length === 0 ? <div className="empty"><b>No messages read yet</b><span>Messages from the groups you switched on appear here, with what the bot did.</span></div> : (
            <ul className="rows">{signals.map((s) => (
              <li key={String(s._id)} style={{ alignItems: "flex-start" }}>
                <div className="row-main" style={{ maxWidth: 680 }}>
                  <span className="hint">{when(s.createdAt)} · {groups.get(String(s.groupId)) || "group"}</span>
                  <span style={{ whiteSpace: "pre-wrap", fontSize: ".92rem" }}>{String(s.text || "").slice(0, 280)}</span>
                  {s.parsed?.ok && <span className="hint num">{s.parsed.base} {s.parsed.side} · entry {s.parsed.entryLow ?? "market"} · stop {s.parsed.stop ?? "–"} · targets {(s.parsed.targets || []).join(", ") || "–"}</span>}
                </div>
                <div className="row-side" style={{ flexDirection: "column", alignItems: "flex-end" }}>
                  <span className={`pill ${s.outcome === "traded" ? "ok" : s.outcome === "not_a_signal" ? "info" : s.outcome === "error" ? "bad" : "wait"}`}>{{ traded: "Traded", skipped: "Skipped", not_a_signal: "Not a signal", error: "Error", queued: "Queued", processing: "Placing" }[s.outcome]}</span>
                  {s.reason && <span className="hint" style={{ maxWidth: 300, textAlign: "right" }}>{s.reason}</span>}
                </div>
              </li>))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
