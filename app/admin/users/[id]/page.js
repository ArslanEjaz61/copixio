import Link from "next/link";
import mongoose from "mongoose";
import { notFound } from "next/navigation";
import { Exchange, Group, Payment, Signal, Telegram, Trade, User, PLANS, planOf } from "@/lib/models";
import { ago, day, px, requireAdmin, standing, usd, when } from "@/lib/admin";
import { PauseToggle, PlanSetter } from "@/components/admin/Actions";
import { exchangeName } from "@/lib/exchanges/list";

export const metadata = { title: "User" };
export const dynamic = "force-dynamic";

const exName = (e) => exchangeName(e.exchange, e.env);
const OUT = { traded: ["Traded", "ok"], skipped: ["Skipped", "wait"], not_a_signal: ["Not a signal", "info"], error: ["Error", "bad"], queued: ["Queued", "info"], processing: ["Placing", "info"] };

export default async function AdminUser({ params }) {
  await requireAdmin();
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) notFound();
  const u = await User.findById(id, { passwordHash: 0, notifyLinkHash: 0 }).lean();
  if (!u) notFound();
  const [exs, tg, groups, trades, signals, pays] = await Promise.all([
    Exchange.find({ userId: u._id }, { keySealed: 0, secretSealed: 0, passphraseSealed: 0 }).sort({ createdAt: 1 }).lean(),
    Telegram.findOne({ userId: u._id }, { sessionSealed: 0, pendingSessionSealed: 0, phoneCodeHash: 0 }).lean(),
    Group.find({ userId: u._id }).sort({ createdAt: 1 }).lean(),
    Trade.find({ userId: u._id }).sort({ createdAt: -1 }).limit(50).lean(),
    Signal.find({ userId: u._id }).sort({ createdAt: -1 }).limit(30).lean(),
    Payment.find({ userId: u._id }).sort({ createdAt: -1 }).lean(),
  ]);
  const gName = new Map(groups.map((g) => [String(g._id), g.title]));
  const s = standing(u);
  const closed = trades.filter((t) => t.status === "closed");
  const pnl = closed.reduce((a, t) => a + (t.pnlUsdt || 0), 0);
  const paid = pays.filter((p) => p.status === "approved").reduce((a, p) => a + (p.amountUsdt || 0), 0);

  return (
    <>
      <div className="ap-top">
        <div className="ad-head">
          <span className="av" style={{ background: "var(--ink)" }} aria-hidden="true">{(u.name || u.email)[0].toUpperCase()}</span>
          <div>
            <h1>{u.name || u.email}</h1>
            <p>{u.email}{u.role === "admin" ? " · admin" : ""} · joined {day(u.createdAt)} · last seen {ago(u.lastLoginAt || u.createdAt)}</p>
          </div>
        </div>
        <Link className="btn btn-line sm" href="/admin/users">← All users</Link>
      </div>

      <section className="panel"><div className="ad-kpis">
        <div><span className="lab">Status</span><b style={{ fontSize: "1.25rem" }}>{{ trial: "Free trial", paid: PLANS[planOf(u)]?.name, expired: "Expired", none: "No plan" }[s]}</b><span className="sub">{s === "trial" || s === "paid" ? `until ${day(u.planUntil)}` : "not trading"}</span></div>
        <div><span className="lab">Bot</span><b style={{ fontSize: "1.25rem" }} className={u.botPaused ? "neg" : "pos"}>{u.botPaused ? "Paused" : "On"}</b><span className="sub">{groups.filter((g) => g.enabled).length} group(s) on</span></div>
        <div><span className="lab">Trades</span><b>{trades.length}</b><span className="sub">{trades.filter((t) => ["opening", "open", "closing"].includes(t.status)).length} open now</span></div>
        <div><span className="lab">P&amp;L</span><b className={pnl >= 0 ? "pos" : "neg"}>{usd(pnl, true)}</b><span className="sub">USDT on {closed.length} closed</span></div>
        <div><span className="lab">Paid us</span><b>{usd(paid)}</b><span className="sub">USDT</span></div>
      </div></section>

      <div className="ad-grid">
        <div className="ad-stack">
          <section className="panel">
            <div className="panel-h"><h2>Exchange keys</h2></div>
            {exs.length === 0 ? <div className="empty"><span>No exchange connected yet.</span></div> : (
              <ul className="ad-kv">{exs.map((e) => (
                <li key={String(e._id)}>
                  <span style={{ color: "var(--text)" }}><b style={{ fontFamily: "var(--font-body)" }}>{exName(e)}</b>{e.label ? ` · ${e.label}` : ""} <span className="hint">key …{e.keyTail || "?"} · checked {ago(e.checkedAt)}{e.lastError ? ` · ${e.lastError}` : ""}</span></span>
                  <span className="actions">{e.status === "ok" && <b>{usd(e.usdtFree)} USDT</b>}<span className={`pill ${e.status === "ok" ? "ok" : "bad"}`}>{e.status === "ok" ? "Working" : "Failing"}</span></span>
                </li>))}
              </ul>
            )}
          </section>

          <section className="panel">
            <div className="panel-h"><h2>Signal groups</h2></div>
            {groups.length === 0 ? <div className="empty"><span>No groups followed yet.</span></div> : (
              <div className="tbl"><table>
                <thead><tr><th>Group</th><th>Status</th><th>Account</th><th className="r">Size</th><th className="r">Max open</th><th>Stop</th><th>Daily loss cap</th></tr></thead>
                <tbody>{groups.map((g) => { const e = exs.find((x) => String(x._id) === String(g.exchangeId)); return (
                  <tr key={String(g._id)}>
                    <td><b>{g.title}</b><span className="hint">{g.kind || "group"}</span></td>
                    <td><span className={`pill ${g.enabled ? "ok" : "info"}`}>{g.enabled ? "Trading" : "Off"}</span></td>
                    <td>{e ? exName(e) : "–"}</td>
                    <td className="r num">{g.sizeMode === "percent" ? `${g.sizePercent}%` : `${usd(g.sizeUsdt)} USDT`}</td>
                    <td className="r num">{g.maxOpen}</td>
                    <td>{g.slMode === "signal" ? `From signal, else ${g.slPercent}%` : `${g.slPercent}% below entry`}</td>
                    <td className="num">{g.dailyLossUsdt > 0 ? `${usd(g.dailyLossUsdt)} USDT` : "–"}</td>
                  </tr>); })}
                </tbody></table></div>
            )}
          </section>

          <section className="panel">
            <div className="panel-h"><h2>Trades</h2><span className="hint">Newest 50</span></div>
            {trades.length === 0 ? <div className="empty"><span>No trades yet.</span></div> : (
              <div className="tbl"><table>
                <thead><tr><th>Opened (UTC)</th><th>Coin</th><th>Group</th><th className="r">Size</th><th className="r">Entry</th><th className="r">Exit</th><th className="r">P&amp;L</th><th>Status</th></tr></thead>
                <tbody>{trades.map((t) => (
                  <tr key={String(t._id)}>
                    <td className="hint">{when(t.openedAt || t.createdAt)}</td>
                    <td><b>{t.base}</b><span className="hint">{exName(t)}</span></td>
                    <td>{gName.get(String(t.groupId)) || "–"}</td>
                    <td className="r num">{usd(t.costUsdt)}</td>
                    <td className="r num">{px(t.entryPrice)}</td>
                    <td className="r num">{px(t.exitPrice)}</td>
                    <td className={`r num ${t.pnlUsdt > 0 ? "pos" : t.pnlUsdt < 0 ? "neg" : ""}`}>{t.status === "closed" ? usd(t.pnlUsdt, true) : "–"}</td>
                    <td>{t.status === "closed" ? <span className={`pill ${t.pnlUsdt >= 0 ? "ok" : "bad"}`}>{t.outcome || "Closed"}</span> : t.status === "failed" ? <span className="pill bad" title={t.error || ""}>Not opened</span> : <span className="pill info">{t.status}</span>}</td>
                  </tr>))}
                </tbody></table></div>
            )}
          </section>

          <section className="panel">
            <div className="panel-h"><h2>Messages the bot read</h2><span className="hint">Newest 30</span></div>
            {signals.length === 0 ? <div className="empty"><span>No messages read yet.</span></div> : (
              <div className="tbl"><table>
                <thead><tr><th>Time (UTC)</th><th>Group</th><th>Message</th><th>Result</th></tr></thead>
                <tbody>{signals.map((m) => { const [l, k] = OUT[m.outcome] || [m.outcome, "info"]; return (
                  <tr key={String(m._id)}>
                    <td className="hint">{when(m.createdAt)}</td>
                    <td>{gName.get(String(m.groupId)) || "–"}</td>
                    <td><div className="ad-text">{String(m.text || "").slice(0, 220)}</div>{m.parsed?.ok && <span className="hint num">{m.parsed.base} {m.parsed.side} · entry {m.parsed.entryLow ?? "market"} · stop {m.parsed.stop ?? "–"}</span>}</td>
                    <td><span className={`pill ${k}`}>{l}</span>{m.reason && <span className="hint">{m.reason}</span>}</td>
                  </tr>); })}
                </tbody></table></div>
            )}
          </section>
        </div>

        <div className="ad-stack">
          <section className="panel">
            <div className="panel-h"><h2>Manage</h2></div>
            <div className="ad-actions">
              <div><h3>Plan</h3><p className="hint">Sets the plan from today for the number of days given. Ends a free trial.</p></div>
              <PlanSetter userId={String(u._id)} plan={u.plan} />
              <div><h3>Bot</h3><p className="hint">{u.botPaused ? "Paused: no new trades are placed for this user." : "On: groups that are switched on are traded."}</p></div>
              <PauseToggle userId={String(u._id)} paused={!!u.botPaused} />
            </div>
          </section>

          <section className="panel">
            <div className="panel-h"><h2>Telegram</h2></div>
            <ul className="ad-kv">
              <li><span>Status</span>{!tg ? <span className="hint">Not connected</span> : <span className={`pill ${tg.status === "connected" ? "ok" : "wait"}`}>{tg.status}</span>}</li>
              {tg?.tgName && <li><span>Account</span><b style={{ fontFamily: "var(--font-body)" }}>{tg.tgName}</b></li>}
              {tg?.connectedAt && <li><span>Connected</span><b>{when(tg.connectedAt)}</b></li>}
              {tg?.lastError && <li><span>Last error</span><span className="hint err">{tg.lastError}</span></li>}
              <li><span>Trade messages to Telegram</span><b style={{ fontFamily: "var(--font-body)" }}>{u.notifyChatId ? "On" : "Off"}</b></li>
            </ul>
          </section>

          <section className="panel">
            <div className="panel-h"><h2>Account</h2></div>
            <ul className="ad-kv">
              <li><span>Email verified</span><b style={{ fontFamily: "var(--font-body)" }}>{u.emailVerifiedAt ? day(u.emailVerifiedAt) : "No"}</b></li>
              <li><span>Plan wanted at sign-up</span><b style={{ fontFamily: "var(--font-body)" }}>{u.wantedPlan ? PLANS[u.wantedPlan]?.name || u.wantedPlan : "–"}</b></li>
              <li><span>Joined</span><b>{when(u.createdAt)}</b></li>
              <li><span>Last sign-in</span><b>{when(u.lastLoginAt)}</b></li>
            </ul>
          </section>

          <section className="panel">
            <div className="panel-h"><h2>Payments</h2></div>
            {pays.length === 0 ? <div className="empty"><span>No payments.</span></div> : (
              <ul className="ad-kv">{pays.map((p) => (
                <li key={String(p._id)}>
                  <span style={{ color: "var(--text)" }}>{PLANS[p.plan]?.name} × {p.months} <span className="hint">{day(p.createdAt)}</span></span>
                  <span className="actions"><b>{usd(p.amountUsdt)}</b><span className={`pill ${p.status === "approved" ? "ok" : p.status === "rejected" ? "bad" : "wait"}`}>{p.status === "submitted" ? "Waiting" : p.status}</span></span>
                </li>))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
