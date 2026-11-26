"use client";
import { useEffect, useState } from "react";

// One shared poll of /api/trades/live for every cell on the page (every second, paused while the tab is hidden).
const subs = new Set();
let data = {}, timer = null, inflight = false;
async function pull() {
  if (inflight || (typeof document !== "undefined" && document.hidden)) return;
  inflight = true;
  const r = await fetch("/api/trades/live", { cache: "no-store" }).catch(() => null);
  const j = r && r.ok ? await r.json().catch(() => null) : null;
  inflight = false;
  if (!j?.rows) return;
  data = Object.fromEntries(j.rows.map((x) => [x.id, x]));
  subs.forEach((f) => f(data));
}
function useLive() {
  const [d, setD] = useState(data);
  useEffect(() => {
    subs.add(setD);
    if (!timer) { pull(); timer = setInterval(pull, 1000); }
    return () => { subs.delete(setD); if (!subs.size) { clearInterval(timer); timer = null; } };
  }, []);
  return d;
}

const pp = (x) => Number(Number(x).toPrecision(6));
const sign = (x) => (x >= 0 ? "+" : "");

export function LivePrice({ id }) {
  const r = useLive()[id];
  return <span className="num">{r?.px ? pp(r.px) : "–"}</span>;
}

export function LivePnl({ id }) {
  const r = useLive()[id];
  if (!r || r.px == null) return <span className="hint">–</span>;
  const cls = r.pnl >= 0 ? "pos" : "neg";
  return (
    <span className={`num ${cls}`} title={`Price move ${sign(r.move)}${r.move.toFixed(2)}% · fees paid taken off, closing fee not yet`}>
      <b>{sign(r.pnl)}{r.pnl.toFixed(2)}</b>
      {r.pct != null && <span style={{ display: "block", fontSize: ".8rem" }}>{sign(r.pct)}{r.pct.toFixed(2)}%</span>}
    </span>
  );
}
