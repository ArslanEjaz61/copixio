// Reads a @vexegemhouse signal chart (22 Oct):
//   - the teal/cyan horizontal lines carry a cyan label box at the right end with their price;
//   - the light grey band under price: its lowest edge is the SL (no label; priced from the chart's own scale);
//   - the chart scale (price = a + b*y) is fitted on the labelled lines, so a misread label shows up as a bad fit.
//   readChart(buffer) -> { lines: [{ y, v }], sl, slY, scale: { a, b, fitErrPct }, priceLabel } or { error }
// Which lines are targets is decided by the caller against the live price: only lines ABOVE it are TPs.
import sharp from "sharp";
import Tesseract from "tesseract.js";

const isCyan = (r, g, b) => g > 120 && b > 130 && b - r > 40 && g - r > 30; // teal lines and cyan boxes, any brightness
const isBox = (r, g, b) => g > 160 && b > 170 && b - r > 60;                 // the bright cyan label fill
const isLight = (r, g, b) => r > 150 && g > 150 && b > 150 && Math.abs(r - g) < 40 && Math.abs(g - b) < 40;

let worker = null;
async function ocrWorker() {
  if (worker) return worker;
  // the language file is cached next to this module, not in whatever folder the process runs from
  worker = await Tesseract.createWorker("eng", 1, { cachePath: new URL(".", import.meta.url).pathname, logger: () => {}, errorHandler: () => {} });
  await worker.setParameters({ tessedit_char_whitelist: "0123456789.", tessedit_pageseg_mode: "7" });
  return worker;
}
// Several readings of one label (insets x thresholds); every plausible number is a candidate.
async function ocrCandidates(img, box) {
  const out = new Map(); // value -> how many readings agree
  const add = (v, n) => out.set(v, (out.get(v) || 0) + n);
  const w = await ocrWorker();
  for (const inset of [3, 6]) {
    const left = box.left + inset, top = box.top + 2, width = box.width - inset - 2, height = box.height - 4;
    if (width < 10 || height < 8) continue;
    for (const th of [120, 160, 200]) {
      const png = await sharp(img).extract({ left, top, width, height }).grayscale().resize({ width: width * 4, kernel: "lanczos3" }).normalise().threshold(th).png().toBuffer();
      const { data } = await w.recognize(png);
      const t = (data.text || "").replace(/[^0-9.]/g, "");
      if (!/^\d+\.\d+$/.test(t)) continue;
      add(parseFloat(t), 2);
      // a box edge read as a leading "1" ("10.001172"): also try without it
      if (/^1d/.test(t)) add(parseFloat(t.slice(1)), 1); // weaker candidate
    }
  }
  return [...out].filter(([v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([v, votes]) => ({ v, votes }));
}

export async function readChart(buf) {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const px = (x, y) => { const i = (y * W + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
  const plotW = Math.floor(W * 0.78);
  const group = (rows, gap = 2) => { const out = []; for (const y of rows) { const last = out[out.length - 1]; if (last && y - last.y1 <= gap) last.y1 = y; else out.push({ y0: y, y1: y }); } return out; };

  // 1. horizontal lines across the chart part
  const cyanRows = [], lightRows = [];
  for (let y = 0; y < H; y++) {
    let c = 0, l = 0;
    for (let x = 0; x < plotW; x += 2) { const [r, g, b] = px(x, y); if (isCyan(r, g, b)) c++; else if (isLight(r, g, b)) l++; }
    const n = plotW / 2;
    if (c / n > 0.55) cyanRows.push(y);
    if (l / n > 0.6) lightRows.push(y);
  }
  const lineYs = group(cyanRows).map((g) => (g.y0 + g.y1) / 2);
  const bandYs = group(lightRows).map((g) => (g.y0 + g.y1) / 2);

  // 2. label boxes: rows of the right part mostly filled with box cyan, grouped into boxes
  const boxRows = [];
  for (let y = 0; y < H; y++) { let c = 0; for (let x = plotW; x < W; x++) { const [r, g, b] = px(x, y); if (isBox(r, g, b)) c++; } if (c > (W - plotW) * 0.35) boxRows.push(y); }
  const boxes = group(boxRows, 5).filter((g) => g.y1 - g.y0 >= 12).map((g) => {
    const my = Math.round((g.y0 + g.y1) / 2); let x0 = W, x1 = -1;
    for (let x = plotW; x < W; x++) { const [r, gg, b] = px(x, my); if (isBox(r, gg, b)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); } }
    return { y0: g.y0, y1: g.y1, x0, x1 };
  });
  // each line takes the box its row passes through (or the nearest within 14 px); a box two lines tall is a
  // price box (price + countdown) and only its top half is read
  const labelled = [];
  for (const y of lineYs) {
    const bx = boxes.find((b) => y >= b.y0 - 3 && y <= b.y1 + 3) || boxes.filter((b) => Math.abs((b.y0 + b.y1) / 2 - y) <= 14)[0];
    if (!bx || bx.x1 - bx.x0 < 20) continue;
    const tall = bx.y1 - bx.y0 > 34;
    const box = { left: bx.x0, top: bx.y0, width: bx.x1 - bx.x0, height: tall ? Math.round((bx.y1 - bx.y0) / 2) : bx.y1 - bx.y0 };
    const cands = await ocrCandidates(buf, box);
    if (cands.length) labelled.push({ y, cands, tall });
  }
  const usable = labelled.filter((l) => !l.tall); // a price box sitting on a line is the price, not that line's level
  if (usable.length < 2) return { error: "fewer than two readable labelled lines", lineYs, labelled };

  // 3. the reading of each label that makes the best straight scale (higher on the chart = higher price)
  let best = null;
  const pickRec = (i, chosen) => {
    if (i === usable.length) {
      const pts = chosen;
      for (let k = 1; k < pts.length; k++) if (!(pts[k].v < pts[k - 1].v)) return; // lines sorted top-down
      const n = pts.length, sx = pts.reduce((s, p) => s + p.y, 0), sy = pts.reduce((s, p) => s + p.v, 0);
      const sxx = pts.reduce((s, p) => s + p.y * p.y, 0), sxy = pts.reduce((s, p) => s + p.y * p.v, 0);
      const b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n;
      const err = Math.max(...pts.map((p) => Math.abs((a + b * p.y) / p.v - 1) * 100));
      // the straightest scale wins; within 0.3% of each other, the readings that agree most
      const votes = pts.reduce((s, p) => s + p.votes, 0);
      if (!best || err < best.err - 0.3 || (Math.abs(err - best.err) <= 0.3 && votes > best.votes)) best = { a, b, err, votes, pts: pts.map((p) => ({ ...p })) };
      return;
    }
    for (const c of usable[i].cands) pickRec(i + 1, [...chosen, { y: usable[i].y, v: c.v, votes: c.votes }]);
  };
  usable.sort((p, q) => p.y - q.y);
  pickRec(0, []);
  if (!best) return { error: "no consistent reading of the labels", labelled };
  const at = (y) => best.a + best.b * y;
  // lines whose label could not be used (e.g. under the price box) still get a price from the scale
  const lines = lineYs.map((y) => { const p = best.pts.find((q) => q.y === y); return { y, v: p ? p.v : +at(y).toPrecision(6), fromScale: !p }; });

  // 4. SL: the lowest light band edge on the chart
  const slY = bandYs.length ? Math.max(...bandYs) : null;
  const sl = slY !== null ? at(slY) : null;
  return { lines, sl, slY, bandYs, scale: { a: best.a, b: best.b, fitErrPct: best.err, points: best.pts.length } };
}

export async function closeOcr() { if (worker) { await worker.terminate(); worker = null; } }
