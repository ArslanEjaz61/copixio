import Link from "next/link";
import { Exchange, Group, Payment, Signal, Telegram, Trade, User, PLANS, planOf } from "@/lib/models";
import { ago, day, requireAdmin, standing, usd } from "@/lib/admin";

export const metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

const DAY = 864e5;

export default async function AdminOverview() {
  await requireAdmin();
  const now = Date.now();
  const since24 = new Date(now - DAY), since7 = new Date(now - 7 * DAY), since30 = new Date(now - 30 * DAY);
  const [users, payments, exchanges, tgs, groupsOn, sig24, skipReasons, openTrades, closed7, tradedUsers, lastSignal, lastTrade] = await Promise.all([
    User.find({}, { name: 1, email: 1, role: 1, plan: 1, planUntil: 1, trial: 1, botPaused: 1, createdAt: 1, lastLoginAt: 1 }).lean(),
    Payment.find({}, { status: 1, amountUsdt: 1, plan: 1, createdAt: 1, decidedAt: 1, userId: 1 }).lean(),
    Exchange.find({}, { userId: 1, status: 1 }).lean(),
    Telegram.find({}, { userId: 1, status: 1 }).lean(),
    Group.find({ enabled: true }, { userId: 1 }).lean(),
    Signal.aggregate([{ $match: { createdAt: { $gte: since24 } } }, { $group: { _id: "$outcome", n: { $sum: 1 } } }]),
    Signal.aggregate([{ $match: { createdAt: { $gte: since24 }, outcome: { $in: ["skipped", "error"] } } }, { $group: { _id: "$reason", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 6 }]),
    Trade.countDocuments({ status: { $in: ["opening", "open", "closing"] } }),
    Trade.find({ status: "closed", closedAt: { $gte: since7 } }, { pnlUsdt: 1 }).lean(),
    Trade.distinct("userId"),
    Signal.findOne({}, { createdAt: 1 }).sort({ createdAt: -1 }).lean(),
    Trade.findOne({}, { createdAt: 1 }).sort({ createdAt: -1 }).lean(),
  ]);

  // people
  const st = users.map((u) => ({ u, s: standing(u) }));
  const count = (k) => st.filter((x) => x.s === k).length;
  const new7 = users.filter((u) => +new Date(u.createdAt) >= +since7).length;
  const ending = st.filter((x) => (x.s === "trial" || x.s === "paid") && +new Date(x.u.planUntil) - now < 2 * DAY);
  const mrr = st.filter((x) => x.s === "paid").reduce((a, x) => a + (PLANS[planOf(x.u)]?.price || 0), 0);

  // money
  const approved = payments.filter((p) => p.status === "approved");
  const rev30 = approved.filter((p) => +new Date(p.decidedAt || p.createdAt) >= +since30).reduce((a, p) => a + (p.amountUsdt || 0), 0);
  const revAll = approved.reduce((a, p) => a + (p.amountUsdt || 0), 0);
  const pending = payments.filter((p) => p.status === "submitted");

  // set-up funnel
  const has = (arr, f = () => true) => new Set(arr.filter(f).map((x) => String(x.userId)));
  const exOk = has(exchanges, (e) => e.status === "ok");
  const tgOk = has(tgs, (t) => t.status === "connected");
  const grOn = has(groupsOn);
  const traded = new Set(tradedUsers.map(String));
  const ids = users.map((u) => String(u._id));
  const funnel = [
    ["Signed up", ids.length],
    ["Exchange connected", ids.filter((i) => exOk.has(i)).length],
    ["Telegram connected", ids.filter((i) => exOk.has(i) && tgOk.has(i)).length],
    ["A group switched on", ids.filter((i) => exOk.has(i) && tgOk.has(i) && grOn.has(i)).length],
    ["Bot placed a trade", ids.filter((i) => traded.has(i)).length],
  ];
  const top = Math.max(1, funnel[0][1]);

  // sign-ups per UTC day, last 14 days
  const today0 = new Date(new Date().setUTCHours(0, 0, 0, 0)).getTime();
  const days = Array.from({ length: 14 }, (_, i) => today0 - (13 - i) * DAY);
  const perDay = days.map((d) => users.filter((u) => { const t = +new Date(u.createdAt); return t >= d && t < d + DAY; }).length);
  const maxDay = Math.max(1, ...perDay);

  // bot activity
  const sig = Object.fromEntries(sig24.map((x) => [x._id, x.n]));
  const sigTotal = sig24.reduce((a, x) => a + x.n, 0);
  const pnl7 = closed7.reduce((a, t) => a + (t.pnlUsdt || 0), 0);
  const won7 = closed7.filter((t) => t.pnlUsdt > 0).length;

  // what needs a look
  const exErr = exchanges.filter((e) => e.status !== "ok").length;
  const tgLost = tgs.filter((t) => t.status !== "connected" && t.status !== "pending").length;
  const attention = [
    pending.length && ["bad", <><Link href="/admin/payments">{pending.length} payment{pending.length > 1 ? "s" : ""}</Link> waiting for your approval</>],
    ending.length && ["wait", <><Link href="/admin/users?f=ending">{ending.length} plan{ending.length > 1 ? "s" : ""} or trial{ending.length > 1 ? "s" : ""}</Link> end within 48 hours</>],
    exErr && ["wait", <><Link href="/admin/users?f=exerr">{exErr} exchange key{exErr > 1 ? "s" : ""}</Link> failing their check</>],
    tgLost && ["wait", <><Link href="/admin/users?f=tglost">{tgLost} Telegram login{tgLost > 1 ? "s" : ""}</Link> ended; those users&apos; groups are not read</>],
    count("expired") && ["info", <><Link href="/admin/users?f=expired">{count("expired")} account{count("expired") > 1 ? "s" : ""}</Link> expired and are not trading</>],
  ].filter(Boolean);
  const newest = [...users].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 6);

  return (
    <>
      <div className="ap-top"><div><h1>Overview</h1><p>Everyone on Copixio, what they set up, and what the bot is doing. Times in UTC.</p></div></div>

      <section className="panel"><div className="ad-kpis">
        <div><span className="lab">Users</span><b>{users.length}</b><span className="sub">+{new7} this week</span></div>
        <div><span className="lab">On free trial</span><b>{count("trial")}</b><span className="sub">{ending.filter((x) => x.s === "trial").length} end in 48 h</span></div>
        <div><span className="lab">Paying</span><b>{count("paid")}</b><span className="sub">{usd(mrr)} USDT a month</span></div>
        <div><span className="lab">Revenue · 30 days</span><b>{usd(rev30)}</b><span className="sub">{usd(revAll)} USDT all time</span></div>
        <div><span className="lab">Open trades</span><b>{openTrades}</b><span className="sub">across all users</span></div>
      </div></section>

      <div className="ad-grid">
        <div className="ad-stack">
          <section className="panel">
            <div className="panel-h"><h2>Sign-ups · last 14 days</h2><span className="hint">{perDay.reduce((a, b) => a + b, 0)} in total</span></div>
            <div className="ad-chart" role="img" aria-label={`Sign-ups per day: ${perDay.join(", ")}`}>
              {perDay.map((n, i) => (
                <div className="bar" key={i}><span className="n">{n || ""}</span><div className={`col${i === 13 ? " today" : ""}`} style={{ height: `${(n / maxDay) * 100}%` }} /></div>
              ))}
            </div>
            <div className="ad-axis" aria-hidden="true">{days.map((d, i) => <span key={i}>{i % 2 === 1 || i === 13 ? new Date(d).toISOString().slice(8, 10) : ""}</span>)}</div>
          </section>

          <section className="panel">
            <div className="panel-h"><h2>Set-up funnel</h2><span className="hint">How far users got</span></div>
            <div className="ad-funnel">
              {funnel.map(([l, n]) => (
                <div className="row" key={l}>
                  <span>{l}</span>
                  <div className="track"><div className="fill" style={{ width: `${(n / top) * 100}%` }} /></div>
                  <span className="v">{n} <small>{Math.round((n / top) * 100)}%</small></span>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-h"><h2>Newest users</h2><Link className="btn btn-line sm" href="/admin/users">All users</Link></div>
            {newest.length === 0 ? <div className="empty"><b>No users yet</b></div> : (
              <div className="tbl"><table>
                <thead><tr><th>User</th><th>Joined</th><th>Status</th><th>Last seen</th></tr></thead>
                <tbody>{newest.map((u) => { const s = standing(u); return (
                  <tr key={String(u._id)}>
                    <td><Link href={`/admin/users/${u._id}`}><b>{u.name || "–"}</b></Link><span className="hint">{u.email}</span></td>
                    <td className="hint">{day(u.createdAt)}</td>
                    <td><span className={`pill ${s === "paid" ? "ok" : s === "trial" ? "info" : s === "expired" ? "wait" : "bad"}`}>{{ trial: "Free trial", paid: PLANS[planOf(u)]?.name, expired: "Expired", none: "No plan" }[s]}</span></td>
                    <td className="hint">{ago(u.lastLoginAt || u.createdAt)}</td>
                  </tr>); })}
                </tbody></table></div>
            )}
          </section>
        </div>

        <div className="ad-stack">
          <section className="panel">
            <div className="panel-h"><h2>Needs a look</h2></div>
            {attention.length === 0 ? <div className="empty"><b>All clear</b><span>No payments waiting, no failing keys, no lost Telegram logins.</span></div> : (
              <ul className="ad-alerts">{attention.map(([k, t], i) => <li key={i}><span className={`dot ${k}`} aria-hidden="true" /><span>{t}</span></li>)}</ul>
            )}
          </section>

          <section className="panel">
            <div className="panel-h"><h2>Bot · last 24 hours</h2></div>
            <ul className="ad-kv">
              <li><span>Messages read</span><b>{sigTotal}</b></li>
              <li><span>Signals traded</span><b className="pos">{sig.traded || 0}</b></li>
              <li><span>Signals skipped</span><b>{sig.skipped || 0}</b></li>
              <li><span>Not a signal</span><b>{sig.not_a_signal || 0}</b></li>
              <li><span>Errors</span><b className={sig.error ? "neg" : ""}>{sig.error || 0}</b></li>
              <li><span>Last message read</span><b>{ago(lastSignal?.createdAt)}</b></li>
              <li><span>Last trade placed</span><b>{ago(lastTrade?.createdAt)}</b></li>
            </ul>
          </section>

          <section className="panel">
            <div className="panel-h"><h2>Results · 7 days</h2><Link className="btn btn-line sm" href="/admin/trades?tab=closed">Trades</Link></div>
            <ul className="ad-kv">
              <li><span>Closed trades</span><b>{closed7.length}</b></li>
              <li><span>Win rate</span><b>{closed7.length ? Math.round((won7 / closed7.length) * 100) : 0}%</b></li>
              <li><span>Users&apos; P&amp;L</span><b className={pnl7 >= 0 ? "pos" : "neg"}>{usd(pnl7, true)} USDT</b></li>
            </ul>
          </section>

          <section className="panel">
            <div className="panel-h"><h2>Why signals were skipped</h2><span className="hint">24 h</span></div>
            {skipReasons.length === 0 ? <div className="empty"><span>Nothing skipped.</span></div> : (
              <ul className="ad-kv">{skipReasons.map((r) => <li key={String(r._id)}><span style={{ color: "var(--text)" }}>{r._id || "no reason recorded"}</span><b>{r.n}</b></li>)}</ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
