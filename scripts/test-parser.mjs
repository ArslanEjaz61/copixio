// node scripts/test-parser.mjs  -> prints PASS/FAIL per sample; exits 1 on any failure.
import { parseSignal } from "../lib/parser.js";

const cases = [
  ["#ARIA/USDT LONG\nEntry 0.2495\nTP1 0.2580 · TP2 0.2620\nSL 0.2410", { base: "ARIA", side: "long", entryLow: 0.2495, targets: [0.258, 0.262], stop: 0.241 }],
  ["🟢 BTCUSDT\nBuy zone: 64000 - 64500\nTargets: 65500 - 66500 - 68000\nStop loss: 62900", { base: "BTC", side: "long", entryLow: 64000, entryHigh: 64500, targets: [65500, 66500, 68000], stop: 62900 }],
  ["Coin: $PEPE\nLONG\nEntry: 0.00001234\nTarget 1: 0.00001300\nTarget 2: 0.00001400\nStop: 0.00001150\nLeverage 10x", { base: "PEPE", side: "long", targets: [0.000013, 0.000014], stop: 0.0000115 }],
  ["SOL/USDT SHORT\nEntry 150\nTP 140\nSL 156", { base: "SOL", side: "short" }],
  ["#LINK\nBuy CMP\nTargets:\n1) 15.2\n2) 15.8\n3) 16.5\nSL 13.9", { base: "LINK", side: "long", market: true, targets: [15.2, 15.8, 16.5], stop: 13.9 }],
  ["Good morning traders! Market looks bullish today, stay safe.", { ok: false }],
  ["ETH/USDT long entry 3000 SL 3100", { ok: false }],
  ["#DOGEUSDT 🟢\nEntry: 0.1520-0.1500\nTP1: 0.1580\nTP2: 0.1650\nSL: 0.1450", { base: "DOGE", side: "long", entryLow: 0.15, entryHigh: 0.152, targets: [0.158, 0.165], stop: 0.145 }],
  ["🟢 SOL/USDT TP1 150 ✅ hit", { ok: false }],
  ["Bullish on ETH/USDT, target 4000", { ok: false }],
  ["Don't buy BTC/USDT now, wait for 60000", { ok: false }],
  ["#BNB/USDT LONG\nEntry: market\nSL 5%\nTP 700", { base: "BNB", side: "long", stop: null, targets: [700] }],
  ["ADA/USDT long\nEntry 0.45\nTarget 0.50\nStop 3x", { base: "ADA", stop: null }],
  // 25 Nov: Tradex posts (bare coin first, $ before prices)
  ["PIEVERSE Market entry: $3.64 Stop-loss: $3 Target: $5.3", { base: "PIEVERSE", side: "long", entryLow: 3.64, targets: [5.3], stop: 3 }],
  ["BTC Entry: 57850 SL: 55081 TP: 64800", { base: "BTC", side: "long", entryLow: 57850, targets: [64800], stop: 55081 }],
  ["ETH Entry: 3000 SL: 3100 TP: 2800", { base: "ETH", side: "short", stop: 3100, targets: [2800] }],
  ["GM fam, entry soon, stop by later for targets", { ok: false }],
  ["Hello Entry: 5 SL: 4 TP: 6", { ok: false }],
];

let fail = 0;
for (const [text, want] of cases) {
  const got = parseSignal(text);
  const bad = [];
  for (const [k, v] of Object.entries(want)) {
    const g = k === "ok" ? got.ok : got[k];
    if (JSON.stringify(g) !== JSON.stringify(v)) bad.push(`${k}: want ${JSON.stringify(v)} got ${JSON.stringify(g)}`);
  }
  if (want.ok !== false && !got.ok) bad.push(`not parsed: ${got.reason}`);
  if (bad.length) { fail++; console.log("FAIL", JSON.stringify(text.slice(0, 40)), "\n   ", bad.join("\n    ")); }
  else console.log("PASS", JSON.stringify(text.slice(0, 40)));
}
console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
