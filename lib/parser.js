// Reads a trading signal out of a free-form Telegram message.
// -> { ok:true, base, side:"long"|"short", entryLow, entryHigh, market, targets:[...], stop } or { ok:false, reason }.
// Conservative on purpose: when a message cannot be read with confidence it is NOT a signal (no trade is placed).

const NUM = "(\\d+(?:[.,]\\d+)?)";
const toNum = (s) => Number(String(s).replace(",", "."));
const QUOTES = ["USDT", "USDC", "FDUSD", "BUSD", "USD"];
const NOT_COINS = new Set(["LONG", "SHORT", "BUY", "SELL", "ENTRY", "TP", "SL", "TARGET", "TARGETS", "STOP", "SPOT", "FUTURES", "LEVERAGE", "CROSS", "ISOLATED", "VIP", "SIGNAL", "PRICE", "ZONE", "CMP", "NOW", "RISK", "USDT", "USD", "PAIR", "COIN", "NEW", "TAKE", "PROFIT", "LOSS", "AND", "THE", "FOR", "MARKET"]);

function findBase(t) {
  const U = t.toUpperCase();
  // ARIA/USDT, ARIA-USDT, ARIA USDT, #ARIAUSDT, $ARIAUSDT, ARIAUSDT
  let m = U.match(new RegExp(`[#$]?\\b([A-Z0-9]{2,15})\\s*[/\\-]?\\s*(${QUOTES.join("|")})(?:\\.P|PERP)?\\b`));
  if (m && !NOT_COINS.has(m[1]) && !/^\d+$/.test(m[1])) return m[1];
  // #ARIA or $ARIA
  m = U.match(/[#$]([A-Z][A-Z0-9]{1,14})\b/);
  if (m && !NOT_COINS.has(m[1])) return m[1];
  // "Coin: ARIA" / "Pair: ARIA"
  m = U.match(/\b(?:COIN|PAIR|SYMBOL|ASSET)\s*[:\-]\s*([A-Z][A-Z0-9]{1,14})\b/);
  if (m && !NOT_COINS.has(m[1])) return m[1];
  // 25 Nov (Tradex): "PIEVERSE Market entry: $3.64 Stop-loss: $3 Target: $5.3" / "BTC Entry: 57850 SL: 55081 TP: 64800"
  // a bare coin as the FIRST word, written in capitals, and only when an entry plus a stop or target follow
  m = t.match(/^\s*([A-Z][A-Z0-9]{1,14})\b/);
  if (m && !NOT_COINS.has(m[1]) && /\bentry\b/i.test(t) && /\b(sl|stop|tp|target|take\s*profit)/i.test(t)) return m[1];
  return null;
}

// 25 Nov: forex / metals / index signals for MetaTrader 5. A pair of known currency codes (EURUSD, EUR/USD, GBPJPY),
// gold and silver (XAUUSD, XAG/USD) or a known index / oil name (US30, NAS100, USOIL). Checked BEFORE the crypto coin
// finder, which would read XAUUSD as coin "XAU". Returns the symbol ("XAUUSD") or null.
const CCY = new Set(["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD"]);
const FX_INDEX = new Set(["US30", "NAS100", "US100", "SPX500", "US500", "GER40", "DE40", "DAX40", "UK100", "JPN225", "JP225", "HK50", "FRA40", "AUS200", "USOIL", "UKOIL", "XTIUSD", "XBRUSD"]);
function findFx(t) {
  const U = t.toUpperCase();
  const re = /\b(XAU|XAG|[A-Z]{3})\s*\/?\s*([A-Z]{3})\b/g;
  let m;
  while ((m = re.exec(U))) {
    const a = m[1], b = m[2];
    if ((CCY.has(a) || a === "XAU" || a === "XAG") && CCY.has(b) && a !== b) return a + b;
  }
  const ix = U.match(/\b([A-Z]{2,6}\d{2,3}|USOIL|UKOIL|XTIUSD|XBRUSD)\b/);
  return ix && FX_INDEX.has(ix[1]) ? ix[1] : null;
}

function findSide(t) {
  // explicit words only: colours, emoji and "bullish" are opinions, not orders
  const long = /\b(long|buy)\b/i.test(t);
  const short = /\b(short|sell)\b/i.test(t);
  if (long && !short) return "long";
  if (short && !long) return "short";
  if (long && short) {
    // "Buy ... Sell targets" is a long; decide by the first explicit word
    const l = t.search(/\b(long|buy)\b/i), s = t.search(/\b(short|sell)\b/i);
    if (l >= 0 && (s < 0 || l < s)) return "long";
    if (s >= 0) return "short";
  }
  return null;
}

// numbers that follow a label on the same line (and the next one, for "Targets:\n1) 0.25\n2) 0.26")
// cutRe: another label on the SAME line ends this one ("BTC Entry: 57850 SL: 55081 TP: 64800")
function numbersAfter(t, labelRe, maxLines = 1, cutRe = null) {
  const lines = t.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(labelRe);
    if (!m) continue;
    // following lines belong to this label until another label starts (stop loss, entry, leverage...)
    const next = [];
    for (const l of lines.slice(i + 1, i + maxLines)) {
      if (/\b(sl|stop|stoploss|entry|entries|buy|leverage|lev|margin|risk|invalidation)\b/i.test(l)) break;
      next.push(l);
    }
    let own = lines[i].slice(m.index + m[0].length);
    const cut = cutRe ? own.search(cutRe) : -1;
    if (cut >= 0) { own = own.slice(0, cut); next.length = 0; }
    const rest = [own, ...next].join(" ");
    for (const n of rest.matchAll(new RegExp(NUM, "g"))) out.push(toNum(n[1]));
    if (out.length) return out;
  }
  return out;
}

export function parseSignal(text) {
  let t = String(text || "").slice(0, 4000);
  if (t.length < 8) return { ok: false, reason: "too short" };
  // results and updates about earlier signals are not new signals
  if (/✅|🎯|\b(hit|reached|achieved|booked|smashed|done|closed|cancel(?:l?ed)?|update|result|profits?\s*(?:secured|booked|taken))\b/i.test(t))
    return { ok: false, reason: "looks like a result or an update, not a new signal" };
  if (/\b(don'?t|do\s+not|never|avoid|no)\s+(buy|long|enter)\b/i.test(t)) return { ok: false, reason: "says not to buy" };
  const fxSym = findFx(t);
  if (fxSym) {
    // 2,350.50 -> 2350.50 ; "Sell Limit/Stop 2350" -> "Sell 2350" ; a bare SELL counts as the entry label like BUY does
    t = t.replace(/(?<![\d,.])([1-9]\d{0,2}),(\d{3})(?!\d)/g, "$1$2")
      .replace(/\b(buy|sell)\s+(limit|stop)\b/gi, "$1")
      .replace(/\bsell\b/gi, (w) => `${w} Entry`);
  }
  const base = fxSym || findBase(t);
  if (!base) return { ok: false, reason: "no coin found" };
  const side = findSide(t);

  // entry: "Entry: 0.2495", "Entry zone 0.24 - 0.25", "Buy: 0.24-0.25", "Entry: CMP / market"
  const market = /\b(cmp|market\s*price|current\s*price|at\s*market|market\s*entry|buy\s*now|enter\s*now)\b|\b(entry|buy|enter)\s*[:\-=]?\s*(market|now)\b/i.test(t);
  let entries = numbersAfter(t, /\b(entry(?:\s*(?:zone|price|point|range))?|entries|buy(?:\s*(?:zone|price|between|at|range))?|enter(?:\s*at)?|open(?:\s*at)?)\b\s*[:\-=@]?/i, 1, /\b(sl|stop|stoploss|tp\d*|targets?|take\s*profits?|leverage|lev)\b/i);
  entries = entries.filter((x) => x > 0).slice(0, 4);

  // targets: "TP1 0.258", "Target 2: 0.262", "Targets: 0.25 - 0.26 - 0.27", "Take profit 0.26"
  let targets = [];
  // "TP1 0.258" / "TP1: 0.258" / "TP 700": a target index is only an index when a separator or space follows it
  const tpLines = [...t.matchAll(/\b(?:tp|target|take\s*profit)\s*(?:(\d{1,2})(?:\s*[:\-=)@.]+\s*|\s+))?[:\-=)@.]*\s*\$?\s*(\d+(?:[.,]\d+)?)/gi)];
  if (tpLines.length) targets = tpLines.map((m) => toNum(m[2]));
  if (targets.length <= 1) {
    const many = numbersAfter(t, /\b(targets?|tps?|take\s*profits?)\b\s*[:\-=]?/i, 6, /\b(sl|stop|stoploss|entry|entries|leverage|lev)\b/i);
    if (many.length > targets.length) targets = many;
  }
  // a list numbered "1) 0.25" right after "Targets:" can catch the list numbers themselves: drop small integers
  targets = targets.filter((x) => x > 0 && !(Number.isInteger(x) && x <= 10 && targets.some((y) => !Number.isInteger(y))));

  // stop: "SL 0.241", "Stop loss: 0.241", "Stop: 0.241", "Invalidation 0.24"
  const stopM = t.match(new RegExp(`\\b(?:sl|stop\\s*-?\\s*loss|stoploss|stop|invalidation)\\b\\s*[:\\-=@]?\\s*\\$?\\s*${NUM}(?![\\d.,]*\\s*[%x×])`, "i")); // "SL 5%" / "3x" are not prices
  const stop = stopM ? toNum(stopM[1]) : null;

  // drop leverage / percentages that look like prices ("10x", "5%")
  const lev = [...t.matchAll(/(\d+(?:\.\d+)?)\s*[x×%]/gi)].map((m) => toNum(m[1]));
  targets = targets.filter((x) => !lev.includes(x));
  entries = entries.filter((x) => !lev.includes(x));

  const entryLow = entries.length ? Math.min(...entries) : null;
  const entryHigh = entries.length ? Math.max(...entries) : null;
  let sideOut = side;
  if (!sideOut && targets.length && (entryLow || stop)) {
    const ref = entryLow || stop;
    sideOut = targets[0] > ref ? "long" : "short";
  }
  if (!sideOut) return { ok: false, reason: "no direction (long or short) found", base };
  // a forex post with a direction word and a stop or target but no entry ("XAUUSD SELL / SL / TP") is a market order
  const fxMarket = !!fxSym && !entries.length && !!side && !!(stop || targets.length);
  if (!entries.length && !market && !fxMarket) return { ok: false, reason: "no entry price or market entry found", base };
  if (!stop && !targets.length) return { ok: false, reason: "no stop loss or targets found", base };

  if (sideOut === "long") {
    targets = [...new Set(targets)].sort((a, b) => a - b);
    const ref = entryHigh || entryLow;
    if (ref) targets = targets.filter((x) => x > ref);
    if (stop) targets = targets.filter((x) => x > stop);
    if (stop && ref && stop >= ref) return { ok: false, reason: "stop loss is not below the entry", base };
  } else {
    targets = [...new Set(targets)].sort((a, b) => b - a);
  }
  return { ok: true, base, side: sideOut, entryLow, entryHigh, market: market || !entries.length, targets: targets.slice(0, 10), stop, ...(fxSym ? { fx: true } : {}) };
}
