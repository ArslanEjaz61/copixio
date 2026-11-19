import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { Payment, PLANS, planOf } from "@/lib/models";
import { currentUser } from "@/lib/auth";
import BillingClient from "@/components/app/BillingClient";

export const metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const user = await currentUser();
  if (!user) redirect("/login"); // a stale cookie: the page renders beside the layout, so it checks too
  await db();
  const payments = await Payment.find({ userId: user._id }).sort({ createdAt: -1 }).limit(20).lean();
  const plan = planOf(user);
  return (
    <>
      <div className="ap-top">
        <div><h1>Billing</h1><p>{plan === "none" ? "No plan is active. Set everything up, then pick a plan to switch the bot on." : `${PLANS[plan].name} plan, active until ${new Date(user.planUntil).toDateString()}.`}</p></div>
        {plan !== "none" && <span className="pill ok">{PLANS[plan].name} · active</span>}
      </div>
      <BillingClient plans={PLANS} current={plan} address={process.env.USDT_TRC20_ADDRESS || ""} pending={payments.some((p) => p.status === "submitted")} />
      {payments.length > 0 && (
        <section className="panel">
          <div className="panel-h"><h2>Payments</h2></div>
          <ul className="rows">{payments.map((p) => (
            <li key={String(p._id)}>
              <div className="row-main"><b>{PLANS[p.plan].name} × {p.months} · <span className="num">{p.amountUsdt} USDT</span></b><span className="hint mono" style={{ wordBreak: "break-all" }}>{p.txid}</span>{p.note && <span className="hint">{p.note}</span>}</div>
              <span className={`pill ${p.status === "approved" ? "ok" : p.status === "rejected" ? "bad" : "wait"}`}>{p.status === "approved" ? "Confirmed" : p.status === "rejected" ? "Not confirmed" : "Waiting"}</span>
            </li>))}
          </ul>
        </section>
      )}
    </>
  );
}
