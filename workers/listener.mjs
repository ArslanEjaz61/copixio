// pm2 "copixio-listener": keeps one Telegram (MTProto) connection per connected user and reads new messages in the
// groups they switched on. Each message is stored once (unique user+chat+message), parsed, and real signals are queued
// for the trader. Also links the Copixio notification bot (/start <code>).
try { process.loadEnvFile(new URL("../.env", import.meta.url)); } catch { /* env from pm2 */ }
import crypto from "node:crypto";
import Redis from "ioredis";
import { TelegramClient, utils } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import { db } from "../lib/db.js";
import { Group, Signal, Telegram, User } from "../lib/models.js";
import { redis } from "../lib/redis.js";
import { unseal } from "../lib/seal.js";
import { parseSignal } from "../lib/parser.js";
import { botCall, notify } from "../lib/notify.js";

const log = (...a) => console.log(new Date().toISOString(), ...a);
const QUEUE = "cx:signals";
const clients = new Map(); // userId -> { client, groups: Map(chatId -> groupId) }

async function loadGroups(userId) {
  const gs = await Group.find({ userId, enabled: true }, { chatId: 1 }).lean();
  return new Map(gs.map((g) => [g.chatId, g._id]));
}

async function onMessage(userId, ev) {
  const entry = clients.get(userId);
  const msg = ev.message;
  if (!entry || !msg) return;
  const chatId = String(utils.getPeerId(msg.peerId));
  const groupId = entry.groups.get(chatId);
  if (!groupId) return;
  const text = msg.message || "";
  if (!text.trim()) return;
  const parsed = parseSignal(text);
  try {
    const s = await Signal.create({
      userId, groupId, chatId, messageId: String(msg.id), text: text.slice(0, 4000), parsed,
      outcome: parsed.ok ? "queued" : "not_a_signal", reason: parsed.ok ? null : parsed.reason,
    });
    if (parsed.ok) { await redis().lpush(QUEUE, String(s._id)); log(`signal ${userId} ${chatId} ${parsed.base} ${parsed.side}`); }
  } catch (e) {
    if (e?.code !== 11000) log(`store ${userId}: ${e.message}`); // 11000 = already stored (duplicate update)
  }
}

async function connect(t) {
  const userId = String(t.userId);
  await disconnect(userId);
  const apiId = Number(process.env.TG_API_ID), apiHash = process.env.TG_API_HASH;
  if (!apiId || !apiHash) return;
  let session;
  try { session = unseal(t.sessionSealed); } catch { log(`session unreadable ${userId}`); return; }
  const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 10, autoReconnect: true, deviceModel: "Copixio", appVersion: "1.0" });
  client.setLogLevel("error");
  const entry = { client, groups: await loadGroups(t.userId) };
  clients.set(userId, entry);
  try {
    await client.connect();
    await client.getMe(); // starts the update stream
    client.addEventHandler((ev) => onMessage(userId, ev).catch((e) => log("message:", e.message)), new NewMessage({}));
    log(`connected ${userId} (${entry.groups.size} groups)`);
  } catch (e) {
    const m = String(e?.errorMessage || e?.message);
    log(`connect ${userId}: ${m}`);
    clients.delete(userId);
    if (/AUTH_KEY_UNREGISTERED|SESSION_REVOKED|USER_DEACTIVATED/.test(m)) {
      await Telegram.updateOne({ userId: t.userId }, { $set: { status: "logged_out", lastError: "Telegram ended this login." } });
      const u = await User.findById(t.userId).lean();
      await notify(u, "⚠️ Your Telegram login for Copixio ended, so your groups are not being read. Connect Telegram again in Copixio.");
    }
  }
}

async function disconnect(userId) {
  const e = clients.get(userId);
  if (!e) return;
  clients.delete(userId);
  await e.client.disconnect().catch(() => {});
  await e.client.destroy?.().catch?.(() => {});
}

async function syncAll() {
  const list = await Telegram.find({ status: "connected" }).lean();
  const want = new Set(list.map((t) => String(t.userId)));
  for (const id of [...clients.keys()]) if (!want.has(id)) await disconnect(id);
  for (const t of list) {
    const id = String(t.userId);
    if (!clients.has(id)) await connect(t);
    else clients.get(id).groups = await loadGroups(t.userId);
  }
}

// ---- notification bot: "/start <code>" links the chat to the user who opened Settings
let botOffset = 0;
async function pollBot() {
  if (!process.env.TG_BOT_TOKEN) return;
  const j = await botCall("getUpdates", { offset: botOffset, timeout: 25, allowed_updates: ["message"] });
  for (const u of j?.result || []) {
    botOffset = u.update_id + 1;
    const m = u.message;
    const code = String(m?.text || "").match(/^\/start\s+([A-Za-z0-9_-]{8,64})$/)?.[1];
    if (!code || m.chat?.type !== "private") continue; // only a private chat with the bot can receive a user's trades
    const hash = crypto.createHash("sha256").update(code).digest("hex");
    const user = await User.findOneAndUpdate({ notifyLinkHash: hash, notifyLinkExpires: { $gt: new Date() } }, { $set: { notifyChatId: String(m.chat.id), notifyLinkHash: null, notifyLinkExpires: null } }, { new: true }).lean();
    await botCall("sendMessage", { chat_id: m.chat.id, text: user ? "✅ Copixio notifications are on. You will get a message for every trade." : "This link has expired. Open Copixio → Settings and press Connect notifications again." });
  }
}

async function main() {
  await db();
  log("copixio-listener up");
  await syncAll();
  setInterval(() => syncAll().catch((e) => log("sync:", e.message)), 60000);
  const sub = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379");
  await sub.subscribe("cx:changed");
  sub.on("message", async (_c, raw) => {
    try {
      const { kind, userId } = JSON.parse(raw);
      const t = await Telegram.findOne({ userId, status: "connected" }).lean();
      if (kind === "telegram") { if (t) await connect(t); else await disconnect(String(userId)); }
      else if (clients.has(String(userId))) clients.get(String(userId)).groups = await loadGroups(userId);
    } catch (e) { log("changed:", e.message); }
  });
  for (;;) { try { await pollBot(); } catch (e) { log("bot:", e.message); await new Promise((r) => setTimeout(r, 5000)); } if (!process.env.TG_BOT_TOKEN) await new Promise((r) => setTimeout(r, 60000)); }
}
main().catch((e) => { console.error(e); process.exit(1); });
