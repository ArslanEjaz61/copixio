// Exact levels from a chart's price axis (27 Nov). The coloured labels TradingView prints at the end of each line
// (green take profit, blue entry, red stop ...) carry the exact price, but small labels OCR badly: "0.12003" comes
// back as "0.32003", "0.010707" as "10707", "0.10818" as "8.10818". The axis itself settles it: on a price axis the
// height of a number is a straight line in its price (or in its log, for a log chart). So:
//   1. the axis column is cut into its text lines (grey ticks and coloured labels alike), each line enlarged on its
//      own and read as one line -- far better than reading the whole strip at once;
//   2. the straight line that the most numbers sit on is found (RANSAC: two numbers define a line, the others vote);
//   3. each coloured label keeps the reading -- among everything OCR saw in it, with a misplaced decimal point or one
//      or two stray leading characters put right -- that lies on that line within a few pixels.
// A label with no reading on the line is dropped: a level is only ever a number printed on the chart, never a guess.
//   readAxisLevels(buffer) -> { labels: [{ y, color, v, expected, tall }], model, bands } | { error }
import sharp from "sharp";
import Tesseract from "tesseract.js";
import { readLineLabels } from "./linelabels.mjs";
import { findPosition } from "./boxread.mjs";

let worker = null;
async function ocrWorker() {
  if (worker) return worker;
  worker = await Tesseract.createWorker("eng", 1, { cachePath: new URL(".", import.meta.url).pathname, logger: () => {}, errorHandler: () => {} });
  await worker.setParameters({ tessedit_char_whitelist: "0123456789.,", tessedit_pageseg_mode: "7" });
  return worker;
}

const clean = (t) => String(t || "").replace(/\s/g, "").replace(/,(?=\d{3}(\D|$))/g, "").replace(",", ".");
const num = (t) => (/^\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

// Every value a garbled reading could stand for: the digits with the decimal point anywhere, after dropping up to two
// leading characters (the "0." OCR turns into "8" or "3"). Only used against a fitted line, so extra values are harmless.
export function expand(raw) {
  const out = new Set();
  const t = clean(raw);
  const v0 = num(t);
  if (v0) out.add(v0);
  const digits = t.replace(/\D/g, "");
  for (let drop = 0; drop <= 2 && digits.length - drop >= 3; drop++) {
    const d = digits.slice(drop);
    for (let p = 1; p <= d.length; p++) {
      const v = Number(p === d.length ? d : `${d.slice(0, p)}.${d.slice(p)}`);
      if (v > 0) out.add(v);
    }
    if (d[0] !== "0") for (const z of ["0.", "0.0", "0.00", "0.000"]) out.add(Number(z + d));
  }
  return [...out];
}

// colour class of a saturated pixel, or null (greys, black, white)
function colorOf(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx < 90 || (mx - mn) / mx < 0.42) return null;
  const d = mx - mn;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 18 || h >= 330) return "red";
  if (h < 70) return "yellow";
  if (h < 170) return "green";
  if (h < 200) return "teal";
  if (h < 255) return "blue";
  return "purple";
}

// The axis column's text lines: rows whose pixels spread wide in brightness (ink on a background) grouped into bands.
function bandsOf(gray, rgb, W, H, xa) {
  const sw = W - xa, ink = [];
  for (let y = 0; y < H; y++) {
    let lo = 255, hi = 0;
    for (let x = xa; x < W; x++) { const g = gray[y * W + x]; if (g < lo) lo = g; if (g > hi) hi = g; }
    // a text row: strong contrast, and more than a thin grid line's worth of dark-vs-light changes
    let flips = 0, prev = null;
    const mid = (lo + hi) / 2;
    for (let x = xa; x < W; x++) { const s = gray[y * W + x] > mid; if (prev !== null && s !== prev) flips++; prev = s; }
    ink[y] = hi - lo >= 70 && flips >= 4;
  }
  const bands = [];
  for (let y = 0; y < H; y++) {
    if (!ink[y]) continue;
    const last = bands[bands.length - 1];
    if (last && y - last.y1 <= 1) last.y1 = y; else bands.push({ y0: y, y1: y });
  }
  const out = [];
  for (const b of bands) {
    const h = b.y1 - b.y0 + 1;
    if (h < 4 || h > H * 0.08) continue;
    // colour: the commonest saturated class in the band, when it covers a good part of it
    const cnt = {};
    let n = 0;
    for (let y = b.y0; y <= b.y1; y++) for (let x = xa; x < W; x++) { const i = (y * W + x) * 3; const c = colorOf(rgb[i], rgb[i + 1], rgb[i + 2]); n++; if (c) cnt[c] = (cnt[c] || 0) + 1; }
    const top = Object.entries(cnt).sort((a, c) => c[1] - a[1])[0];
    out.push({ y0: b.y0, y1: b.y1, y: (b.y0 + b.y1) / 2, h, color: top && top[1] / n >= 0.18 ? top[0] : null });
  }
  return out;
}

