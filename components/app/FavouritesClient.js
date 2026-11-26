"use client";
import { useEffect, useRef, useState } from "react";

async function call(url, body) {
  const r = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  return { ok: !!r && r.ok, ...j, error: j.error || (!r ? "Could not reach Copixio." : undefined) };
}

export default function FavouritesClient({ initialFavs, initialOnly }) {
  const [favs, setFavs] = useState(initialFavs);
  const [only, setOnly] = useState(initialOnly);
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null); // null = nothing searched yet
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const seq = useRef(0);

  // search as you type (250 ms after the last key)
  useEffect(() => {
    const term = q.trim();
    if (!term) { setResults(null); return; }
    const n = ++seq.current;
    const t = setTimeout(async () => {
      const j = await call(`/api/favorites?q=${encodeURIComponent(term)}`);
      if (n === seq.current) setResults(j.ok ? j.results : []);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const isFav = (b) => favs.includes(b);
  async function toggle(base) {
    setBusy(base); setMsg(null);
    const j = await call("/api/favorites", { action: isFav(base) ? "remove" : "add", base });
    setBusy(null);
    if (j.ok) { setFavs(j.favs); setResults((r) => r && r.map((x) => (x.base === base ? { ...x, fav: j.favs.includes(base) } : x))); }
    else setMsg({ ok: false, text: j.error });
  }

  return (
    <>
      <section className="panel">
        <div className="panel-h"><h2>Trade only my favourites</h2><span className={`pill ${only ? "ok" : "info"}`}>{only ? "On" : "Off"}</span></div>
        <div className="form-col">
          <p className="hint">{only
            ? "The bot trades a signal only when its coin is in your list below. Signals for other coins are skipped and show in the Signal log."
            : "Off: the bot trades every signal your groups post. Switch on to trade only the coins you pick below."}</p>
          {only && favs.length === 0 && <div className="note bad" role="status">Your list is empty, so no signal will trade. Add coins below.</div>}
          <div className="actions"><button className={`btn ${only ? "btn-line" : "btn-ink"}`} type="button" onClick={async () => {
            const j = await call("/api/favorites", { action: "only", on: !only });
            if (j.ok) setOnly(j.only); else setMsg({ ok: false, text: j.error });
          }}>{only ? "Turn off" : "Turn on"}</button></div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-h"><h2>Find a coin</h2></div>
        <div className="form-col">
          <div className="field">
            <label htmlFor="coinq">Coin name</label>
            <input className="input" id="coinq" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a coin, for example PEPE or SOL" autoComplete="off" maxLength={20} />
          </div>
          {msg && <div className={`note ${msg.ok ? "ok" : "bad"}`} role="status">{msg.text}</div>}
        </div>
        {results && (results.length === 0
          ? <div className="empty"><b>No coin found</b><span>Check the spelling. Coins from Binance, KuCoin and your connected exchanges are searched.</span></div>
          : <ul className="rows">{results.map((c) => (
            <li key={c.base}>
              <div className="row-main"><b>{c.base}</b><span className="hint">{c.venues.join(" · ")}</span></div>
              <div className="row-side">
                <button className={`btn sm ${c.fav ? "btn-ink" : "btn-line"}`} type="button" disabled={busy === c.base} aria-pressed={c.fav} onClick={() => toggle(c.base)}>{c.fav ? "★ Favourite" : "☆ Add to favourites"}</button>
              </div>
            </li>))}
          </ul>)}
      </section>

      <section className="panel">
        <div className="panel-h"><h2>My favourites</h2><span className="pill info">{favs.length}</span></div>
        {favs.length === 0
          ? <div className="empty"><b>No favourites yet</b><span>Search a coin above and press Add to favourites.</span></div>
          : <ul className="rows">{[...favs].sort().map((b) => (
            <li key={b}>
              <div className="row-main"><b>{b}</b></div>
              <div className="row-side"><button className="btn-text danger" type="button" disabled={busy === b} onClick={() => toggle(b)}>Remove</button></div>
            </li>))}
          </ul>}
      </section>
    </>
  );
}
