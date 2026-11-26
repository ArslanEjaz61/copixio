// Position-tool reader by geometry (6 Nov, TradeX / smartradepro): TradingView's Long / Short Position tool is a
// green (or teal / cyan) box on top of a red (or pink) one. No words on the picture are needed:
//   the boxes are found by their colour, and their edges are turned into prices with the numbers on the chart's
//   price axis (OCR of each axis label, then a straight-line fit of price against height; log scale tried too).
//   LONG: green above red -> TP = top of green, entry = the edge they share, SL = bottom of red. SHORT the other way.
// Where an axis label sits on an edge (phone charts print the TP / entry / SL there) its exact number is used.
//   readPositionBoxes(buffer) -> { side, entry, sl, tp, edges, fit } | { error }
import fs from "fs";
import sharp from "sharp";
import Tesseract from "tesseract.js";

let worker = null;
async function ocrWorker() {
  if (worker) return worker;
  worker = await Tesseract.createWorker("eng", 1, { cachePath: new URL(".", import.meta.url).pathname, logger: () => {}, errorHandler: () => {} });
  await worker.setParameters({ tessedit_char_whitelist: "0123456789.,", tessedit_pageseg_mode: "7" });
  return worker;
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// fill colour class: "g" green / teal / cyan, "r" red / pink, or null. Low saturation is allowed (TradingView's
// fills are 20% colour over white), greys and black are not.
function cls(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (mx < 40 || d / mx < 0.06 || d < 10) return null;
  let h;
  if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h >= 70 && h <= 200) return "g";
  if (h >= 300 || h <= 25) return "r";
  return null;
}

// longest vertical run of one class in a column, short gaps (lines, digits drawn over the box) bridged
function runs(colCls, H, c, gap) {
  let best = null, cur = null;
  for (let y = 0; y < H; y++) {
    if (colCls[y] !== c) continue;
    if (cur && y - cur.end <= gap + 1) cur.end = y; else cur = { start: y, end: y };
    if (!best || cur.end - cur.start > best.end - best.start) best = { ...cur };
  }
  return best;
}

export function findPosition(img) {
  const { data, W, H } = img;
  const gap = 3, minG = Math.max(8, Math.round(H * 0.03)), minR = Math.max(4, Math.round(H * 0.012)), touch = Math.max(6, Math.round(H * 0.03)); // 10 Nov: the entry-zone band between the boxes can be 8+ px on a small copy
  const cols = [];
  const colCls = new Array(H);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) { const i = (y * W + x) * 3; colCls[y] = cls(data[i], data[i + 1], data[i + 2]); }
    const g = runs(colCls, H, "g", gap), r = runs(colCls, H, "r", gap);
    if (!g || !r || g.end - g.start + 1 < minG || r.end - r.start + 1 < minR) { cols[x] = null; continue; }
    if (Math.abs(g.end - r.start) <= touch) cols[x] = { side: "LONG", g, r };
    else if (Math.abs(r.end - g.start) <= touch) cols[x] = { side: "SHORT", g, r };
    else cols[x] = null;
  }
  const groups = [];
  for (let x = 0; x < W; x++) {
    if (!cols[x]) continue;
    const last = groups[groups.length - 1];
    if (last && last.side === cols[x].side && x - last.x1 <= 3) { last.x1 = x; last.cols.push(cols[x]); }
    else groups.push({ side: cols[x].side, x0: x, x1: x, cols: [cols[x]] });
  }
  const best = groups.sort((a, b) => b.cols.length - a.cols.length)[0];
  if (!best || best.cols.length < Math.max(12, W * 0.05)) return null;
  const c = best.cols;
  const gTop = median(c.map((k) => k.g.start)), gBot = median(c.map((k) => k.g.end));
  const rTop = median(c.map((k) => k.r.start)), rBot = median(c.map((k) => k.r.end));
  if (best.side === "LONG") return { side: "LONG", x0: best.x0, x1: best.x1, tpY: gTop, entryY: (gBot + rTop) / 2, slY: rBot };
  return { side: "SHORT", x0: best.x0, x1: best.x1, slY: rTop, entryY: (rBot + gTop) / 2, tpY: gBot };
}

