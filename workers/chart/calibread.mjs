// Y-axis calibration reader (11 Nov, TradeX / smartradepro charts): reads a TradingView long setup from a small
// Telegram preview (680 px) without reading any digit. The level lines are found by colour (green TPs, red SL, the
// coloured ENTRY badge) and their prices come from the chart's own candles: the time axis (month labels, 1 Jan = the
// widest label) gives each day's x, every visible daily candle's wick top/bottom is matched with that day's Binance
// high/low, and a trimmed log (or linear) fit turns any y into a price. Checks: enough candles, a tight fit,
// SL < entry < TP1 < TP2 < TP3, entry within 5% of the price at the post. Otherwise { reason }.
//   readCalibrated(buffer, symbol, postedAtMs) -> { symbol, side, entry, sl, tps, fit } | { reason }
import sharp from "sharp";

const getJ = async (u) => { const r = await fetch(u, { signal: AbortSignal.timeout(10000) }); if (!r.ok) throw new Error(`${r.status} ${u.split("?")[0]}`); return r.json(); };
const hueOf = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };

// daily klines: Binance futures (the charts are perpetuals), else spot, else KuCoin; [{ t, h, l, c }] oldest first
async function dailyKlines(symbol, endMs) {
  const sym = symbol.replace(/^KC_/, "");
  const tryB = async (base) => { const k = await getJ(`${base}?symbol=${sym}&interval=1d&endTime=${endMs}&limit=400`); return Array.isArray(k) && k.length > 30 ? k.map((x) => ({ t: +x[0], h: +x[2], l: +x[3], c: +x[4] })) : null; };
  try { const k = await tryB("https://fapi.binance.com/fapi/v1/klines"); if (k) return { k, src: "Binance futures" }; } catch { /* next */ }
  try { const k = await tryB("https://api.binance.com/api/v3/klines"); if (k) return { k, src: "Binance spot" }; } catch { /* next */ }
  const pair = sym.replace(/USDT$/, "-USDT");
  const j = await getJ(`https://api.kucoin.com/api/v1/market/candles?type=1day&symbol=${pair}&startAt=${Math.floor(endMs / 1000) - 400 * 86400}&endAt=${Math.floor(endMs / 1000)}`);
  const k = (j?.data || []).map((x) => ({ t: +x[0] * 1000, h: +x[3], l: +x[4], c: +x[2] })).sort((a, b) => a.t - b.t);
  if (k.length > 30) return { k, src: "KuCoin" };
  throw new Error("no daily candles for " + symbol);
}
async function priceAt(symbol, ms) {
  const sym = symbol.replace(/^KC_/, "");
  for (const base of ["https://fapi.binance.com/fapi/v1/klines", "https://api.binance.com/api/v3/klines"]) {
    try { const k = await getJ(`${base}?symbol=${sym}&interval=1m&endTime=${ms}&limit=1`); if (Array.isArray(k) && k.length) return +k[0][4]; } catch { /* next */ }
  }
  try { const j = await getJ(`https://api.kucoin.com/api/v1/market/candles?type=1min&symbol=${sym.replace(/USDT$/, "-USDT")}&startAt=${Math.floor(ms / 1000) - 120}&endAt=${Math.floor(ms / 1000)}`); if (j?.data?.length) return +j.data[0][2]; } catch { /* none */ }
  return null;
}

