// Chart text reader (4 Nov, TradeX): a pasted chart screenshot -> the words printed on it (OCR, free, local),
// then the coin from the chart title ("XRPUSDT.P · 4h · Binance", "AIO / TetherUS PERPETUAL", "Bitcoin / U.S. Dollar")
// and the levels from its labels ("ENTRY 1.2427", "STOP 1.2143", "TP1 1.3001", "SL: 0.02764").
// No coin on the chart -> no trade. Same tesseract.js + English data the vexegemhouse reader uses.
import sharp from "sharp";
import Tesseract from "tesseract.js";

let worker = null;
async function ocr() {
  if (!worker) {
    worker = await Tesseract.createWorker("eng", 1, { cachePath: new URL(".", import.meta.url).pathname, logger: () => {}, errorHandler: () => {} });
  }
  return worker;
}

// coin names written out on chart titles -> ticker
const NAMES = { BITCOIN: "BTC", ETHEREUM: "ETH", SOLANA: "SOL", RIPPLE: "XRP", DOGECOIN: "DOGE", CARDANO: "ADA", LITECOIN: "LTC", POLKADOT: "DOT", CHAINLINK: "LINK", AVALANCHE: "AVAX", TRON: "TRX", POLYGON: "POL", TONCOIN: "TON", SHIBA: "SHIB", PEPE: "PEPE", SUI: "SUI" };

// the picture's text, read twice: as it is and inverted (dark charts), both 2x larger so small labels are readable
// Telegram's public page gives small copies (680x351, 358x800): the whole picture is enlarged to at least 1800 px
// wide, and its top strip (the chart title with the coin) separately to 2600 px.
export async function chartText(buf) {
  const meta = await sharp(buf).metadata();
  const W0 = meta.width || 1000, H0 = meta.height || 800;
  const width = Math.min(3200, Math.max(1800, Math.round(W0 * 2)));
  const w = await ocr();
  const read = async (img) => {
    const base = img.grayscale().normalise();
    const plain = await base.clone().png().toBuffer();
    const inv = await base.clone().negate({ alpha: false }).png().toBuffer();
    return `${(await w.recognize(plain)).data.text || ""}\n${(await w.recognize(inv)).data.text || ""}`;
  };
  const whole = await read(sharp(buf).resize({ width, kernel: "lanczos3" }));
  const topH = Math.max(20, Math.round(H0 * (H0 > W0 ? 0.08 : 0.12)));
  const title = await read(sharp(buf).extract({ left: 0, top: 0, width: W0, height: topH }).resize({ width: Math.min(3200, Math.max(2600, W0 * 3)), kernel: "lanczos3" }));
  return `${title}\n${whole}`;
}

// coin from the chart text: the first "XXXUSDT" / "XXX / TetherUS" / "Bitcoin / U.S. Dollar" that is a real pair
// OCR slips on small titles (4 Nov, smartradepro "EIGENUSDT.P" read as "OEICENUSDTP"): the coin icon becomes a
// leading letter and G/C, O/0, I/1, S/5, B/8 swap. Exact readings first; then up to two leading letters dropped
// and up to two swaps. A reading only counts when it is a real pair.
const SWAP = { C: "G", G: "C", O: "0", 0: "O", I: "1", 1: "I", S: "5", 5: "S", B: "8", 8: "B", Q: "O" };
function variants(c) {
  const out = new Set();
  for (let drop = 0; drop <= Math.min(2, c.length - 2); drop++) {
    const base = c.slice(drop);
    out.add(base);
    for (let i = 0; i < base.length; i++) {
      if (!SWAP[base[i]]) continue;
      const one = base.slice(0, i) + SWAP[base[i]] + base.slice(i + 1);
      out.add(one);
      for (let j = i + 1; j < one.length; j++) if (SWAP[one[j]]) out.add(one.slice(0, j) + SWAP[one[j]] + one.slice(j + 1));
    }
  }
  return [...out];
}
export function coinFromText(text, isSymbol) {
  const up = String(text).toUpperCase().replace(/[|]/g, "I");
  const cands = [];
  for (const m of up.matchAll(/([A-Z0-9]{2,17}?)\s*[/_-]?\s*(?:USDT|USDC|USD)(?:\.?P|\s*PERP)?\b/g)) cands.push(m[1]);
  for (const m of up.matchAll(/\b([A-Z][A-Z0-9]{1,14})\s*\/\s*(?:TETHER|U\.?S\.?\s*DOLLAR|USD)/g)) cands.push(m[1]);
  for (const c of cands) {
    const t = NAMES[c] || c;
    if (isSymbol(`${t}USDT`)) return `${t}USDT`;
  }
  for (const c of cands) for (const v of variants(c)) if (v.length >= 2 && isSymbol(`${v}USDT`)) return `${v}USDT`;
  return null;
}

