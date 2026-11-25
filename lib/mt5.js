// MetaTrader 5 bridge (25 Nov). Free: no third-party service. The user runs the Copixio EA in their own MT5 terminal;
// every second it POSTs a short text report to /api/mt5/bridge and gets back orders to place (the trader worker queues
// them in Mt5Command). The stop loss and take profit sit on the BROKER's side of the position, so a position stays
// protected while Copixio or the terminal is down. Used by the web route and by workers/trader.mjs.
//
// The EA talks in plain lines (MQL5 has no JSON), fields split by "|":
//   EA -> server   A|login|server|currency|balance|equity|leverage|mode(0 demo,2 real)|name|build   account
//                  P|ticket|symbol|type|volume|price|sl|tp|profit|swap|comment|time                  open position
//                  PE                                                                                end of the position list
//                  D|ticket|positionId|symbol|type|volume|price|profit|commission|swap|reason|comment|time|entry   a deal
//                  R|commandId|ok or fail|ticket|price|volume|message                                  result of an order
//   server -> EA   OK|serverTime   then   C|id|kind|symbol|side|lots|risk|sl|tp|slPct|tpPct|ticket|comment|entry|gapPct
import crypto from "node:crypto";
import { Exchange, Mt5Command, Trade, User } from "./models.js";
import { notify, esc } from "./notify.js";

export const newToken = () => crypto.randomBytes(32).toString("hex");
export const hashToken = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
export const ONLINE_MS = 45000;
export const bridgeOnline = (conn) => !!conn?.bridge?.lastSeenAt && Date.now() - new Date(conn.bridge.lastSeenAt).getTime() < ONLINE_MS;
export const tradeComment = (tradeId) => `cx:${tradeId}`; // MT5 allows 31 characters: 3 + 24

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => String(s ?? "").replace(/[|\r\n]/g, " ").slice(0, 200);
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
const isId = (s) => /^[0-9a-f]{24}$/i.test(String(s || ""));
const fx = (n, d = 2) => Number(n || 0).toFixed(d);
const pp = (n) => Number(Number(n).toPrecision(6));
// MQL5 ENUM_DEAL_REASON: 3 = the EA itself (our close button), 4 = stop loss, 5 = take profit, 6 = stop out
const REASON = { 4: "SL", 5: "TP", 6: "STOPOUT" };

// ------------------------------------------------------------------ what the EA sends
export function parseReport(text) {
  const out = { account: null, positions: [], deals: [], results: [], complete: false };
  for (const line of String(text || "").split(/\r?\n/)) {
    const f = line.split("|");
    if (f[0] === "A") out.account = { login: f[1], server: f[2], currency: f[3], balance: num(f[4]), equity: num(f[5]), leverage: num(f[6]), mode: Number(f[7]), name: f[8], build: num(f[9]) };
    else if (f[0] === "P") out.positions.push({ ticket: f[1], symbol: f[2], type: Number(f[3]), volume: num(f[4]), price: num(f[5]), sl: num(f[6]), tp: num(f[7]), profit: num(f[8]), swap: num(f[9]), comment: f[10], time: num(f[11]) });
    else if (f[0] === "PE") out.complete = true;
    else if (f[0] === "D") out.deals.push({ ticket: f[1], positionId: f[2], symbol: f[3], type: Number(f[4]), volume: num(f[5]), price: num(f[6]), profit: num(f[7]), commission: num(f[8]), swap: num(f[9]), reason: Number(f[10]), comment: f[11], time: num(f[12]), entry: Number(f[13]) });
    else if (f[0] === "R") out.results.push({ id: f[1], ok: f[2] === "ok", ticket: f[3], price: num(f[4]), volume: num(f[5]), message: f.slice(6).join("|") });
  }
  return out;
}

// ------------------------------------------------------------------ orders for the EA
export const enqueue = (conn, tradeId, kind, params) => Mt5Command.create({ userId: conn.userId, exchangeId: conn._id, tradeId: tradeId || null, kind, params });

export async function waitResult(id, ms = 40000) {
  const end = Date.now() + ms;
  for (;;) {
    const c = await Mt5Command.findById(id).lean();
    if (c && ["done", "failed", "expired"].includes(c.status)) return c;
    if (Date.now() > end) return null;
    await sleep(400);
  }
}

