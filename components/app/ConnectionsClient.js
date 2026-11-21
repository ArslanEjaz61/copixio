"use client";
import { useEffect, useState } from "react";
import { EXCHANGES, exchangeMeta } from "@/lib/exchanges/list";

// Network drops (VPN, mobile data, a proxy hiccup) are retried a few times before the user sees an error.
// Retries are marked so the server can tell "the first try already went through" from a new request.
async function api(path, method = "GET", body) {
  let r = null;
  for (let i = 0; i < 4 && !r; i++) {
    if (i) await new Promise((res) => setTimeout(res, 1200 * i));
    const send = i && body?.step ? { ...body, retry: true } : body;
    r = await fetch(path, { method, cache: "no-store", headers: send ? { "Content-Type": "application/json" } : undefined, body: send ? JSON.stringify(send) : undefined, signal: AbortSignal.timeout?.(30000) }).catch(() => null);
    if (r && r.status >= 502 && r.status <= 504) r = null; // proxy or restart window: try again
  }
  const j = r ? await r.json().catch(() => ({})) : {};
  return { ok: !!r && r.ok, ...j, error: j.error || (!r ? "Your connection to Copixio dropped. Check your internet (or VPN) and try again." : undefined) };
}
const usd = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// every exchange's name, colours, passphrase need and key guide: lib/exchanges/list.js