// one rectangle read as one line of text, at a few thresholds; every reading kept
async function readRect(gray, W, H, x0, x1, y0, y1) {
  const w = await ocrWorker();
  const left = Math.max(0, x0), right = Math.min(W - 1, x1);
  const top = Math.max(0, y0), bottom = Math.min(H - 1, y1), bh = bottom - top + 1, bw = right - left + 1;
  if (bw < 8 || bh < 4) return [];
  const px = Buffer.alloc(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) px[y * bw + x] = gray[(top + y) * W + left + x];
  const vals = [...px], lo = Math.min(...vals), hi = Math.max(...vals), med = median(vals);
  const darkInk = med > (lo + hi) / 2; // light background (grey ticks, light labels) -> the ink is the dark part
  const raws = [];
  for (const f of [0.35, 0.5, 0.65]) {
    const thr = lo + (hi - lo) * f;
    const bin = Buffer.alloc(px.length);
    for (let i = 0; i < px.length; i++) bin[i] = (darkInk ? px[i] < thr : px[i] > thr) ? 0 : 255;
    const k = Math.max(2, 48 / bh);
    const png = await sharp(bin, { raw: { width: bw, height: bh, channels: 1 } })
      .resize({ width: Math.round(bw * k), height: Math.round(bh * k), kernel: "lanczos3" }).threshold(128)
      .extend({ top: 16, bottom: 16, left: 16, right: 16, background: "#ffffff" }).png().toBuffer();
    const tr = Date.now();
    const t = clean((await w.recognize(png)).data.text);
    if (process.env.AXIS_DEBUG) console.error(`[axis] recognize ${bw}x${bh} k${k.toFixed(1)} -> ${Date.now() - tr}ms "${t}"`);
    if (/\d{2}/.test(t)) raws.push(t);
  }
  return raws;
}

// the straight line (or log line) through the most axis numbers. price = a + b*y; b < 0 (higher up = higher price)
function fit(points, pxTol) {
  let best = null;
  for (const kind of ["lin", "log"]) {
    const f = kind === "log" ? Math.log : (v) => v;
    const P = points.filter((p) => p.v > 0).map((p) => ({ ...p, u: f(p.v) }));
    let bk = null;
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      const dy = P[j].y - P[i].y;
      if (Math.abs(dy) < 12) continue;
      const b = (P[j].u - P[i].u) / dy;
      if (!(b < 0)) continue;
      const a = P[i].u - b * P[i].y, tol = Math.abs(b) * pxTol;
      const inl = P.filter((p) => Math.abs(a + b * p.y - p.u) <= tol);
      const n = new Set(inl.map((p) => p.band)).size; // one vote per text line
      if (n >= 3 && (!bk || n > bk.n)) bk = { kind, a, b, n, inl };
    }
    if (!bk) continue;
    const I = bk.inl, my = I.reduce((s, p) => s + p.y, 0) / I.length, mu = I.reduce((s, p) => s + p.u, 0) / I.length;
    const sxy = I.reduce((s, p) => s + (p.y - my) * (p.u - mu), 0), sxx = I.reduce((s, p) => s + (p.y - my) ** 2, 0);
    if (sxx > 0 && sxy / sxx < 0) { bk.b = sxy / sxx; bk.a = mu - bk.b * my; }
    bk.f = f;
    bk.at = (y) => (kind === "log" ? Math.exp(bk.a + bk.b * y) : bk.a + bk.b * y);
    if (!best || bk.n > best.n) best = bk; // a tie keeps the linear one (tried first)
  }
  return best;
}

