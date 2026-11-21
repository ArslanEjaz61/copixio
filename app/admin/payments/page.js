import Link from "next/link";
import { Payment, User, PLANS } from "@/lib/models";
import { requireAdmin, usd, when } from "@/lib/admin";
import { PaymentActions } from "@/components/admin/Actions";

export const metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

export default async function AdminPayments() {
  await requireAdmin();
  const pays = await Payment.find({}).sort({ createdAt: -1 }).limit(500).lean();
  const users = new Map((await User.find({ _id: { $in: [...new Set(pays.map((p) => String(p.userId)))] } }, { name: 1, email: 1 }).lean()).map((u) => [String(u._id), u]));
  const admins = new Map((await User.find({ role: "admin" }, { name: 1, email: 1 }).lean()).map((u) => [String(u._id), u]));
  const pending = pays.filter((p) => p.status === "submitted").reverse();
  const done = pays.filter((p) => p.status !== "submitted");
  const total = done.filter((p) => p.status === "approved").reduce((a, p) => a + (p.amountUsdt || 0), 0);
  const who = (p) => users.get(String(p.userId));

  return (
    <>
      <div className="ap-top"><div><h1>Payments</h1><p>USDT (TRC20) payments users sent. Check each TXID on Tronscan before you approve it: approval starts the plan at once.</p></div></div>

      <section className="panel">
        <div className="panel-h"><h2>Waiting for approval ({pending.length})</h2><span className="hint">Oldest first</span></div>
        {pending.length === 0 ? <div className="empty"><b>Nothing waiting</b><span>New payments show up here.</span></div> : (
          <div className="tbl"><table>
            <thead><tr><th>Sent (UTC)</th><th>User</th><th>Plan</th><th className="r">Amount</th><th>Transaction</th><th></th></tr></thead>
            <tbody>{pending.map((p) => (
              <tr key={String(p._id)}>
                <td className="hint">{when(p.createdAt)}</td>
                <td><Link href={`/admin/users/${p.userId}`}><b>{who(p)?.name || "–"}</b></Link><span className="hint">{who(p)?.email || "deleted user"}</span></td>
                <td>{PLANS[p.plan]?.name} × {p.months} month{p.months > 1 ? "s" : ""}</td>
                <td className="r num"><b>{usd(p.amountUsdt)}</b> USDT</td>
                <td><a className="hint mono" style={{ wordBreak: "break-all" }} href={`https://tronscan.org/#/transaction/${encodeURIComponent(p.txid)}`} target="_blank" rel="noopener noreferrer">{p.txid}</a></td>
                <td><PaymentActions id={String(p._id)} /></td>
              </tr>))}
            </tbody></table></div>
        )}
      </section>

      <section className="panel">
        <div className="panel-h"><h2>History</h2><span className="hint">{usd(total)} USDT approved</span></div>
        {done.length === 0 ? <div className="empty"><span>No decided payments yet.</span></div> : (
          <div className="tbl"><table>
            <thead><tr><th>Decided (UTC)</th><th>User</th><th>Plan</th><th className="r">Amount</th><th>Result</th><th>By</th><th>Transaction</th></tr></thead>
            <tbody>{done.map((p) => (
              <tr key={String(p._id)}>
                <td className="hint">{when(p.decidedAt || p.createdAt)}</td>
                <td><Link href={`/admin/users/${p.userId}`}><b>{who(p)?.name || "–"}</b></Link><span className="hint">{who(p)?.email || "deleted user"}</span></td>
                <td>{PLANS[p.plan]?.name} × {p.months}</td>
                <td className="r num">{usd(p.amountUsdt)}</td>
                <td><span className={`pill ${p.status === "approved" ? "ok" : "bad"}`}>{p.status === "approved" ? "Approved" : "Rejected"}</span>{p.note && <span className="hint">{p.note}</span>}</td>
                <td className="hint">{admins.get(String(p.decidedBy))?.name || "–"}</td>
                <td><a className="hint mono" style={{ wordBreak: "break-all" }} href={`https://tronscan.org/#/transaction/${encodeURIComponent(p.txid)}`} target="_blank" rel="noopener noreferrer">{String(p.txid).slice(0, 18)}…</a></td>
              </tr>))}
            </tbody></table></div>
        )}
      </section>
    </>
  );
}
