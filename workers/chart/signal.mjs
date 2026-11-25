// Picture signals (25 Nov): a chart screenshot in a followed group is read like a text signal.
// Ported from the Smartbot TradeX / smartradepro reader (free OCR: tesseract.js + sharp, no paid AI). Order:
//   1. caption coin ("btc", "$ZIL", "JCT") -- a one-word caption names the coin, whatever the chart's title says
//   2. "$COIN" + TradingView labels (purple TP / grey entry / blue SL)            -> posread
//   3. ENTRY / SL / STOP / TP words printed on the chart                            -> chartread
//   4. TradingView Position tool (green + red boxes) mapped through the price axis -> boxread (entry within 25% of live)
//   5. coloured price labels on the axis: above the price = targets, red below = stop -> linelabels
//   6. level lines calibrated on the chart's own daily candles                        -> calibread
//   7. the Position tool is there but its numbers are not readable: direction only, at market
// No coin -> no trade. Missing stop / targets are filled by the group's own % in the trader (as for text signals).
// chartSignal(buffer, caption, postedAtMs) -> { ok:true, base, side, entryLow, entryHigh, market, targets, stop, chart }
//                                          | { ok:false, reason }
import { readChartSetup } from "./chartread.mjs";
import { readPositionBoxes } from "./boxread.mjs";
import { readLineLabels, levelsFromLabels } from "./linelabels.mjs";
import { readCalibrated } from "./calibread.mjs";
import { readPosition } from "./posread.mjs";

const getJ = async (u, ms = 10000) => { const r = await fetch(u, { signal: AbortSignal.timeout(ms) }); if (!r.ok) throw new Error(`${r.status}`); return r.json(); };

// ---- coins: Binance spot + KuCoin spot USDT pairs, read once an hour
let syms = null, symsAt = 0;
async function loadSymbols() {
  if (syms && Date.now() - symsAt < 36e5) return syms;
  const next = new Set();
  try { const j = await getJ("https://api.binance.com/api/v3/exchangeInfo?permissions=SPOT", 20000); for (const s of j.symbols || []) if (s.status === "TRADING" && s.quoteAsset === "USDT") next.add(s.symbol); } catch {}
  try { const j = await getJ("https://api.kucoin.com/api/v2/symbols", 20000); for (const s of j.data || []) if (s.enableTrading && s.quoteCurrency === "USDT") next.add(`${s.baseCurrency}USDT`); } catch {}
  if (next.size > 100) { syms = next; symsAt = Date.now(); }
  return syms || next;
}
const isSymbol = (sym) => !!syms && syms.has(String(sym || "").toUpperCase());

