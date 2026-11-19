// pm2 "copixio-trader": turns queued signals into orders and manages open trades (targets, stop loss, manual close).
//
// Safety rules:
//  - a signal is claimed atomically (queued -> processing), so two workers or a restart never trade it twice;
//  - every order carries our client id; after any unclear answer we ask the exchange whether it landed instead of
//    ordering again; a sell that landed is always recorded (never a "closed" trade with no exit);
//  - the stop loss also sits ON the exchange (stop-limit), so a position stays protected while this worker is down;
//    whenever the bot cancels it (to sell a target) and the sell does not go through, the stop is put back;
//  - one trade is managed by one loop at a time, always from a fresh read of the database.
try { process.loadEnvFile(new URL("../.env", import.meta.url)); } catch { /* env from pm2 */ }
import Redis from "ioredis";
import { db } from "../lib/db.js";
import { Exchange, Group, Signal, Trade, User, PLANS, planOf } from "../lib/models.js";
import { adapterFor, floorTo } from "../lib/exchanges/adapter.js";
import { checkKey as binanceCheck } from "../lib/exchanges/binance.js";
import { checkKey as kucoinCheck } from "../lib/exchanges/kucoin.js";
import { unseal } from "../lib/seal.js";
import { notify, esc } from "../lib/notify.js";

