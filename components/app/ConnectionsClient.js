"use client";
import { useState } from "react";

async function api(path, method = "GET", body) {
  const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  return { ok: !!r && r.ok, ...j, error: j.error || (!r ? "Could not reach Copixio. Try again." : undefined) };
}
const usd = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const GUIDES = {
  binance: [
    "Binance → Profile → API Management (demo account: demo.binance.com → API Management).",
    "Create API → System generated → name it Copixio.",
    "Edit restrictions: tick Enable Spot & Margin Trading. Keep Withdrawals and Transfers OFF.",
    "IP access: restrict to our server IP below, or leave unrestricted.",
    "Copy the API key and secret (the secret is shown only once).",
  ],
  kucoin: [
    "KuCoin → Account → API Management → Create API → API Trading.",
    "Set a passphrase: you will need it here.",
    "Permissions: General and Spot Trading only. No Withdrawal, no Transfer.",
    "IP restriction: our server IP below, or none.",
    "Copy the key, secret and passphrase.",
  ],
};
const EX = { binance: { name: "Binance", mark: "B", tone: "#B7862A", sub: "Spot · live or demo account" }, kucoin: { name: "KuCoin", mark: "K", tone: "#1F8F6F", sub: "Spot · live account" } };

// ---------------------------------------------------------------- an exchange tile: accounts + connect form
function ExchangeTile({ kind, accounts, onAdd, onUpdate, onRemove, serverIp }) {
  const meta = EX[kind];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [rowBusy, setRowBusy] = useState(null);
  const [rowMsg, setRowMsg] = useState({});

  async function add(e) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const f = new FormData(e.currentTarget);
    const body = { exchange: kind, label: f.get("label") || "", key: f.get("key"), secret: f.get("secret"), ...(kind === "kucoin" ? { passphrase: f.get("passphrase") } : {}) };
    const j = await api("/api/exchanges", "POST", body);
    setBusy(false);
    if (!j.ok) return setErr(j.error);
    onAdd(j.exchange); setOpen(false);
  }
  async function recheck(id) {
    setRowBusy(id);
    const j = await api(`/api/exchanges/${id}`, "POST");
    setRowBusy(null);
    if (j.ok) onUpdate(j.exchange); else setRowMsg((m) => ({ ...m, [id]: j.error }));
  }
  async function remove(id) {
    if (!window.confirm(`Remove this ${meta.name} key? Groups that trade on it are switched off.`)) return;
    setRowBusy(id);
    const j = await api(`/api/exchanges/${id}`, "DELETE");
    setRowBusy(null);
    if (j.ok) onRemove(id); else setRowMsg((m) => ({ ...m, [id]: j.error }));
  }

  return (
    <article className="tile">
      <header className="tile-h">
        <span className="tile-mark" style={{ background: meta.tone }} aria-hidden="true">{meta.mark}</span>
        <div><h3>{meta.name}</h3><p className="hint">{meta.sub}</p></div>
        {accounts.length > 0 ? <span className="pill ok">Connected</span> : <span className="pill info">Not connected</span>}
      </header>

      {accounts.length > 0 && (
        <ul className="acct">
          {accounts.map((x) => (
            <li key={x.id}>
              <div className="row-main">
                <b>{x.label || `${meta.name} account`} <span className={`pill ${x.env === "demo" ? "info" : "ok"}`}>{x.env === "demo" ? "Demo" : "Live"}</span></b>
                <span className="hint">Key {x.keyTail}{x.status === "ok" ? <> · <span className="num">{usd(x.usdtFree)} USDT</span> free</> : ""}</span>
                {x.status === "error" && <span className="hint err">{x.lastError}</span>}
                {rowMsg[x.id] && <span className="hint err" role="alert">{rowMsg[x.id]}</span>}
              </div>
              <div className="row-side">
                <button className="btn-text" type="button" disabled={rowBusy === x.id} onClick={() => recheck(x.id)}>{rowBusy === x.id ? "Checking…" : "Test"}</button>
                <button className="btn-text danger" type="button" disabled={rowBusy === x.id} onClick={() => remove(x.id)}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!open ? (
        <div className="tile-f">
          <button className={`btn ${accounts.length ? "btn-line" : "btn-ink"}`} type="button" onClick={() => { setOpen(true); setErr(null); }}>
            {accounts.length ? `Add another ${meta.name} key` : `Connect ${meta.name}`}
          </button>
        </div>
      ) : (
        <div className="tile-form">
          <form className="form-col" onSubmit={add}>
            <div className="field"><label htmlFor={`${kind}-key`}>API key</label><input className="input mono" id={`${kind}-key`} name="key" autoComplete="off" spellCheck="false" required autoFocus /></div>
            <div className="field"><label htmlFor={`${kind}-secret`}>Secret key</label><input className="input mono" id={`${kind}-secret`} name="secret" type="password" autoComplete="off" required /></div>
            {kind === "kucoin" && <div className="field"><label htmlFor="kc-pass">Passphrase</label><input className="input" id="kc-pass" name="passphrase" type="password" autoComplete="off" required /></div>}
            <div className="field"><label htmlFor={`${kind}-label`}>Name <span className="hint">(optional)</span></label><input className="input" id={`${kind}-label`} name="label" maxLength={40} placeholder={kind === "binance" ? "Main / Demo" : "Main"} /></div>
            {err && <div className="note bad" role="alert">{err}</div>}
            <div className="actions">
              <button className="btn btn-ink" type="submit" disabled={busy}>{busy ? "Testing the key…" : "Test and connect"}</button>
              <button className="btn-text" type="button" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </form>
          <aside className="guide">
            <b>Create the key on {meta.name}</b>
            <ol>{GUIDES[kind].map((s) => <li key={s}>{s}</li>)}</ol>
            <div className="ipbox"><span className="hint">Our server IP</span><b className="num">{serverIp}</b></div>
          </aside>
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------- the Telegram tile: sign-in stepper
const STEPS = [["phone", "Phone"], ["code", "Code"], ["password", "Password"]];
function TelegramTile({ tg, setTg, groupsHref, hasExchange, configured }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState("phone");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const connected = tg.status === "connected";

  async function submit(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setErr(null);
    const body = step === "phone" ? { step, phone: String(f.get("phone") || "").replace(/[\s-]/g, "") } : step === "code" ? { step, code: f.get("code") } : { step, password: f.get("password") };
    const j = await api("/api/telegram", "POST", body);
    setBusy(false);
    if (!j.ok) return setErr(j.error);
    if (j.next === "done") { setTg(j.telegram); setOpen(false); setStep("phone"); } else setStep(j.next);
  }
  async function logout() {
    if (!window.confirm("Disconnect Telegram? Your groups stop trading until you connect again.")) return;
    const j = await api("/api/telegram", "POST", { step: "logout" });
    if (j.ok) setTg({ status: "none" });
  }
  const shownSteps = step === "password" ? STEPS : STEPS.slice(0, 2);

  return (
    <article className="tile tile-wide">
      <header className="tile-h">
        <span className="tile-mark" style={{ background: "#2A7DC9" }} aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24"><path d="M3 11.5 20.5 4.5 17.5 20 11 15.5 9.5 19.5 9 14.5 17 7.5 7.5 13.5Z" fill="#fff" /></svg>
        </span>
        <div><h3>Telegram</h3><p className="hint">Reads the signal groups you choose</p></div>
        {connected ? <span className="pill ok">Connected</span> : tg.status === "logged_out" ? <span className="pill bad">Login ended</span> : <span className="pill info">Not connected</span>}
      </header>

      {connected ? (
        <>
          <ul className="acct"><li>
            <div className="row-main"><b>{tg.tgName || "Telegram account"}</b><span className="hint">{tg.phone}</span></div>
            <div className="row-side"><button className="btn-text danger" type="button" onClick={logout}>Disconnect</button></div>
          </li></ul>
          <div className="tile-f"><a className="btn btn-ink" href={groupsHref}>Choose signal groups</a></div>
        </>
      ) : !configured ? (
        <div className="tile-f"><p className="hint">Telegram sign-in is being set up on our side. It will be available shortly.</p></div>
      ) : !open ? (
        <div className="tile-f">
          <ul className="trust-list">
            <li>Only the groups you pick are read; private chats never.</li>
            <li>Copixio never sends a message from your account.</li>
            <li>End the login any time, here or in Telegram → Devices.</li>
          </ul>
          <button className="btn btn-ink" type="button" disabled={!hasExchange} onClick={() => setOpen(true)}>Connect Telegram</button>
          {!hasExchange && <span className="hint">Connect an exchange first.</span>}
        </div>
      ) : (
        <div className="tile-form">
          <form className="form-col" onSubmit={submit}>
            <ol className="stepper" aria-label="Sign-in steps">
              {shownSteps.map(([k, l], i) => {
                const idx = STEPS.findIndex((s) => s[0] === step);
                return <li key={k} className={i < idx ? "done" : i === idx ? "now" : ""}><span>{i < idx ? "✓" : i + 1}</span>{l}</li>;
              })}
            </ol>
            {step === "phone" && (<div className="field"><label htmlFor="phone">Phone number on Telegram</label>
              <input className="input" id="phone" name="phone" type="tel" inputMode="tel" placeholder="+92 300 1234567" autoComplete="tel" required autoFocus />
              <span className="hint">With country code. Telegram sends a login code to your app.</span></div>)}
            {step === "code" && (<div className="field"><label htmlFor="code">Login code</label>
              <input className="input num code-input" id="code" name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="• • • • •" required autoFocus />
              <span className="hint">Open Telegram: the code is in the chat from “Telegram”.</span></div>)}
            {step === "password" && (<div className="field"><label htmlFor="password">Two-step verification password</label>
              <input className="input" id="password" name="password" type="password" autoComplete="current-password" required autoFocus />
              <span className="hint">The password you set in Telegram → Privacy → Two-Step Verification.</span></div>)}
            {err && <div className="note bad" role="alert">{err}</div>}
            <div className="actions">
              <button className="btn btn-ink" type="submit" disabled={busy}>{busy ? "Please wait…" : step === "phone" ? "Send code" : step === "code" ? "Verify code" : "Sign in"}</button>
              <button className="btn-text" type="button" onClick={() => { setOpen(false); setStep("phone"); setErr(null); }}>Cancel</button>
            </div>
          </form>
          <aside className="guide">
            <b>Why Copixio signs in to Telegram</b>
            <p className="hint">Signal groups are private: only a member can read them. Signing in lets Copixio read new messages in the groups you choose, the same way your Telegram app does.</p>
            <p className="hint">Your login is encrypted with AES-256 and never shown to anyone.</p>
          </aside>
        </div>
      )}
    </article>
  );
}

export default function ConnectionsClient({ initialExchanges, initialTelegram, serverIp, configured }) {
  const [list, setList] = useState(initialExchanges);
  const [tg, setTg] = useState(initialTelegram);
  const add = (x) => setList((l) => [...l, x]);
  const upd = (x) => setList((l) => l.map((y) => (y.id === x.id ? x : y)));
  const rem = (id) => setList((l) => l.filter((y) => y.id !== id));
  return (
    <>
      <h2 className="sec-title">Exchanges</h2>
      <div className="tiles">
        {["binance", "kucoin"].map((k) => (
          <ExchangeTile key={k} kind={k} accounts={list.filter((x) => x.exchange === k)} onAdd={add} onUpdate={upd} onRemove={rem} serverIp={serverIp} />
        ))}
      </div>
      <h2 className="sec-title">Signals</h2>
      <TelegramTile tg={tg} setTg={setTg} groupsHref="/app/groups" hasExchange={list.some((x) => x.status === "ok")} configured={configured} />
    </>
  );
}