// the numbers on the price axis: rows of ink in the strip right of the box, each read as one line of digits
async function axisNumbers(img, xa) {
  const { data, W, H } = img;
  const lum = (x, y) => { const i = (y * W + x) * 3; return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; };
  const ink = [], rowMed = [];
  for (let y = 0; y < H; y++) {
    const row = [];
    for (let x = xa; x < W; x++) row.push(lum(x, y));
    const m = (rowMed[y] = median(row));
    let n = 0;
    for (const v of row) if (Math.abs(v - m) > 60) n++;
    ink[y] = n >= 2 && n < row.length * 0.85;
  }
  const segs = [];
  for (let y = 0; y < H; y++) {
    if (!ink[y]) continue;
    const last = segs[segs.length - 1];
    if (last && y - last.y1 <= 1) last.y1 = y; else segs.push({ y0: y, y1: y });
  }
  const w = await ocrWorker();
  const out = [];
  const gapX = Math.max(6, Math.round(W * 0.012));
  for (const s of segs) {
    const h = s.y1 - s.y0 + 1;
    if (h < 4 || h > 40) continue;
    const top = Math.max(0, s.y0 - 1), bottom = Math.min(H - 1, s.y1 + 1), bh = bottom - top + 1;
    // only the rightmost piece of text on this line is the axis number (a panel or a label can sit to its left)
    const colInk = [];
    for (let x = xa; x < W; x++) {
      let n = 0;
      for (let y = s.y0; y <= s.y1; y++) if (Math.abs(lum(x, y) - rowMed[y]) > 60) n++;
      colInk.push(n > 0);
    }
    let cl = null, cur = null;
    for (let i = 0; i < colInk.length; i++) {
      if (!colInk[i]) continue;
      if (cur && i - cur.b <= gapX) cur.b = i; else { cur = { a: i, b: i }; }
      cl = cur;
    }
    if (!cl || cl.b - cl.a < 5) continue;
    const x0 = Math.max(xa, xa + cl.a - 2), x1 = Math.min(W - 1, xa + cl.b + 2), bw = x1 - x0 + 1;
    const rs = [], gs = [], bs = [];
    for (let y = top; y <= bottom; y++) for (let x = x0; x <= x1; x++) { const i = (y * W + x) * 3; rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]); }
    const bg = [median(rs), median(gs), median(bs)];
    const votes = new Map();
    // tiny axis digits (6-7 px on Telegram's small copies) break apart when made black and white: the crop stays
    // grey (dark = far from the label's background), enlarged 8x; three contrasts, the readings vote
    for (const thr of [1, 2, 3.5]) {
      const buf = Buffer.alloc(bw * bh);
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const i = ((top + y) * W + x0 + x) * 3;
        const d = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
        buf[y * bw + x] = 255 - Math.min(255, Math.round(d * thr));
      }
      const png = await sharp(buf, { raw: { width: bw, height: bh, channels: 1 } })
        .resize({ height: Math.max(80, bh * 8), kernel: "lanczos3" })
        .extend({ top: 20, bottom: 20, left: 20, right: 20, background: "#ffffff" }).png().toBuffer();
      const raw = (await w.recognize(png)).data.text || "";
      if (process.env.BOX_DEBUG) { fs.mkdirSync("/root/txc/dbg", { recursive: true }); fs.writeFileSync(`/root/txc/dbg/${process.env.BOX_DEBUG}_${s.y0}_${thr}.png`, png); console.error("row", s.y0, "x", x0, x1, "thr", thr, JSON.stringify(raw.trim())); }
      const v = parseAxisNumber(raw);
      if (v !== null) votes.set(v, (votes.get(v) || 0) + 1);
    }
    const best = [...votes].sort((a, b) => b[1] - a[1] || String(b[0]).length - String(a[0]).length)[0];
    if (best) out.push({ y: (s.y0 + s.y1) / 2, v: best[0], votes: best[1], cands: [...votes.keys()] });
  }
  return out;
}

// price = a + b*y (or exp(a + b*y) on a log axis), from the readings that agree: every pair proposes a line, the one
// most readings fit within 3 px wins, then a least-squares fit on those
function fitAxis(pts, H) {
  let best = null;
  for (const log of [false, true]) {
    const P = pts.flatMap((p) => p.cands.map((v) => ({ y: p.y, v: log ? Math.log(v) : v, raw: v })));
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      if (Math.abs(P[i].y - P[j].y) < 8) continue;
      const b = (P[j].v - P[i].v) / (P[j].y - P[i].y);
      if (!(b < 0)) continue; // higher on the picture = higher price
      const a = P[i].v - b * P[i].y, tol = Math.abs(b) * 3;
      const inl = [];
      const seenY = new Set();
      for (const p of P) if (Math.abs(a + b * p.y - p.v) <= tol && !seenY.has(p.y)) { inl.push(p); seenY.add(p.y); }
      if (inl.length < 3) continue;
      if (!best || inl.length > best.inl.length || (inl.length === best.inl.length && !log && best.log)) best = { inl, log };
    }
  }
  if (!best) return null;
  const n = best.inl.length, my = best.inl.reduce((s, p) => s + p.y, 0) / n, mv = best.inl.reduce((s, p) => s + p.v, 0) / n;
  let sxy = 0, sxx = 0;
  for (const p of best.inl) { sxy += (p.y - my) * (p.v - mv); sxx += (p.y - my) ** 2; }
  const b = sxy / sxx, a = mv - b * my;
  const price = (y) => (best.log ? Math.exp(a + b * y) : a + b * y);
  // the span covered by readings: an edge far outside it is an extrapolation
  const ys = best.inl.map((p) => p.y);
  return { price, log: best.log, points: n, yMin: Math.min(...ys), yMax: Math.max(...ys), perPx: Math.abs(price(H / 2 + 1) - price(H / 2)), used: best.inl.map((p) => ({ y: p.y, v: p.raw })) };
}

