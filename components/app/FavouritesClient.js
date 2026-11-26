"use client";
import { useEffect, useRef, useState } from "react";
import { normBase } from "@/lib/favs";

async function call(url, body) {
  const r = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" }).catch(() => null);
  const j = (r && (await r.json().catch(() => null))) || {};
  return { ok: !!r && r.ok, ...j, error: j.error || (!r ? "Could not reach Copixio." : undefined) };
}

const POPULAR = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "SUI", "PEPE", "LINK", "AVAX"];

const Star = ({ on }) => (
  <svg className="fv-star" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
  </svg>
);
const Avatar = ({ base }) => <span className="fv-av" aria-hidden="true">{normBase(base).slice(0, 2)}</span>;
const venueLabel = (v) => v.replace("Binance futures", "Futures");

export default function FavouritesClient({ initialFavs, initialOnly }) {
  const [favs, setFavs] = useState(initialFavs);
  const [only, setOnly] = useState(initialOnly);
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null); // { q, term, results } | null -- q: the exact text it answers
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null); // the coin (or "*") whose change is on its way to the server
  const pending = useRef(false); // one change at a time: star, remove, clear, switch
  const listHead = useRef(null);
  const [msg, setMsg] = useState(null);
  const seq = useRef(0);
  const inputRef = useRef(null);

  // search as you type (250 ms after the last key); a newer search wins over an older answer
  useEffect(() => {
    const term = q.trim();
    if (!term) { seq.current++; setRes(null); setLoading(false); return; } // drops an answer still on its way
    const n = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      const j = await call(`/api/favorites?q=${encodeURIComponent(term)}`);
      if (n !== seq.current) return;
      setLoading(false);
      setRes(j.ok ? { q: term, term: j.term, results: j.results } : { q: term, term, results: [], error: j.error });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  // PEPE and 1000PEPE are the same coin (the server matches signals the same way)
  const favOf = (b) => favs.find((x) => normBase(x) === normBase(b));
  const isFav = (b) => !!favOf(b);

  // every change goes through here: one at a time, shown at once, put back if the server refuses
  async function change(key, optimistic, body, rollback) {
    if (pending.current) return null;
    pending.current = true; setBusy(key); setMsg(null);
    optimistic();
    const j = await call("/api/favorites", body);
    pending.current = false; setBusy(null);
    if (!j.ok) { rollback(); setMsg({ kind: "bad", text: j.error }); }
    return j;
  }
  async function toggle(base) {
    const saved = favOf(base);
    const before = favs;
    const j = await change(base, () => setFavs((f) => (saved ? f.filter((x) => x !== saved) : [...f, base])),
      { action: saved ? "remove" : "add", base: saved || base }, () => setFavs(before));
    if (j?.ok) setFavs(j.favs);
  }
  function setOnlyTo(on) { change("*", () => setOnly(on), { action: "only", on }, () => setOnly(!on)); }
  async function clearAll() {
    if (!favs.length || pending.current || !window.confirm(`Remove all ${favs.length} coins from your favourites?`)) return;
    const before = favs;
    await change("*", () => setFavs([]), { action: "clear" }, () => setFavs(before));
    listHead.current?.focus();
  }

  const fresh = !!res && res.q === q.trim(); // the results on screen answer what is typed now
  const results = fresh ? res.results : [];
  const typed = q.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const mode = only ? (favs.length ? "on" : "empty") : "off";

  return (
    <div className="fv">
      {/* the switch: what the bot does right now */}
      <section className={`panel fv-mode fv-mode-${mode}`}>
        <div className="fv-mode-main">
          <button type="button" role="switch" aria-checked={only} aria-labelledby="fv-only-l" aria-describedby="fv-only-d" aria-disabled={busy === "*"} className="fv-switch" onClick={() => setOnlyTo(!only)}>
            <span className="fv-knob" />
          </button>
          <div>
            <b id="fv-only-l">Trade only my favourites</b>
            <p id="fv-only-d">{mode === "on" ? `The bot trades signals for your ${favs.length} coin${favs.length === 1 ? "" : "s"} only. Signals for other coins are skipped and listed in the Signal log.`
              : mode === "empty" ? "Your list is empty, so no signal will be traded. Add coins below, or switch this off."
              : "Off: the bot trades every signal your groups post. Switch on to trade only the coins you star."}</p>
          </div>
        </div>
        <div className="fv-count"><span className="lab">Favourites</span><b className="num">{favs.length}</b></div>
      </section>

      {msg && <div className={`note ${msg.kind}`} role="alert">{msg.text}</div>}

      <div className="fv-grid">
        {/* search */}
        <section className="panel fv-search">
          <div className="panel-h"><h2>Find a coin</h2></div>
          <div className="fv-box">
            <label htmlFor="fv-q" className="sr-only">Coin name</label>
            <div className="fv-input">
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M20 20l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              <input ref={inputRef} id="fv-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="BTC, btcusdt, PEPE…" autoComplete="off" spellCheck={false} maxLength={30}
                onKeyDown={(e) => { if (e.key === "Enter" && fresh && !loading && results[0] && !isFav(results[0].base)) { e.preventDefault(); toggle(results[0].base); } if (e.key === "Escape") setQ(""); }} />
              {q && <button type="button" className="fv-clear" aria-label="Clear search" onClick={() => { setQ(""); inputRef.current?.focus(); }}>×</button>}
            </div>
            <p className="hint">{fresh && res.term && res.term !== typed ? <>Showing coins for <b>{res.term}</b>. </> : null}Binance, KuCoin and your connected exchanges. Press Enter to star the first match.</p>
          </div>

          {!q.trim() && (
            <div className="fv-popular">
              <span className="lab">Popular</span>
              <div className="fv-chips">{POPULAR.map((b) => (
                <button key={b} type="button" className={`fv-chip${isFav(b) ? " on" : ""}`} aria-pressed={isFav(b)} aria-disabled={!!busy} onClick={() => toggle(b)}>
                  <Star on={isFav(b)} />{b}
                </button>))}
              </div>
            </div>
          )}

          <p className="sr-only" aria-live="polite">{!q.trim() ? "" : !fresh ? "Searching" : results.length ? `${results.length} coin${results.length === 1 ? "" : "s"} found` : `No coin called ${res.term}`}</p>
          {q.trim() && (!fresh ? <div className="fv-wait">Searching…</div>
            : results.length === 0 ? <div className="empty"><b>No coin called {res.term || typed}</b><span>{res.error || "Check the spelling, or connect the exchange that lists it."}</span></div>
            : <ul className="fv-results" aria-busy={loading}>{results.map((c) => {
                const on = isFav(c.base);
                return (
                  <li key={c.base} className={on ? "on" : ""}>
                    <Avatar base={c.base} />
                    <div className="fv-coin"><b>{c.base}</b><span className="fv-venues">{c.venues.map((v) => <span key={v}>{venueLabel(v)}</span>)}</span></div>
                    <button type="button" className={`fv-fav${on ? " on" : ""}`} aria-pressed={on} aria-label={`${c.base} favourite`} aria-disabled={!!busy} onClick={() => toggle(c.base)}>
                      <Star on={on} /><span>{on ? "Starred" : "Star"}</span>
                    </button>
                  </li>);
              })}</ul>)}
        </section>

        {/* the list */}
        <section className="panel fv-list">
          <div className="panel-h"><h2 ref={listHead} tabIndex={-1}>My favourites</h2>{favs.length > 0 && <button type="button" className="btn-text danger" onClick={clearAll}>Clear all</button>}</div>
          {favs.length === 0
            ? <div className="empty"><b>No favourites yet</b><span>Star a coin on the left. It shows up here.</span></div>
            : <ul className="fv-mine">{[...favs].sort().map((b) => (
                <li key={b}><Avatar base={b} /><b>{b}</b>
                  <button type="button" aria-label={`Remove ${b}`} aria-disabled={!!busy} onClick={() => { toggle(b); listHead.current?.focus(); }}>×</button>
                </li>))}
              </ul>}
        </section>
      </div>
    </div>
  );
}
