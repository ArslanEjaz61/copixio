// pm2 "copixio-trader": turns queued signals into orders and manages open trades (targets, stop loss, manual close).
//
// Safety rules:
//  - a signal is claimed atomically (queued -> processing), so two workers or a restart never trade it twice;
//  - every order carries our client id; after any unclear answer we ask the exchange whether it landed instead of
//    ordering again; a sell that landed is always recorded (never a "closed" trade with no exit);
//  - the stop loss also sits ON the exchange (stop-limit), so a position stays protected while this worker is down;
//    whenever the bot cancels it (to sell a target) and the sell does not go through, the stop is put back;
//  - one trade is managed by one loop at a time, always from a fresh read of the database.
// 24 Nov: futures (lib/exchanges/futures.js). A group trades on spot, futures or both: spot = longs only; futures =
// long and short; both = a long is bought on spot AND opened on futures, a short goes to futures. Futures run on
// isolated margin with the group's leverage; their stop is watched by this worker (no stop order on the exchange).
try { process.loadEnvFile(new URL("../.env", import.meta.url)); } catch { /* env from pm2 */ }
import Redis from "ioredis";
import { db } from "../lib/db.js";
import { redis as rds } from "../lib/redis.js";
import { Exchange, Group, Signal, Trade, User, PLANS, planOf } from "../lib/models.js";
import { adapterFor, floorTo } from "../lib/exchanges/adapter.js";
import { futuresFor } from "../lib/exchanges/futures.js";
import { checkKeyFor } from "../lib/exchanges/check.js";
import { exchangeName } from "../lib/exchanges/list.js";
import { unseal } from "../lib/seal.js";
import { notify, esc } from "../lib/notify.js";
import { bridgeOnline, enqueue, sweep as mt5Sweep, tradeComment, waitResult } from "../lib/mt5.js";

