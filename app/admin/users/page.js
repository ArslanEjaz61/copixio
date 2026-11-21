import Link from "next/link";
import { Exchange, Group, Telegram, Trade, User, PLANS, planOf } from "@/lib/models";
import { ago, day, requireAdmin, standing, usd } from "@/lib/admin";
import { exchangeName } from "@/lib/exchanges/list";

export const metadata = { title: "Users" };
export const dynamic = "force-dynamic";

const FILTERS = [
  ["all", "All"], ["trial", "Free trial"], ["paid", "Paying"], ["ending", "Ending in 48 h"], ["expired", "Expired"],
  ["none", "No plan"], ["exerr", "Key failing"], ["tglost", "Telegram lost"], ["paused", "Paused"], ["admin", "Admins"],
];
const HUES = ["#0E2238", "#24548F", "#0F7B4A", "#8A5A12", "#6B3FA0", "#B45309", "#2F6B6B"];
const hue = (s) => HUES[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
const initials = (u) => (u.name || u.email || "?").split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default async function AdminUsers({ searchParams }) {
  await requireAdmin();
  const { q = "", f = "all" } = await searchParams;
  const query = String(q).trim().slice(0, 100);
  const [users, exchanges, tgs, groups, trades] = await Promise.all([
    User.find(query ? { $or: [{ email: new RegExp(esc(query), "i") }, { name: new RegExp(esc(query), "i") }] } : {},
      { name: 1, email: 1, role: 1, plan: 1, planUntil: 1, trial: 1, botPaused: 1, createdAt: 1, lastLoginAt: 1 }).sort({ createdAt: -1 }).limit(1000).lean(),
    Exchange.find({}, { userId: 1, status: 1, exchange: 1, env: 1 }).lean(),
    Telegram.find({}, { userId: 1, status: 1 }).lean(),
    Group.find({ enabled: true }, { userId: 1 }).lean(),
    Trade.aggregate([{ $group: { _id: "$userId", n: { $sum: 1 }, pnl: { $sum: { $cond: [{ $eq: ["$status", "closed"] }, { $ifNull: ["$pnlUsdt", 0] }, 0] } } } }]),
  ]);
  const by = (arr) => { const m = new Map(); for (const x of arr) { const k = String(x.userId); m.set(k, [...(m.get(k) || []), x]); } return m; };
  const ex = by(exchanges), tg = new Map(tgs.map((t) => [String(t.userId), t])), gr = by(groups);
  const tr = new Map(trades.map((t) => [String(t._id), t]));
  const now = Date.now();

  const rows = users.map((u) => {
    const id = String(u._id);
    const s = standing(u);
    const exs = ex.get(id) || [];
    return { u, id, s, exs, exBad: exs.some((e) => e.status !== "ok"), tg: tg.get(id), groups: (gr.get(id) || []).length, t: tr.get(id) || { n: 0, pnl: 0 },
      ending: (s === "trial" || s === "paid") && +new Date(u.planUntil) - now < 2 * 864e5 };
  });
  const keep = {
    all: () => true, trial: (r) => r.s === "trial", paid: (r) => r.s === "paid", expired: (r) => r.s === "expired", none: (r) => r.s === "none",
    ending: (r) => r.ending, exerr: (r) => r.exBad, tglost: (r) => r.tg && r.tg.status !== "connected" && r.tg.status !== "pending",
    paused: (r) => r.u.botPaused, admin: (r) => r.u.role === "admin",
  };
  const fk = keep[f] ? f : "all";
  const shown = rows.filter(keep[fk]);
  const link = (k) => `/admin/users?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(k !== "all" ? { f: k } : {}) })}`;

  return (
    <>
      <div className="ap-top"><div><h1>Users</h1><p>{users.length} account{users.length === 1 ? "" : "s"}{query ? ` matching “${query}”` : ""}. Open one to change its plan or pause its bot.</p></div></div>
      <section className="panel">
        <div className="ad-tools">
          <form action="/admin/users" role="search" style={{ display: "flex", gap: 8 }}>
            {fk !== "all" && <input type="hidden" name="f" value={fk} />}
            <input className="input" type="search" name="q" defaultValue={query} placeholder="Search name or email" aria-label="Search users" />
            <button className="btn btn-line sm" type="submit">Search</button>
          </form>
          <nav className="ad-seg" aria-label="Filter users">
            {FILTERS.map(([k, l]) => <a key={k} href={link(k)} aria-current={fk === k ? "page" : undefined}>{l}<small>{rows.filter(keep[k]).length}</small></a>)}
          </nav>
        </div>
        {shown.length === 0 ? <div className="empty"><b>No users here</b><span>Try another filter or search.</span></div> : (
          <div className="tbl"><table>
            <thead><tr><th>User</th><th>Joined</th><th>Status</th><th>Exchange</th><th>Telegram</th><th className="r">Groups on</th><th className="r">Trades</th><th className="r">P&amp;L</th><th>Last seen</th></tr></thead>
            <tbody>{shown.map(({ u, id, s, exs, exBad, tg: t, groups: g, t: k }) => (
              <tr key={id}>
                <td><div className="ad-user"><span className="av" style={{ background: hue(id) }} aria-hidden="true">{initials(u)}</span>
                  <Link href={`/admin/users/${id}`}><b>{u.name || "–"}</b><span className="hint">{u.email}</span></Link></div></td>
                <td className="hint">{day(u.createdAt)}</td>
                <td>
                  <span className={`pill ${s === "paid" ? "ok" : s === "trial" ? "info" : s === "expired" ? "wait" : "bad"}`}>{{ trial: "Free trial", paid: PLANS[planOf(u)]?.name, expired: "Expired", none: "No plan" }[s]}</span>
                  {(s === "trial" || s === "paid") && <span className="hint">until {day(u.planUntil)}</span>}
                  {u.role === "admin" && <span className="hint">admin</span>}
                  {u.botPaused && <span className="hint">bot paused</span>}
                </td>
                <td>{exs.length === 0 ? <span className="hint">–</span> : <span className={`pill ${exBad ? "bad" : "ok"}`}>{exs.map((e) => exchangeName(e.exchange, e.env)).join(", ")}</span>}</td>
                <td>{!t ? <span className="hint">–</span> : t.status === "connected" ? <span className="pill ok">Connected</span> : <span className="pill wait">{t.status}</span>}</td>
                <td className="r num">{g}</td>
                <td className="r num">{k.n}</td>
                <td className={`r num ${k.pnl > 0 ? "pos" : k.pnl < 0 ? "neg" : ""}`}>{k.n ? usd(k.pnl, true) : "–"}</td>
                <td className="hint">{ago(u.lastLoginAt || u.createdAt)}</td>
              </tr>))}
            </tbody></table></div>
        )}
      </section>
    </>
  );
}
