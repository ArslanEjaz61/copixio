"use client";
import { useEffect, useMemo, useState } from "react";
import { exchangeMeta, FUTURES_IDS } from "@/lib/exchanges/list";

async function api(path, method = "GET", body) {
  const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  return { ok: !!r && r.ok, ...j, error: j.error || (!r ? "Could not reach Copixio. Try again." : undefined) };
}
const TONES = ["#24548F", "#0F7B4A", "#8C6115", "#6B4FA0", "#A0412D", "#1F7A8C", "#5A6B7B"];
const tone = (s) => TONES[[...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % TONES.length];
const initials = (t) => String(t || "?").replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "#";
const Avatar = ({ title, size = 36 }) => <span className="av" style={{ background: tone(title), width: size, height: size }} aria-hidden="true">{initials(title)}</span>;

const DEFAULTS = { sizeMode: "fixed", sizeUsdt: 20, sizePercent: 5, maxOpen: 3, slMode: "signal", slPercent: 3, tpMode: "signal", tpPercent: 4, tpSplit: "even", moveSlToEntry: true, dailyLossUsdt: 0, maxEntryGapPct: 2, market: "spot", leverage: 5 };
const MARKET_HINT = {
  spot: "Long (buy) signals are bought on spot. Short signals are skipped.",
  futures: "Long and short signals are opened on USDT futures with your leverage, isolated margin.",
  both: "A long signal is bought on spot AND opened on futures (two trades). A short signal goes to futures.",
};

function Seg({ value, onChange, options }) {
  return (
    <div className="seg">{options.map(([v, l]) => <button key={v} type="button" className={value === v ? "on" : ""} aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}</div>
  );
}

// ---------------------------------------------------------------- the rules of one group
function Rules({ group, exchanges, onSaved, onRemoved }) {
  const [g, setG] = useState({ ...DEFAULTS, ...group, exchangeId: group.exchangeId || exchanges[0]?.id || "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [dirty, setDirty] = useState(false);
  const set = (k) => (v) => { setG((x) => ({ ...x, [k]: v?.target ? (v.target.type === "checkbox" ? v.target.checked : v.target.value) : v })); setDirty(true); };

  async function save(enabled) {
    const nums = ["sizeUsdt", "sizePercent", "maxOpen", "slPercent", "tpPercent", "dailyLossUsdt", "maxEntryGapPct", "leverage"];
    if (nums.some((k) => g[k] === "" || g[k] === null || Number.isNaN(Number(g[k])))) return setMsg({ bad: true, text: "Fill in every number (use 0 for “no limit”)." });
    setBusy(true); setMsg(null);
    const { id, chatId, title, kind, ...rules } = g; // eslint-disable-line no-unused-vars
    const j = await api(`/api/groups/${group.id}`, "PUT", { ...rules, enabled });
    setBusy(false);
    if (!j.ok) return setMsg({ bad: true, text: j.error });
    setG((x) => ({ ...x, ...j.group })); setDirty(false); onSaved(j.group);
    setMsg({ bad: false, text: j.group.enabled ? "Saved. This group is trading." : "Saved. This group is switched off." });
  }
  async function remove() {
    if (!window.confirm(`Stop following “${group.title}”?`)) return;
    const j = await api(`/api/groups/${group.id}`, "DELETE");
    if (j.ok) onRemoved(group.id); else setMsg({ bad: true, text: j.error });
  }

  return (
    <div className="rules">
      <div className="rules-h">
        <Avatar title={group.title} size={44} />
        <div className="row-main"><h3>{group.title}</h3><span className="hint">{group.kind === "channel" ? "Channel" : "Group"}</span></div>
        <span className={`pill ${g.enabled ? "ok" : "wait"}`}>{g.enabled ? "Trading" : "Off"}</span>
      </div>

      <section className="rsec">
        <div className="rsec-t"><b>Trade on</b><span className="hint">Which account this group&apos;s signals use.</span></div>
        <div className="rsec-b">
          <select className="input" value={g.exchangeId} onChange={set("exchangeId")} aria-label="Exchange account">
            {exchanges.length === 0 && <option value="">Connect an exchange first</option>}
            {exchanges.map((x) => <option key={x.id} value={x.id}>{exchangeMeta(x.exchange).name}{x.env === "demo" ? " · demo" : ""}{x.label ? ` · ${x.label}` : ""}</option>)}
          </select>
        </div>
      </section>

      <section className="rsec">
        <div className="rsec-t"><b>Market</b><span className="hint">Spot, futures, or both.</span></div>
        <div className="rsec-b two">
          <div className="field"><label>Trade signals on</label>
            <Seg value={g.market} onChange={set("market")} options={[["spot", "Spot"], ["futures", "Futures"], ["both", "Both"]]} />
            <span className="hint">{MARKET_HINT[g.market]}</span>
            {g.market !== "spot" && exchanges.length > 0 && !FUTURES_IDS.includes(exchanges.find((x) => x.id === g.exchangeId)?.exchange) && (
              <span className="hint" style={{ color: "var(--loss)" }}>Futures are not available on this exchange in Copixio yet (Binance, KuCoin, OKX, Bitget and HTX are).</span>
            )}
          </div>
          {g.market !== "spot" && (
            <div className="field"><label>Leverage (futures)</label>
              <div className="input-group"><input className="input num" type="number" min="1" max="20" step="1" value={g.leverage} onChange={set("leverage")} aria-label="Futures leverage" /><span className="suffix">x</span></div>
              <span className="hint">Isolated margin. The size per trade is your margin; the position is size × leverage. A stop past the liquidation price is skipped.</span>
            </div>
          )}
        </div>
      </section>

      <section className="rsec">
        <div className="rsec-t"><b>Position size</b><span className="hint">How much each trade from this group uses.</span></div>
        <div className="rsec-b two">
          <div className="field"><label>Size per trade</label>
            <div className="input-group">
              <Seg value={g.sizeMode} onChange={set("sizeMode")} options={[["fixed", "USDT"], ["percent", "% of free"]]} />
              {g.sizeMode === "fixed" ? <input className="input num" type="number" min="1" step="1" value={g.sizeUsdt} onChange={set("sizeUsdt")} aria-label="USDT per trade" />
                : <input className="input num" type="number" min="0.1" step="0.1" value={g.sizePercent} onChange={set("sizePercent")} aria-label="Percent of free USDT" />}
            </div></div>
          <div className="field"><label>Max open trades</label><input className="input num" type="number" min="1" max="100" value={g.maxOpen} onChange={set("maxOpen")} aria-label="Max open trades" /></div>
        </div>
      </section>

      <section className="rsec">
        <div className="rsec-t"><b>Stop loss</b><span className="hint">Placed on the exchange right after the buy.</span></div>
        <div className="rsec-b two">
          <div className="field"><label>Stop from</label><Seg value={g.slMode} onChange={set("slMode")} options={[["signal", "The signal"], ["percent", "My own %"]]} /></div>
          <div className="field"><label>{g.slMode === "signal" ? "If the signal has none: % below entry" : "% below entry"}</label><input className="input num" type="number" min="0.1" step="0.1" value={g.slPercent} onChange={set("slPercent")} aria-label="Stop loss percent below entry" /></div>
          <label className="check span2"><input type="checkbox" checked={!!g.moveSlToEntry} onChange={set("moveSlToEntry")} />After the first target, move the stop to the entry price (break-even)</label>
        </div>
      </section>

      <section className="rsec">
        <div className="rsec-t"><b>Take profit</b><span className="hint">Sold at market when the price reaches each target.</span></div>
        <div className="rsec-b two">
          <div className="field"><label>Targets from</label><Seg value={g.tpMode} onChange={set("tpMode")} options={[["signal", "The signal"], ["percent", "My own %"]]} /></div>
          {g.tpMode === "percent"
            ? <div className="field"><label>% above entry</label><input className="input num" type="number" min="0.1" step="0.1" value={g.tpPercent} onChange={set("tpPercent")} aria-label="Take profit percent above entry" /></div>
            : <div className="field"><label>Sell over the targets</label>
                <select className="input" value={g.tpSplit} onChange={set("tpSplit")} aria-label="How to sell over the targets"><option value="even">Evenly over all targets</option><option value="half">Half at TP1, rest at the last</option><option value="first">Everything at TP1</option></select></div>}
        </div>
      </section>

      <section className="rsec">
        <div className="rsec-t"><b>Safety</b><span className="hint">Limits checked before every order.</span></div>
        <div className="rsec-b two">
          <div className="field"><label>Daily loss limit (USDT)</label><input className="input num" type="number" min="0" step="1" value={g.dailyLossUsdt} onChange={set("dailyLossUsdt")} aria-label="Daily loss limit in USDT" /><span className="hint">0 means no limit. When reached, the group stops until tomorrow (UTC).</span></div>
          <div className="field"><label>Skip if price ran above entry by</label><div className="input-group"><input className="input num" type="number" min="0" step="0.1" value={g.maxEntryGapPct} onChange={set("maxEntryGapPct")} aria-label="Skip if price ran above entry by percent" /><span className="suffix">%</span></div><span className="hint">Avoids buying a pump that already happened.</span></div>
        </div>
      </section>

      <p className="hint" style={{ padding: "0 22px" }}>{g.market === "spot" ? "Spot trading: only long (buy) signals are traded. Short signals are skipped and shown in the signal log." : "Futures: for a short, the stop sits above the entry and the targets below it. The bot watches the stop every few seconds and closes at market."}</p>
      {msg && <div className={`note ${msg.bad ? "bad" : "ok"}`} role="status" style={{ margin: "0 22px" }}>{msg.text}</div>}

      <footer className="rules-f">
        <button className="btn-text danger" type="button" onClick={remove}>Stop following</button>
        <div className="actions">
          {g.enabled && <button className="btn btn-line" type="button" disabled={busy} onClick={() => save(false)}>Switch off</button>}
          <button className="btn btn-ink" type="button" disabled={busy || exchanges.length === 0} onClick={() => save(true)}>{busy ? "Saving…" : g.enabled ? (dirty ? "Save changes" : "Saved") : "Save and start trading"}</button>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------- picker of the user's Telegram chats
function Picker({ onAdd, onClose }) {
  const [chats, setChats] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(null);
  useEffect(() => { let live = true; api("/api/telegram/chats").then((j) => { if (live) { if (j.ok) setChats(j.chats); else setErr(j.error); } }); return () => { live = false; }; }, []);
  const shown = useMemo(() => (chats || []).filter((c) => (c.title || "").toLowerCase().includes(q.toLowerCase())), [chats, q]);
  return (
    <div className="picker" role="region" aria-label="Add groups from Telegram" ref={(el) => el?.scrollIntoView?.({ block: "nearest" })}>
      <div className="picker-h"><b>Your Telegram groups and channels</b><button className="btn-text" type="button" onClick={onClose}>Done</button></div>
      <input className="input" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {err && <div className="note bad" role="alert">{err}</div>}
      {!chats && !err && <p className="hint">Loading your chats from Telegram…</p>}
      {chats && (
        <ul className="picker-list">
          {shown.length === 0 && <li className="hint">Nothing matches “{q}”.</li>}
          {shown.map((c) => (
            <li key={c.chatId}>
              <Avatar title={c.title} size={32} />
              <div className="row-main"><b>{c.title}</b><span className="hint">{c.kind === "channel" ? "Channel" : "Group"}</span></div>
              {c.added ? <span className="pill ok">Added</span> : (
                <button className="btn btn-line sm" type="button" disabled={adding === c.chatId} onClick={async () => {
                  setAdding(c.chatId);
                  const j = await api("/api/groups", "POST", { chatId: c.chatId, title: c.title, kind: c.kind });
                  setAdding(null);
                  if (j.ok) { onAdd(j.group); setChats((cs) => cs.map((x) => (x.chatId === c.chatId ? { ...x, added: true } : x))); } else setErr(j.error);
                }}>{adding === c.chatId ? "Adding…" : "Add"}</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function SignalGroups({ initialGroups, exchanges, connected }) {
  const [groups, setGroups] = useState(initialGroups);
  const [sel, setSel] = useState(initialGroups[0]?.id || null);
  const [picking, setPicking] = useState(initialGroups.length === 0 && connected);
  const on = groups.filter((g) => g.enabled).length;

  if (!connected) return (
    <section className="panel"><div className="next-card">
      <div><h2>Connect Telegram first</h2><p>Copixio reads signals from the Telegram groups you choose. Connect your Telegram account, then come back to pick groups.</p></div>
      <a className="btn btn-cta" href="/app/connections">Go to Connections</a>
    </div></section>
  );
  const current = groups.find((g) => g.id === sel);

  return (
    <>
      <div className="grp-bar">
        <span className="hint"><b className="num">{on}</b> trading · <b className="num">{groups.length}</b> followed</span>
        <button className="btn btn-ink" type="button" onClick={() => setPicking(true)}>Add groups</button>
      </div>
      {picking && <Picker onClose={() => setPicking(false)} onAdd={(g) => { setGroups((gs) => (gs.some((x) => x.id === g.id) ? gs : [...gs, g])); setSel(g.id); }} />}
      {groups.length === 0 ? (
        <section className="panel"><div className="empty"><b>No groups yet</b><span>Add the Telegram groups or channels whose signals you want traded.</span></div></section>
      ) : (
        <section className="panel grp-layout">
          <nav className="grp-list" aria-label="Followed groups">
            {groups.map((g) => (
              <button key={g.id} type="button" className={`grp-item${g.id === sel ? " on" : ""}`} onClick={() => setSel(g.id)}>
                <Avatar title={g.title} />
                <span className="row-main"><b>{g.title}</b><span className="hint">{g.enabled ? `${g.sizeMode === "fixed" ? `${g.sizeUsdt} USDT` : `${g.sizePercent}%`} · max ${g.maxOpen}` : "Not trading"}</span></span>
                <span className={`dot ${g.enabled ? "on" : ""}`} aria-label={g.enabled ? "Trading" : "Off"} />
              </button>
            ))}
          </nav>
          {current ? <Rules key={current.id} group={current} exchanges={exchanges}
            onSaved={(ng) => setGroups((gs) => gs.map((x) => (x.id === ng.id ? { ...x, ...ng } : x)))}
            onRemoved={(id) => { setGroups((gs) => { const rest = gs.filter((x) => x.id !== id); setSel(rest[0]?.id || null); return rest; }); }} />
            : <div className="empty"><b>Choose a group</b><span>Select a group on the left to set its rules.</span></div>}
        </section>
      )}
    </>
  );
}
