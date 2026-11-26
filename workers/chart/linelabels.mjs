// Price labels on a chart's axis (4 Nov, TradeX): the coloured boxes TradingView draws at the end of each
// horizontal line ("95,000.0" green, "69,000.0" red, "0.0460" yellow ...), on the right axis or the left one.
// Any colour; each box's number is read with OCR and its colour kept. The caller decides with the live price:
// boxes above it are targets, the red box under it is the stop (the vexegemhouse rule).
//   readLineLabels(buffer) -> { labels: [{ y, v, color, tall }], dropped } | { error }
import sharp from "sharp";
import Tesseract from "tesseract.js";

let worker = null;
async function ocrWorker() {
  if (worker) return worker;
  worker = await Tesseract.createWorker("eng", 1, { cachePath: new URL(".", import.meta.url).pathname, logger: () => {}, errorHandler: () => {} });
  await worker.setParameters({ tessedit_char_whitelist: "0123456789.,", tessedit_pageseg_mode: "7" });
  return worker;
}

// colour class of a saturated pixel, or null (greys, black, white)
function colorOf(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx < 90 || (mx - mn) / mx < 0.42) return null;
  let h;
  const d = mx - mn;
  if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 18 || h >= 330) return "red";
  if (h < 70) return "yellow";
  if (h < 170) return "green";
  if (h < 200) return "teal";
  if (h < 255) return "blue";
  return "purple";
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// the box's digits: pixels far from the box's own colour are ink (white-on-green and black-on-yellow alike)
async function readBox(img, box) {
  const { data, W } = img;
  const w = await ocrWorker();
  const left = box.x0 + 2, right = box.x1 - 1, top = box.y0 + 1, bottom = box.y1 - 1;
  const bw = right - left + 1, bh = bottom - top + 1;
  if (bw < 12 || bh < 6) return null;
  const rs = [], gs = [], bs = [];
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) { const i = (y * W + x) * 3; rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]); }
  const bg = [median(rs), median(gs), median(bs)];
  const votes = new Map();
  for (const thr of [50, 80, 110, 150]) {
    const out = Buffer.alloc(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = ((top + y) * W + left + x) * 3;
      const d = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
      out[y * bw + x] = d > thr ? 0 : 255;
    }
    const png = await sharp(out, { raw: { width: bw, height: bh, channels: 1 } })
      .resize({ height: Math.max(54, bh * 3), kernel: "lanczos3" }).threshold(128)
      .extend({ top: 12, bottom: 12, left: 12, right: 12, background: "#ffffff" }).png().toBuffer();
    const t = ((await w.recognize(png)).data.text || "").replace(/\s/g, "").replace(/,(?=\d{3}(\D|$))/g, "").replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(t)) continue;
    const v = parseFloat(t);
    if (v > 0) votes.set(v, (votes.get(v) || 0) + 1);
  }
  // every reading is kept: the caller picks the one that fits the live price ("69" vs "69000")
  const cands = [...votes].map(([v, n]) => ({ v, votes: n })).sort((a, b) => b.votes - a.votes || String(b.v).length - String(a.v).length);
  return cands.length ? { v: cands[0].v, votes: cands[0].votes, cands } : null;
}

// the boxes along one axis strip [xa, xb)
function findBoxes(img, xa, xb, runFrac = 0.045) {
  const { data, W, H } = img;
  const minRun = Math.max(runFrac < 0.045 ? 14 : 24, Math.round(W * runFrac)), gapMax = Math.max(6, Math.round(W * 0.015));
  const rows = [];
  for (let y = 0; y < H; y++) {
    let best = null, cur = null;
    for (let x = xa; x < xb; x++) {
      const i = (y * W + x) * 3;
      const c = colorOf(data[i], data[i + 1], data[i + 2]);
      if (!c) continue;
      // the digits inside a box break its colour for a few pixels: a short gap is still the box
      if (cur && cur.c === c && x - cur.end <= gapMax) cur.end = x; else cur = { c, start: x, end: x };
      if (!best || cur.end - cur.start > best.end - best.start) best = { ...cur };
    }
    rows[y] = best && best.end - best.start >= minRun ? best : null;
  }
  const groups = [];
  for (let y = 0; y < H; y++) {
    const r = rows[y];
    if (!r) continue;
    const last = groups[groups.length - 1];
    if (last && last.c === r.c && y - last.y1 <= 2) { last.y1 = y; last.rows.push(r); }
    else groups.push({ c: r.c, y0: y, y1: y, rows: [r] });
  }
  // the line runs through the box's middle and on across the chart: the box's sides come from its rows' medians
  return groups.map((g) => ({ c: g.c, y0: g.y0, y1: g.y1, x0: median(g.rows.map((r) => r.start)), x1: median(g.rows.map((r) => r.end)) }));
}

