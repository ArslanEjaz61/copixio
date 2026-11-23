// Demo account with sample data for presentations: demo@copixio.com. Telegram shows "connected" (no real session, so
// the listener skips it), three signal groups, signals read from them and CLOSED trades only (an open trade would be
// managed by the trader against a key that does not exist). Every name says Demo.
//   node --env-file=.env scripts/seed-demo.mjs          create / refresh
//   node --env-file=.env scripts/seed-demo.mjs --remove delete the demo account and everything it owns
import crypto from "node:crypto";
import { promisify } from "node:util";
import mongoose from "mongoose";
import { User, Exchange, Telegram, Group, Signal, Trade } from "../lib/models.js";
import { seal } from "../lib/seal.js";
import { parseSignal } from "../lib/parser.js";

const EMAIL = "demo@copixio.com";
const PASSWORD = process.env.DEMO_PASSWORD || "CopixioDemo@2026";
const scrypt = promisify(crypto.scrypt);
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw.normalize("NFKC"), salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/copixio");
const old = await User.findOne({ email: EMAIL });
if (old) {
  for (const M of [Trade, Signal, Group, Telegram, Exchange]) await M.deleteMany({ userId: old._id });
  if (process.argv.includes("--remove")) { await User.deleteOne({ _id: old._id }); console.log("demo account removed"); process.exit(0); }
}

const user = old || new User({ email: EMAIL });
Object.assign(user, { name: "Demo Account", passwordHash: await hashPassword(PASSWORD), emailVerifiedAt: new Date(), role: "user", plan: "pro", planUntil: new Date(Date.now() + 30 * 864e5), trial: false, botPaused: false });
await user.save();

const ex = await Exchange.create({ userId: user._id, exchange: "binance", env: "demo", label: "Demo account", keyTail: "DEMO", keySealed: seal("demo-not-a-key"), secretSealed: seal("demo-not-a-key"), status: "ok", usdtFree: 2480.55, checkedAt: new Date() });
await Telegram.create({ userId: user._id, phone: "+923000000000", status: "connected", tgName: "Demo Telegram", tgUserId: "0", connectedAt: new Date(Date.now() - 3 * 864e5) });

const groups = await Group.insertMany([
  { userId: user._id, chatId: "-1001000000001", title: "Demo · Crypto VIP Signals", kind: "channel", enabled: true, exchangeId: ex._id, sizeMode: "fixed", sizeUsdt: 50, maxOpen: 3, slMode: "signal", tpMode: "signal", tpSplit: "even", moveSlToEntry: true },
  { userId: user._id, chatId: "-1001000000002", title: "Demo · Spot Gems", kind: "group", enabled: true, exchangeId: ex._id, sizeMode: "percent", sizePercent: 5, maxOpen: 2, slMode: "percent", slPercent: 3, tpMode: "signal", tpSplit: "half", moveSlToEntry: true },
  { userId: user._id, chatId: "-1001000000003", title: "Demo · Altcoin Daily", kind: "channel", enabled: false, exchangeId: ex._id },
]);

