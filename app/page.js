import "./landing.css";
import { Brand } from "@/components/Logo";
import LandingHeader from "@/components/landing/LandingHeader";
import { Guilloche, TicketDemo } from "@/components/landing/HeroArt";
import { Check, Eye, Lock, NoWithdraw, Pause, Server, Sliders } from "@/components/landing/Icons";

const STEPS = [
  ["Connect your exchange", "Paste a Binance or KuCoin API key with trading on and withdrawals off. We test it before saving and show your free balance."],
  ["Connect Telegram", "Sign in with your phone number and the code Telegram sends you. Then tick the groups and channels whose signals you want traded."],
  ["Set rules per group", "Each group gets its own size, stop loss, take profit, maximum open trades and daily loss limit. Pause any group with one switch."],
  ["The bot trades", "A new signal is read, checked against your rules and placed as an order. You get a Telegram message with the fill, and later the result."],
];

const SECURITY = [
  [NoWithdraw, "No withdrawals, ever", "We check every key when you add it. A key that can withdraw funds is refused and not saved."],
  [Lock, "Keys and sessions sealed", "API secrets and your Telegram session are encrypted with AES-256 before they are stored, and are never shown again, not even to you."],
  [Server, "Locked to our server", "Restrict your key to our server's IP address. Even a copied key is useless anywhere else."],
  [Eye, "Only the groups you pick", "We read new messages in the groups you ticked, nothing else. We never send messages from your account."],
  [Pause, "Stop everything in one click", "Pause one group or the whole bot at any time. Open trades keep their stop loss on the exchange."],
  [Sliders, "Limits you control", "Daily loss limits and maximum open trades are enforced before any order is sent."],
];

const PLANS = [
  { id: "starter", name: "Starter", who: "For trying one or two channels you trust.", price: 29, items: ["2 Telegram groups", "1 exchange account", "5 open trades at a time"] },
  { id: "pro", name: "Pro", who: "For traders following several groups every day.", price: 59, items: ["10 Telegram groups", "Binance and KuCoin together", "25 open trades at a time", "Results report per group"], best: true },
  { id: "desk", name: "Desk", who: "For heavy users and small trading teams.", price: 119, items: ["Unlimited Telegram groups", "3 exchange accounts", "Unlimited open trades", "Priority support"] },
];

const FAQ = [
  ["Does Copixio ever hold my money?", "No. Your funds stay on Binance or KuCoin. We use an API key that can only place and cancel orders. Keys that allow withdrawals are refused when you add them."],
  ["Why do I log in with my Telegram account?", "Signal groups are usually private, and only a member can read them. Logging in lets Copixio read new messages in the groups you tick, the same way your Telegram app does. We never send messages or read any other chat."],
  ["What if a signal is written in an unusual way?", "Copixio reads the common formats: pair, long or short, entry, targets and stop loss in any order. If a message cannot be read with confidence, no trade is placed and you get a note showing the message."],
  ["Can I start without real money?", "Yes. Add a Binance Demo Trading key and everything works the same with test funds. Switch to a live key whenever you want."],
  ["What happens if the exchange is down?", "The bot keeps trying for a short window and never places the same order twice. If the window passes, the trade is skipped and you are told why."],
  ["Can I close a trade myself?", "Yes, from the dashboard with one click, or directly on your exchange. Copixio notices and stops managing that trade."],
];

const Ticks = ({ items }) => (
  <ul className="lp-ticks">{items.map((t) => <li key={t}><Check />{t}</li>)}</ul>
);