const BUDGET_MS = Number(process.env.AXIS_BUDGET_MS || 45000);
const MAX_BANDS = 45;

export async function readAxisLevels(buf) {
  const t0 = Date.now(), late = () => Date.now() - t0 > BUDGET_MS;
  // small copies (Telegram previews, 680 px wide) are doubled first: labels ~10 px tall are too few pixels to read
  const m = await sharp(buf).metadata();
  if (m.width < 1000) buf = await sharp(buf).resize({ width: m.width * 2, kernel: "lanczos3" }).png().toBuffer();
  const { data: rgb, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const gray = Buffer.alloc(W * H);
  for (let i = 0; i < W * H; i++) gray[i] = Math.round(0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2]);
  // the price axis: the right-hand 13% (TradingView desktop and phone alike)
  const xa = Math.floor(W * 0.87);
  const tb = Date.now();
  const bands = bandsOf(gray, rgb, W, H, xa);
  if (process.env.AXIS_DEBUG) console.error(`[axis] W ${W} H ${H}, bandsOf ${Date.now() - tb}ms, total so far ${Date.now() - t0}ms`);
  if (bands.length < 3) return { error: "no price axis on the right of the chart", bands: bands.length };
  const hMed = median(bands.map((b) => b.h));
  const read = [];
  // grey ticks build the line; coloured bands are left to the label boxes below (a label sitting on a tick merges)
  for (const [i, b] of bands.entries()) {
    if (b.color) continue;
    if (read.length >= MAX_BANDS || late()) break;
    read.push({ ...b, band: i, raws: await readRect(gray, W, H, xa, W - 1, b.y0 - 2, b.y1 + 2) });
  }
  // the line: every plain reading of every band
  const pxTol = Math.max(3, hMed * 0.35);
  const points = read.flatMap((b) => b.raws.map((r) => ({ y: b.y, v: num(r), band: b.band })).filter((p) => p.v));
  // the coloured label boxes (linelabels.mjs finds them by colour) and their own readings
  // only the axis column: wide coloured fills in the chart (the tool itself, volume) are not labels
  const dbg = process.env.AXIS_DEBUG ? (...m) => console.error(`[axis ${Date.now() - t0}ms]`, ...m) : () => {};
  dbg(`bands ${bands.length}, read ${read.length}, points ${points.length}`);
  // the usual label size first; narrower labels (small phone / preview pictures) only when that finds under two
  let ll = await readLineLabels(buf, { maxBoxes: 30 });
  if ((ll.labels || []).filter((l) => l.box && l.box.x0 >= W * 0.5).length < 2) ll = await readLineLabels(buf, { runFrac: 0.022, fromX: W * 0.6, maxBoxes: 30 });
  dbg(`label boxes ${(ll.labels || []).length}`);
  const boxes = (ll.labels || []).filter((l) => l.box && l.box.x0 >= W * 0.5);
  const lab = [];
  for (const [i, l] of boxes.entries()) {
    if (i >= 20 || late()) break;
    const b = l.box, tall = !!l.tall, y1 = tall ? b.y0 + Math.round((b.y1 - b.y0) / 2) : b.y1;
    const raws = [...(l.cands || []).map((c) => String(c.v)), ...(await readRect(gray, W, H, b.x0 + 2, b.x1 - 1, b.y0, y1))];
    lab.push({ y: (b.y0 + y1) / 2, color: l.color, tall, raws, band: 1000 + i });
  }
  // labels count for the line too (one vote each), but only with a plain reading
  for (const l of lab) for (const r of l.raws) { const v = num(r); if (v) points.push({ y: l.y, v, band: l.band }); }
  const model = fit(points, pxTol);
  if (!model) return { error: "price axis not readable (no three numbers on one line)", bands: read.map((b) => [Math.round(b.y), b.raws]), labels: lab.map((l) => [l.color, l.raws]) };
  // The decimal point: a tick read "6300" for 0.06300 puts the whole line 10^k off. Readings that start with "0." are
  // the ones to trust about the decimal point (OCR drops leading zeros, it does not invent them); each plain reading
  // votes for the power of ten that puts it on the line, "0.x" readings three times.
  const votes = new Map();
  for (const b of [...read, ...lab]) for (const r of b.raws) {
    const v = num(r);
    if (!v) continue;
    const k = Math.round(Math.log10(v / model.at(b.y)));
    if (Math.abs(model.f(v / 10 ** k) - model.f(model.at(b.y))) > Math.abs(model.b) * (pxTol + 2)) continue;
    votes.set(k, (votes.get(k) || 0) + (/^0\.\d/.test(r) ? 3 : 1));
  }
  const dec = [...votes].sort((a, c) => c[1] - a[1])[0]?.[0] ?? 0;
  const scale = 10 ** dec, fix = (v) => Number((v * scale).toPrecision(8));
  const labels = [];
  for (const b of lab) {
    const y = b.y;
    const exp = model.at(y), tol = Math.abs(model.b) * (pxTol + 2);
    const seen = new Map();
    for (const r of b.raws) for (const v of expand(r)) {
      if (Math.abs(model.f(v) - model.f(exp)) > tol) continue;
      const k = String(v);
      seen.set(k, { v, n: (seen.get(k)?.n || 0) + 1, len: k.replace(/\D/g, "").length });
    }
    const pick = [...seen.values()].sort((a, c) => c.n - a.n || c.len - a.len)[0];
    labels.push({ y: Math.round(y), color: b.color, v: pick ? fix(pick.v) : null, expected: fix(exp), tall: !!b.tall, raws: b.raws });
  }
  const at = (y) => fix(model.at(y));
  return { labels, at, perPx: Math.abs(at(H / 2 + 1) - at(H / 2)), model: { kind: model.kind, inliers: model.n, pxTol: +pxTol.toFixed(1), dec }, bands: read.length, img: { rgb, W, H }, hMed };
}