async function livePrice(sym) {
  try { const j = await getJ(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}`, 6000); if (+j.price > 0) return +j.price; } catch {}
  try { const j = await getJ(`https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${sym.replace(/USDT$/, "-USDT")}`, 6000); if (+j?.data?.price > 0) return +j.data.price; } catch {}
  return null;
}

// "btc" / "$ZIL" / "jct usdt" / "XRPUSDT.P" -> "BTCUSDT"; anything longer is not a caption coin
function captionCoin(text) {
  const m = /^\s*[$#]?([A-Za-z0-9]{1,15}?)(?:\s*\/?\s*USDT)?(?:\.?P)?\s*$/i.exec(String(text || ""));
  if (!m) return null;
  const sym = `${m[1].toUpperCase()}USDT`;
  return isSymbol(sym) ? sym : null;
}
const COIN_TAG = /\$([A-Z][A-Z0-9]{1,14})\b/;

// Position tool: levels only when the price axis was read well enough (entry within 25% of the live price)
async function boxSetup(buf, symbol) {
  const b = await readPositionBoxes(buf);
  if (b.error && !b.pos) return { reason: `${symbol}: ${b.error}` };
  const side = b.side || b.pos.side;
  if (!b.error) {
    const px = await livePrice(symbol);
    if (px > 0 && Math.abs(b.entry / px - 1) <= 0.25) return { symbol, side, entry: b.entry, sl: b.sl, tps: [b.tp], how: "position tool" };
    b.error = `levels read off the axis (entry ${b.entry}) do not fit the live price ${px}`;
  }
  return { symbol, side, directionOnly: true, note: b.error };
}
async function lineSetup(buf, symbol) {
  const px = await livePrice(symbol);
  if (!(px > 0)) return { reason: `no live price for ${symbol}` };
  const L = await readLineLabels(buf);
  if (L.error) return { reason: L.error };
  const { tps, sl } = levelsFromLabels(L.labels, px);
  if (!sl && tps.length < 2) return { reason: `${symbol}: no red stop line under the price ${px} and fewer than two lines above it` };
  return { symbol, side: "LONG", entry: null, sl, tps, how: "axis labels" };
}

// a reader's answer -> Copixio's parsed signal, with the checks a text signal gets (stop side, 50% / 3x misreads)
async function toParsed(r) {
  const side = String(r.side || "LONG").toLowerCase() === "short" ? "short" : "long";
  const base = r.symbol.replace(/USDT$/, "");
  const entry = Number(r.entry) > 0 ? Number(r.entry) : null;
  const ref = entry || (await livePrice(r.symbol));
  if (!(ref > 0)) return { ok: false, reason: `${base}: no price to check the chart levels against` };
  let stop = Number(r.sl) > 0 ? Number(r.sl) : null;
  if (stop && (Math.abs(stop / ref - 1) > 0.5 || (side === "long" ? stop >= ref : stop <= ref))) stop = null; // misread -> the group's own %
  let targets = (r.tps || []).map(Number).filter((t) => t > 0 && Math.abs(t / ref - 1) <= 3 && (side === "long" ? t > ref : t < ref));
  targets = [...new Set(targets)].sort((a, b) => (side === "long" ? a - b : b - a)).slice(0, 10);
  return { ok: true, base, side, entryLow: entry, entryHigh: entry, market: !entry, targets, stop, chart: r.how || "chart" };
}

export async function chartSignal(buf, caption = "", postedAtMs = Date.now()) {
  await loadSymbols();
  if (!syms) return { ok: false, reason: "coin list not readable right now" };
  const cap = captionCoin(caption);
  const tag = COIN_TAG.exec(caption || "");
  // 2. "$COIN" + the TP / entry / SL labels
  if (tag && isSymbol(`${tag[1]}USDT`)) {
    try {
      const p = await readPosition(buf);
      if (!p.error && Math.abs(p.sl / p.entry - 1) <= 0.5 && Math.abs(p.tp / p.entry - 1) <= 3)
        return toParsed({ symbol: `${tag[1]}USDT`, side: p.side, entry: p.entry, sl: p.sl, tps: [p.tp], how: "chart labels" });
    } catch { /* next reader */ }
  }
  // 3. printed ENTRY / SL / TP
  let r;
  try { r = await readChartSetup(buf, isSymbol, caption || ""); } catch (e) { return { ok: false, reason: `chart not readable (${e.message})` }; }
  if (cap && r.symbol !== cap) r = r.reason ? { reason: `${cap}: no ENTRY / SL / TP labels readable on the chart`, symbol: cap } : { ...r, symbol: cap };
  if (!r.reason) return toParsed({ ...r, how: "chart text" });
  const symbol = r.symbol || cap || (tag && isSymbol(`${tag[1]}USDT`) ? `${tag[1]}USDT` : null);
  if (!symbol) return { ok: false, reason: `picture: ${r.reason}` };
  const why = [r.reason];
  // 4. Position tool  5. axis labels
  const br = await boxSetup(buf, symbol).catch((e) => ({ reason: `position tool not readable (${e.message})` }));
  if (!br.reason && !br.directionOnly) return toParsed(br);
  if (br.reason) why.push(br.reason);
  const lr = await lineSetup(buf, symbol).catch((e) => ({ reason: `chart lines not readable (${e.message})` }));
  if (!lr.reason) return toParsed(lr);
  why.push(lr.reason);
  // 6. calibrated on the chart's own candles
  if (process.env.CHART_CALIB !== "off") {
    try {
      const cr = await readCalibrated(buf, symbol, postedAtMs);
      if (!cr.reason) return toParsed({ symbol, side: "LONG", entry: cr.entry, sl: cr.sl, tps: cr.tps, how: "calibrated lines" });
      why.push(cr.reason);
    } catch (e) { why.push(`calibrated reader: ${e.message}`); }
  }
  // 7. the Position tool's direction, at market (the group's own stop / target %)
  if (br.directionOnly) return toParsed({ symbol, side: br.side, how: "position tool direction (levels not readable)" });
  return { ok: false, reason: `picture: ${why.join("; ").slice(0, 400)}` };
}