export default function Landing() {
  return (
    <div className="lp">
      <LandingHeader />
      <main id="top">
        <div className="lp-hero" id="hero">
          <Guilloche />
          <div className="lp-hero-body">
            <div className="in">
              <div className="lp-hero-grid">
                <div>
                  <h1>Your Telegram signals, traded on <em>your own</em> Binance and KuCoin account.</h1>
                  <p className="lp-lede">Pick the signal groups you trust and set the dollar size, stop loss and daily limit for each one. When a new signal is posted, Copixio reads it and places the order through your API key within seconds.</p>
                  <div className="lp-ctas">
                    <a className="btn btn-cta" href="/signup">Create your account</a>
                    <a className="btn btn-ghost" href="#how">See how a signal becomes a trade</a>
                  </div>
                  <p className="lp-fine">Start on a Binance demo account. Your funds never leave your exchange.</p>
                </div>
                <div className="lp-mech" aria-label="A Telegram signal turning into an order">
                  <div className="lp-tg">
                    <div className="from"><span>Alpha Calls VIP</span><span className="num">12:41</span></div>
                    <div className="msg"><mark>#ARIA/USDT</mark> <mark>LONG</mark>{"\n"}Entry <mark>0.2495</mark>{"\n"}TP1 0.2580 · TP2 <mark>0.2620</mark>{"\n"}SL <mark>0.2410</mark></div>
                  </div>
                  <TicketDemo />
                </div>
              </div>
            </div>
          </div>
          <div className="lp-trust"><div className="in">
            <div><Lock />API keys sealed with AES-256, never shown again</div>
            <div><NoWithdraw />Keys with withdrawal permission are refused</div>
            <div><Sliders />You set every limit, group by group</div>
          </div></div>
        </div>

        <section className="lp-sec" id="how">
          <div className="in">
            <div className="lp-sec-h">
              <h2>From a message in a group to an order on your exchange.</h2>
              <p>Setup takes about ten minutes. After that the bot works on its own and tells you on Telegram what it did.</p>
            </div>
            <ol className="lp-flow">
              {STEPS.map(([t, d], i) => (
                <li key={t}><span className="n">0{i + 1}</span><h3>{t}</h3><p>{d}</p></li>
              ))}
            </ol>
          </div>
        </section>

        <section className="lp-sec" id="rules">
          <div className="in lp-split">
            <div className="lp-copy">
              <h2>Different groups deserve different money.</h2>
              <p>Trust one channel with 50 dollars a trade and a new one with 10. Let one trade on Binance and another on KuCoin. Every group keeps its own rules, and a signal is only placed if it fits them.</p>
              <Ticks items={["Fixed dollar size, or a share of your free balance", "Stop loss and targets from the signal, or your own", "A daily loss limit that stops the group for the day", "Maximum open trades, so one busy channel cannot take over"]} />
            </div>
            <div className="lp-ui lp-rules" aria-label="Rules for a Telegram group">
              <div className="lp-groups">
                <div className="lp-grp on"><span className="lp-av" style={{ background: "#24548F" }}>AC</span><div><b>Alpha Calls VIP</b><small>50 USDT · Binance</small></div></div>
                <div className="lp-grp"><span className="lp-av" style={{ background: "#0F7B4A" }}>KS</span><div><b>KuCoin Scalps</b><small>25 USDT · KuCoin</small></div></div>
                <div className="lp-grp"><span className="lp-av" style={{ background: "#8C6115" }}>SW</span><div><b>Swing Desk</b><small>Paused</small></div></div>
              </div>
              <div className="lp-form">
                <div className="top"><h4>Alpha Calls VIP</h4><span className="lp-tog"><span className="lp-switch" role="img" aria-label="On" />Trading on</span></div>
                <div className="lp-fgrid">
                  <div className="lp-fld"><label>Exchange</label><div className="lp-seg"><span className="on">Binance</span><span>KuCoin</span></div></div>
                  <div className="lp-fld"><label>Size per trade</label><div className="lp-inp">50 USDT</div></div>
                  <div className="lp-fld"><label>Max open trades</label><div className="lp-inp">4</div></div>
                  <div className="lp-fld"><label>Stop loss</label><div className="lp-inp">From the signal</div></div>
                  <div className="lp-fld"><label>Take profit</label><div className="lp-inp">50% TP1, rest TP2</div></div>
                  <div className="lp-fld"><label>Daily loss limit</label><div className="lp-inp">60 USDT</div></div>
                </div>
                <div className="note info">If a signal has no stop loss, Copixio places one 3% below entry. You can change that.</div>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-sec">
          <div className="in lp-split rev">
            <div className="lp-copy">
              <h2>See every trade, and why it was taken.</h2>
              <p>The dashboard opens on today&apos;s result, then what is open right now. Each trade links back to the exact signal message it came from, so you always know which group earned or lost.</p>
              <Ticks items={["Profit and loss per group, per day and per month", "Close any trade yourself with one click", "A Telegram message for every entry and exit"]} />
            </div>
            <div className="lp-ui lp-dash" aria-label="Dashboard">
              <div className="top"><h4>Today</h4><span className="pill info">Binance · KuCoin connected</span></div>
              <div className="lp-kpis">
                <div><span className="lab">Net P&amp;L today</span><b className="pos">+128.40 USDT</b></div>
                <div><span className="lab">Trades</span><b>11</b></div>
                <div><span className="lab">Won</span><b>7</b></div>
                <div><span className="lab">Limit used</span><b>22%</b></div>
              </div>
              <div className="lp-tw"><table>
                <thead><tr><th>Pair</th><th>Group</th><th className="r">Size</th><th className="r">P&amp;L</th><th>Status</th></tr></thead>
                <tbody>
                  <tr><td><b>ARIAUSDT</b></td><td>Alpha Calls VIP</td><td className="r num">50.00</td><td className="r num pos">+1.74</td><td><span className="pill ok">TP1 hit</span></td></tr>
                  <tr><td><b>ZKPUSDT</b></td><td>Alpha Calls VIP</td><td className="r num">50.00</td><td className="r num neg">−0.50</td><td><span className="pill wait">Open</span></td></tr>
                  <tr><td><b>ICNTUSDT</b></td><td>KuCoin Scalps</td><td className="r num">25.00</td><td className="r num pos">+1.00</td><td><span className="pill wait">Open</span></td></tr>
                  <tr><td><b>UMXMUSDT</b></td><td>KuCoin Scalps</td><td className="r num">25.00</td><td className="r num neg">−0.87</td><td><span className="pill bad">Stopped out</span></td></tr>
                </tbody>
              </table></div>
            </div>
          </div>
        </section>

        <section className="lp-sec lp-band" id="security">
          <div className="in">
            <div className="lp-sec-h">
              <h2>Your money stays on your exchange. We only get permission to trade.</h2>
              <p>Copixio never holds funds. Here is exactly what we can and cannot do with your accounts.</p>
            </div>
            <div className="lp-seclist">
              {SECURITY.map(([Icon, t, d]) => (
                <div key={t}><Icon /><div><h3>{t}</h3><p>{d}</p></div></div>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-sec">
          <div className="in">
            <div className="lp-sec-h">
              <h2>Works with the exchanges you already use.</h2>
              <p>Live or demo, it is the key you give us that decides. Start on a demo account and switch when you are ready.</p>
            </div>
            <div className="lp-ex">
              <div><h3>Binance</h3><p>Spot trading on your live account, or on Binance Demo Trading with a demo key.</p><span className="pill ok">Live and demo</span></div>
              <div><h3>KuCoin</h3><p>Spot trading on your KuCoin account, including coins that Binance does not list.</p><span className="pill ok">Live</span></div>
              <div><h3>Telegram</h3><p>Public channels and private groups you are a member of, in any common signal format.</p><span className="pill info">Groups and channels</span></div>
            </div>
          </div>
        </section>

        <section className="lp-sec" id="pricing">
          <div className="in">
            <div className="lp-sec-h">
              <h2>One price a month. No share of your profits.</h2>
              <p>Every plan includes Binance and KuCoin, Telegram notifications and all rule types. Plans differ in how many groups and trades you run.</p>
            </div>
            <div className="lp-plans">
              {PLANS.map((p) => (
                <div key={p.id} className={`lp-plan${p.best ? " best" : ""}`}>
                  <h3>{p.name}</h3>
                  <p className="who">{p.who}</p>
                  <div className="price">${p.price}<small> / month</small></div>
                  <ul>{p.items.map((t) => <li key={t}><Check s={18} />{t}</li>)}</ul>
                  <a className={`btn ${p.best ? "btn-ink" : "btn-line"}`} href={`/signup?plan=${p.id}`}>Start with {p.name}</a>
                </div>
              ))}
            </div>
            <p className="lp-plans-note">Pay monthly in USDT. Cancel any time; the bot stops at the end of the paid month and your open trades keep their stop loss.</p>
          </div>
        </section>

        <section className="lp-sec" id="faq">
          <div className="in">
            <div className="lp-sec-h"><h2>Questions traders ask first.</h2></div>
            <div className="lp-faq">
              {FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
            </div>
          </div>
        </section>

        <section className="lp-sec lp-band lp-final">
          <div className="in row">
            <div>
              <h2>Connect a demo account and watch your first signal become a trade.</h2>
              <p>No card needed to set up. Pick a plan when you switch the bot on.</p>
            </div>
            <a className="btn btn-cta" href="/signup">Create your account</a>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="in">
          <div className="row">
            <Brand href="#top" size={28} />
            <nav aria-label="Footer">
              <a href="#how">How it works</a><a href="#security">Security</a><a href="#pricing">Pricing</a>
              <a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="mailto:support@copixio.com">Support</a>
            </nav>
          </div>
          <p className="lp-risk">Trading crypto carries a high risk of loss. Copixio executes the signals and rules you choose; it does not give financial advice and does not guarantee any result. Signals come from third-party groups that Copixio does not control. Only trade money you can afford to lose.</p>
          <p className="lp-risk" style={{ marginTop: 12 }}>© 2026 Copixio</p>
        </div>
      </footer>
    </div>
  );
}
