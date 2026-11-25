// Reads a TradingView "Long/Short Position" chart as @K_cryptoMemes posts it (26 Oct): on the price axis the tool
// shows three filled labels -- purple = take profit, grey = entry, blue = stop loss (the red/green one is the live
// price with its countdown and is ignored). Numbers use a decimal comma ("0,004108").
//   readPosition(buffer) -> { side, entry, sl, tp, boxes, ratioErrPct } | { error }
// Safety: the three must be in order (long: tp > entry > sl; short: the reverse), and the label positions must be in
// the same proportion as the prices (a misread digit or a label pinned at the chart edge breaks it) -> error.
import sharp from "sharp";
import Tesseract from "tesseract.js";

const CLASSES = {
  tp: (r, g, b) => r >= 115 && r <= 200 && g <= 85 && b >= 135 && b <= 215 && b > r,
  entry: (r, g, b) => r >= 100 && r <= 155 && Math.abs(r - g) <= 12 && Math.abs(g - b) <= 12,
  sl: (r, g, b) => b >= 190 && r <= 95 && g >= 65 && g <= 140,
};

let worker = null;
async function ocrWorker() {
  if (worker) return worker;
  worker = await Tesseract.createWorker("eng", 1, { cachePath: new URL(".", import.meta.url).pathname, logger: () => {}, errorHandler: () => {} });
  await worker.setParameters({ tessedit_char_whitelist: "0123456789,.", tessedit_pageseg_mode: "7" });
  return worker;
}

// Filled label boxes of each class in the right-hand price-axis strip.
function findBoxes(data, W, H) {
  const x0 = Math.floor(W * 0.86);
  const minRun = Math.max(18, Math.round((W - x0) * 0.22));
  const boxes = [];
  for (const [name, is] of Object.entries(CLASSES)) {
    let cur = null;
    for (let y = 0; y < H; y++) {
      let n = 0, xl = W, xr = 0;
      for (let x = x0; x < W; x++) {
        const i = (y * W + x) * 3;
        if (is(data[i], data[i + 1], data[i + 2])) { n++; if (x < xl) xl = x; if (x > xr) xr = x; }
      }
      if (n >= minRun) {
        if (cur && y - cur.bottom <= 2) { cur.bottom = y; cur.left = Math.min(cur.left, xl); cur.right = Math.max(cur.right, xr); }
        else { if (cur) boxes.push(cur); cur = { name, top: y, bottom: y, left: xl, right: xr }; }
      }
    }
    if (cur) boxes.push(cur);
  }
  return boxes.filter((b) => b.bottom - b.top >= 8 && b.right - b.left >= 30).map((b) => ({ ...b, y: (b.top + b.bottom) / 2 }));
}

// Several readings of one label (2 scales x 4 thresholds set from the label's own fill); the value most readings
// agree on wins, and only with at least 3 votes and more than any other value.
async function readBox(img, data, W, b, height) {
  const w = await ocrWorker();
  let sum = 0, n = 0; // the fill's grey level
  for (let y = b.top; y <= b.bottom; y++) for (let x = b.left; x <= b.left + 3; x++) { const i = (y * W + x) * 3; sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; n++; }
  const bg = n ? sum / n : 100;
  const imgH = data.length / 3 / W;
  const clampTop = (t) => Math.max(0, Math.min(imgH - height, Math.round(t)));
  // a label touching a zone edge is detected shorter than it is: read it from every position that contains the rows
  const tops = [...new Set([clampTop(b.top), clampTop(b.y - height / 2), clampTop(b.bottom - height + 1)])];
  const left = b.left + 2, width = b.right - b.left - 4;
  const votes = new Map();
  for (const top of tops) for (const scale of [4, 6]) for (const fr of [0.2, 0.25, 0.32, 0.4]) {
    const th = Math.round(bg + (255 - bg) * fr);
    const png = await sharp(img).extract({ left, top, width, height }).grayscale().resize({ width: width * scale, kernel: "lanczos3" })
      .threshold(th).negate().extend({ top: 12, bottom: 12, left: 12, right: 12, background: "#ffffff" }).png().toBuffer();
    const { data: d } = await w.recognize(png);
    let t = (d.text || "").replace(/\s+/g, "").replace(/[^0-9,.]/g, "");
    if ((t.match(/[,.]/g) || []).length !== 1) continue; // one decimal mark, no thousands grouping on these charts
    t = t.replace(",", ".");
    if (!/^\d+\.\d+$/.test(t)) continue;
    const v = parseFloat(t);
    if (v > 0) votes.set(v, (votes.get(v) || 0) + 1);
  }
  const ranked = [...votes].sort((a, c) => c[1] - a[1]);
  if (!ranked.length || ranked[0][1] < 3 || (ranked[1] && ranked[1][1] >= ranked[0][1])) return null;
  return { v: ranked[0][0], votes: ranked[0][1], readings: Object.fromEntries(ranked) };
}

