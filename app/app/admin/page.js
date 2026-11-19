import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Exchange, Group, Payment, Telegram, Trade, User, PLANS, planOf } from "@/lib/models";
import { currentUser } from "@/lib/auth";
import { PaymentActions, PlanSetter } from "@/components/app/AdminClient";

export const metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const me = await currentUser();
  if (me?.role !== "admin") notFound();
  await db();
  const [users, pending, exch, tgs, groups, open, closedToday] = await Promise.all([
    User.find({}, { passwordHash: 0 }).sort({ createdAt: -1 }).limit(500).lean(),
    Payment.find({ status: "submitted" }).sort({ createdAt: 1 }).lean(),
    Exchange.aggregate([{ $group: { _id: "$userId", n: { $sum: 1 } } }]),
    Telegram.find({ status: "connected" }, { userId: 1 }).lean(),
    Group.aggregate([{ $match: { enabled: true } }, { $group: { _id: "$userId", n: { $sum: 1 } } }]),
    Trade.countDocuments({ status: { $in: ["opening", "open", "closing"] } }),
    Trade.find({ status: "closed", closedAt: { $gte: new Date(new Date().setUTCHours(0, 0, 0, 0)) } }, { pnlUsdt: 1 }).lean(),
  ]);
  const m = (arr) => new Map(arr.map((x) => [String(x._id), x.n]));
  const ex = m(exch), gr = m(groups), tg = new Set(tgs.map((t) => String(t.userId)));
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const paying = users.filter((u) => planOf(u) !== "none").length;

  return (
    <>
      <div className="ap-top"><div><h1>Admin</h1><p>Users, payments and what the bot is doing.</p></div></div>
      <section className="panel"><div className="kpis">
        <div><span className="lab">Users</span><b className="num">{users.length}</b></div>
        <div><span className="lab">Paying</span><b className="num">{paying}</b></div>
        <div><span className="lab">Open trades</span><b className="num">{open}</b></div>
        <div><span className="lab">Closed today</span><b className="num">{closedToday.length}</b></div>
      </div></section>

      <section className="panel">
        <div className="panel-h"><h2>Payments to confirm ({pending.length})</h2><span className="hint">Check each TXID on tronscan.org before approving.</span></div>
        {pending.length === 0 ? <div className="empty"><b>Nothing waiting</b></div> : (
          <ul className="rows">{pending.map((p) => (
            <li key={String(p._id)}>
              <div className="row-main"><b>{byId.get(String(p.userId))?.email || "?"} · {PLANS[p.plan].name} × {p.months} · <span className="num">{p.amountUsdt} USDT</span></b>
                <a className="hint mono" style={{ wordBreak: "break-all" }} href={`https://tronscan.org/#/transaction/${p.txid}`} target="_blank" rel="noopener noreferrer">{p.txid}</a></div>
              <PaymentActions id={String(p._id)} />
            </li>))}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="panel-h"><h2>Users</h2></div>
        <div className="tbl"><table>
          <thead><tr><th>User</th><th>Joined</th><th>Plan</th><th className="r">Exchanges</th><th>Telegram</th><th className="r">Groups on</th><th>Set plan (days)</th></tr></thead>
          <tbody>{users.map((u) => (
            <tr key={String(u._id)}>
              <td><b>{u.name || "–"}</b><div className="hint">{u.email}{u.role === "admin" ? " · admin" : ""}</div></td>
              <td className="hint">{new Date(u.createdAt).toISOString().slice(0, 10)}</td>
              <td>{planOf(u) === "none" ? <span className="pill wait">none</span> : <span className="pill ok">{u.plan} → {new Date(u.planUntil).toISOString().slice(0, 10)}</span>}</td>
              <td className="r num">{ex.get(String(u._id)) || 0}</td>
              <td>{tg.has(String(u._id)) ? <span className="pill ok">yes</span> : "–"}</td>
              <td className="r num">{gr.get(String(u._id)) || 0}</td>
              <td><PlanSetter userId={String(u._id)} plan={u.plan} /></td>
            </tr>))}
          </tbody></table></div>
      </section>
    </>
  );
}