// "81,200.0", "81.200.0", "0.002400", "1,234" -> a number; two separators that are not thousands -> null
export function parseAxisNumber(raw) {
  const m = /\d[\d.,]*/.exec(String(raw).replace(/\s/g, ""));
  if (!m) return null;
  let t = m[0].replace(/[.,]+$/, "");
  if (/^\d{1,3}(?:[.,]\d{3})+[.,]\d{1,2}$/.test(t)) {
    const k = t.search(/[.,]\d{1,2}$/);
    t = t.slice(0, k).replace(/[.,]/g, "") + "." + t.slice(k + 1);
  } else if (/^\d{1,3}(?:,\d{3})+$/.test(t)) t = t.replace(/,/g, "");
  else if ((t.match(/[.,]/g) || []).length > 1) return null;
  else t = t.replace(",", ".");
  const v = parseFloat(t);
  return v > 0 && isFinite(v) ? v : null;
}
const decimals = (v) => { const s = String(v); return s.includes(".") ? s.split(".")[1].length : 0; };

export async function readPositionBoxes(buf) {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const img = { data, W: info.width, H: info.height };
  const pos = findPosition(img);
  if (!pos) return { error: "no position tool (green + red box) on the chart" };
  const pts = await axisNumbers(img, Math.min(img.W - 20, pos.x1 + 3));
  const fit = fitAxis(pts, img.H);
  if (!fit) return { error: `position tool found, but the price axis is not readable (${pts.length} numbers)`, pos, pts: pts.map((p) => [Math.round(p.y), p.cands]) };
  const span = fit.yMax - fit.yMin;
  for (const y of [pos.tpY, pos.entryY, pos.slY]) {
    if (y < fit.yMin - span * 0.5 || y > fit.yMax + span * 0.5) return { error: "position tool lies outside the readable price axis", pos };
  }
  // an axis label printed on the edge itself (phone charts): its exact number
  const dp = Math.max(...fit.used.map((p) => decimals(p.v)));
  // the tick step (the most common gap between neighbouring readings on the line): a label that is a multiple of it
  // is a grid tick, not a level printed on the edge
  const vs = [...new Set(fit.used.map((p) => p.v))].sort((a, b) => a - b);
  const gaps = new Map();
  for (let i = 1; i < vs.length; i++) { const g = Number((vs[i] - vs[i - 1]).toPrecision(3)); gaps.set(g, (gaps.get(g) || 0) + 1); }
  const step = [...gaps].sort((a, b) => b[1] - a[1])[0]?.[0] || 0;
  const isTick = (v) => step > 0 && Math.abs(v / step - Math.round(v / step)) < 0.02;
  const at = (y) => {
    const est = fit.price(y);
    const lab = pts.flatMap((p) => p.cands.map((v) => ({ y: p.y, v }))).find((p) => Math.abs(p.y - y) <= 5 && Math.abs(p.v / est - 1) <= 0.01 && !isTick(p.v));
    return lab ? { v: lab.v, exact: true } : { v: Number(est.toFixed(Math.min(10, Math.max(dp, Math.ceil(-Math.log10(fit.perPx)) + 1)))), exact: false };
  };
  const tp = at(pos.tpY), entry = at(pos.entryY), sl = at(pos.slY);
  const ok = pos.side === "LONG" ? tp.v > entry.v && entry.v > sl.v : tp.v < entry.v && entry.v < sl.v;
  if (!ok) return { error: `levels out of order (tp ${tp.v}, entry ${entry.v}, sl ${sl.v})`, pos };
  return { side: pos.side, entry: entry.v, sl: sl.v, tp: tp.v, exact: { entry: entry.exact, sl: sl.exact, tp: tp.exact }, edges: pos, fit: { points: fit.points, log: fit.log, perPx: fit.perPx } };
}

export async function closeBoxReader() { if (worker) { await worker.terminate(); worker = null; } }