const log = (...a) => console.log(new Date().toISOString(), ...a);
const QUEUE = "cx:signals";
const MONITOR_MS = Number(process.env.MONITOR_MS || 3000);
const KEY_RECHECK_MS = 6 * 3600e3;
const isGateway = (e) => e?.gateway || e?.name === "TimeoutError" || /not answering|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|did not report/i.test(String(e?.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fx = (n, d = 2) => Number(n || 0).toFixed(d);
const pp = (n) => Number(Number(n).toPrecision(6));
const dayStart = () => new Date(new Date().setUTCHours(0, 0, 0, 0));
const exName = (c) => (c.exchange === "binance" ? "Binance" : "KuCoin") + (c.env === "demo" ? " (demo)" : "");

// ------------------------------------------------------------------ opening a trade from a signal
async function skip(sig, reason, user, tell = true) {
  await Signal.updateOne({ _id: sig._id }, { $set: { outcome: "skipped", reason } });
  log(`skip ${sig._id}: ${reason}`);
  if (user && tell) await notify(user, `⏭ Signal skipped (${esc(sig.parsed?.base || "?")}): ${esc(reason)}`);
}

// stop and targets for this entry price, from the signal or the group's own percentages
function plan(p, g, price) {
  let stop = g.slMode === "percent" || !p.stop ? price * (1 - g.slPercent / 100) : p.stop;
  if (!(stop < price)) return { error: `the stop loss ${pp(stop)} is not below the market price ${pp(price)}` };
  if (stop < price * 0.5) return { error: `the stop loss ${pp(stop)} is more than 50% below the price ${pp(price)}; that does not look like a real stop` };
  let tps = g.tpMode === "percent" || !p.targets?.length ? [price * (1 + g.tpPercent / 100)] : p.targets.filter((t) => t > price);
  if (!tps.length) return { error: "every target is already below the market price" };
  let shares;
  if (tps.length === 1 || g.tpSplit === "first") { tps = [tps[0]]; shares = [100]; }
  else if (g.tpSplit === "half") { tps = [tps[0], tps[tps.length - 1]]; shares = [50, 50]; }
  else shares = tps.map(() => 100 / tps.length);
  return { stop, targets: tps.map((x, i) => ({ price: x, share: shares[i], done: false })) };
}

// The key is re-checked every few hours before trading: it must still trade and still be unable to withdraw.
async function keyStillSafe(conn) {
  if (conn.checkedAt && Date.now() - new Date(conn.checkedAt).getTime() < KEY_RECHECK_MS) return true;
  const key = unseal(conn.keySealed), secret = unseal(conn.secretSealed);
  const r = conn.exchange === "binance" ? await binanceCheck(key, secret) : await kucoinCheck(key, secret, unseal(conn.passphraseSealed));
  if (/not answering/.test(r.error || "")) return true; // an outage is not a verdict on the key
  await Exchange.updateOne({ _id: conn._id }, r.ok ? { $set: { status: "ok", lastError: null, checkedAt: new Date(), usdtFree: r.usdtFree } } : { $set: { status: "error", lastError: r.error, checkedAt: new Date() } });
  return r.ok;
}

async function openTrade(signalId) {
  const sig = await Signal.findOneAndUpdate({ _id: signalId, outcome: "queued" }, { $set: { outcome: "processing" } }, { new: true }).lean();
  if (!sig) return; // already handled
  const [user, g] = await Promise.all([User.findById(sig.userId).lean(), Group.findById(sig.groupId).lean()]);
  if (!user || !g) return skip(sig, "the group no longer exists", null);
  if (user.botPaused) return skip(sig, "the bot is paused", user, false);
  const pl = planOf(user);
  if (pl === "none") return skip(sig, "no plan is active", user, false);
  if (!g.enabled || !g.exchangeId) return skip(sig, "this group is switched off", user, false);
  const p = sig.parsed;
  if (p?.side !== "long") return skip(sig, "not a long signal (spot trading buys only)", user, false);

  const conn = await Exchange.findOne({ _id: g.exchangeId, userId: user._id }).lean();
  if (!conn || conn.status !== "ok") return skip(sig, "the exchange key for this group is not working", user);
  if (!(await keyStillSafe(conn))) return skip(sig, "the exchange key failed its safety check (it may allow withdrawals now). Check it in Exchanges", user);
  const ex = adapterFor(conn);
  const symbol = ex.symbolFor(p.base);
  const info = await ex.info(symbol).catch(() => null);
  if (!info) return skip(sig, `${p.base}/USDT is not traded on ${exName(conn)}`, user);

  const live = ["opening", "open", "closing"];
  if ((await Trade.countDocuments({ userId: user._id, status: { $in: live } })) >= PLANS[pl].open) return skip(sig, `your plan allows ${PLANS[pl].open} open trades at a time`, user);
  const openGroup = await Trade.countDocuments({ groupId: g._id, status: { $in: live } });
  if (openGroup >= g.maxOpen) return skip(sig, `this group already has ${openGroup} open trades (limit ${g.maxOpen})`, user);
  if (await Trade.exists({ userId: user._id, symbol, exchangeId: conn._id, status: { $in: live } })) return skip(sig, `a ${p.base} trade is already open on this account`, user);
  if (g.dailyLossUsdt > 0) {
    const day = (await Trade.find({ groupId: g._id, status: "closed", closedAt: { $gte: dayStart() } }, { pnlUsdt: 1 }).lean()).reduce((a, t) => a + (t.pnlUsdt || 0), 0);
    if (day <= -g.dailyLossUsdt) return skip(sig, `the daily loss limit of ${g.dailyLossUsdt} USDT is reached for this group`, user);
  }

  const price = await ex.price(symbol);
  if (!(price > 0)) return skip(sig, "no market price", user);
  if (p.entryHigh && g.maxEntryGapPct > 0 && price > p.entryHigh * (1 + g.maxEntryGapPct / 100))
    return skip(sig, `price ${pp(price)} already ran ${fx((price / p.entryHigh - 1) * 100)}% above the entry ${p.entryHigh}`, user);
  if (p.stop && price <= p.stop) return skip(sig, `price ${pp(price)} is already at or below the stop ${p.stop}`, user);
  const pl2 = plan(p, g, price);
  if (pl2.error) return skip(sig, pl2.error, user);

  const free = await ex.usdtFree();
  let usdt = g.sizeMode === "percent" ? free * (g.sizePercent / 100) : g.sizeUsdt;
  usdt = Math.floor(usdt * 100) / 100;
  if (usdt > free) return skip(sig, `not enough USDT: ${fx(free)} free, the rule needs ${fx(usdt)}`, user);
  if (usdt < Math.max(info.minNotional || 5, 5)) return skip(sig, `trade size ${fx(usdt)} USDT is below the exchange minimum`, user);

  const trade = await Trade.create({ userId: user._id, groupId: g._id, signalId: sig._id, exchangeId: conn._id, exchange: conn.exchange, env: conn.env, symbol, base: p.base, status: "opening", stopPrice: pl2.stop, targets: pl2.targets });
  const clientId = `cx${trade._id}`;
  await Trade.updateOne({ _id: trade._id }, { $set: { clientOrderId: clientId } });

  let buy = null, refused = null;
  for (let attempt = 0; attempt < 4 && !buy && !refused; attempt++) {
    try { buy = attempt === 0 ? await ex.buy(symbol, p.base, usdt, clientId) : await ex.findBuy(symbol, p.base, clientId); }
    catch (e) { if (!isGateway(e)) refused = e; else await sleep(2500 * (attempt + 1)); }
  }
  if (!buy && !refused) buy = await ex.findBuy(symbol, p.base, clientId).catch(() => null); // last look
  if (!buy || !(buy.qty > 0)) {
    const why = refused ? `the exchange refused the buy: ${refused.message}` : "the exchange did not answer and no buy was found";
    await Trade.updateOne({ _id: trade._id }, { $set: { status: "failed", error: why } });
    await Signal.updateOne({ _id: sig._id }, { $set: { outcome: "error", reason: why, tradeId: trade._id } });
    await notify(user, `❌ ${esc(p.base)}: ${esc(why)}. No trade was opened.`);
    return;
  }
  await adopt(trade._id, buy, info, ex, symbol, pl2.stop, clientId);
  await Signal.updateOne({ _id: sig._id }, { $set: { outcome: "traded", tradeId: trade._id, reason: null } });
  log(`BUY ${conn.exchange} ${symbol} ${buy.net} @ ${buy.avg} (${fx(buy.quote)} USDT) stop ${pl2.stop}`);
  await notify(user, `✅ <b>Bought ${esc(p.base)}</b> on ${exName(conn)}\nSize ${fx(buy.quote)} USDT @ ${pp(buy.avg)}\nStop ${pp(pl2.stop)}\nTargets ${pl2.targets.map((t) => pp(t.price)).join(" · ")}\nGroup: ${esc(g.title)}`);
}

// record the buy and put the protective stop on the exchange (looked up first, so a restart never doubles it)
async function adopt(tradeId, buy, info, ex, symbol, stop, clientId) {
  const qty = floorTo(buy.net, info.step);
  let stopOrderId = await ex.findStop(symbol, `${clientId}s0`).catch(() => null);
  if (!stopOrderId) { try { stopOrderId = await ex.placeStop(symbol, qty, stop, info, `${clientId}s0`); } catch (e) { log(`stop on exchange failed ${symbol}: ${e.message} -> watched by the bot`); } }
  await Trade.updateOne({ _id: tradeId }, { $set: { status: "open", entryPrice: buy.avg, qty, qtyLeft: qty, costUsdt: buy.quote, feesUsdt: buy.feeUsdt, openedAt: new Date(), stopOrderId,
    fills: [{ kind: "BUY", price: buy.avg, qty: buy.qty, usdt: buy.quote, fee: buy.feeUsdt, at: new Date(), orderId: buy.orderId }] } });
}

// ------------------------------------------------------------------ managing open trades
const busy = new Set();
const connCache = new Map();
async function adapterOf(t) {
  const c = connCache.get(String(t.exchangeId));
  if (c && Date.now() - c.at < 60000) return c.ex;
  const conn = await Exchange.findById(t.exchangeId).lean();
  if (!conn) return null;
  const ex = adapterFor(conn);
  connCache.set(String(t.exchangeId), { at: Date.now(), ex });
  return ex;
}

const record = (t, kind, f) => {
  t.fills.push({ kind, price: f.avg, qty: f.qty, usdt: f.usdt, fee: f.feeUsdt, at: new Date(), orderId: f.orderId });
  t.qtyLeft = Math.max(0, Number((t.qtyLeft - f.qty).toFixed(12)));
  t.feesUsdt = (t.feesUsdt || 0) + (f.feeUsdt || 0);
};
const save = (t, extra = {}) => Trade.updateOne({ _id: t._id }, { $set: { fills: t.fills, qtyLeft: t.qtyLeft, feesUsdt: t.feesUsdt, stopOrderId: t.stopOrderId, stopPrice: t.stopPrice, targets: t.targets, error: null, ...extra } });

// Sell `qty` at market. Returns "stop" when the exchange stop filled meanwhile, true when sold, false when nothing
// could be sold. Every fill is saved at once; a failed sell puts the stop back.
async function sellPart(t, ex, info, qty, kind) {
  if (t.stopOrderId) {
    await ex.cancelStop(t.symbol, t.stopOrderId).catch(() => {});
    const f = await ex.stopFill(t.symbol, t.base, t.stopOrderId).catch(() => null); // filled before the cancel?
    if (f) { record(t, "STOP", f); t.stopOrderId = null; await save(t); return "stop"; }
    t.stopOrderId = null;
    await save(t);
  }
  const clientId = `cx${t._id}x${t.fills.length}`;
  let held = null;
  try { held = await ex.baseFree(t.base); } catch { /* use our own count */ }
  const q = floorTo(Math.min(qty, held ?? qty), info.step);
  if (!(q > 0) || q * (await ex.price(t.symbol)) < (info.minNotional || 1) * 0.5) return false;
  let s = null;
  try { s = await ex.sell(t.symbol, t.base, q, info.step, clientId); }
  catch (e) {
    s = await ex.findSell(t.symbol, t.base, clientId).catch(() => null); // landed after all?
    if (!s) {
      try { t.stopOrderId = await ex.placeStop(t.symbol, t.qtyLeft, t.stopPrice, info, `cx${t._id}s${t.fills.length}r${Date.now() % 1e6}`); } catch { /* watched by the bot */ }
      await save(t, { error: `sell failed: ${e.message}` });
      throw e;
    }
  }
  record(t, kind, s);
  await save(t);
  return true;
}

async function finish(t, outcome, user) {
  const sold = t.fills.filter((f) => f.kind !== "BUY");
  if (!sold.length) {
    await Trade.updateOne({ _id: t._id }, { $set: { status: "failed", error: "the coins are no longer on the account (sold outside Copixio?)", closedAt: new Date() } });
    await notify(user, `⚠️ ${esc(t.base)}: the coins are no longer on your account, so Copixio stopped managing this trade.`);
    return;
  }
  const usdt = sold.reduce((a, f) => a + f.usdt, 0), q = sold.reduce((a, f) => a + f.qty, 0);
  const exitPrice = q ? usdt / q : null;
  const pnl = usdt - t.costUsdt - (t.feesUsdt || 0);
  await Trade.updateOne({ _id: t._id }, { $set: { status: "closed", outcome, exitPrice, pnlUsdt: pnl, closedAt: new Date(), fills: t.fills, qtyLeft: 0, feesUsdt: t.feesUsdt, stopOrderId: null, closeRequested: false, targets: t.targets } });
  log(`CLOSED ${t.symbol} ${outcome} pnl ${fx(pnl)}`);
  await notify(user, `${pnl >= 0 ? "🟢" : "🔴"} <b>${esc(t.base)} closed: ${outcome}</b>\nResult ${pnl >= 0 ? "+" : ""}${fx(pnl)} USDT (exit ${exitPrice ? pp(exitPrice) : "?"})`);
}

const label = (t, end) => (t.targets.some((x) => x.done) ? (end === "SL" && Math.abs(t.stopPrice / t.entryPrice - 1) <= 0.003 ? "TP + BE" : `TP + ${end}`) : end);

// sell whatever is left and close
async function exitAll(t, ex, info, kind, end, user) {
  const r = await sellPart(t, ex, info, t.qtyLeft, kind);
  if (r === "stop" && t.qtyLeft * (await ex.price(t.symbol)) >= (info.minNotional || 5)) await sellPart(t, ex, info, t.qtyLeft, kind); // partial stop fill: sell the rest
  return finish(t, r === "stop" ? label(t, "SL") : label(t, end), user);
}

async function manage(id) {
  const t = await Trade.findOne({ _id: id, status: "open" }).lean(); // fresh read under the busy lock
  if (!t) return;
  t.fills ||= []; t.targets ||= [];
  const ex = await adapterOf(t);
  if (!ex) return;
  const user = await User.findById(t.userId, { notifyChatId: 1 }).lean();
  const info = await ex.info(t.symbol);
  const px = await ex.price(t.symbol);
  if (!(px > 0) || !info) return;

  // 1. the stop on the exchange filled (fully, or partly and stopped)
  if (t.stopOrderId) {
    const f = await ex.stopFill(t.symbol, t.base, t.stopOrderId).catch(() => null);
    if (f) {
      record(t, "STOP", f); t.stopOrderId = null; await save(t);
      if (t.qtyLeft * px >= (info.minNotional || 5)) await sellPart(t, ex, info, t.qtyLeft, "STOP").catch(() => {});
      return finish(t, label(t, "SL"), user);
    }
  }
  // 2. close requested from the dashboard
  if (t.closeRequested) return exitAll(t, ex, info, "MANUAL", "MANUAL", user);
  // 3. price went through the stop and no exchange stop filled (gap, or no stop order): sell at market
  if (px <= t.stopPrice * (t.stopOrderId ? 0.993 : 1)) return exitAll(t, ex, info, "STOP", "SL", user);
  // 4. targets, in order
  const next = t.targets.find((x) => !x.done);
  if (!next || px < next.price) return;
  const remaining = t.targets.filter((x) => !x.done).length;
  let qty = remaining === 1 ? t.qtyLeft : floorTo(t.qty * (next.share / 100), info.step);
  const small = (x) => x * px < (info.minNotional || 5) || x < (info.minQty || 0);
  if (remaining > 1 && (small(qty) || small(t.qtyLeft - qty))) qty = t.qtyLeft; // too small to split: take it all here
  const r = await sellPart(t, ex, info, qty, "TP");
  if (r === "stop") return finish(t, label(t, "SL"), user);
  if (r === false && !(t.qtyLeft > 0)) return finish(t, "TP", user);
  next.done = true;
  if (qty >= t.qtyLeft || !(t.qtyLeft > 0) || small(t.qtyLeft)) { t.targets.forEach((x) => { x.done = true; }); await save(t); return finish(t, "TP", user); }
  const g = await Group.findById(t.groupId, { moveSlToEntry: 1 }).lean();
  if (g?.moveSlToEntry && t.stopPrice < t.entryPrice) t.stopPrice = t.entryPrice * 1.002; // fees covered
  try { t.stopOrderId = await ex.placeStop(t.symbol, t.qtyLeft, t.stopPrice, info, `cx${t._id}s${t.fills.length}`); } catch { t.stopOrderId = null; }
  await save(t);
  await notify(user, `🎯 <b>${esc(t.base)} target hit</b> at ${pp(px)}. ${t.qtyLeft} left, stop now ${pp(t.stopPrice)}.`);
}

async function monitor() {
  const ids = (await Trade.find({ status: "open" }, { _id: 1 }).lean()).map((x) => String(x._id));
  await Promise.all(ids.map(async (id) => {
    if (busy.has(id)) return;
    busy.add(id);
    try { await manage(id); }
    catch (e) { log(`manage ${id}: ${e.message}`); }
    finally { busy.delete(id); }
  }));
}

// ------------------------------------------------------------------ start-up recovery and main loop
async function recover() {
  // trades left "opening" by a crash: adopt the buy if it landed, otherwise mark it failed
  for (const t of await Trade.find({ status: "opening" }).lean()) {
    try {
      const ex = await adapterOf(t);
      const info = ex && (await ex.info(t.symbol));
      const buy = ex && t.clientOrderId ? await ex.findBuy(t.symbol, t.base, t.clientOrderId) : null;
      if (buy && info) { await adopt(t._id, buy, info, ex, t.symbol, t.stopPrice, t.clientOrderId); log(`adopted ${t.symbol} ${t._id} after a restart`); }
      else await Trade.updateOne({ _id: t._id }, { $set: { status: "failed", error: "interrupted before the buy was placed" } });
    } catch (e) { log(`recover ${t._id}: ${e.message}`); }
  }
  // signals left "processing": traded if a trade exists, otherwise an interrupted signal
  for (const s of await Signal.find({ outcome: "processing", updatedAt: { $lt: new Date(Date.now() - 120000) } }, { _id: 1 }).lean()) {
    const tr = await Trade.findOne({ signalId: s._id }, { _id: 1, status: 1 }).lean();
    await Signal.updateOne({ _id: s._id }, { $set: tr && tr.status !== "failed" ? { outcome: "traded", tradeId: tr._id } : { outcome: "error", reason: "interrupted by a restart" } });
  }
}

async function main() {
  await db();
  log("copixio-trader up");
  await recover();
  setInterval(() => monitor().catch((e) => log("monitor:", e.message)), MONITOR_MS);
  const r = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379"); // no command timeout: BRPOP blocks
  for (;;) {
    try {
      const item = await r.brpop(QUEUE, 5);
      if (!item) continue;
      await openTrade(item[1]).catch(async (e) => {
        log(`open ${item[1]}: ${e.message}`);
        await Signal.updateOne({ _id: item[1], outcome: "processing" }, { $set: { outcome: "error", reason: e.message } });
      });
    } catch (e) { log("queue:", e.message); await sleep(2000); }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
