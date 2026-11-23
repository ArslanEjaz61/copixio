// Data model shared by the web app and the workers (plain Node): keep this file free of Next-only imports.
import mongoose from "mongoose";
import { EXCHANGE_IDS } from "./exchanges/list.js";

const { Schema, models, model } = mongoose;
const Id = Schema.Types.ObjectId;

const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, trim: true, maxlength: 80 },
    passwordHash: { type: String, required: true },
    emailVerifiedAt: { type: Date, default: null },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    plan: { type: String, enum: ["none", "starter", "pro", "desk"], default: "none" },
    planUntil: { type: Date, default: null },
    trial: { type: Boolean, default: false }, // the free trial given at sign-up; a confirmed payment ends it
    wantedPlan: { type: String, default: null },
    botPaused: { type: Boolean, default: false }, // the one switch that stops every new trade
    notifyChatId: { type: String, default: null }, // Telegram chat of the Copixio notification bot
    notifyLinkHash: { type: String, default: null, index: true }, // SHA-256 of the one-time /start code
    notifyLinkExpires: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// A login session. The cookie carries a random token; only its SHA-256 is stored, so a database leak cannot be replayed.
const SessionSchema = new Schema(
  {
    userId: { type: Id, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    ip: String,
    ua: String,
  },
  { timestamps: true }
);
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// One-time tokens: email verification and password reset. Hashed like sessions.
const TokenSchema = new Schema(
  {
    userId: { type: Id, ref: "User", required: true, index: true },
    kind: { type: String, enum: ["verify", "reset"], required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
TokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// An exchange API key. Secrets are sealed (AES-256-GCM, lib/seal.js) and never sent back to the browser.
const ExchangeSchema = new Schema(
  {
    userId: { type: Id, ref: "User", required: true, index: true },
    exchange: { type: String, enum: EXCHANGE_IDS, required: true },
    env: { type: String, enum: ["live", "demo"], required: true },
    label: { type: String, trim: true, maxlength: 40 },
    keyTail: String,
    keySealed: { type: String, required: true },
    secretSealed: { type: String, required: true },
    passphraseSealed: String,
    status: { type: String, enum: ["ok", "error"], default: "ok" },
    lastError: { type: String, default: null },
    usdtFree: { type: Number, default: 0 },
    ipRestricted: { type: Boolean, default: null },
    checkedAt: Date,
  },
  { timestamps: true }
);

// A user's Telegram login (MTProto). The session string is sealed; the pending fields live only during sign-in.
const TelegramSchema = new Schema(
  {
    userId: { type: Id, ref: "User", required: true, unique: true },
    phone: String,
    sessionSealed: String,
    pendingSessionSealed: String,
    phoneCodeHash: String,
    pendingAt: Date,
    codeVia: String, // 23 Nov: where Telegram sent the login code (app / sms / call / email ...)
    codeNextVia: String, // the other way it can send it ("Send by SMS instead")
    tgUserId: String,
    tgName: String,
    status: { type: String, enum: ["pending", "connected", "error", "logged_out"], default: "pending" },
    lastError: { type: String, default: null },
    connectedAt: Date,
  },
  { timestamps: true }
);

// A Telegram group/channel the user follows, with the money rules for its signals.
const GroupSchema = new Schema(
  {
    userId: { type: Id, ref: "User", required: true, index: true },
    chatId: { type: String, required: true },
    title: { type: String, maxlength: 200 },
    kind: { type: String, enum: ["group", "channel", "user"], default: "group" },
    enabled: { type: Boolean, default: false },
    exchangeId: { type: Id, ref: "Exchange", default: null },
    sizeMode: { type: String, enum: ["fixed", "percent"], default: "fixed" },
    sizeUsdt: { type: Number, default: 20 },
    sizePercent: { type: Number, default: 5 },
    maxOpen: { type: Number, default: 3 },
    slMode: { type: String, enum: ["signal", "percent"], default: "signal" },
    slPercent: { type: Number, default: 3 }, // used when slMode=percent and as the fallback when a signal has no SL
    tpMode: { type: String, enum: ["signal", "percent"], default: "signal" },
    tpPercent: { type: Number, default: 4 },
    tpSplit: { type: String, enum: ["first", "even", "half"], default: "even" }, // how the position is sold over the targets
    moveSlToEntry: { type: Boolean, default: true }, // after the first target, the stop moves to the entry price
    dailyLossUsdt: { type: Number, default: 0 }, // 0 = no limit
    maxEntryGapPct: { type: Number, default: 2 }, // skip when the market is this far above the signal entry
  },
  { timestamps: true }
);
GroupSchema.index({ userId: 1, chatId: 1 }, { unique: true });

// Every message the reader saw in an enabled group, with what the parser found and what happened.
const SignalSchema = new Schema(
  {
    userId: { type: Id, ref: "User", required: true, index: true },
    groupId: { type: Id, ref: "Group", required: true },
    chatId: String,
    messageId: String,
    text: { type: String, maxlength: 4000 },
    parsed: Schema.Types.Mixed,
    outcome: { type: String, enum: ["traded", "skipped", "not_a_signal", "error", "queued", "processing"], default: "queued" },
    reason: String,
    tradeId: { type: Id, ref: "Trade", default: null },
  },
  { timestamps: true }
);
SignalSchema.index({ userId: 1, chatId: 1, messageId: 1 }, { unique: true });
SignalSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 864e5 / 1000 });

// A position the bot opened. Sells (targets, stop, manual) are appended to `fills`.
const TradeSchema = new Schema(
  {
    userId: { type: Id, ref: "User", required: true, index: true },
    groupId: { type: Id, ref: "Group" },
    signalId: { type: Id, ref: "Signal" },
    exchangeId: { type: Id, ref: "Exchange", required: true },
    exchange: String,
    env: String,
    symbol: String, // exchange format: ARIAUSDT (Binance) / ARIA-USDT (KuCoin)
    base: String,
    side: { type: String, default: "long" },
    status: { type: String, enum: ["opening", "open", "closing", "closed", "failed"], default: "opening", index: true },
    clientOrderId: { type: String, unique: true, sparse: true },
    entryPrice: Number,
    qty: Number, // bought
    qtyLeft: Number, // still held
    costUsdt: Number,
    stopPrice: Number,
    targets: [{ price: Number, share: Number, done: { type: Boolean, default: false } }],
    stopOrderId: String,
    fills: [{ kind: String, price: Number, qty: Number, usdt: Number, fee: Number, at: Date, orderId: String }],
    exitPrice: Number,
    pnlUsdt: { type: Number, default: 0 },
    feesUsdt: { type: Number, default: 0 },
    outcome: String, // TP, SL, BE, MANUAL, ...
    closeRequested: { type: Boolean, default: false },
    error: String,
    openedAt: Date,
    closedAt: Date,
  },
  { timestamps: true }
);

// A USDT payment for a plan. Approved by an admin (or by the on-chain check when a wallet is configured).
const PaymentSchema = new Schema(
  {
    userId: { type: Id, ref: "User", required: true, index: true },
    plan: { type: String, enum: ["starter", "pro", "desk"], required: true },
    months: { type: Number, default: 1 },
    amountUsdt: Number,
    network: { type: String, default: "TRC20" },
    txid: { type: String, trim: true, maxlength: 120, unique: true, sparse: true },
    status: { type: String, enum: ["submitted", "approved", "rejected"], default: "submitted" },
    note: String,
    decidedAt: Date,
    decidedBy: { type: Id, ref: "User" },
  },
  { timestamps: true }
);

export const User = models.User || model("User", UserSchema);
export const Session = models.Session || model("Session", SessionSchema);
export const Token = models.Token || model("Token", TokenSchema);
export const Exchange = models.Exchange || model("Exchange", ExchangeSchema);
export const Telegram = models.Telegram || model("Telegram", TelegramSchema);
export const Group = models.Group || model("Group", GroupSchema);
export const Signal = models.Signal || model("Signal", SignalSchema);
export const Trade = models.Trade || model("Trade", TradeSchema);
export const Payment = models.Payment || model("Payment", PaymentSchema);

// Plans: what each one allows. Before a plan is paid the user can set everything up (no trading).
export const PLANS = {
  none: { name: "No plan", price: 0, groups: 0, exchanges: 1, open: 0 },
  starter: { name: "Starter", price: 29, groups: 2, exchanges: 1, open: 5 },
  pro: { name: "Pro", price: 59, groups: 10, exchanges: 2, open: 25 },
  desk: { name: "Desk", price: 119, groups: 1000, exchanges: 3, open: 100000 },
};
export const planOf = (u) => (u?.plan && u.plan !== "none" && u.planUntil && new Date(u.planUntil) > new Date() ? u.plan : "none");
