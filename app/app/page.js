import { db } from "@/lib/db";
import { Exchange, Group, Telegram, Trade, planOf } from "@/lib/models";
import { currentUser } from "@/lib/auth";
import ResendVerify from "@/components/app/ResendVerify";

export const dynamic = "force-dynamic";

const usd = (n) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)} USDT`;

// One clear next step while setting up; once the bot runs, today's money and the open trades.
export default async function Dashboard({ searchParams }) {
  const user = await currentUser();
  const { welcome } = await searchParams;
  await db();
  const [exCount, tg, groupsOn] = await Promise.all([
    Exchange.countDocuments({ userId: user._id, status: "ok" }),
    Telegram.findOne({ userId: user._id, status: "connected" }, { _id: 1 }).lean(),
    Group.countDocuments({ userId: user._id, enabled: true, exchangeId: { $ne: null } }),
  ]);
  const plan = planOf(user);
  const steps = [
    { key: "ex", title: "Connect your exchange", done: exCount > 0, href: "/app/connections", text: "Add a Binance or KuCoin API key that can trade but not withdraw. A Binance demo key works too." },
    { key: "tg", title: "Connect Telegram", done: !!tg, href: "/app/connections", text: "Sign in with your phone number so Copixio can read the signal groups you pick." },
    { key: "gr", title: "Pick groups and set rules", done: groupsOn > 0, href: "/app/groups", text: "Choose the groups to trade and set the size, stop loss and limits for each one." },
  ];
  const next = steps.find((s) => !s.done);
  const ready = !next;

  const dayStart = new Date(new Date().setUTCHours(0, 0, 0, 0));
  const [open, closedToday] = ready
    ? await Promise.all([
        Trade.find({ userId: user._id, status: { $in: ["opening", "open", "closing"] } }).sort({ createdAt: -1 }).limit(20).lean(),
        Trade.find({ userId: user._id, status: "closed", closedAt: { $gte: dayStart } }, { pnlUsdt: 1 }).lean(),
      ])
    : [[], []];
  const pnl = closedToday.reduce((a, t) => a + (t.pnlUsdt || 0), 0);
  const first = (user.name || "").split(" ")[0];
  const mailOn = !!process.env.SMTP_HOST;

  return (
    <>
      <div className="ap-top">
        <div>
          <h1>{welcome ? `Welcome${first ? `, ${first}` : ""}` : "Dashboard"}</h1>
          <p>{ready ? (user.botPaused ? "The bot is paused. No new trades are placed." : plan === "none" ? "Setup is done. Choose a plan to switch the bot on." : "The bot is reading your groups.") : `Step ${steps.indexOf(next) + 1} of 3 to get the bot trading.`}</p>
        </div>
      </div>

      {mailOn && !user.emailVerifiedAt && (
        <div className="note info" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span>Confirm your email: we sent a link to {user.email}.</span><ResendVerify />
        </div>
      )}

      {!ready && (
        <section className="panel">
          <div className="next-card">
            <div><h2>{next.title}</h2><p>{next.text}</p></div>
            <a className="btn btn-cta" href={next.href}>{next.key === "ex" ? "Connect exchange" : next.key === "tg" ? "Connect Telegram" : "Choose groups"}</a>
          </div>
          <nav className="progress" aria-label="Setup steps">
            {steps.map((s, i) => (
              <a key={s.key} href={s.href}>
                <span className={`st${s.done ? " done" : s === next ? " now" : ""}`}>{s.done ? "✓ DONE" : s === next ? `STEP ${i + 1} · NOW` : `STEP ${i + 1}`}</span>
                <b>{s.title}</b>
              </a>
            ))}
          </nav>
        </section>
      )}

      {ready && plan === "none" && (
        <section className="panel"><div className="next-card">
          <div><h2>Choose a plan to switch the bot on</h2><p>Your exchange, Telegram and groups are ready. The bot starts placing trades as soon as a plan is active.</p></div>
          <a className="btn btn-cta" href="/app/billing">Choose a plan</a>
        </div></section>
      )}

      {ready && (
        <>
          <section className="panel">
            <div className="kpis">
              <div><span className="lab">Today</span><b className={`num ${pnl >= 0 ? "pos" : "neg"}`}>{usd(pnl)}</b></div>
              <div><span className="lab">Closed today</span><b className="num">{closedToday.length}</b></div>
              <div><span className="lab">Open now</span><b className="num">{open.length}</b></div>
              <div><span className="lab">Groups trading</span><b className="num">{groupsOn}</b></div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-h"><h2>Open trades</h2><a className="btn-text" href="/app/trades">All trades</a></div>
            {open.length === 0 ? (
              <div className="empty"><b>No open trades</b><span>A trade appears here seconds after one of your groups posts a signal that fits its rules.</span></div>
            ) : (
              <ul className="rows">
                {open.map((t) => (
                  <li key={String(t._id)}>
                    <div className="row-main"><b>{t.base || t.symbol}</b><span className="hint">{t.exchange === "binance" ? "Binance" : "KuCoin"} · entry <span className="num">{t.entryPrice ?? "…"}</span> · stop <span className="num">{t.stopPrice ?? "…"}</span></span></div>
                    <div className="row-side"><span className="num">{(t.costUsdt || 0).toFixed(2)} USDT</span><span className={`pill ${t.status === "open" ? "wait" : "info"}`}>{t.status === "open" ? "Open" : t.status === "opening" ? "Opening" : "Closing"}</span></div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
