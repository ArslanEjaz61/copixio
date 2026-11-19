"use client";
import { useState } from "react";

async function api(path, method = "GET", body) {
  const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  return { ok: !!r && r.ok, ...j, error: j.error || (!r ? "Could not reach Copixio. Try again." : undefined) };
}

// ---- 1. connect Telegram (phone -> code -> password)
function Connect({ onDone }) {
  const [step, setStep] = useState("phone");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  async function submit(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setErr(null);
    const body = step === "phone" ? { step, phone: String(f.get("phone") || "").replace(/[\s-]/g, "") } : step === "code" ? { step, code: f.get("code") } : { step, password: f.get("password") };
    const j = await api("/api/telegram", "POST", body);
    setBusy(false);
    if (!j.ok) return setErr(j.error);
    if (j.next === "done") onDone(j.telegram); else setStep(j.next);
  }
  return (
    <section className="panel">
      <div className="panel-h"><h2>Connect Telegram</h2><span className="hint">Step {step === "phone" ? 1 : step === "code" ? 2 : 3} of {step === "password" ? 3 : 2}</span></div>
      <div className="split-form">
        <form className="form-col" onSubmit={submit}>
          {step === "phone" && (
            <div className="field"><label htmlFor="phone">Your Telegram phone number</label>
              <input className="input" id="phone" name="phone" type="tel" inputMode="tel" placeholder="+923001234567" autoComplete="tel" required />
              <span className="hint">With the country code. Telegram will send a login code to your Telegram app.</span></div>
          )}
          {step === "code" && (
            <div className="field"><label htmlFor="code">Login code</label>
              <input className="input num" id="code" name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="12345" required autoFocus />
              <span className="hint">Open Telegram: the code arrives in the chat from “Telegram”.</span></div>
          )}
          {step === "password" && (
            <div className="field"><label htmlFor="password">Telegram password</label>
              <input className="input" id="password" name="password" type="password" autoComplete="current-password" required autoFocus />
              <span className="hint">Your account has two-step verification. Enter the password you set in Telegram.</span></div>
          )}
          {err && <div className="note bad" role="alert">{err}</div>}
          <div className="actions">
            <button className="btn btn-ink" type="submit" disabled={busy}>{busy ? "Please wait…" : step === "phone" ? "Send me the code" : "Sign in"}</button>
            {step !== "phone" && <button className="btn-text" type="button" onClick={() => { setStep("phone"); setErr(null); }}>Use another number</button>}
          </div>
        </form>
        <aside className="guide">
          <b>What Copixio can do with this login</b>
          <ol>
            <li>Read new messages only in the groups you choose on the next screen.</li>
            <li>Nothing else: we never send messages, never read your private chats.</li>
            <li>The login is encrypted with AES-256. End it any time here or in Telegram → Settings → Devices.</li>
          </ol>
        </aside>
      </div>
    </section>
  );
}

// ---- 2. rules form for one group
const DEFAULTS = { sizeMode: "fixed", sizeUsdt: 20, sizePercent: 5, maxOpen: 3, slMode: "signal", slPercent: 3, tpMode: "signal", tpPercent: 4, tpSplit: "even", moveSlToEntry: true, dailyLossUsdt: 0, maxEntryGapPct: 2 };