export async function takeCommands(conn, max = 5) {
  const out = [];
  for (let i = 0; i < max; i++) {
    const c = await Mt5Command.findOneAndUpdate({ exchangeId: conn._id, status: "queued" }, { $set: { status: "sent", sentAt: new Date() } }, { sort: { createdAt: 1 }, new: true }).lean();
    if (!c) break;
    out.push(c);
  }
  return out;
}

const n0 = (x) => (x === null || x === undefined || x === "" || !Number.isFinite(Number(x)) ? "0" : String(x));
export function formatResponse(cmds) {
  const lines = [`OK|${Math.floor(Date.now() / 1000)}`];
  for (const c of cmds) {
    const p = c.params || {};
    lines.push(["C", c._id, c.kind, clean(p.symbol), p.side || "", n0(p.lots), n0(p.risk), n0(p.sl), n0(p.tp), n0(p.slPct), n0(p.tpPct), clean(p.ticket || "0"), clean(p.comment), n0(p.entry), n0(p.gapPct)].join("|"));
  }
  return lines.join("\n");
}

// ------------------------------------------------------------------ what the EA reported
export async function ingest(conn, rep) {
  const set = { "bridge.lastSeenAt": new Date(), status: "ok", lastError: null };
  if (rep.account) {
    const a = rep.account;
    Object.assign(set, { "bridge.login": clean(a.login), "bridge.server": clean(a.server), "bridge.currency": clean(a.currency), "bridge.accountName": clean(a.name), "bridge.balance": a.balance, "bridge.equity": a.equity, "bridge.leverage": a.leverage, "bridge.build": a.build, env: a.mode === 2 ? "live" : "demo", usdtFree: a.balance });
  }
  await Exchange.updateOne({ _id: conn._id }, { $set: set });
  const user = await User.findById(conn.userId).lean();

  for (const r of rep.results) await applyResult(conn, r);
  for (const d of [...rep.deals].sort((a, b) => a.time - b.time || a.entry - b.entry)) await applyDeal(conn, d, user).catch(() => {});

  // positions: remember the ones we know; a trade whose position has been missing for a minute is closed
  if (rep.complete) {
    const open = await Trade.find({ exchangeId: conn._id, status: "open", "mt5.positionId": { $exists: true } }, { _id: 1, mt5: 1 }).lean();
    const byId = new Map(rep.positions.map((p) => [String(p.ticket), p]));
    for (const t of open) {
      const p = byId.get(String(t.mt5.positionId));
      if (p) await Trade.updateOne({ _id: t._id }, { $set: { "mt5.floating": p.profit + p.swap, "mt5.missing": 0, "mt5.sl": p.sl, "mt5.tp": p.tp } });
      else if ((t.mt5.missing || 0) >= 60) {
        await Trade.updateOne({ _id: t._id, status: "open" }, { $set: { status: "closed", closedAt: new Date(), outcome: "CLOSED" } });
        if (user) await notify(user, `ℹ️ <b>${esc(t.base || "MT5")}</b> is no longer open in your MetaTrader 5 terminal (closed there).`);
      } else await Trade.updateOne({ _id: t._id }, { $inc: { "mt5.missing": 1 } });
    }
  }
}

async function applyResult(conn, r) {
  if (!isId(r.id)) return;
  const cmd = await Mt5Command.findOneAndUpdate({ _id: r.id, exchangeId: conn._id, status: { $in: ["sent", "queued"] } },
    { $set: { status: r.ok ? "done" : "failed", doneAt: new Date(), result: { ok: r.ok, ticket: r.ticket, price: r.price, volume: r.volume, message: r.message } } }, { new: true }).lean();
  if (!cmd || cmd.kind !== "open" || !cmd.tradeId) return;
  if (r.ok) {
    await Trade.updateOne({ _id: cmd.tradeId, status: "opening" }, { $set: { status: "open", entryPrice: r.price, qty: r.volume, qtyLeft: r.volume, openedAt: new Date(), "mt5.positionId": String(r.ticket), "mt5.symbol": cmd.params?.symbol } });
  } else {
    await Trade.updateOne({ _id: cmd.tradeId, status: "opening" }, { $set: { status: "failed", error: r.message || "the terminal refused the order" } });
  }
}

