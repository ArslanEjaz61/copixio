import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { Exchange, Group, Signal, Telegram, Trade, planOf, PLANS } from "@/lib/models";
import { currentUser } from "@/lib/auth";
import { exchangeName } from "@/lib/exchanges/list";

export const dynamic = "force-dynamic";

const PERIODS = [["today", "Today"], ["7d", "7 days"], ["30d", "30 days"], ["all", "All time"]];
const sinceOf = (p) => (p === "today" ? new Date(new Date().setUTCHours(0, 0, 0, 0)) : p === "7d" ? new Date(Date.now() - 7 * 864e5) : p === "30d" ? new Date(Date.now() - 30 * 864e5) : new Date(0));
const money = (n) => `${n >= 0 ? "+" : "−"}${Math.abs(n || 0).toFixed(2)}`;
const px = (x) => (x === null || x === undefined ? "–" : Number(Number(x).toPrecision(6)));

// The dashboard is numbers only: results for the chosen period, what is open now, and how each group performs.
export default async function Dashboard({ searchParams }) {
  const user = await currentUser();
  if (!user) redirect("/login"); // a stale cookie: the page renders beside the layout, so it checks too
  const { p = "30d" } = await searchParams;
  const period = PERIODS.some(([k]) => k === p) ? p : "30d";
  const since = sinceOf(period);
  await db();

  const [closed, open, groups, exchanges, tg, signals] = await Promise.all([
    Trade.find({ userId: user._id, status: "closed", closedAt: { $gte: since } }, { pnlUsdt: 1, groupId: 1, base: 1, outcome: 1, closedAt: 1, costUsdt: 1, exchange: 1 }).sort({ closedAt: -1 }).lean(),
    Trade.find({ userId: user._id, status: { $in: ["opening", "open", "closing"] } }).sort({ createdAt: -1 }).lean(),
    Group.find({ userId: user._id }, { title: 1, kind: 1, enabled: 1 }).lean(),
    Exchange.find({ userId: user._id }, { exchange: 1, env: 1, status: 1, label: 1 }).lean(),
    Telegram.findOne({ userId: user._id, status: "connected" }, { _id: 1 }).lean(),
    Signal.aggregate([{ $match: { userId: user._id, createdAt: { $gte: since } } }, { $group: { _id: "$outcome", n: { $sum: 1 } } }]),
  ]);

  const pnl = closed.reduce((a, t) => a + (t.pnlUsdt || 0), 0);
  const won = closed.filter((t) => t.pnlUsdt > 0).length, lost = closed.filter((t) => t.pnlUsdt <= 0).length;
  const rate = closed.length ? Math.round((won / closed.length) * 100) : 0;
  const best = closed.reduce((m, t) => (t.pnlUsdt > (m?.pnlUsdt ?? -Infinity) ? t : m), null);
  const worst = closed.reduce((m, t) => (t.pnlUsdt < (m?.pnlUsdt ?? Infinity) ? t : m), null);
  const sig = Object.fromEntries(signals.map((s) => [s._id, s.n]));
  const signalsSeen = signals.reduce((a, s) => a + s.n, 0);
  const channels = groups.filter((g) => g.kind === "channel").length, grps = groups.length - channels, trading = groups.filter((g) => g.enabled).length;

  const byGroup = new Map(groups.map((g) => [String(g._id), { title: g.title, enabled: g.enabled, trades: 0, won: 0, lost: 0, pnl: 0 }]));
  for (const t of closed) {
    const r = byGroup.get(String(t.groupId));
    if (!r) continue;
    r.trades++; r.pnl += t.pnlUsdt || 0; if (t.pnlUsdt > 0) r.won++; else r.lost++;
  }
  const groupRows = [...byGroup.values()].sort((a, b) => b.pnl - a.pnl || b.trades - a.trades);
  const gName = (id) => byGroup.get(String(id))?.title || "–";
  const plan = planOf(user);

  return (
    <>
      <div className="ap-top">
        <div><h1>Dashboard</h1><p>{user.botPaused ? "The bot is paused: no new trades are placed." : plan === "none" ? "No plan is active, so the bot is not placing trades." : `${PLANS[plan].name} plan · the bot is reading ${trading} group${trading === 1 ? "" : "s"}.`}</p></div>
        <nav className="seg" aria-label="Period">
          {PERIODS.map(([k, l]) => <Link key={k} href={`/app?p=${k}`} className={period === k ? "on" : ""} style={{ padding: "8px 14px", textDecoration: "none", fontWeight: 600, borderLeft: k === "today" ? 0 : "1px solid var(--line-2)", background: period === k ? "var(--ink)" : "var(--surface)", color: period === k ? "var(--on-ink)" : "var(--text)" }}>{l}</Link>)}
        </nav>
      </div>

      <section className="panel"><div className="kpis kpis-5">
        <div><span className="lab">Net result</span><b className={`num ${pnl >= 0 ? "pos" : "neg"}`}>{money(pnl)} USDT</b></div>
        <div><span className="lab">Trades closed</span><b className="num">{closed.length}</b></div>
        <div><span className="lab">Won</span><b className="num pos">{won}</b></div>
        <div><span className="lab">Lost</span><b className="num neg">{lost}</b></div>
        <div><span className="lab">Win rate</span><b className="num">{rate}%</b></div>
      </div></section>

      <section className="panel"><div className="kpis kpis-5">
        <div><span className="lab">Open now</span><b className="num">{open.length}</b></div>
        <div><span className="lab">Groups · channels</span><b className="num">{grps} · {channels}</b></div>
        <div><span className="lab">Trading</span><b className="num">{trading}</b></div>
        <div><span className="lab">Signals read</span><b className="num">{signalsSeen}</b><span className="hint">{sig.traded || 0} traded · {sig.skipped || 0} skipped</span></div>
        <div><span className="lab">Best · worst</span><b className="num" style={{ fontSize: "1rem" }}><span className="pos">{best ? `${money(best.pnlUsdt)} ${best.base}` : "–"}</span><br /><span className="neg">{worst ? `${money(worst.pnlUsdt)} ${worst.base}` : "–"}</span></b></div>
      </div></section>

      <div className="dash-grid">
        <section className="panel">
          <div className="panel-h"><h2>Open trades</h2><Link className="btn-text" href="/app/trades">All trades</Link></div>
          {open.length === 0 ? <div className="empty"><b>No open trades</b><span>New trades appear here seconds after a signal is placed.</span></div> : (
            <div className="tbl"><table style={{ minWidth: 520 }}>
              <thead><tr><th>Coin</th><th>Group</th><th className="r">Size</th><th className="r">Entry</th><th className="r">Stop</th></tr></thead>
              <tbody>{open.slice(0, 10).map((t) => (
                <tr key={String(t._id)}><td><b>{t.base}</b><div className="hint">{exchangeName(t.exchange, t.env)}</div></td><td>{gName(t.groupId)}</td>
                  <td className="r num">{(t.costUsdt || 0).toFixed(2)}</td><td className="r num">{px(t.entryPrice)}</td><td className="r num neg">{px(t.stopPrice)}</td></tr>))}
              </tbody></table></div>
          )}
        </section>

        <section className="panel">
          <div className="panel-h"><h2>Accounts</h2><Link className="btn-text" href="/app/connections">Manage</Link></div>
          <ul className="rows">
            {[...exchanges.map((x) => [`${exchangeName(x.exchange, x.env)}${x.label ? ` · ${x.label}` : ""}`, x.status === "ok" ? "Connected" : "Key failing", String(x._id)]),
              ...(exchanges.length ? [] : [["Exchange", null, "ex"]]), ["Telegram", tg ? "Connected" : null, "tg"]].map(([n, st, k]) => (
              <li key={k}><b>{n}</b>{st ? <span className={`pill ${st === "Connected" ? "ok" : "bad"}`}>{st}</span> : <span className="pill info">Not connected</span>}</li>
            ))}
            <li><b>Plan</b>{plan === "none" ? <Link className="pill wait" href="/app/billing" style={{ textDecoration: "none" }}>No plan</Link> : <span className="pill ok">{user.trial ? "Free trial" : PLANS[plan].name} · until {new Date(user.planUntil).toISOString().slice(0, 10)}</span>}</li>
          </ul>
        </section>
      </div>

      <section className="panel">
        <div className="panel-h"><h2>Results by group</h2><Link className="btn-text" href="/app/groups">Signal groups</Link></div>
        {groupRows.length === 0 ? <div className="empty"><b>No groups yet</b><span>Groups you follow show their trades, wins, losses and result here.</span></div> : (
          <div className="tbl"><table style={{ minWidth: 560 }}>
            <thead><tr><th>Group</th><th className="r">Trades</th><th className="r">Won</th><th className="r">Lost</th><th className="r">Win rate</th><th className="r">Result (USDT)</th><th>Status</th></tr></thead>
            <tbody>{groupRows.map((r) => (
              <tr key={r.title}><td><b>{r.title}</b></td><td className="r num">{r.trades}</td><td className="r num pos">{r.won}</td><td className="r num neg">{r.lost}</td>
                <td className="r num">{r.trades ? Math.round((r.won / r.trades) * 100) : 0}%</td><td className={`r num ${r.pnl >= 0 ? "pos" : "neg"}`}>{money(r.pnl)}</td>
                <td>{r.enabled ? <span className="pill ok">Trading</span> : <span className="pill info">Off</span>}</td></tr>))}
            </tbody></table></div>
        )}
      </section>

      <section className="panel">
        <div className="panel-h"><h2>Recently closed</h2></div>
        {closed.length === 0 ? <div className="empty"><b>No closed trades in this period</b></div> : (
          <ul className="rows">{closed.slice(0, 8).map((t) => (
            <li key={String(t._id)}><div className="row-main"><b>{t.base}</b><span className="hint">{gName(t.groupId)} · {new Date(t.closedAt).toISOString().slice(5, 16).replace("T", " ")} UTC</span></div>
              <div className="row-side"><span className={`pill ${t.pnlUsdt >= 0 ? "ok" : "bad"}`}>{t.outcome}</span><b className={`num ${t.pnlUsdt >= 0 ? "pos" : "neg"}`}>{money(t.pnlUsdt)}</b></div></li>))}
          </ul>
        )}
      </section>
    </>
  );
}
