"use client";
import { useState } from "react";

export default function BillingClient({ plans, current, address, pending }) {
  const [plan, setPlan] = useState(current !== "none" ? current : "pro");
  const [months, setMonths] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(pending ? { ok: true, text: "Your payment is waiting for confirmation. Your plan switches on as soon as it is confirmed (usually within a few hours)." } : null);
  const [copied, setCopied] = useState(false);
  const total = plans[plan].price * months;

  async function submit(e) {
    e.preventDefault();
    const txid = new FormData(e.currentTarget).get("txid");
    setBusy(true); setMsg(null);
    const r = await fetch("/api/billing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan, months, txid }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    setMsg(r && r.ok ? { ok: true, text: "Thanks. We are confirming the payment; your plan switches on as soon as it is confirmed." } : { ok: false, text: j.error || "Could not send. Try again." });
  }

  return (
    <>
      <section className="panel">
        <div className="panel-h"><h2>Choose a plan</h2></div>
        <div className="plans">
          {Object.entries(plans).filter(([k]) => k !== "none").map(([k, p]) => (
            <button key={k} type="button" className={`plan${plan === k ? " on" : ""}`} onClick={() => setPlan(k)} style={{ textAlign: "left", background: "var(--surface)", cursor: "pointer", color: "var(--text)", font: "inherit" }} aria-pressed={plan === k}>
              <b style={{ fontFamily: "var(--font-display)", fontSize: "1.15rem" }}>{p.name}{current === k ? " · your plan" : ""}</b>
              <div className="price">${p.price}<small> / month</small></div>
              <ul><li>{p.groups >= 1000 ? "Unlimited" : p.groups} Telegram groups</li><li>{p.exchanges} exchange account{p.exchanges > 1 ? "s" : ""}</li><li>{p.open >= 100000 ? "Unlimited" : p.open} open trades</li></ul>
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-h"><h2>Pay with USDT (TRC20)</h2></div>
        {!address ? <div className="empty"><b>Payments open soon</b><span>You can set everything up now; we will tell you when plans can be bought.</span></div> : (
          <div className="split-form">
            <form className="form-col" onSubmit={submit}>
              <div className="field"><label htmlFor="months">Months</label>
                <select className="input" id="months" value={months} onChange={(e) => setMonths(Number(e.target.value))}>{[1, 3, 6, 12].map((m) => <option key={m} value={m}>{m} month{m > 1 ? "s" : ""}</option>)}</select></div>
              <div className="note info">Send exactly <b className="num">{total} USDT</b> on the <b>TRON (TRC20)</b> network to the address on the right, then paste the transaction hash here.</div>
              <div className="field"><label htmlFor="txid">Transaction hash (TXID)</label><input className="input mono" id="txid" name="txid" required autoComplete="off" spellCheck="false" /></div>
              {msg && <div className={`note ${msg.ok ? "ok" : "bad"}`} role="status">{msg.text}</div>}
              <div className="actions"><button className="btn btn-ink" type="submit" disabled={busy}>{busy ? "Sending…" : "I have paid"}</button></div>
            </form>
            <aside className="guide">
              <b>Copixio USDT address (TRC20 only)</b>
              <div className="ipbox" style={{ flexWrap: "wrap" }}><b className="num" style={{ wordBreak: "break-all" }}>{address}</b>
                <button className="btn btn-line sm" type="button" onClick={() => { navigator.clipboard?.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy"}</button></div>
              <p className="hint">Only send USDT on the TRON network. Coins sent on another network cannot be recovered.</p>
            </aside>
          </div>
        )}
      </section>
    </>
  );
}
