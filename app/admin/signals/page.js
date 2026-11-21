import Link from "next/link";
import { Group, Signal, User } from "@/lib/models";
import { requireAdmin, when } from "@/lib/admin";

export const metadata = { title: "Signals" };
export const dynamic = "force-dynamic";

const OUT = [["all", "All"], ["traded", "Traded"], ["skipped", "Skipped"], ["error", "Errors"], ["not_a_signal", "Not a signal"]];
const PILL = { traded: ["Traded", "ok"], skipped: ["Skipped", "wait"], not_a_signal: ["Not a signal", "info"], error: ["Error", "bad"], queued: ["Queued", "info"], processing: ["Placing", "info"] };

export default async function AdminSignals({ searchParams }) {
  await requireAdmin();
  const { o = "all" } = await searchParams;
  const k = OUT.some(([v]) => v === o) ? o : "all";
  const since = new Date(Date.now() - 7 * 864e5);
  const [rows, counts] = await Promise.all([
    Signal.find({ createdAt: { $gte: since }, ...(k !== "all" ? { outcome: k } : {}) }).sort({ createdAt: -1 }).limit(300).lean(),
    Signal.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: "$outcome", n: { $sum: 1 } } }]),
  ]);
  const n = Object.fromEntries(counts.map((c) => [c._id, c.n]));
  n.all = counts.reduce((a, c) => a + c.n, 0);
  const [users, groups] = await Promise.all([
    User.find({ _id: { $in: [...new Set(rows.map((r) => String(r.userId)))] } }, { name: 1, email: 1 }).lean(),
    Group.find({ _id: { $in: [...new Set(rows.map((r) => String(r.groupId)))] } }, { title: 1 }).lean(),
  ]);
  const un = new Map(users.map((u) => [String(u._id), u])), gn = new Map(groups.map((g) => [String(g._id), g.title]));

  return (
    <>
      <div className="ap-top"><div><h1>Signals</h1><p>Every message the bot read from users&apos; groups in the last 7 days, and what it did with it.</p></div>
        <nav className="ad-seg" aria-label="Filter by result">
          {OUT.map(([v, l]) => <a key={v} href={v === "all" ? "/admin/signals" : `/admin/signals?o=${v}`} aria-current={k === v ? "page" : undefined}>{l}<small>{n[v] || 0}</small></a>)}
        </nav>
      </div>
      <section className="panel">
        {rows.length === 0 ? <div className="empty"><b>No messages here</b><span>Messages appear once a user switches a group on and it posts.</span></div> : (
          <div className="tbl"><table>
            <thead><tr><th>Time (UTC)</th><th>User</th><th>Group</th><th>Message</th><th>Read as</th><th>Result</th></tr></thead>
            <tbody>{rows.map((m) => { const [l, c] = PILL[m.outcome] || [m.outcome, "info"]; return (
              <tr key={String(m._id)}>
                <td className="hint">{when(m.createdAt)}</td>
                <td><Link href={`/admin/users/${m.userId}`}><b>{un.get(String(m.userId))?.name || "–"}</b></Link></td>
                <td>{gn.get(String(m.groupId)) || "–"}</td>
                <td><div className="ad-text">{String(m.text || "").slice(0, 200)}</div></td>
                <td className="num hint">{m.parsed?.ok ? `${m.parsed.base} ${m.parsed.side} · entry ${m.parsed.entryLow ?? "market"} · stop ${m.parsed.stop ?? "–"} · TP ${(m.parsed.targets || []).slice(0, 3).join(", ") || "–"}` : "–"}</td>
                <td><span className={`pill ${c}`}>{l}</span>{m.reason && <span className="hint">{m.reason}</span>}</td>
              </tr>); })}
            </tbody></table></div>
        )}
      </section>
    </>
  );
}