// opts.runFrac: the shortest coloured run that is a label, as a share of the width (27 Nov: axisfit.mjs asks 0.022, the
// narrow labels of small phone / preview pictures; the default stays for the old caller)
export async function readLineLabels(buf, opts = {}) {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, img = { data, W, H };
  const minH = Math.max(9, Math.round(H * 0.009));
  const strips = opts.fromX ? [[Math.max(0, Math.floor(opts.fromX)), W]] : [[Math.floor(W * 0.6), W], [0, Math.ceil(W * 0.4)]];
  let best = null;
  for (const [xa, xb] of strips) {
    // opts.minRight: only boxes reaching that far right (labels sit on the axis), and at most opts.maxBoxes of them --
    // filtered before any OCR (27 Nov: an enlarged small picture gave hundreds of candle-sized boxes, 15+ minutes)
    const boxes = findBoxes(img, xa, xb, opts.runFrac).filter((b) => b.y1 - b.y0 + 1 >= minH && b.y1 - b.y0 < H * 0.08 && b.x1 - b.x0 >= 24 && (!opts.minRight || b.x1 >= W * opts.minRight)).slice(0, opts.maxBoxes || Infinity);
    if (!boxes.length) continue;
    const labels = [];
    const hMed = median(boxes.map((b) => b.y1 - b.y0 + 1));
    for (const b of boxes) {
      // a box about twice the others' height is the live price with its countdown under it: only its top half
      // carries the number (measured against the other boxes: phone screenshots have big labels everywhere)
      const tall = boxes.length > 1 && b.y1 - b.y0 + 1 > hMed * 1.6;
      const r = await readBox(img, tall ? { ...b, y1: b.y0 + Math.round((b.y1 - b.y0) / 2) } : b);
      // 27 Nov: a box whose digits did not read is kept too (v null, no cands): axisfit.mjs reads it again
      labels.push({ y: Math.round((b.y0 + b.y1) / 2), v: r?.v ?? null, votes: r?.votes ?? 0, cands: r?.cands ?? [], color: b.c, tall, box: { x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1 } });
    }
    labels.sort((a, b) => a.y - b.y);
    if (!best || labels.filter((l) => l.v).length > best.labels.filter((l) => l.v).length) best = { labels, boxes: boxes.length, strip: xa ? "right" : "left" };
  }
  if (!best || !best.labels.some((l) => l.v)) return { error: "no readable price labels on the chart's axis", ...(best || {}) };
  return best;
}

// targets / stop from the labels and the live price (LONG only, like the spot trades): entry = the market.
// A misread (a digit lost or added) is far from the price: only labels within 20x of it count, and of those the
// longest top-to-bottom run where a higher label is a higher price (linear or log scale).
export function levelsFromLabels(labels, px) {
  // each label: its best-voted reading that lies within 20x of the price (a lost or extra digit is far off)
  // first a reading within 2.5x of the price, only then one within 20x (pump charts): "8459" for 80,459.71 loses
  const close = (v) => v > px / 2.5 && v < px * 2.5, ok = (v) => v > px / 20 && v < px * 20;
  const near = labels.filter((l) => !l.tall).map((l) => {
    const cs = l.cands || [{ v: l.v }];
    const c = cs.find((x) => close(x.v)) || cs.find((x) => ok(x.v));
    return c ? { ...l, v: c.v } : null;
  }).filter(Boolean);
  const n = near.length, len = Array(n).fill(1), prev = Array(n).fill(-1);
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) if (near[j].v > near[i].v && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
  let end = n ? len.indexOf(Math.max(...len)) : -1;
  const keep = [];
  while (end >= 0) { keep.unshift(near[end]); end = prev[end]; }
  const tps = keep.filter((l) => l.v > px * 1.003 && l.color !== "red").map((l) => l.v).sort((a, b) => a - b);
  const reds = keep.filter((l) => l.color === "red" && l.v < px * 0.997).map((l) => l.v).sort((a, b) => b - a);
  return { tps, sl: reds[0] ?? null, used: keep.length };
}

export async function closeLineLabels() { if (worker) { await worker.terminate(); worker = null; } }
