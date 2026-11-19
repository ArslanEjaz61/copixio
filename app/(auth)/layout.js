import "./auth.css";
import { Brand } from "@/components/Logo";
import { Check } from "@/components/landing/Icons";

export default function AuthLayout({ children }) {
  return (
    <div className="au">
      <aside className="au-side">
        <Brand href="/" />
        <div>
          <h2>Your signals. Your exchange. Your limits.</h2>
          <ul>
            <li><Check />Your funds stay on Binance or KuCoin. We only get permission to trade.</li>
            <li><Check />Keys with withdrawal permission are refused.</li>
            <li><Check />Every Telegram group gets its own size, stop loss and daily limit.</li>
          </ul>
        </div>
        <p className="fine">Trading crypto carries a high risk of loss. Copixio does not give financial advice.</p>
      </aside>
      <main className="au-main">
        <div className="au-card">
          <div className="au-mobile-brand"><Brand href="/" /></div>
          {children}
        </div>
      </main>
    </div>
  );
}