export async function readCalibrated(buf, symbol, postedAtMs) {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const px = (x, y) => { const i = (y * W + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
  const at = Number(postedAtMs) || Date.now();

  // ---- level lines (middle-right zone): thin green TPs, thin red SL
  const lineCls = (r, g, b) => (g > r + 10 && g > b + 15 && g > 75 ? "green" : r > g + 25 && r > b + 25 && r > 65 && b < g + 25 ? "red" : null);
  const rows = [];
  for (let y = 10; y < H - 20; y++) {
    let best = null, cur = null;
    for (let x = Math.round(W * 0.45); x < Math.round(W * 0.85); x++) {
      const c = lineCls(...px(x, y));
      if (c && cur && cur.c === c && x - cur.end <= 2) cur.end = x;
      else { if (cur && (!best || cur.end - cur.start > best.end - best.start)) best = cur; cur = c ? { c, start: x, end: x } : null; }
    }
    if (cur && (!best || cur.end - cur.start > best.end - best.start)) best = cur;
    if (best && best.end - best.start >= 35) rows.push({ y, c: best.c, x0: best.start, x1: best.end });
  }
  const lines = [];
  for (const l of rows) { const m = lines[lines.length - 1]; if (m && m.c === l.c && l.y - m.y1 <= 1) m.y1 = l.y; else lines.push({ c: l.c, y0: l.y, y1: l.y, x0: l.x0, x1: l.x1 }); }
  // sub-pixel y: the colour-strength weighted centroid over y-2..y+2 along the whole line (an anti-aliased 1 px line
  // spreads over two rows; the centroid finds where it really sits, to a few hundredths of a pixel)
  for (const l of lines) {
    const strength = (r, g, b) => Math.max(0, l.c === "green" ? g - Math.max(r, b) : r - Math.max(g, b));
    let sw = 0, sy = 0;
    for (let x = l.x0; x <= l.x1; x++) for (let y = l.y0 - 2; y <= l.y1 + 2; y++) { if (y < 0 || y >= H) continue; const w = strength(...px(x, y)); sw += w; sy += w * y; }
    l.y = sw > 0 ? sy / sw : (l.y0 + l.y1) / 2;
  }
  const greens = lines.filter((l) => l.c === "green" && l.y1 - l.y0 <= 2).sort((a, b) => b.y - a.y); // thin only; lowest = TP1
  const reds = lines.filter((l) => l.c === "red" && l.y1 - l.y0 <= 2);
  if (!greens.length || !reds.length) return { reason: `calibrated reader: ${greens.length} target line(s) and ${reds.length} stop line(s) found` };
  // ---- the ENTRY badge: a solid coloured block (5+ rows thick) between the targets and the stop
  let entryY = null;
  {
    const thick = [];
    for (let y = Math.round(greens[0].y) + 3; y < Math.round(reds[0].y) - 2; y++) {
      let run = 0, bestRun = 0;
      for (let x = Math.round(W * 0.45); x < Math.round(W * 0.85); x++) {
        const [r, g, b] = px(x, y); const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx > 120 && (mx - mn) / mx > 0.35) { run++; bestRun = Math.max(bestRun, run); } else run = 0;
      }
      if (bestRun >= 18) thick.push(y);
    }
    if (thick.length >= 5) entryY = (thick[0] + thick[thick.length - 1]) / 2;
  }
  // ---- candles (and the pattern's own lines, whose corners sit on candle highs/lows), left of the position tool
  const plotRight = Math.min(...lines.map((l) => l.x0)) - 12;
  const candle = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx < 70 || (mx - mn) / mx < 0.35) return false; const h = hueOf(r, g, b); return !(h >= 22 && h < 75); };
  const colTop = new Map();
  for (let x = 2; x < plotRight; x++) {
    let top = null, bot = null;
    for (let y = 20; y < H - 28; y++) {
      if (!candle(...px(x, y)) || !(candle(...px(x, y - 1)) || candle(...px(x, y + 1)))) continue;
      if (top === null) top = y; bot = y;
    }
    if (top !== null) colTop.set(x, { top, bot });
  }
  if (colTop.size < 40) return { reason: "calibrated reader: too few candles on the chart" };
  // ---- time axis: month labels; the widest is the year (1 Jan)
  const br = (x, y) => { const p = px(x, y); return (p[0] + p[1] + p[2]) / 3; };
  let band = null;
  for (let y0 = H - 14; y0 <= H - 5 && !band; y0++) { let k = 0; for (let x = 70; x < W - 40; x++) if (br(x, y0) > 45) k++; if (k >= 6) band = [y0, Math.min(H - 1, y0 + 5)]; }
  if (!band) return { reason: "calibrated reader: no time axis" };
  const on = []; for (let x = 0; x < W; x++) { let o = false; for (let y = band[0]; y <= band[1]; y++) if (br(x, y) > 45) o = true; on.push(o); }
  const cl = []; let s = -1; for (let x = 0; x <= W; x++) { if (x < W && on[x]) { if (s < 0) s = x; } else if (s >= 0) { cl.push([s, x - 1]); s = -1; } }
  const labs0 = []; for (const c of cl) { const l = labs0[labs0.length - 1]; if (l && c[0] - l[1] <= 4) l[1] = c[1]; else labs0.push([...c]); }
  const lab = labs0.map((c) => ({ x: (c[0] + c[1]) / 2, w: c[1] - c[0] + 1 })).filter((l) => l.x > 4 && l.x < W - 30);
  if (lab.length < 4) return { reason: "calibrated reader: not a daily chart (no month labels)" };
  const gaps = lab.slice(1).map((l, i) => l.x - lab[i].x), mg = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  if (!(mg > 45 && mg < 130) || gaps.some((g) => Math.abs(g - mg) > mg * 0.2)) return { reason: "calibrated reader: the time axis is not monthly" };
  const yi = lab.reduce((bi, l, i) => (l.w > lab[bi].w ? i : bi), 0);
  const lastX = Math.max(...colTop.keys());
  const yearAt = lab[yi].x > lastX ? new Date(at).getUTCFullYear() + 1 : new Date(at).getUTCFullYear();
  const pts = lab.map((l, i) => ({ x: l.x, t: Date.UTC(yearAt, i - yi, 1) / 864e5 }));
  const mt = pts.reduce((a, p) => a + p.t, 0) / pts.length, mxx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const slope = pts.reduce((a, p) => a + (p.t - mt) * (p.x - mxx), 0) / pts.reduce((a, p) => a + (p.t - mt) ** 2, 0);
  // ---- per-candle pairs and the fit
  const { k: kl, src } = await dailyKlines(symbol, at);
  const pairs = [];
  for (const k of kl) {
    const xc = mxx + (Math.floor(k.t / 864e5) - mt) * slope;
    if (xc < 3 || xc > plotRight - 2) continue;
    let top = null, bot = null;
    for (let x = Math.round(xc - 1); x <= Math.round(xc + 1); x++) { const c = colTop.get(x); if (!c) continue; top = top === null ? c.top : Math.min(top, c.top); bot = bot === null ? c.bot : Math.max(bot, c.bot); }
    if (top !== null) { pairs.push({ p: k.h, y: top }); pairs.push({ p: k.l, y: bot }); }
  }
  if (pairs.length < 100) return { reason: `calibrated reader: only ${pairs.length} candle points matched` };
  const fitMode = (mode) => {
    const f = mode === "log" ? Math.log : (v) => v;
    let q = pairs.map((z) => ({ u: f(z.p), y: z.y })), a = 0, b = 0, rms = 0;
    for (let it = 0; it < 6; it++) {
      const n = q.length, mu = q.reduce((t, z) => t + z.u, 0) / n, my = q.reduce((t, z) => t + z.y, 0) / n;
      a = q.reduce((t, z) => t + (z.u - mu) * (z.y - my), 0) / q.reduce((t, z) => t + (z.u - mu) ** 2, 0); b = my - a * mu;
      const res = q.map((z) => Math.abs(z.y - (a * z.u + b))), med = [...res].sort((x, y) => x - y)[Math.floor(res.length / 2)];
      rms = Math.sqrt(res.reduce((t, r) => t + r * r, 0) / res.length);
      q = q.filter((z, i) => res[i] <= Math.max(1.5, 3 * med));
    }
    return { mode, a, b, rms, kept: q.length };
  };
  const fl = fitMode("log"), fn = fitMode("linear");
  const fit = fn.rms * 1.25 < fl.rms ? fn : fl; // TradeX charts are on a log scale; linear only when clearly better
  if (!(fit.a < 0) || fit.rms > 7 || fit.kept < 100) return { reason: `calibrated reader: the candles do not fit a price scale (rms ${fit.rms.toFixed(1)} px, ${fit.kept} points)` };
  let priceOf = (y) => (fit.mode === "log" ? Math.exp((y - fit.b) / fit.a) : (y - fit.b) / fit.a);
  const candleFit = { mode: fit.mode, rmsPx: +fit.rms.toFixed(2), points: fit.kept };

  // ---- harmonic pivots (X A B C D badges): exact Binance swing prices as clean anchors, and the TP Fib rule
  const yel = [];
  const badgeRight = Math.min(...lines.map((l) => l.x0)) + 4; // D sits on the last candle, where the position tool starts
  for (let y = 20; y < H - 28; y++) for (let x = 2; x < badgeRight; x++) {
    const [r, g, b] = px(x, y); const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx > 150 && (mx - mn) / mx > 0.45) { const h = hueOf(r, g, b); if (h >= 30 && h < 60) yel.push([x, y]); }
  }
  const bcl = [];
  for (const [x, y] of yel) { let c = bcl.find((k) => Math.abs(k.cx - x) <= 6 && Math.abs(k.cy - y) <= 6); if (!c) { c = { sx: 0, sy: 0, n: 0, cx: x, cy: y, y0: y, y1: y }; bcl.push(c); } c.sx += x; c.sy += y; c.n++; c.cx = c.sx / c.n; c.cy = c.sy / c.n; c.y0 = Math.min(c.y0, y); c.y1 = Math.max(c.y1, y); }
  const badges = bcl.filter((c) => c.n >= 15).sort((a, b) => a.cx - b.cx);
  let pivots = [], fib = null, pivotFit = null;
  if (badges.length >= 4) {
    const byDay = new Map(kl.map((k) => [Math.floor(k.t / 864e5), k]));
    // from D backwards the pivots alternate: D low, C high, B low, A high, X low (a bullish pattern)
    for (let i = badges.length - 1, kind = "low"; i >= 0; i--, kind = kind === "low" ? "high" : "low") {
      const b = badges[i], d = Math.round(mt + (b.cx - mxx) / slope);
      let best = null;
      for (let k = d - 3; k <= d + 3; k++) { const c = byDay.get(k); if (!c) continue; const v = kind === "high" ? c.h : c.l; if (!best || (kind === "high" ? v > best.p : v < best.p)) best = { p: v, day: k }; }
      if (!best) continue;
      // the vertex: the coloured pixel nearest the badge, just under a high's badge / just over a low's
      let vy = null;
      // D's corner is covered by the position tool (the entry / stop boxes start on that candle): its price still comes
      // from Binance, but its pixel is not used for the scale
      for (let x = Math.round(b.cx) - 3; x <= Math.round(b.cx) + 3 && i < badges.length - 1; x++) {
        if (x < 0 || x >= W) continue; // D sits on the last candle, outside the candle-read area: scanned directly
        if (kind === "high") { for (let y = b.y1 + 1; y < H - 28; y++) if (candle(...px(x, y))) { vy = vy === null ? y : Math.min(vy, y); break; } }
        else { for (let y = b.y0 - 1; y > 20; y--) if (candle(...px(x, y))) { vy = vy === null ? y : Math.max(vy, y); break; } }
      }
      pivots.unshift({ kind, p: best.p, day: best.day, y: vy });
    }
    const D = pivots[pivots.length - 1], C = pivots[pivots.length - 2];
    if (D?.kind === "low" && C?.kind === "high" && C.p > D.p) fib = [D.p + 0.382 * (C.p - D.p), D.p + 0.618 * (C.p - D.p), C.p];
    // the pivot-only fit (5 noiseless points), used for the stop and the entry when it is tight
    const pv = pivots.filter((q) => q.y !== null);
    if (pv.length >= 3) { // two unknowns (slope, offset): three pivots already over-determine the scale
      const f = fit.mode === "log" ? Math.log : (v) => v;
      const n = pv.length, mu = pv.reduce((t, q) => t + f(q.p), 0) / n, my = pv.reduce((t, q) => t + q.y, 0) / n;
      const a = pv.reduce((t, q) => t + (f(q.p) - mu) * (q.y - my), 0) / pv.reduce((t, q) => t + (f(q.p) - mu) ** 2, 0), b = my - a * mu;
      const rms = Math.sqrt(pv.reduce((t, q) => t + (q.y - (a * f(q.p) + b)) ** 2, 0) / n);
      pivotFit = { a, b, rms, n };
      if (a < 0 && rms <= 1.5) priceOf = (y) => (fit.mode === "log" ? Math.exp((y - b) / a) : (y - b) / a);
    }
  }
  let tps = greens.slice(0, 3).map((l) => priceOf(l.y));
  const sl = priceOf(reds.sort((a, b) => b.y - a.y)[0].y);
  const entry = entryY !== null ? priceOf(entryY) : null;
  // Fib snap: the indicator's targets are D + 0.382 / 0.618 / 1.0 of the C-D leg; when all the measured targets agree
  // with that (1.5%), the exact values are used
  let fibSnap = false;
  if (fib && tps.length === 3 && tps.every((v, i) => Math.abs(v / fib[i] - 1) <= 0.015)) { tps = fib; fibSnap = true; }
  const pNow = await priceAt(symbol, at);
  const ladder = [sl, ...(entry ? [entry] : []), ...tps];
  if (ladder.some((v, i) => i && !(v > ladder[i - 1]))) return { reason: "calibrated reader: the levels are not in order (stop, entry, targets)" };
  // a wrong coin or a wrong scale lands far away; whether the price has run from the entry is the trade rule's call
  if (pNow && entry && Math.abs(entry / pNow - 1) > 0.15) return { reason: `calibrated reader: entry ${entry.toPrecision(5)} is not near the price ${pNow} at the post` };
  const r5 = (v) => +v.toPrecision(5);
  return {
    symbol, side: "LONG", entry: entry ? r5(entry) : null, sl: r5(sl), tps: tps.map(r5),
    ratios: fib ? (() => { const D = pivots[pivots.length - 1].p, C = pivots[pivots.length - 2].p, X = pivots[0]?.kind === "low" ? pivots[0].p : null; return {
      entryVsCD: entry ? +((entry - D) / (C - D)).toFixed(4) : null, slBelowDvsCD: +((D - sl) / (C - D)).toFixed(4), slPctBelowD: +((1 - sl / D) * 100).toFixed(3), slVsX: X ? +(sl / X).toFixed(4) : null, D, C, X }; })() : null,
    fit: { ...candleFit, pivotRmsPx: pivotFit ? +pivotFit.rms.toFixed(2) : null, pivotN: pivotFit?.n ?? null, pivots: pivots.map((q) => `${q.kind[0]}:${q.p}`).join(" "), fibSnap, pxPerDay: +slope.toFixed(3), source: src, priceAtPost: pNow },
  };
}
