"use client";
import { useEffect, useRef, useState } from "react";

// Banknote guilloche band: sums of sines drawn as fine brass lines. The only decoration on the page.
export function Guilloche() {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return undefined;
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
      c.width = w * dpr; c.height = h * dpr;
      const g = c.getContext("2d");
      g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
      g.lineWidth = 0.6; g.strokeStyle = "rgba(192,138,46,.5)";
      for (let k = 0; k < 18; k++) {
        g.beginPath();
        for (let x = 0; x <= w; x += 3) {
          const t = (x / w) * Math.PI * 2;
          const y = h * 0.5 + Math.sin(t * 6 + k * 0.35) * h * 0.22 + Math.sin(t * 13 - k * 0.5) * h * 0.08 + Math.cos(t * 3 + k * 0.2) * h * 0.06;
          if (x) g.lineTo(x, y); else g.moveTo(x, y);
        }
        g.stroke();
      }
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, []);
  return <canvas ref={ref} aria-hidden="true" />;
}

const ROWS = [
  ["Pair", "ARIAUSDT · Long", ""],
  ["Size (your rule)", "50.00 USDT", ""],
  ["Entry", "0.2495", ""],
  ["Stop loss", "0.2410 (−3.4%)", "neg"],
  ["Take profit", "50% at 0.2580 · rest at 0.2620", "pos"],
];

// The one authored moment: the signal fills an order ticket row by row, then reads "Filled".
export function TicketDemo() {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(ROWS.length + 1); return undefined; }
    let timers = [];
    const run = () => {
      timers.forEach(clearTimeout);
      setShown(0);
      timers = ROWS.map((_, i) => setTimeout(() => setShown(i + 1), 600 + i * 420));
      timers.push(setTimeout(() => setShown(ROWS.length + 1), 600 + ROWS.length * 420 + 300));
    };
    run();
    const loop = setInterval(run, 9000);
    return () => { clearInterval(loop); timers.forEach(clearTimeout); };
  }, []);
  const filled = shown > ROWS.length;
  return (
    <div className="lp-ticket">
      <div className="head">
        <h4>Order on your Binance</h4>
        <span className={`pill ${filled ? "ok" : "wait"}`} aria-live="polite">{filled ? "Filled" : "Reading signal"}</span>
      </div>
      {ROWS.map(([k, v, cls], i) => (
        <div key={k} className={`lp-trow${i < shown ? " on" : ""}`}>
          <span>{k}</span>
          <span className={`num ${cls}`}>{v}</span>
        </div>
      ))}
    </div>
  );
}