function Rules({ group, exchanges, onSaved, onRemoved }) {
  const [g, setG] = useState({ ...DEFAULTS, ...group, exchangeId: group.exchangeId || exchanges[0]?.id || "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k) => (e) => setG((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  async function save(enabled) {
    setBusy(true); setMsg(null);
    const body = { ...g, enabled };
    delete body.id; delete body.chatId; delete body.title; delete body.kind;
    const j = await api(`/api/groups/${group.id}`, "PUT", body);
    setBusy(false);
    if (!j.ok) return setMsg({ bad: true, text: j.error });
    setG((x) => ({ ...x, ...j.group }));
    onSaved(j.group);
    setMsg({ bad: false, text: j.group.enabled ? "Saved. This group is trading." : "Saved. This group is off." });
  }
  async function remove() {
    if (!window.confirm(`Stop following “${group.title}”?`)) return;
    const j = await api(`/api/groups/${group.id}`, "DELETE");
    if (j.ok) onRemoved(group.id); else setMsg({ bad: true, text: j.error });
  }
  return (
    <div className="form-col">
      <div className="actions" style={{ justifyContent: "space-between" }}>
        <h3 style={{ fontSize: "1.2rem" }}>{group.title}</h3>
        <span className={`pill ${g.enabled ? "ok" : "wait"}`}>{g.enabled ? "Trading on" : "Off"}</span>
      </div>
      <div className="form-grid">
        <div className="field"><label>Exchange</label>
          <select className="input" value={g.exchangeId} onChange={set("exchangeId")}>
            {exchanges.length === 0 && <option value="">Connect an exchange first</option>}
            {exchanges.map((x) => <option key={x.id} value={x.id}>{x.exchange === "binance" ? "Binance" : "KuCoin"} {x.env === "demo" ? "(demo)" : ""} {x.label}</option>)}
          </select></div>
        <div className="field"><label>Size per trade</label>
          <div className="actions" style={{ flexWrap: "nowrap" }}>
            <select className="input" style={{ maxWidth: 130 }} value={g.sizeMode} onChange={set("sizeMode")}><option value="fixed">USDT</option><option value="percent">% of free</option></select>
            {g.sizeMode === "fixed" ? <input className="input num" type="number" min="1" step="1" value={g.sizeUsdt} onChange={set("sizeUsdt")} /> : <input className="input num" type="number" min="0.1" step="0.1" value={g.sizePercent} onChange={set("sizePercent")} />}
          </div></div>
        <div className="field"><label>Max open trades</label><input className="input num" type="number" min="1" max="100" value={g.maxOpen} onChange={set("maxOpen")} /></div>
        <div className="field"><label>Stop loss</label>
          <select className="input" value={g.slMode} onChange={set("slMode")}><option value="signal">From the signal</option><option value="percent">My own %</option></select></div>
        <div className="field"><label>{g.slMode === "signal" ? "If the signal has no stop: % below entry" : "Stop: % below entry"}</label><input className="input num" type="number" min="0.1" step="0.1" value={g.slPercent} onChange={set("slPercent")} /></div>
        <div className="field"><label>Daily loss limit (USDT, 0 = none)</label><input className="input num" type="number" min="0" step="1" value={g.dailyLossUsdt} onChange={set("dailyLossUsdt")} /></div>
        <div className="field"><label>Take profit</label>
          <select className="input" value={g.tpMode} onChange={set("tpMode")}><option value="signal">Targets from the signal</option><option value="percent">My own %</option></select></div>
        {g.tpMode === "percent"
          ? <div className="field"><label>Take profit: % above entry</label><input className="input num" type="number" min="0.1" step="0.1" value={g.tpPercent} onChange={set("tpPercent")} /></div>
          : <div className="field"><label>Sell over the targets</label>
              <select className="input" value={g.tpSplit} onChange={set("tpSplit")}><option value="even">Evenly over all targets</option><option value="half">Half at TP1, rest at the last</option><option value="first">Everything at TP1</option></select></div>}
        <div className="field"><label>Skip if price ran above entry by (%)</label><input className="input num" type="number" min="0" step="0.1" value={g.maxEntryGapPct} onChange={set("maxEntryGapPct")} /></div>
      </div>
      <label className="check"><input type="checkbox" checked={!!g.moveSlToEntry} onChange={set("moveSlToEntry")} />After the first target, move the stop to the entry price</label>
      <p className="hint">Copixio trades spot, so only long (buy) signals are traded. Short signals are skipped and shown in the log.</p>
      {msg && <div className={`note ${msg.bad ? "bad" : "ok"}`} role="status">{msg.text}</div>}
      <div className="actions">
        <button className="btn btn-ink" type="button" disabled={busy} onClick={() => save(true)}>{busy ? "Saving…" : g.enabled ? "Save" : "Save and switch on"}</button>
        {g.enabled && <button className="btn btn-line" type="button" disabled={busy} onClick={() => save(false)}>Switch off</button>}
        <button className="btn-text danger" type="button" onClick={remove}>Stop following</button>
      </div>
    </div>
  );
}

// ---- 3. the page: connected account, chosen groups with rules, picker for more
export default function TelegramClientUI({ initialTelegram, initialGroups, exchanges, configured }) {
  const [tg, setTg] = useState(initialTelegram);
  const [groups, setGroups] = useState(initialGroups);
  const [sel, setSel] = useState(initialGroups[0]?.id || null);
  const [chats, setChats] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState("");

  if (!configured) return <div className="note warn">Telegram login is being set up on our side. Please check back shortly.</div>;
  if (tg.status !== "connected") return (
    <>
      {tg.status === "logged_out" && <div className="note warn">Your Telegram login ended. Connect again to keep reading your groups.</div>}
      <Connect onDone={(t) => setTg(t)} />
    </>
  );

  async function loadChats() {
    setBusy(true); setErr(null);
    const j = await api("/api/telegram/chats");
    setBusy(false);
    if (!j.ok) return setErr(j.error);
    setChats(j.chats);
  }
  async function addChat(c) {
    const j = await api("/api/groups", "POST", { chatId: c.chatId, title: c.title, kind: c.kind });
    if (!j.ok) return setErr(j.error);
    setGroups((gs) => (gs.some((g) => g.id === j.group.id) ? gs : [...gs, j.group]));
    setChats((cs) => cs.map((x) => (x.chatId === c.chatId ? { ...x, added: true } : x)));
    setSel(j.group.id);
  }
  async function logout() {
    if (!window.confirm("Disconnect Telegram? All groups stop trading until you connect again.")) return;
    const j = await api("/api/telegram", "POST", { step: "logout" });
    if (j.ok) { setTg({ status: "none" }); setGroups((gs) => gs.map((g) => ({ ...g, enabled: false }))); }
  }
  const current = groups.find((g) => g.id === sel);
  const shown = (chats || []).filter((c) => c.title.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <section className="panel">
        <ul className="rows"><li>
          <div className="row-main"><b>Telegram connected{tg.tgName ? ` · ${tg.tgName}` : ""}</b><span className="hint">{tg.phone}</span></div>
          <div className="row-side"><span className="pill ok">Reading your groups</span><button className="btn-text" type="button" onClick={logout}>Disconnect</button></div>
        </li></ul>
      </section>

      {exchanges.length === 0 && <div className="note warn">Connect an exchange first, so each group knows where to trade. <a href="/app/exchanges">Connect exchange</a></div>}

      <section className="panel">
        <div className="panel-h"><h2>Your signal groups</h2><button className="btn btn-line" type="button" disabled={busy} onClick={loadChats}>{busy ? "Loading your chats…" : chats ? "Refresh list" : "Add groups from Telegram"}</button></div>
        {err && <div className="note bad" role="alert" style={{ margin: 16 }}>{err}</div>}
        {chats && (
          <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--line)", display: "grid", gap: 10 }}>
            <input className="input" placeholder="Search your groups and channels" value={q} onChange={(e) => setQ(e.target.value)} />
            <ul className="rows" style={{ maxHeight: 320, overflow: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
              {shown.length === 0 && <li><span className="hint">No groups or channels match.</span></li>}
              {shown.map((c) => (
                <li key={c.chatId}><div className="row-main"><b>{c.title}</b><span className="hint">{c.kind === "channel" ? "Channel" : "Group"}</span></div>
                  {c.added ? <span className="pill ok">Added</span> : <button className="btn btn-line sm" type="button" onClick={() => addChat(c)}>Add</button>}</li>
              ))}
            </ul>
          </div>
        )}
        {groups.length === 0 ? (
          <div className="empty"><b>No groups yet</b><span>Add the Telegram groups or channels whose signals you want traded.</span></div>
        ) : (
          <div className="split-form" style={{ gridTemplateColumns: "minmax(0,280px) minmax(0,1fr)" }}>
            <ul className="rows" style={{ borderRight: "1px solid var(--line)", background: "var(--paper)" }}>
              {groups.map((g) => (
                <li key={g.id} style={{ cursor: "pointer", background: g.id === sel ? "var(--surface)" : undefined }} onClick={() => setSel(g.id)}>
                  <div className="row-main"><b>{g.title}</b><span className="hint">{g.enabled ? `On · ${g.sizeMode === "fixed" ? `${g.sizeUsdt} USDT` : `${g.sizePercent}%`}` : "Off"}</span></div>
                </li>
              ))}
            </ul>
            {current && <Rules key={current.id} group={current} exchanges={exchanges}
              onSaved={(ng) => setGroups((gs) => gs.map((x) => (x.id === ng.id ? ng : x)))}
              onRemoved={(id) => { setGroups((gs) => gs.filter((x) => x.id !== id)); setSel(null); }} />}
          </div>
        )}
      </section>
    </>
  );
}
