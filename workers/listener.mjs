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

// 25 Nov: chart pictures. The full-size photo is downloaded through the user's own Telegram session (sharper than
// Telegram's web preview) and read by workers/chart/signal.mjs. One picture at a time (OCR is CPU work), 90 s cap each.
let chartLane = Promise.resolve();
let chartMod = null;
function readPicture(client, msg, caption) {
  const job = chartLane.then(async () => {
    const buf = await Promise.race([client.downloadMedia(msg, {}), new Promise((_, j) => setTimeout(() => j(new Error("download took over 30 s")), 30000))]);
    if (!buf || !buf.length) return { ok: false, reason: "picture could not be downloaded" };
    chartMod ||= await import("./chart/signal.mjs");
    let t;
    try {
      return await Promise.race([chartMod.chartSignal(Buffer.from(buf), caption || "", (msg.date || 0) * 1000 || Date.now()), new Promise((_, j) => { t = setTimeout(() => j(new Error("chart reading took over 90 s")), 90000); })]);
    } finally { clearTimeout(t); }
  });
  chartLane = job.catch(() => {});
  return job;
}

const onMessage = (userId, ev) => handleMsg(userId, ev.message);

// 26 Nov: the live update stream alone missed every post of a large channel (@Bitcoinhabebe, 6 posts in 26 h, 0 seen)
// and anything posted while the listener restarted. Each message now passes here from the stream OR the poller below;
// `seen` makes sure a message is read (and its picture OCR'd) once.
async function handleMsg(userId, msg) {
  const entry = clients.get(userId);
  if (!entry || !msg) return;
  const chatId = String(utils.getPeerId(msg.peerId));
  const groupId = entry.groups.get(chatId);
  if (!groupId) return;
  const key = `${chatId}:${msg.id}`;
  if (entry.seen.has(key)) return;
  entry.seen.add(key);
  if (entry.seen.size > 5000) entry.seen.delete(entry.seen.values().next().value);
  const text = msg.message || "";
  const photo = !!msg.photo || msg.media?.className === "MessageMediaPhoto";
  if (!text.trim() && !photo) return;
  let parsed = text.trim() ? parseSignal(text) : { ok: false, reason: "no text" };
  // 25 Nov: a chart picture is read when its text is not a signal by itself (CHART_SIGNALS=off: text only)
  if (!parsed.ok && photo && process.env.CHART_SIGNALS !== "off") {
    const c = await readPicture(entry.client, msg, text).catch((e) => ({ ok: false, reason: `picture: ${e.message}` }));
    parsed = c.ok ? c : { ...parsed, ok: false, reason: text.trim() ? `${parsed.reason}; ${c.reason}` : c.reason };
  }
  try {
    const s = await Signal.create({
      userId, groupId, chatId, messageId: String(msg.id), text: (text || (photo ? "(picture)" : "")).slice(0, 4000), parsed,
      outcome: parsed.ok ? "queued" : "not_a_signal", reason: parsed.ok ? null : String(parsed.reason || "").slice(0, 500),
    });
    if (parsed.ok) { await redis().lpush(QUEUE, String(s._id)); log(`signal ${userId} ${chatId} ${parsed.base} ${parsed.side}${parsed.chart ? ` (picture: ${parsed.chart})` : ""}`); }
    else if (photo) log(`picture ${userId} ${chatId} not a signal: ${String(parsed.reason).slice(0, 200)}`);
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
  const entry = { client, groups: await loadGroups(t.userId), seen: new Set(), last: new Map() };
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

// ---- poller (26 Nov): every CX_POLL_MS (20 s) each switched-on group is asked for messages newer than the last one
// seen. First look at a group (start, restart, newly added): only messages from the last CX_CATCHUP_S (300 s) that are
// not stored yet are read, so a restart never loses a fresh signal and never trades an old one. CX_POLL=off: stream only.
const POLL_MS = Number(process.env.CX_POLL_MS) || 20000, CATCHUP_S = Number(process.env.CX_CATCHUP_S) || 300;
let polling = false;
async function pollGroups() {
  if (polling || process.env.CX_POLL === "off") return;
  polling = true;
  try {
    for (const [userId, entry] of [...clients]) {
      for (const chatId of [...entry.groups.keys()]) {
        if (clients.get(userId) !== entry) break; // reconnected meanwhile
        try {
          const last = entry.last.get(chatId);
          const msgs = last == null
            ? await entry.client.getMessages(chatId, { limit: 10 })
            : await entry.client.getMessages(chatId, { limit: 30, minId: last });
          const ids = msgs.map((m) => m.id);
          if (ids.length) entry.last.set(chatId, Math.max(last || 0, ...ids));
          else if (last == null) entry.last.set(chatId, 0);
          const fresh = Date.now() / 1000 - CATCHUP_S;
          for (const m of [...msgs].sort((a, b) => a.id - b.id)) {
            const key = `${chatId}:${m.id}`;
            if (entry.seen.has(key)) continue;
            if (last == null) {
              if (m.date < fresh) continue;
              if (await Signal.exists({ userId, chatId, messageId: String(m.id) })) { entry.seen.add(key); continue; }
            }
            log(`poll picked ${userId} ${chatId} msg ${m.id}${last == null ? " (catch-up)" : ""}`);
            await handleMsg(userId, m).catch((e) => log("message:", e.message));
          }
        } catch (e) {
          const s = Number(e?.seconds) || 0; // FLOOD_WAIT: back off as long as Telegram asks
          log(`poll ${userId} ${chatId}: ${e?.errorMessage || e?.message}`);
          if (s) await new Promise((r) => setTimeout(r, Math.min(s, 300) * 1000));
        }
      }
    }
  } finally { polling = false; }
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
  setInterval(() => pollGroups().catch((e) => log("poll:", e.message)), POLL_MS);
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