export async function readPosition(buf) {
  const img = await sharp(buf).removeAlpha().toBuffer();
  const { data, info } = await sharp(img).raw().toBuffer({ resolveWithObject: true });
  const boxes = findBoxes(data, info.width, info.height);
  const pick = (name) => boxes.filter((b) => b.name === name);
  const [tpB, enB, slB] = ["tp", "entry", "sl"].map(pick);
  if (tpB.length !== 1 || enB.length !== 1 || slB.length !== 1) {
    return { error: `no position tool (labels found: tp ${tpB.length}, entry ${enB.length}, sl ${slB.length})` };
  }
  // the labels are all one height; the grey one is detected shorter (its fill is close to the text), so use the tallest
  const height = Math.max(...[tpB[0], enB[0], slB[0]].map((b) => b.bottom - b.top + 1));
  const tp = await readBox(img, data, info.width, tpB[0], height);
  const entry = await readBox(img, data, info.width, enB[0], height);
  const sl = await readBox(img, data, info.width, slB[0], height);
  if (!tp || !entry || !sl) {
    const bx = (b) => `${b.top}-${b.bottom}`;
    return { error: `label not readable (tp ${tp?.v ?? "?"}, entry ${entry?.v ?? "?"}, sl ${sl?.v ?? "?"}; rows tp ${bx(tpB[0])} entry ${bx(enB[0])} sl ${bx(slB[0])}, height ${height})` };
  }
  const long = tpB[0].y < enB[0].y;
  const side = long ? "LONG" : "SHORT";
  const ordered = long ? tp.v > entry.v && entry.v > sl.v && tpB[0].y < enB[0].y && enB[0].y < slB[0].y
                       : tp.v < entry.v && entry.v < sl.v && tpB[0].y > enB[0].y && enB[0].y > slB[0].y;
  if (!ordered) return { error: `levels out of order (${side}: tp ${tp.v}, entry ${entry.v}, sl ${sl.v})` };
  // label positions vs prices: (y_entry - y_tp) / (y_sl - y_entry) must match (tp - entry) / (entry - sl)
  const pixRatio = Math.abs(enB[0].y - tpB[0].y) / Math.abs(slB[0].y - enB[0].y);
  const pxRatio = Math.abs(tp.v - entry.v) / Math.abs(entry.v - sl.v);
  const ratioErrPct = (Math.abs(pixRatio - pxRatio) / pxRatio) * 100;
  if (!(ratioErrPct <= Number(process.env.POSREAD_MAX_RATIO_ERR_PCT || 15))) {
    return { error: `label positions do not match the prices (off by ${ratioErrPct.toFixed(1)}%: a misread or a label pinned at the edge)` };
  }
  return { side, entry: entry.v, sl: sl.v, tp: tp.v, ratioErrPct: +ratioErrPct.toFixed(2), votes: { tp: tp.votes, entry: entry.votes, sl: sl.votes }, boxes: { tp: tpB[0], entry: enB[0], sl: slB[0] } };
}

export async function closeReader() { if (worker) { await worker.terminate(); worker = null; } }