async function applyDeal(conn, d, user) {
  let trade = null;
  const m = /cx:([0-9a-f]{24})/i.exec(d.comment || "");
  if (m) trade = await Trade.findOne({ _id: m[1], exchangeId: conn._id }).lean();
  if (!trade && d.positionId) trade = await Trade.findOne({ exchangeId: conn._id, "mt5.positionId": String(d.positionId) }).lean();
  if (!trade) return; // a deal of the user's own, not ours
  // claim the deal once (a repeated report never counts it twice)
  const claim = await Trade.updateOne({ _id: trade._id, "mt5.deals": { $ne: String(d.ticket) } }, { $push: { "mt5.deals": String(d.ticket) } });
  if (!claim.modifiedCount) return;
  const money = d.profit + d.swap + d.commission;

  if (d.entry === 0) { // IN: the position opened (also revives a trade whose order result was lost)
    const revive = ["opening", "failed"].includes(trade.status);
    await Trade.updateOne({ _id: trade._id }, { $set: { ...(revive ? { status: "open", error: null, openedAt: new Date(d.time * 1000) } : {}), entryPrice: d.price, qty: d.volume, qtyLeft: d.volume, "mt5.positionId": String(d.positionId), "mt5.symbol": d.symbol }, $inc: { pnlUsdt: d.commission + d.swap, feesUsdt: Math.abs(d.commission) } });
    if (revive && trade.status === "failed" && user) await notify(user, `✅ <b>${esc(trade.base)}</b> order did land in MetaTrader 5 after all; it is being tracked.`);
    return;
  }
  // OUT / INOUT / OUT_BY: part or all of the position closed
  const kind = REASON[d.reason] || "MANUAL";
  await Trade.updateOne({ _id: trade._id }, {
    $push: { fills: { kind, price: d.price, qty: d.volume, usdt: money, fee: Math.abs(d.commission), at: new Date(d.time * 1000), orderId: String(d.ticket) } },
    $inc: { pnlUsdt: money, feesUsdt: Math.abs(d.commission), qtyLeft: -d.volume },
  });
  const t = await Trade.findById(trade._id).lean();
  if (t.status !== "closed" && (t.qtyLeft ?? 0) <= 1e-9) {
    await Trade.updateOne({ _id: t._id, status: { $ne: "closed" } }, { $set: { status: "closed", qtyLeft: 0, exitPrice: d.price, outcome: kind, closedAt: new Date(d.time * 1000) } });
    if (user) {
      const cur = conn.bridge?.currency || "";
      await notify(user, `${t.pnlUsdt >= 0 ? "💰" : "🔻"} <b>${esc(t.base)} ${esc(t.side)} closed</b> (${kind === "TP" ? "take profit" : kind === "SL" ? "stop loss" : kind === "STOPOUT" ? "stop out" : "closed"}) at ${pp(d.price)}\nP&L ${t.pnlUsdt >= 0 ? "+" : ""}${fx(t.pnlUsdt)} ${esc(cur)}`);
    }
  }
}

// ------------------------------------------------------------------ housekeeping (the trader calls this every few seconds)
export async function sweep() {
  const now = Date.now();
  // an order the terminal never answered (offline, or the answer got lost)
  await Mt5Command.updateMany({ status: "sent", sentAt: { $lt: new Date(now - 90e3) } }, { $set: { status: "expired", doneAt: new Date(), result: { ok: false, message: "the terminal did not answer" } } });
  await Mt5Command.updateMany({ status: "queued", createdAt: { $lt: new Date(now - 120e3) } }, { $set: { status: "expired", doneAt: new Date(), result: { ok: false, message: "the terminal was offline" } } });
  // trades left "opening" with no live order behind them
  for (const t of await Trade.find({ exchange: "mt5", status: "opening", createdAt: { $lt: new Date(now - 150e3) } }, { _id: 1 }).lean()) {
    if (await Mt5Command.exists({ tradeId: t._id, status: { $in: ["queued", "sent"] } })) continue;
    await Trade.updateOne({ _id: t._id, status: "opening" }, { $set: { status: "failed", error: "the terminal did not confirm the order" } });
  }
  // Close buttons pressed in Copixio: one close order per trade
  for (const t of await Trade.find({ exchange: "mt5", status: "open", closeRequested: true }).lean()) {
    if (!t.mt5?.positionId) continue;
    if (await Mt5Command.exists({ tradeId: t._id, kind: "close", createdAt: { $gt: new Date(now - 60e3) }, status: { $in: ["queued", "sent", "done"] } })) continue;
    const conn = await Exchange.findById(t.exchangeId).lean();
    if (!conn) continue;
    await enqueue(conn, t._id, "close", { symbol: t.mt5.symbol || t.symbol, ticket: t.mt5.positionId, comment: tradeComment(t._id) });
  }
}