// The whole setup. A TradingView Long / Short Position tool on the chart (green box on red, boxread.findPosition):
// TP = the far edge of the green box, entry = the edge they share, SL = the far edge of the red box; each edge takes
// the label printed on it when there is one (exact), else the axis line's price at that height, rounded to the
// axis's precision (off by about one pixel). No tool: the label colours decide (setupFromAxis).
// opts.refPrice (the coin's live price): OCR often loses the "0.0" in front of every number on the axis alike, which
// keeps every digit right and the decimal point wrong (8820 for 0.008820). The levels are moved by the power of ten
// that puts them next to the live price; levels that sit nowhere near it (within 3x) are refused.
//   axisSetup(buffer, { refPrice }) -> { side, entry, sl, tps, exact: { entry, sl, tp }, how } | { reason }
export async function axisSetup(buf, opts = {}) {
  const s = await axisSetupRaw(buf);
  if (s.reason || !(opts.refPrice > 0)) return s;
  const mid = s.entry || (s.sl + s.tps[0]) / 2;
  const k = Math.round(Math.log10(opts.refPrice / mid));
  const m = 10 ** k, sc = (v) => (v == null ? v : Number((v * m).toPrecision(8)));
  const out = { ...s, entry: sc(s.entry), sl: sc(s.sl), tps: s.tps.map(sc), decimalShift: k };
  const bad = gates(out, opts.refPrice);
  return bad ? { reason: bad, read: out } : out;
}

// Real money: a reading that does not look like a real setup is refused (the post is then left to the other readers,
// or skipped). On the test charts these turned every gross misread (a target 800x the entry, an entry 2x the price)
// into "not read" while every exact reading passed.
function gates(s, px) {
  const long = s.side === "LONG", e = s.entry, sl = s.sl, tp = s.tps[0];
  if (e != null) {
    if (Math.abs(e / px - 1) > 0.15) return `chart entry ${e} is ${((e / px - 1) * 100).toFixed(0)}% from the live price ${px}`;
  } else if (!(long ? px > sl && px < tp : px < sl && px > tp)) return `live price ${px} is not between the chart's stop ${sl} and target ${tp}`;
  const ref = e ?? px;
  const risk = Math.abs(ref - sl) / ref, reward = Math.abs(tp - ref) / ref;
  if (risk < 0.003 || risk > 0.5) return `chart stop ${sl} is ${(risk * 100).toFixed(1)}% from the entry ${ref}`;
  if (reward < 0.003 || reward > 3) return `chart target ${tp} is ${(reward * 100).toFixed(1)}% from the entry ${ref}`;
  if (reward / risk < 0.2 || reward / risk > 20) return `chart risk:reward 1:${(reward / risk).toFixed(1)} does not look like a real setup`;
  if ((!s.exact.sl || !s.exact.tp) && (s.inliers || 0) < 5) return "chart levels are estimated from a thinly read price axis";
  return null;
}