// live prices so the levels look real
const COINS = ["SOL", "LINK", "AVAX", "DOGE", "ARB", "INJ", "SUI", "NEAR", "OP", "TIA"];
const px = {};
await Promise.all(COINS.map(async (c) => {
  const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${c}USDT`).then((x) => x.json()).catch(() => null);
  px[c] = Number(r?.price) || 1;
}));
const f = (v) => (v >= 100 ? v.toFixed(2) : v >= 1 ? v.toFixed(3) : v.toFixed(5));
const r = (v) => Number(f(v));

// [coin, group, hours ago, outcome, fill move %]
const plan = [
  ["SOL", 0, 70, "TP", 4.1], ["LINK", 0, 64, "SL", -3.0], ["AVAX", 1, 55, "TP", 6.2], ["DOGE", 0, 49, "BE", 0],
  ["ARB", 1, 40, "TP", 3.4], ["INJ", 0, 31, "TP", 5.0], ["SUI", 1, 22, "SL", -3.0], ["NEAR", 0, 15, "TP", 2.8],
  ["OP", 0, 9, "MANUAL", 1.2], ["TIA", 1, 4, "TP", 3.9],
];
let n = 0;
for (const [coin, gi, hAgo, outcome, move] of plan) {
  const g = groups[gi];
  const entry = px[coin] / (1 + move / 100 * 0.3); // the entry a little under today's price
  const stop = entry * 0.97, t1 = entry * 1.03, t2 = entry * 1.06;
  const text = `🚀 #${coin}/USDT LONG\nEntry: ${f(entry * 0.995)} - ${f(entry * 1.005)}\nTargets: ${f(t1)} / ${f(t2)}\nStop loss: ${f(stop)}\n(Demo signal)`;
  const at = new Date(Date.now() - hAgo * 36e5);
  const sig = await Signal.create({ userId: user._id, groupId: g._id, chatId: g.chatId, messageId: String(1000 + n++), text, parsed: parseSignal(text), outcome: "traded", reason: null, createdAt: at, updatedAt: at });
  const cost = g.sizeMode === "fixed" ? 50 : 2480 * 0.05;
  const qty = cost / entry;
  const exit = outcome === "TP" ? entry * (1 + move / 100) : outcome === "SL" ? stop : outcome === "BE" ? entry : entry * (1 + move / 100);
  const fees = cost * 0.002;
  const pnl = (exit - entry) * qty - fees;
  const closedAt = new Date(at.getTime() + (2 + (n % 5)) * 36e5);
  const tr = await Trade.create({
    userId: user._id, groupId: g._id, signalId: sig._id, exchangeId: ex._id, exchange: "binance", env: "demo", symbol: `${coin}USDT`, base: coin, side: "long",
    status: "closed", clientOrderId: `demo-${user._id}-${n}`, entryPrice: r(entry), qty: Number(qty.toFixed(4)), qtyLeft: 0, costUsdt: Number(cost.toFixed(2)),
    stopPrice: r(outcome === "BE" ? entry : stop), targets: [{ price: r(t1), share: 50, done: outcome === "TP" || outcome === "BE" }, { price: r(t2), share: 50, done: outcome === "TP" && move >= 6 }],
    fills: [{ kind: "buy", price: r(entry), qty: Number(qty.toFixed(4)), usdt: Number(cost.toFixed(2)), fee: Number((fees / 2).toFixed(4)), at }, { kind: "sell", price: r(exit), qty: Number(qty.toFixed(4)), usdt: Number((exit * qty).toFixed(2)), fee: Number((fees / 2).toFixed(4)), at: closedAt }],
    exitPrice: r(exit), pnlUsdt: Number(pnl.toFixed(2)), feesUsdt: Number(fees.toFixed(4)), outcome, openedAt: at, closedAt, createdAt: at, updatedAt: closedAt,
  });
  await Signal.updateOne({ _id: sig._id }, { $set: { tradeId: tr._id } });
  // mongoose stamps "now"; the demo needs the real spread over the last three days
  await Signal.collection.updateOne({ _id: sig._id }, { $set: { createdAt: at, updatedAt: at } });
  await Trade.collection.updateOne({ _id: tr._id }, { $set: { createdAt: at, updatedAt: closedAt } });
}
// a few messages that were read but not traded
const extra = [
  [0, 60, "Good morning traders ☀️ Market looks bullish today, stay tuned for signals. (Demo)", "not_a_signal", "no coin found"],
  [1, 35, "#ETH/USDT SHORT\nEntry 3100\nTP 2950\nSL 3180\n(Demo signal)", "skipped", "short signals are not traded on spot"],
  [0, 12, "BTC hit target 2 ✅ +4.2% profit for VIP members (Demo)", "not_a_signal", "looks like a result or an update, not a new signal"],
  [1, 2, "#PEPE/USDT LONG entry 0.0000001\nTP 0.0000002\n(Demo signal)", "skipped", "the market is more than 2% above the signal entry"],
];
for (const [gi, hAgo, text, outcome, reason] of extra) {
  const at = new Date(Date.now() - hAgo * 36e5);
  const s = await Signal.create({ userId: user._id, groupId: groups[gi]._id, chatId: groups[gi].chatId, messageId: String(2000 + n++), text, parsed: parseSignal(text), outcome, reason });
  await Signal.collection.updateOne({ _id: s._id }, { $set: { createdAt: at, updatedAt: at } });
}
const sum = await Trade.aggregate([{ $match: { userId: user._id } }, { $group: { _id: null, n: { $sum: 1 }, pnl: { $sum: "$pnlUsdt" } } }]);
console.log(`demo ready: ${EMAIL} -- ${groups.length} groups, ${n} signals, ${sum[0].n} closed trades, P&L ${sum[0].pnl.toFixed(2)} USDT`);
process.exit(0);
