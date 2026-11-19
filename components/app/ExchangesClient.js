"use client";
import { useState } from "react";

const GUIDES = {
  binance: [
    "Open Binance → Profile → API Management (for a demo account: demo.binance.com → API Management).",
    "Create API → System generated → give it a name like Copixio.",
    "Edit restrictions: tick Enable Spot & Margin Trading. Leave Enable Withdrawals OFF.",
    "IP access: choose Restrict access to trusted IPs and add our server IP (below), or leave it unrestricted.",
    "Copy the API key and the secret key (the secret is shown only once) and paste them here.",
  ],
  kucoin: [
    "Open KuCoin → Account → API Management → Create API.",
    "Type: API Trading. Set a passphrase you will remember: you need it here.",
    "Permissions: tick General and Spot Trading. Do NOT tick Withdrawal or Transfer.",
    "IP restriction: add our server IP (below), or leave it off.",
    "Copy the key, the secret and the passphrase and paste them here.",
  ],
};

const fmt = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ExchangesClient({ initial, serverIp }) {
  const [list, setList] = useState(initial);
  const [adding, setAdding] = useState(initial.length === 0);
  const [ex, setEx] = useState("binance");
  const [guide, setGuide] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [rowBusy, setRowBusy] = useState(null);
  const [rowMsg, setRowMsg] = useState({});

  async function add(e) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const f = new FormData(e.currentTarget);
    const body = { exchange: ex, label: f.get("label") || "", key: f.get("key"), secret: f.get("secret") };
    if (ex === "kucoin") body.passphrase = f.get("passphrase");
    const r = await fetch("/api/exchanges", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r || !r.ok) { setErr(j.error || "Could not reach Copixio. Try again."); return; }
    setList((l) => [...l, j.exchange]);
    setAdding(false);
    e.target.reset();
  }

  async function recheck(id) {
    setRowBusy(id);
    const r = await fetch(`/api/exchanges/${id}`, { method: "POST" }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setRowBusy(null);
    if (r && r.ok) setList((l) => l.map((x) => (x.id === id ? j.exchange : x)));
    else setRowMsg((m) => ({ ...m, [id]: j.error || "Could not check the key." }));
  }

  async function remove(id) {
    if (!window.confirm("Remove this exchange key? Groups that trade on it will be paused.")) return;
    setRowBusy(id);
    const r = await fetch(`/api/exchanges/${id}`, { method: "DELETE" }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setRowBusy(null);
    if (r && r.ok) setList((l) => l.filter((x) => x.id !== id));
    else setRowMsg((m) => ({ ...m, [id]: j.error || "Could not remove the key." }));
  }

  return (
    <>
      {list.length > 0 && (
        <section className="panel">
          <div className="panel-h"><h2>Connected</h2>{!adding && <button className="btn btn-line" type="button" onClick={() => setAdding(true)}>Add another</button>}</div>
          <ul className="rows">
            {list.map((x) => (
              <li key={x.id}>
                <div className="row-main">
                  <b>{x.exchange === "binance" ? "Binance" : "KuCoin"}{x.label ? ` · ${x.label}` : ""}</b>
                  <span className="hint">Key {x.keyTail} · checked {x.checkedAt ? new Date(x.checkedAt).toLocaleString() : "never"}</span>
                  {x.status === "error" && <span className="hint err">{x.lastError}</span>}
                  {rowMsg[x.id] && <span className="hint err" role="alert">{rowMsg[x.id]}</span>}
                </div>
                <div className="row-side">
                  <span className={`pill ${x.env === "demo" ? "info" : "ok"}`}>{x.env === "demo" ? "Demo" : "Live"}</span>
                  {x.status === "ok" ? <span className="num">{fmt(x.usdtFree)} USDT free</span> : <span className="pill bad">Not working</span>}
                  <button className="btn btn-line sm" type="button" disabled={rowBusy === x.id} onClick={() => recheck(x.id)}>{rowBusy === x.id ? "Checking…" : "Test again"}</button>
                  <button className="btn-text" type="button" disabled={rowBusy === x.id} onClick={() => remove(x.id)}>Remove</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {adding && (
        <section className="panel">
          <div className="panel-h">
            <h2>Connect an exchange</h2>
            <div className="seg" role="tablist" aria-label="Exchange">
              {["binance", "kucoin"].map((k) => (
                <button key={k} type="button" role="tab" aria-selected={ex === k} className={ex === k ? "on" : ""} onClick={() => { setEx(k); setErr(null); }}>
                  {k === "binance" ? "Binance" : "KuCoin"}
                </button>
              ))}
            </div>
          </div>
          <div className="split-form">
            <form className="form-col" onSubmit={add}>
              <div className="field"><label htmlFor="key">API key</label><input className="input mono" id="key" name="key" autoComplete="off" spellCheck="false" required /></div>
              <div className="field"><label htmlFor="secret">Secret key</label><input className="input mono" id="secret" name="secret" type="password" autoComplete="off" required /></div>
              {ex === "kucoin" && <div className="field"><label htmlFor="passphrase">Passphrase</label><input className="input" id="passphrase" name="passphrase" type="password" autoComplete="off" required /></div>}
              <div className="field"><label htmlFor="label">Name <span className="hint">(optional)</span></label><input className="input" id="label" name="label" maxLength={40} placeholder="Main account" /></div>
              {ex === "binance" && <p className="hint">Live or demo: Copixio detects it from the key.</p>}
              {err && <div className="note bad" role="alert">{err}</div>}
              <div className="actions">
                <button className="btn btn-ink" type="submit" disabled={busy}>{busy ? "Testing the key…" : "Test and connect"}</button>
                {list.length > 0 && <button className="btn-text" type="button" onClick={() => setAdding(false)}>Cancel</button>}
              </div>
            </form>
            <aside className="guide">
              <button className="guide-h" type="button" aria-expanded={guide} onClick={() => setGuide((g) => !g)}>
                How to create the key on {ex === "binance" ? "Binance" : "KuCoin"} <span aria-hidden="true">{guide ? "−" : "+"}</span>
              </button>
              {guide && (
                <ol>{GUIDES[ex].map((s) => <li key={s}>{s}</li>)}</ol>
              )}
              <div className="ipbox"><span className="hint">Our server IP</span><b className="num">{serverIp}</b></div>
              <p className="hint">Copixio refuses any key that can withdraw. Your secret is encrypted with AES-256 and never shown again.</p>
            </aside>
          </div>
        </section>
      )}
    </>
  );
}
