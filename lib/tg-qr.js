// Telegram login by QR code. The web app is one long-running Node process (pm2 "copixio-web"), so a pending QR login
// lives in memory for up to 3 minutes: the user scans the code in Telegram (Settings -> Devices -> Link Desktop
// Device), and if the account has two-step verification the password is passed in by a second request.
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import QRCode from "qrcode";
import { seal } from "./seal.js";
import { apiCreds, tgError } from "./tg.js";

const TTL_MS = 3 * 60 * 1000;
const pending = (globalThis.__cxQr ||= new Map()); // userId -> entry

async function drop(userId) {
  const e = pending.get(userId);
  if (!e) return;
  pending.delete(userId);
  clearTimeout(e.timer);
  if (e.pw) e.pw.rej(new Error("cancelled"));
  await e.client.disconnect().catch(() => {});
  await e.client.destroy?.().catch?.(() => {});
}

// Start (or restart) a QR login for this user. Resolves once the first code is ready (or after 8 s).
export async function qrStart(userId) {
  await drop(userId);
  const { apiId, apiHash } = apiCreds();
  const client = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 2, deviceModel: "Copixio", appVersion: "1.0", systemVersion: "server" });
  client.setLogLevel("none");
  const e = { client, status: "starting", url: null, hint: null, error: null, result: null, pw: null, at: Date.now() };
  pending.set(userId, e);
  e.timer = setTimeout(() => { if (e.status !== "done") { e.status = "expired"; drop(userId); } }, TTL_MS);
  await client.connect();
  let ready;
  const first = new Promise((r) => { ready = r; });
  client.signInUserWithQrCode({ apiId, apiHash }, {
    qrCode: async ({ token }) => { e.url = `tg://login?token=${Buffer.from(token).toString("base64url")}`; if (e.status === "starting") e.status = "waiting"; ready(); },
    password: async (hint) => { e.status = "password"; e.hint = hint || null; return new Promise((res, rej) => { e.pw = { res, rej }; }); },
    onError: async (err) => { e.error = tgError(err); return !/PASSWORD_HASH_INVALID/.test(String(err?.errorMessage || err?.message)); }, // wrong password: ask again
  }).then((user) => {
    e.result = { sessionSealed: seal(client.session.save()), tgUserId: String(user.id), tgName: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || "" };
    e.status = "done";
    clearTimeout(e.timer);
    client.disconnect().catch(() => {});
  }).catch((err) => {
    if (e.status !== "expired") { e.status = "error"; e.error = e.error || tgError(err); }
    ready();
    client.disconnect().catch(() => {});
  });
  await Promise.race([first, new Promise((r) => setTimeout(r, 8000))]);
  return qrState(userId);
}

export async function qrState(userId) {
  const e = pending.get(userId);
  if (!e) return { status: "none" };
  const out = { status: e.status, hint: e.hint, error: e.error };
  if (e.status === "waiting" && e.url) out.qr = `data:image/svg+xml;base64,${Buffer.from(await QRCode.toString(e.url, { type: "svg", margin: 1, errorCorrectionLevel: "M" })).toString("base64")}`;
  return out;
}

export function qrPassword(userId, password) {
  const e = pending.get(userId);
  if (!e || e.status !== "password" || !e.pw) return false;
  const pw = e.pw; e.pw = null; e.error = null; e.status = "checking";
  pw.res(password);
  return true;
}

// The finished login, handed over once (then forgotten).
export function qrTake(userId) {
  const e = pending.get(userId);
  if (!e || e.status !== "done") return null;
  pending.delete(userId);
  return e.result;
}

export const qrCancel = (userId) => drop(userId);
