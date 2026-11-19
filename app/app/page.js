import { currentUser } from "@/lib/auth";
import ResendVerify from "@/components/app/ResendVerify";

export const dynamic = "force-dynamic";

// The setup checklist leads until the bot can trade; the money panels sit below it with honest empty states.
export default async function Dashboard({ searchParams }) {
  const user = await currentUser();
  const { welcome } = await searchParams;
  const steps = [
    { key: "email", title: "Confirm your email", text: `We sent a link to ${user.email}.`, done: !!user.emailVerifiedAt },
    { key: "exchange", title: "Connect Binance or KuCoin", text: "Add an API key with trading on and withdrawals off. A demo key works too.", done: false, href: "/app/exchanges" },
    { key: "telegram", title: "Connect Telegram and pick groups", text: "Sign in with your phone number, then tick the groups whose signals you want traded.", done: false, href: "/app/telegram" },
    { key: "rules", title: "Set rules for each group", text: "Size per trade, stop loss, take profit, max open trades and a daily loss limit.", done: false, href: "/app/telegram" },
  ];
  const next = steps.find((s) => !s.done);
  const doneCount = steps.filter((s) => s.done).length;
  const first = (user.name || "").split(" ")[0];

  return (
    <>
      <div className="ap-top">
        <div>
          <h1>{welcome ? `Welcome to Copixio${first ? `, ${first}` : ""}` : `Dashboard`}</h1>
          <p>{next ? "Finish setup and the bot starts trading your signals." : "Your bot is set up."}</p>
        </div>
        <span className="pill info">{doneCount} of {steps.length} setup steps done</span>
      </div>

      <section className="panel" aria-labelledby="setup-h">
        <div className="panel-h"><h2 id="setup-h">Set up your bot</h2></div>
        <ol className="steps-list">
          {steps.map((s, i) => {
            const now = next && next.key === s.key;
            return (
              <li key={s.key}>
                <span className={`step-n${s.done ? " done" : now ? " now" : ""}`} aria-hidden="true">{s.done ? "✓" : i + 1}</span>
                <div><b>{s.title}</b><p>{s.text}</p></div>
                <div>
                  {s.done ? <span className="pill ok">Done</span>
                    : s.key === "email" ? <ResendVerify />
                    : <a className={`btn ${now ? "btn-ink" : "btn-line"}`} href={s.href}>{now ? "Start" : "Open"}</a>}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="panel" aria-labelledby="today-h">
        <div className="panel-h"><h2 id="today-h">Today</h2></div>
        <div className="kpis">
          <div><span className="lab">Net P&amp;L today</span><b className="num">0.00 USDT</b></div>
          <div><span className="lab">Trades</span><b className="num">0</b></div>
          <div><span className="lab">Open now</span><b className="num">0</b></div>
          <div><span className="lab">Loss limit used</span><b className="num">0%</b></div>
        </div>
      </section>

      <section className="panel" aria-labelledby="open-h">
        <div className="panel-h"><h2 id="open-h">Open trades</h2></div>
        <div className="empty">
          <b>No trades yet</b>
          <span>Trades appear here as soon as a signal from one of your groups is placed.</span>
        </div>
      </section>
    </>
  );
}