async function axisSetupRaw(buf) {
  const r = await readAxisLevels(buf);
  if (r.error) return { reason: r.error };
  const pos = findPosition({ data: r.img.rgb, W: r.img.W, H: r.img.H });
  if (pos) {
    const near = Math.max(6, r.hMed * 0.9);
    const dp = Math.max(0, ...r.labels.filter((l) => l.v).map((l) => (String(l.v).split(".")[1] || "").length), Math.ceil(-Math.log10(r.perPx || 1e-9)) + 1);
    const long = pos.side === "LONG";
    const span = Math.abs(pos.tpY - pos.slY);
    // the label on the edge; else (an edge hidden behind other drawings, a box cut by the chart's border) the nearest
    // label of the level's own colour on its own side of the entry, within a quarter of the tool's height
    const edge = (y, colors, side) => {
      const l = r.labels.filter((x) => x.v && !x.tall && Math.abs(x.y - y) <= near).sort((a, b) => Math.abs(a.y - y) - Math.abs(b.y - y))[0];
      if (l) return { v: l.v, exact: true };
      if (colors) {
        const c = r.labels.filter((x) => x.v && !x.tall && colors.includes(x.color) && Math.abs(x.y - y) <= span / 4 && (side < 0 ? x.y < pos.entryY : x.y > pos.entryY))
          .sort((a, b) => Math.abs(a.y - y) - Math.abs(b.y - y))[0];
        if (c) return { v: c.v, exact: true };
      }
      return { v: Number(r.at(y).toFixed(Math.min(10, dp))), exact: false };
    };
    const tp = edge(pos.tpY, ["green", "teal"], long ? -1 : 1), entry = edge(pos.entryY), sl = edge(pos.slY, ["red"], long ? 1 : -1);
    if (long ? tp.v > entry.v && entry.v > sl.v : tp.v < entry.v && entry.v < sl.v)
      return { side: pos.side, entry: entry.v, sl: sl.v, tps: [tp.v], exact: { entry: entry.exact, sl: sl.exact, tp: tp.exact }, inliers: r.model.inliers, how: "position tool + axis" };
  }
  const s = setupFromAxis(r.labels);
  return s.reason ? s : { ...s, exact: { entry: s.entry != null, sl: true, tp: true }, inliers: r.model.inliers, how: "axis labels" };
}

// Long setup from the labels: blue = entry; green above the entry = targets; red under it = stop.
// Short setup: green under the entry = targets, red above = stop. No blue label: the side is taken from where the
// green and red labels sit, and the entry is left to the market. The live price label (tall) never counts.
export function setupFromAxis(labels) {
  const L = labels.filter((l) => l.v > 0 && !l.tall);
  const greens = L.filter((l) => l.color === "green" || l.color === "teal"), reds = L.filter((l) => l.color === "red");
  const blue = L.find((l) => l.color === "blue");
  if (!greens.length || !reds.length) return { reason: "no green target label and red stop label on the axis" };
  const g0 = greens.reduce((a, b) => (a.y < b.y ? a : b)), r0 = reds.reduce((a, b) => (a.y > b.y ? a : b));
  const long = g0.v > r0.v;
  const entry = blue?.v ?? null;
  const tps = greens.map((l) => l.v).filter((v) => (entry ? (long ? v > entry : v < entry) : true)).sort((a, b) => (long ? a - b : b - a));
  const sls = reds.map((l) => l.v).filter((v) => (entry ? (long ? v < entry : v > entry) : true)).sort((a, b) => (long ? b - a : a - b));
  if (!tps.length || !sls.length) return { reason: "the target / stop labels are on the wrong side of the entry" };
  return { side: long ? "LONG" : "SHORT", entry, sl: sls[0], tps };
}

export async function closeAxisReader() { if (worker) { await worker.terminate(); worker = null; } }