const log = (...a) => console.log(new Date().toISOString(), ...a);
const QUEUE = "cx:signals";
const MONITOR_MS = Number(process.env.MONITOR_MS || 3000);
const KEY_RECHECK_MS = 6 * 3600e3;
const isGateway = (e) => e?.gateway || e?.name === "TimeoutError" || /not answering|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|did not report/i.test(String(e?.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fx = (n, d = 2) => Number(n || 0).toFixed(d);
const pp = (n) => Number(Number(n).toPrecision(6));
const dayStart = () => new Date(new Date().setUTCHours(0, 0, 0, 0));
const exName = (c) => exchangeName(c.exchange) + (c.env === "demo" ? " (demo)" : "");
const LIVE = ["opening", "open", "closing"];

// ------------------------------------------------------------------ opening a trade from a signal
async function skip(sig, reason, user, tell = true) {
  await Signal.updateOne({ _id: sig._id }, { $set: { outcome: "skipped", reason } });
  log(`skip ${sig._id}: ${reason}`);
  if (user && tell) await notify(user, `⏭ Signal skipped (${esc(sig.parsed?.base || "?")}): ${esc(reason)}`);
}

// stop and targets for this entry price, from the signal or the group's own percentages (long)
function plan(p, g, price) {
  let stop = g.slMode === "percent" || !p.stop ? price * (1 - g.slPercent / 100) : p.stop;
  if (!(stop < price)) return { error: `the stop loss ${pp(stop)} is not below the market price ${pp(price)}` };
  if (stop < price * 0.5) return { error: `the stop loss ${pp(stop)} is more than 50% below the price ${pp(price)}; that does not look like a real stop` };
  let tps = g.tpMode === "percent" || !p.targets?.length ? [price * (1 + g.tpPercent / 100)] : p.targets.filter((t) => t > price);
  if (!tps.length) return { error: "every target is already below the market price" };
  return { stop, targets: split(tps, g) };
}
// the same for a short: stop above, targets below (nearest first)
function planShort(p, g, price) {
  let stop = g.slMode === "percent" || !p.stop ? price * (1 + g.slPercent / 100) : p.stop;
  if (!(stop > price)) return { error: `the stop loss ${pp(stop)} is not above the market price ${pp(price)}` };
  if (stop > price * 1.5) return { error: `the stop loss ${pp(stop)} is more than 50% above the price ${pp(price)}; that does not look like a real stop` };
  let tps = g.tpMode === "percent" || !p.targets?.length ? [price * (1 - g.tpPercent / 100)] : p.targets.filter((t) => t < price).sort((a, b) => b - a);
  if (!tps.length) return { error: "every target is already above the market price" };
  return { stop, targets: split(tps, g) };
}
function split(tps, g) {
  let shares;
  if (tps.length === 1 || g.tpSplit === "first") { tps = [tps[0]]; shares = [100]; }
  else if (g.tpSplit === "half") { tps = [tps[0], tps[tps.length - 1]]; shares = [50, 50]; }
  else shares = tps.map(() => 100 / tps.length);
  return tps.map((x, i) => ({ price: x, share: shares[i], done: false }));
}

// ------------------------------------------------------------------ MetaTrader 5 (25 Nov)
// The order is queued for the user's own terminal (the Copixio EA, lib/mt5.js) and answered within a few seconds. One
// position per signal, with the stop loss and the first target set ON the broker's side. Forex, gold, indices come as
// "XAUUSD"; a crypto signal ("BTC") goes to the broker's CFD ("BTCUSD").
async function openMt5(sig, user, g, conn, p, pl, side) {
  if (conn.status !== "ok") return skip(sig, "the MetaTrader 5 connection is not working", user);
  if (!bridgeOnline(conn)) {
    const seen = conn.bridge?.lastSeenAt ? `${Math.round((Date.now() - new Date(conn.bridge.lastSeenAt).getTime()) / 60e3)} min ago` : "never";
    return skip(sig, `your MetaTrader 5 terminal is offline (the Copixio EA last reported ${seen}). Open MetaTrader 5 with the EA running and AutoTrading on`, user);
  }
  const symbol = p.fx ? p.base : `${p.base}USD`;
  if ((await Trade.countDocuments({ userId: user._id, status: { $in: LIVE } })) >= PLANS[pl].open) return skip(sig, `your plan allows ${PLANS[pl].open} open trades at a time`, user);
  const openGroup = await Trade.countDocuments({ groupId: g._id, status: { $in: LIVE } });
  if (openGroup >= g.maxOpen) return skip(sig, `this group already has ${openGroup} open trades (limit ${g.maxOpen})`, user, false);
  if (await Trade.exists({ userId: user._id, symbol, exchangeId: conn._id, status: { $in: LIVE } })) return skip(sig, `a ${symbol} trade is already open on this account`, user, false);
  if (await dailyLossHit(g)) return skip(sig, `the daily loss limit of ${g.dailyLossUsdt} is reached for this group`, user, false);

  const long = side === "long";
  const entry = p.entryLow && p.entryHigh ? (p.entryLow + p.entryHigh) / 2 : null;
  const sl = g.slMode === "signal" && p.stop > 0 ? p.stop : null;
  const tps = (p.targets || []).filter((t) => t > 0 && (entry ? (long ? t > entry : t < entry) : true)).sort((a, b) => (long ? a - b : b - a));
  const tp = g.tpMode === "signal" && tps.length ? tps[0] : null; // the nearest target
  if (entry && sl && (long ? !(sl < entry) : !(sl > entry))) return skip(sig, `the stop ${pp(sl)} is on the wrong side of the entry ${pp(entry)} for a ${side}`, user);
  if (sl && tp && (long ? !(sl < tp) : !(sl > tp))) return skip(sig, `the stop ${pp(sl)} and the target ${pp(tp)} do not fit a ${side}`, user);
  const size = g.riskUsd > 0 ? { risk: g.riskUsd } : { lots: g.lots || 0.01 };

  const trade = await Trade.create({ userId: user._id, groupId: g._id, signalId: sig._id, exchangeId: conn._id, exchange: "mt5", env: conn.env, symbol, base: p.base, market: "cfd", side, status: "opening",
    stopPrice: sl, targets: tp ? [{ price: tp, share: 100, done: false }] : [] });
  await Trade.updateOne({ _id: trade._id }, { $set: { clientOrderId: tradeComment(trade._id) } });
  const cmd = await enqueue(conn, trade._id, "open", { symbol, side: long ? "buy" : "sell", ...size, sl, tp, slPct: sl ? 0 : g.slPercent, tpPct: tp ? 0 : g.tpPercent, entry, gapPct: g.maxEntryGapPct, comment: tradeComment(trade._id) });
  const res = await waitResult(cmd._id, 40000);
  if (!res) return { tradeId: trade._id }; // no answer yet: the terminal may still confirm it; the sweep fails it after 2.5 minutes
  const r = res.result || {};
  if (res.status !== "done" || !r.ok) {
    const why = r.message || "the terminal refused the order";
    await Trade.updateOne({ _id: trade._id, status: "opening" }, { $set: { status: "failed", error: why } });
    await notify(user, `❌ ${esc(symbol)}: ${esc(why)}. No trade was opened.`);
    return { error: why };
  }
  log(`MT5 ${side} ${symbol} ${r.volume} lots @ ${r.price} (${conn.env})`);
  await notify(user, `✅ <b>${long ? "Bought" : "Sold"} ${esc(symbol)}</b> on MetaTrader 5 (${conn.env === "demo" ? "demo" : "live"})\n${fx(r.volume, 2)} lots @ ${pp(r.price)}\nStop ${sl ? pp(sl) : `${g.slPercent}% away`}${tp ? ` · Target ${pp(tp)}` : ` · Target ${g.tpPercent}% away`}\nGroup: ${esc(g.title)}`);
  return { tradeId: trade._id };
}

// The key is re-checked every few hours before trading: it must still trade and still be unable to withdraw.
async function keyStillSafe(conn) {
  if (conn.checkedAt && Date.now() - new Date(conn.checkedAt).getTime() < KEY_RECHECK_MS) return true;
  const key = unseal(conn.keySealed), secret = unseal(conn.secretSealed);
  const r = await checkKeyFor(conn.exchange, key, secret, conn.passphraseSealed ? unseal(conn.passphraseSealed) : undefined);
  if (/not answering/.test(r.error || "")) return true; // an outage is not a verdict on the key
  await Exchange.updateOne({ _id: conn._id }, r.ok ? { $set: { status: "ok", lastError: null, checkedAt: new Date(), usdtFree: r.usdtFree } } : { $set: { status: "error", lastError: r.error, checkedAt: new Date() } });
  return r.ok;
}

async function dailyLossHit(g) {
  if (!(g.dailyLossUsdt > 0)) return false;
  const day = (await Trade.find({ groupId: g._id, status: "closed", closedAt: { $gte: dayStart() } }, { pnlUsdt: 1 }).lean()).reduce((a, t) => a + (t.pnlUsdt || 0), 0);
  return day <= -g.dailyLossUsdt;
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
  const market = g.market || "spot";
  const side = p?.side === "short" ? "short" : p?.side === "long" ? "long" : null;
  if (!side) return skip(sig, "no direction in the signal", user, false);
  const conn = await Exchange.findOne({ _id: g.exchangeId, userId: user._id }).lean();
  if (conn?.exchange === "mt5") { // 25 Nov: MetaTrader 5 through the EA
    const r = await openMt5(sig, user, g, conn, p, pl, side).catch((e) => ({ error: e.message }));
    if (r?.tradeId) await Signal.updateOne({ _id: sig._id }, { $set: { outcome: "traded", tradeId: r.tradeId } });
    else if (r?.error) await Signal.updateOne({ _id: sig._id }, { $set: { outcome: "error", reason: r.error } });
    return; // skip() already recorded a skipped signal
  }
  if (p.fx) return skip(sig, "a forex / gold signal; this group trades crypto (connect MetaTrader 5 to trade it)", user, false);
  // which legs this signal opens
  const legs = market === "spot" ? (side === "long" ? ["spot"] : []) : market === "futures" ? ["futures"] : side === "long" ? ["spot", "futures"] : ["futures"];
  if (!legs.length) return skip(sig, "a short signal; this group trades spot only (choose Futures or Both to trade shorts)", user, false);

  if (!conn || conn.status !== "ok") return skip(sig, "the exchange key for this group is not working", user);
  if (!(await keyStillSafe(conn))) return skip(sig, "the exchange key failed its safety check (it may allow withdrawals now). Check it in Exchanges", user);

  const results = [];
  for (const leg of legs) {
    const r = await (leg === "spot" ? openSpot(sig, user, g, conn, p, pl) : openFutures(sig, user, g, conn, p, pl, side))
      .catch((e) => ({ error: e.message }));
    results.push({ leg, ...r });
  }
  const tag = (r) => (legs.length > 1 ? `${r.leg}: ` : "");
  const traded = results.filter((r) => r.tradeId);
  const notOk = results.filter((r) => !r.tradeId);
  for (const r of notOk) if (r.skip) { log(`skip ${sig._id} ${r.leg}: ${r.skip}`); if (r.tell !== false) await notify(user, `⏭ ${legs.length > 1 ? `${r.leg[0].toUpperCase()}${r.leg.slice(1)} ` : ""}signal skipped (${esc(p.base)}): ${esc(r.skip)}`); }
  const reason = notOk.map((r) => tag(r) + (r.skip || r.error)).join(" · ") || null;
  if (traded.length) await Signal.updateOne({ _id: sig._id }, { $set: { outcome: "traded", tradeId: traded[0].tradeId, reason } });
  else await Signal.updateOne({ _id: sig._id }, { $set: { outcome: notOk.some((r) => r.error) ? "error" : "skipped", reason } });
}

// spot: buy (longs only)
async function openSpot(sig, user, g, conn, p, pl) {
  const ex = adapterFor(conn);
  const symbol = ex.symbolFor(p.base);
  const info = await ex.info(symbol).catch(() => null);
  if (!info) return { skip: `${p.base}/USDT is not traded on ${exName(conn)}` };

  if ((await Trade.countDocuments({ userId: user._id, status: { $in: LIVE } })) >= PLANS[pl].open) return { skip: `your plan allows ${PLANS[pl].open} open trades at a time` };
  const openGroup = await Trade.countDocuments({ groupId: g._id, status: { $in: LIVE } });
  if (openGroup >= g.maxOpen) return { skip: `this group already has ${openGroup} open trades (limit ${g.maxOpen})` };
  if (await Trade.exists({ userId: user._id, symbol, exchangeId: conn._id, status: { $in: LIVE } })) return { skip: `a ${p.base} trade is already open on this account` };
  if (await dailyLossHit(g)) return { skip: `the daily loss limit of ${g.dailyLossUsdt} USDT is reached for this group` };

  const price = await ex.price(symbol);
  if (!(price > 0)) return { skip: "no market price" };
  if (p.entryHigh && g.maxEntryGapPct > 0 && price > p.entryHigh * (1 + g.maxEntryGapPct / 100))
    return { skip: `price ${pp(price)} already ran ${fx((price / p.entryHigh - 1) * 100)}% above the entry ${p.entryHigh}` };
  if (p.stop && price <= p.stop) return { skip: `price ${pp(price)} is already at or below the stop ${p.stop}` };
  const pl2 = plan(p, g, price);
  if (pl2.error) return { skip: pl2.error };

  const free = await ex.usdtFree();
  let usdt = g.sizeMode === "percent" ? free * (g.sizePercent / 100) : g.sizeUsdt;
  usdt = Math.floor(usdt * 100) / 100;
  if (usdt > free) return { skip: `not enough USDT: ${fx(free)} free, the rule needs ${fx(usdt)}` };
  if (usdt < Math.max(info.minNotional || 5, 5)) return { skip: `trade size ${fx(usdt)} USDT is below the exchange minimum` };

  const trade = await Trade.create({ userId: user._id, groupId: g._id, signalId: sig._id, exchangeId: conn._id, exchange: conn.exchange, env: conn.env, symbol, base: p.base, market: "spot", side: "long", status: "opening", stopPrice: pl2.stop, targets: pl2.targets });
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
    await notify(user, `❌ ${esc(p.base)}: ${esc(why)}. No trade was opened.`);
    return { error: why };
  }
  await adopt(trade._id, buy, info, ex, symbol, pl2.stop, clientId);
  log(`BUY ${conn.exchange} ${symbol} ${buy.net} @ ${buy.avg} (${fx(buy.quote)} USDT) stop ${pl2.stop}`);
  await notify(user, `✅ <b>Bought ${esc(p.base)}</b> on ${exName(conn)} (spot)\nSize ${fx(buy.quote)} USDT @ ${pp(buy.avg)}\nStop ${pp(pl2.stop)}\nTargets ${pl2.targets.map((t) => pp(t.price)).join(" · ")}\nGroup: ${esc(g.title)}`);
  return { tradeId: trade._id };
}

// record the buy and put the protective stop on the exchange (looked up first, so a restart never doubles it)
async function adopt(tradeId, buy, info, ex, symbol, stop, clientId) {
  const qty = floorTo(buy.net, info.step);
  let stopOrderId = await ex.findStop(symbol, `${clientId}s0`).catch(() => null);
  if (!stopOrderId) { try { stopOrderId = await ex.placeStop(symbol, qty, stop, info, `${clientId}s0`); } catch (e) { log(`stop on exchange failed ${symbol}: ${e.message} -> watched by the bot`); } }
  await Trade.updateOne({ _id: tradeId }, { $set: { status: "open", entryPrice: buy.avg, qty, qtyLeft: qty, costUsdt: buy.quote, feesUsdt: buy.feeUsdt, openedAt: new Date(), stopOrderId,
    fills: [{ kind: "BUY", price: buy.avg, qty: buy.qty, usdt: buy.quote, fee: buy.feeUsdt, at: new Date(), orderId: buy.orderId }] } });
}

// futures: long or short, isolated margin at the group's leverage
async function openFutures(sig, user, g, conn, p, pl, side) {
  const fut = futuresFor(conn);
  if (!fut) return { skip: `futures on ${exName(conn)} are not supported by Copixio yet (Binance, KuCoin, OKX, Bitget and HTX are)` };
  const symbol = fut.symbolFor(p.base);
  const info = await fut.info(symbol).catch(() => null);
  if (!info) return { skip: `${p.base} USDT perpetual is not traded on ${exName(conn)} futures` };

  if ((await Trade.countDocuments({ userId: user._id, status: { $in: LIVE } })) >= PLANS[pl].open) return { skip: `your plan allows ${PLANS[pl].open} open trades at a time` };
  const openGroup = await Trade.countDocuments({ groupId: g._id, status: { $in: LIVE } });
  if (openGroup >= g.maxOpen) return { skip: `this group already has ${openGroup} open trades (limit ${g.maxOpen})` };
  if (await Trade.exists({ userId: user._id, symbol, exchangeId: conn._id, market: "futures", status: { $in: LIVE } })) return { skip: `a ${p.base} futures position is already open on this account` };
  if (await dailyLossHit(g)) return { skip: `the daily loss limit of ${g.dailyLossUsdt} USDT is reached for this group` };

  const price = await fut.price(symbol);
  if (!(price > 0)) return { skip: "no market price" };
  // the same ticker can be a different coin on another exchange (OKX "ON" = 61.7 while ON is 0.117 elsewhere)
  const ref = p.entryLow || p.entryHigh || p.stop || p.targets?.[0];
  if (ref > 0 && (price > ref * 1.5 || price < ref * 0.5)) return { skip: `${p.base} futures on ${exName(conn)} trade at ${pp(price)}, far from the signal's ${pp(ref)}: probably a different coin with the same ticker` };
  const long = side === "long";
  if (long && p.entryHigh && g.maxEntryGapPct > 0 && price > p.entryHigh * (1 + g.maxEntryGapPct / 100))
    return { skip: `price ${pp(price)} already ran ${fx((price / p.entryHigh - 1) * 100)}% above the entry ${p.entryHigh}` };
  if (!long && p.entryLow && g.maxEntryGapPct > 0 && price < p.entryLow * (1 - g.maxEntryGapPct / 100))
    return { skip: `price ${pp(price)} already fell ${fx((1 - price / p.entryLow) * 100)}% below the entry ${p.entryLow}` };
  if (p.stop && (long ? price <= p.stop : price >= p.stop)) return { skip: `price ${pp(price)} is already past the stop ${p.stop}` };
  const pl2 = long ? plan(p, g, price) : planShort(p, g, price);
  if (pl2.error) return { skip: pl2.error };

  const lev = Math.max(1, Math.min(Math.round(g.leverage || 5), info.maxLeverage || 125));
  const stopDist = Math.abs(pl2.stop / price - 1);
  if (stopDist >= 0.9 / lev) return { skip: `the stop is ${fx(stopDist * 100)}% away, past the liquidation price at ${lev}x. Lower the leverage or use a closer stop` };

  const free = await fut.usdtFree();
  let margin = g.sizeMode === "percent" ? free * (g.sizePercent / 100) : g.sizeUsdt;
  margin = Math.floor(margin * 100) / 100;
  if (margin > free) return { skip: `not enough USDT in the futures wallet: ${fx(free)} free, the rule needs ${fx(margin)}` };
  const cs = info.contractSize || 1;
  const contracts = floorTo((margin * lev) / (price * cs), info.step);
  if (!(contracts > 0) || contracts < (info.minQty || 0) || contracts * cs * price < Math.max(info.minNotional || 5, 5))
    return { skip: `trade size ${fx(margin)} USDT x ${lev} is below the exchange minimum for ${p.base}` };

  const trade = await Trade.create({ userId: user._id, groupId: g._id, signalId: sig._id, exchangeId: conn._id, exchange: conn.exchange, env: conn.env, symbol, base: p.base,
    market: "futures", side, leverage: lev, marginUsdt: margin, contractSize: cs, status: "opening", stopPrice: pl2.stop, targets: pl2.targets });
  const clientId = `cx${trade._id}`;
  await Trade.updateOne({ _id: trade._id }, { $set: { clientOrderId: clientId } });

  try { await fut.prepare(symbol, lev); }
  catch (e) {
    const why = `could not set ${lev}x isolated on ${exName(conn)} futures: ${e.message}`;
    await Trade.updateOne({ _id: trade._id }, { $set: { status: "failed", error: why } });
    return { error: why };
  }
  let fill = null, refused = null;
  for (let attempt = 0; attempt < 4 && !fill && !refused; attempt++) {
    try { fill = attempt === 0 ? await fut.open(symbol, side, contracts, clientId, info, lev) : await fut.findOpen(symbol, clientId, info); }
    catch (e) { if (!isGateway(e)) refused = e; else await sleep(2500 * (attempt + 1)); }
  }
  if (!fill && !refused) fill = await fut.findOpen(symbol, clientId, info).catch(() => null);
  if (!fill || !(fill.qty > 0)) {
    const why = refused ? `the exchange refused the order: ${refused.message}` : "the exchange did not answer and no order was found";
    await Trade.updateOne({ _id: trade._id }, { $set: { status: "failed", error: why } });
    await notify(user, `❌ ${esc(p.base)} futures: ${esc(why)}. No position was opened.`);
    return { error: why };
  }
  await adoptFutures(trade._id, fill, info);
  log(`OPEN ${side.toUpperCase()} ${conn.exchange} ${symbol} ${fill.qty} @ ${fill.avg} (${fx(fill.usdt)} USDT, ${lev}x) stop ${pl2.stop}`);
  await notify(user, `✅ <b>${long ? "Long" : "Short"} ${esc(p.base)}</b> on ${exName(conn)} futures, ${lev}x isolated\nMargin ${fx(margin)} USDT (position ${fx(fill.usdt)}) @ ${pp(fill.avg)}\nStop ${pp(pl2.stop)}\nTargets ${pl2.targets.map((t) => pp(t.price)).join(" · ")}\nGroup: ${esc(g.title)}`);
  return { tradeId: trade._id };
}

async function adoptFutures(tradeId, fill, info) {
  const qty = floorTo(fill.qty, info.step);
  await Trade.updateOne({ _id: tradeId }, { $set: { status: "open", entryPrice: fill.avg, qty, qtyLeft: qty, costUsdt: fill.usdt, feesUsdt: fill.feeUsdt, openedAt: new Date(), stopOrderId: null,
    fills: [{ kind: "OPEN", price: fill.avg, qty: fill.qty, usdt: fill.usdt, fee: fill.feeUsdt, at: new Date(), orderId: fill.orderId }] } });
}

// ------------------------------------------------------------------ managing open trades
// 26 Nov: the price each check reads is kept 2 min for the Trades page's live P&L (/api/trades/live)
const livePx = (t, px) => rds().set(`cx:px:${t._id}`, JSON.stringify({ px, at: Date.now() }), "EX", 120).catch(() => {});
const busy = new Set();
const connCache = new Map();
async function adapterOf(t) {
  const key = `${t.market === "futures" ? "f" : "s"}:${t.exchangeId}`;
  const c = connCache.get(key);
  if (c && Date.now() - c.at < 60000) return c.ex;
  const conn = await Exchange.findById(t.exchangeId).lean();
  if (!conn) return null;
  const ex = t.market === "futures" ? futuresFor(conn) : adapterFor(conn);
  connCache.set(key, { at: Date.now(), ex });
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
  if (t.market === "futures") return manageFutures(t);
  const ex = await adapterOf(t);
  if (!ex) return;
  const user = await User.findById(t.userId, { notifyChatId: 1 }).lean();
  const info = await ex.info(t.symbol);
  const px = await ex.price(t.symbol);
  if (!(px > 0) || !info) return;
  livePx(t, px);

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

// ---- futures positions (long or short)
const goneSeen = new Map(); // trade id -> empty position readings in a row
// close `qty` contracts reduce-only; true when closed, false when nothing is left to close
async function closePart(t, fut, info, qty, kind) {
  const clientId = `cx${t._id}x${t.fills.length}`;
  const held = await fut.held(t.symbol, t.side).catch(() => null);
  const q = floorTo(Math.min(qty, held > 0 ? held : qty), info.step); // a 0 reading is not trusted here (manageFutures decides "gone")
  if (!(q > 0)) return false;
  let s = null;
  try { s = await fut.close(t.symbol, t.side, q, clientId, info); }
  catch (e) {
    s = await fut.findClose(t.symbol, clientId, info).catch(() => null);
    if (!s) { await save(t, { error: `close failed: ${e.message}` }); throw e; }
  }
  record(t, kind, s);
  await save(t);
  return true;
}

async function finishFutures(t, outcome, user) {
  const closes = t.fills.filter((f) => f.kind !== "OPEN");
  if (!closes.length) {
    await Trade.updateOne({ _id: t._id }, { $set: { status: "failed", error: "the position is no longer open on the exchange (closed outside Copixio, or liquidated)", closedAt: new Date() } });
    await notify(user, `⚠️ ${esc(t.base)} futures: the position is no longer open on your account (closed outside Copixio, or liquidated). Copixio stopped managing it.`);
    return;
  }
  const usdt = closes.reduce((a, f) => a + f.usdt, 0), q = closes.reduce((a, f) => a + f.qty, 0);
  const cs = t.contractSize || 1;
  const exitPrice = q ? usdt / (q * cs) : null;
  const entryNotional = (t.costUsdt || 0) * (q / (t.qty || q)); // the part of the position that was closed
  const pnl = (t.side === "short" ? entryNotional - usdt : usdt - entryNotional) - (t.feesUsdt || 0);
  await Trade.updateOne({ _id: t._id }, { $set: { status: "closed", outcome, exitPrice, pnlUsdt: pnl, closedAt: new Date(), fills: t.fills, qtyLeft: 0, feesUsdt: t.feesUsdt, closeRequested: false, targets: t.targets } });
  log(`CLOSED ${t.side} ${t.symbol} ${outcome} pnl ${fx(pnl)}`);
  await notify(user, `${pnl >= 0 ? "🟢" : "🔴"} <b>${esc(t.base)} ${t.side} closed: ${outcome}</b> (futures ${t.leverage}x)\nResult ${pnl >= 0 ? "+" : ""}${fx(pnl)} USDT on ${fx(t.marginUsdt)} margin (exit ${exitPrice ? pp(exitPrice) : "?"})`);
}

async function exitFutures(t, fut, info, kind, end, user) {
  const r = await closePart(t, fut, info, t.qtyLeft, kind);
  if (r === false && !t.fills.some((f) => f.kind !== "OPEN")) return finishFutures(t, end, user); // nothing was ever closed: gone
  return finishFutures(t, label(t, end), user);
}

async function manageFutures(t) {
  const fut = await adapterOf(t);
  if (!fut) return;
  const user = await User.findById(t.userId, { notifyChatId: 1 }).lean();
  const info = await fut.info(t.symbol);
  const px = await fut.price(t.symbol);
  if (!(px > 0) || !info) return;
  livePx(t, px);
  const long = t.side !== "short";
  const cs = t.contractSize || info.contractSize || 1;

  // the position vanished (liquidated / closed by hand on the exchange)
  // (two empty readings in a row, never in the first 30 s: an exchange can report a fresh position late)
  const held = await fut.held(t.symbol, t.side).catch(() => null);
  const id = String(t._id);
  if (held === 0 && Date.now() - new Date(t.openedAt).getTime() > 30000) {
    goneSeen.set(id, (goneSeen.get(id) || 0) + 1);
    if (goneSeen.get(id) >= 2) {
      goneSeen.delete(id);
      if (t.fills.some((f) => f.kind !== "OPEN")) return finishFutures(t, label(t, "CLOSED OUTSIDE"), user);
      return finishFutures(t, "GONE", user);
    }
    return;
  }
  goneSeen.delete(id);
  if (t.closeRequested) return exitFutures(t, fut, info, "MANUAL", "MANUAL", user);
  if (long ? px <= t.stopPrice : px >= t.stopPrice) return exitFutures(t, fut, info, "STOP", "SL", user);
  const next = t.targets.find((x) => !x.done);
  if (!next || (long ? px < next.price : px > next.price)) return;
  const remaining = t.targets.filter((x) => !x.done).length;
  let qty = remaining === 1 ? t.qtyLeft : floorTo(t.qty * (next.share / 100), info.step);
  const small = (x) => x * cs * px < (info.minNotional || 5) || x < (info.minQty || 0);
  if (remaining > 1 && (small(qty) || small(t.qtyLeft - qty))) qty = t.qtyLeft;
  const r = await closePart(t, fut, info, qty, "TP");
  if (r === false) return finishFutures(t, "TP", user);
  next.done = true;
  if (qty >= t.qtyLeft || !(t.qtyLeft > 0) || small(t.qtyLeft)) { t.targets.forEach((x) => { x.done = true; }); await save(t); return finishFutures(t, "TP", user); }
  const g = await Group.findById(t.groupId, { moveSlToEntry: 1 }).lean();
  if (g?.moveSlToEntry) {
    if (long && t.stopPrice < t.entryPrice) t.stopPrice = t.entryPrice * 1.002;
    if (!long && t.stopPrice > t.entryPrice) t.stopPrice = t.entryPrice * 0.998;
  }
  await save(t);
  await notify(user, `🎯 <b>${esc(t.base)} ${t.side} target hit</b> at ${pp(px)}. ${t.qtyLeft} contracts left, stop now ${pp(t.stopPrice)}.`);
}

async function monitor() {
  const ids = (await Trade.find({ status: "open", exchange: { $ne: "mt5" } }, { _id: 1 }).lean()).map((x) => String(x._id)); // MetaTrader 5 trades live on the broker (lib/mt5.js)
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
  // trades left "opening" by a crash: adopt the order if it landed, otherwise mark it failed
  for (const t of await Trade.find({ status: "opening", exchange: { $ne: "mt5" } }).lean()) {
    try {
      const ex = await adapterOf(t);
      const info = ex && (await ex.info(t.symbol));
      if (t.market === "futures") {
        const fill = ex && info && t.clientOrderId ? await ex.findOpen(t.symbol, t.clientOrderId, info) : null;
        if (fill && fill.qty > 0) { await adoptFutures(t._id, fill, info); log(`adopted futures ${t.symbol} ${t._id} after a restart`); }
        else await Trade.updateOne({ _id: t._id }, { $set: { status: "failed", error: "interrupted before the order was placed" } });
        continue;
      }
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
  setInterval(() => mt5Sweep().catch((e) => log("mt5 sweep:", e.message)), 5000);
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