const N = String.raw`[:=]?\s*\$?\s*(\d+(?:[.,]\d+)?)`;
const num = (s) => Number(String(s).replace(",", "."));
// levels from the labels printed on the chart (the first value found for each)
export function levelsFromText(text) {
  const t = String(text).replace(/[|]/g, " ");
  const first = (re) => { const m = t.match(re); return m ? num(m[1]) : null; };
  const entry = first(new RegExp(String.raw`\bENTRY\s*(?:PRICE|ZONE)?\s*` + N, "i"));
  const sl = first(new RegExp(String.raw`\b(?:STOP\s*-?\s*LOSS|STOP|SL)\b\s*` + N, "i"));
  // OCR often glues the target number to its price: "TP31.4260" = TP3 1.4260, "TP11.3001" = TP1 1.3001.
  // Each target keeps both readings; the one near the entry / stop wins.
  const ref = entry || sl;
  const near = (v) => (ref ? Math.abs(Math.log(v / ref)) : 0);
  const tps = [];
  for (const m of t.matchAll(/\b(?:TP|TARGET)\s*-?\s*(\d)?\s*[:=]?\s*\$?\s*(\d+(?:[.,]\d+)?)/gi)) {
    const opts = [];
    if (m[1]) opts.push(num(m[2]), num(m[1] + m[2])); // "TP1 1.3001" -> 1.3001, or "TP 12.5" read as "1"+"2.5"
    else {
      opts.push(num(m[2]));
      const g = /^([1-9])(\d+[.,]\d+)$/.exec(m[2]); // glued, no space: "31.4260"
      if (g) opts.push(num(g[2]));
    }
    const v = opts.filter((x) => x > 0).sort((a, b) => near(a) - near(b))[0];
    if (v > 0 && !tps.includes(v)) tps.push(v);
  }
  return { entry, sl, tps };
}

// -> { symbol, side, entry, sl, tps, text } | { reason, text }
export async function readChartSetup(buf, isSymbol, postText = "") {
  const text = await chartText(buf);
  const symbol = coinFromText(`${postText}\n${text}`, isSymbol);
  if (!symbol) return { reason: "no coin name readable on the chart", text };
  const { entry, sl, tps } = levelsFromText(text);
  if (!entry && !sl && !tps.length) return { reason: `${symbol}: no ENTRY / SL / TP labels readable on the chart`, text, symbol };
  // side from the levels: targets above the entry (or above the stop) = LONG
  const ref = entry || sl;
  let side = null;
  if (tps.length && ref) side = tps[0] > ref ? "LONG" : "SHORT";
  else if (entry && sl) side = sl < entry ? "LONG" : "SHORT";
  if (!side) return { reason: `${symbol}: the chart shows no direction (needs a target or a stop next to the entry)`, text, symbol };
  const good = (v) => v > 0 && (!entry || Math.abs(v / entry - 1) < 3);
  return { symbol, side, entry: entry || null, sl: good(sl) ? sl : null, tps: tps.filter(good), text };
}

export async function closeChartReader() { if (worker) { await worker.terminate(); worker = null; } }