// ---------------------------------------------------------------- an exchange tile: accounts + connect form
function ExchangeTile({ kind, accounts, onAdd, onUpdate, onRemove, serverIp, startOpen = false, onClose }) {
  const meta = exchangeMeta(kind);
  const [open, setOpen] = useState(startOpen);
  const close = () => { setOpen(false); if (!accounts.length) onClose?.(); };
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [rowBusy, setRowBusy] = useState(null);
  const [rowMsg, setRowMsg] = useState({});

  async function add(e) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const f = new FormData(e.currentTarget);
    const body = { exchange: kind, label: f.get("label") || "", key: f.get("key"), secret: f.get("secret"), ...(meta.pass ? { passphrase: f.get("passphrase") } : {}) };
    const j = await api("/api/exchanges", "POST", body);
    setBusy(false);
    if (!j.ok) return setErr(j.error);
    onAdd(j.exchange); setOpen(false); onClose?.();
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
    <article className="tile" id={`tile-${kind}`}>
      <header className="tile-h">
        <span className="tile-mark" style={{ background: meta.color, color: meta.ink || "#fff" }} aria-hidden="true">{meta.mark}</span>
        <div><h3>{meta.name}</h3><p className="hint">{meta.demo ? "Spot · live or demo account" : "Spot · live account"}</p></div>
        {accounts.length > 0 ? <span className="pill ok">Connected</span> : <span className="pill info">Not connected</span>}
      </header>

      {accounts.length > 0 && (
        <ul className="acct">
          {accounts.map((x) => (
            <li key={x.id}>
              <div className="row-main">
                <b>{x.label || `${meta.name} account`} <span className={`pill ${x.env === "demo" ? "info" : "ok"}`}>{x.env === "demo" ? "Demo" : "Live"}</span></b>
                <span className="hint">Key {x.keyTail}{x.status === "ok" ? <> · <span className="num">{usd(x.usdtFree)} USDT</span> free</> : ""}</span>
                {x.status === "error" && <span className="hint err" role="alert">{x.lastError}</span>}
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
            <div className="field"><label htmlFor={`${kind}-key`}>{meta.keyLabel || "API key"}</label><input className="input mono" id={`${kind}-key`} name="key" autoComplete="off" spellCheck="false" required autoFocus /></div>
            <div className="field"><label htmlFor={`${kind}-secret`}>{meta.secretLabel || "Secret key"}</label>{meta.longSecret
              ? <textarea className="input mono" id={`${kind}-secret`} name="secret" rows={5} autoComplete="off" spellCheck="false" required placeholder="-----BEGIN EC PRIVATE KEY-----" />
              : <input className="input mono" id={`${kind}-secret`} name="secret" type="password" autoComplete="off" required />}</div>
            {meta.pass && <div className="field"><label htmlFor={`${kind}-pass`}>{meta.pass}</label><input className="input" id={`${kind}-pass`} name="passphrase" type="password" autoComplete="off" required /></div>}
            <div className="field"><label htmlFor={`${kind}-label`}>Name <span className="hint">(optional)</span></label><input className="input" id={`${kind}-label`} name="label" maxLength={40} placeholder={meta.demo ? "Main / Demo" : "Main"} /></div>
            {err && <div className="note bad" role="alert">{err}</div>}
            <div className="actions">
              <button className="btn btn-ink" type="submit" disabled={busy}>{busy ? "Testing the key…" : "Test and connect"}</button>
              <button className="btn-text" type="button" onClick={close}>Cancel</button>
            </div>
          </form>
          <aside className="guide">
            <b>Create the key on {meta.name}</b>
            <ol>{meta.guide.map((s) => <li key={s}>{s}</li>)}</ol>
            <div className="ipbox"><span className="hint">Our server IP</span><b className="num">{serverIp}</b></div>
          </aside>
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------- Telegram sign-in by QR code
function QrLogin({ onDone, onCancel }) {
  const [st, setSt] = useState({ status: "idle" });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true); setErr(null);
    const j = await api("/api/telegram/qr", "POST", { action: "start" });
    setBusy(false);
    if (!j.ok) { setErr(j.error); return; }
    setSt(j);
  }
  // poll while a QR or a password check is pending
  useEffect(() => {
    if (!["waiting", "starting", "checking", "password"].includes(st.status)) return undefined;
    let live = true;
    const t = setInterval(async () => {
      const j = await api("/api/telegram/qr");
      if (!live || !j.ok) return;
      if (j.status === "done") { clearInterval(t); onDone(j.telegram); return; }
      setSt((s) => (s.status === "password" && j.status === "password" && !j.error ? s : j));
    }, 2000);
    return () => { live = false; clearInterval(t); };
  }, [st.status, onDone]);

  async function sendPassword(e) {
    e.preventDefault();
    const password = new FormData(e.currentTarget).get("password");
    setBusy(true); setErr(null);
    const j = await api("/api/telegram/qr", "POST", { action: "password", password });
    setBusy(false);
    if (!j.ok) setErr(j.error); else setSt({ status: "checking" });
  }
  async function cancel() { await api("/api/telegram/qr", "POST", { action: "cancel" }); onCancel(); }

  return (
    <div className="tile-form">
      <div className="form-col">
        {st.status === "idle" && (
          <>
            <p>Sign in by scanning a QR code with the Telegram app on your phone. No phone number or code needed.</p>
            {err && <div className="note bad" role="alert">{err}</div>}
            <div className="actions">
              <button className="btn btn-ink" type="button" disabled={busy} onClick={start}>{busy ? "Preparing the code…" : "Show QR code"}</button>
              <button className="btn-text" type="button" onClick={onCancel}>Cancel</button>
            </div>
          </>
        )}
        {(st.status === "waiting" || st.status === "starting") && (
          <>
            <div className="qr-box">{st.qr ? <img src={st.qr} alt="Telegram login QR code" width="220" height="220" /> : <span className="hint">Preparing the code…</span>}</div>
            <p className="hint" role="status">Waiting for you to scan… The code refreshes by itself.</p>
            <div className="actions"><button className="btn-text" type="button" onClick={cancel}>Cancel</button></div>
          </>
        )}
        {st.status === "password" && (
          <form onSubmit={sendPassword} className="form-col" style={{ padding: 0 }}>
            <div className="field"><label htmlFor="qr-pw">Two-step verification password</label>
              <input className="input" id="qr-pw" name="password" type="password" autoComplete="current-password" required autoFocus />
              <span className="hint">Scanned. Your account also has a Telegram password{st.hint ? ` (hint: ${st.hint})` : ""}.</span></div>
            {(err || st.error) && <div className="note bad" role="alert">{err || st.error}</div>}
            <div className="actions"><button className="btn btn-ink" type="submit" disabled={busy}>{busy ? "Checking…" : "Sign in"}</button><button className="btn-text" type="button" onClick={cancel}>Cancel</button></div>
          </form>
        )}
        {st.status === "checking" && <p className="hint" role="status">Signing you in…</p>}
        {(st.status === "expired" || st.status === "error" || st.status === "none") && (
          <>
            <div className="note warn" role="alert">{st.status === "expired" || st.status === "none" ? "The QR code expired." : st.error || "Telegram did not accept the sign-in."}</div>
            <div className="actions"><button className="btn btn-ink" type="button" onClick={start}>Show a new QR code</button><button className="btn-text" type="button" onClick={onCancel}>Cancel</button></div>
          </>
        )}
      </div>
      <aside className="guide">
        <b>How to scan</b>
        <ol>
          <li>Open Telegram on your phone.</li>
          <li>Go to <b>Settings → Devices</b>.</li>
          <li>Tap <b>Link Desktop Device</b>.</li>
          <li>Point the camera at this code.</li>
        </ol>
        <p className="hint">Copixio reads only the groups you choose and never sends messages. End the login any time in Telegram → Devices.</p>
      </aside>
    </div>
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
  const [mode, setMode] = useState("qr");

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
      ) : !open ? (
        <div className="tile-f">
          <ul className="trust-list">
            <li>Only the groups you pick are read; private chats never.</li>
            <li>Copixio never sends a message from your account.</li>
            <li>End the login any time, here or in Telegram → Devices.</li>
          </ul>
          <button className="btn btn-ink" type="button" onClick={() => setOpen(true)}>Connect Telegram</button>
          {!hasExchange && <span className="hint">Connect Binance or KuCoin above first; Telegram comes next.</span>}
          {!configured && <span className="hint">Telegram sign-in opens as soon as it is switched on for Copixio.</span>}
        </div>
      ) : (
        <>
        <div className="tile-mode">
          <div className="seg" role="tablist" aria-label="How to sign in">
            <button type="button" role="tab" aria-selected={mode === "qr"} className={mode === "qr" ? "on" : ""} onClick={() => setMode("qr")}>Scan QR code</button>
            <button type="button" role="tab" aria-selected={mode === "phone"} className={mode === "phone" ? "on" : ""} onClick={() => setMode("phone")}>Phone number</button>
          </div>
        </div>
        {mode === "qr" ? <QrLogin onDone={(t) => { setTg(t); setOpen(false); }} onCancel={() => setOpen(false)} /> : (
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
        </>
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
  const [adding, setAdding] = useState(null);
  // tiles: every exchange with an account, plus the one being added
  const shown = EXCHANGES.map((x) => x.id).filter((id) => id === adding || list.some((a) => a.exchange === id));
  useEffect(() => { if (adding) document.getElementById(`tile-${adding}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [adding]);
  return (
    <>
      <h2 className="sec-title">Exchanges</h2>
      {shown.length > 0 && (
        <div className="tiles">
          {shown.map((k) => (
            <ExchangeTile key={k} kind={k} accounts={list.filter((x) => x.exchange === k)} onAdd={add} onUpdate={upd} onRemove={rem} serverIp={serverIp}
              startOpen={k === adding && !list.some((x) => x.exchange === k)} onClose={() => setAdding(null)} />
          ))}
        </div>
      )}
      <section className="ex-pick" aria-labelledby="ex-pick-h">
        <div className="ex-pick-h"><h3 id="ex-pick-h">{list.length ? "Add another exchange" : "Connect an exchange"}</h3><p className="hint">Spot trading. Your funds stay on the exchange; keys that can withdraw are not used.</p></div>
        <div className="ex-grid">
          {EXCHANGES.map((x) => {
            const has = list.some((a) => a.exchange === x.id);
            return (
              <button key={x.id} type="button" className={`ex-chip${adding === x.id ? " on" : ""}`} aria-pressed={adding === x.id} onClick={() => setAdding(x.id)}>
                <span className="tile-mark" style={{ background: x.color, color: x.ink || "#fff" }} aria-hidden="true">{x.mark}</span>
                <span><b>{x.name}</b><small>{has ? "Connected" : x.demo ? "Live or demo" : "Live"}</small></span>
              </button>
            );
          })}
        </div>
      </section>
      <h2 className="sec-title">Signals</h2>
      <TelegramTile tg={tg} setTg={setTg} groupsHref="/app/groups" hasExchange={list.some((x) => x.status === "ok")} configured={configured} />
    </>
  );
}
