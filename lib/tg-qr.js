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
// onDone(result) saves the login the moment Telegram confirms the scan, so a browser that dropped its connection
// (VPN, mobile data, closed tab) still ends up connected: the page only reads the outcome.
export async function qrStart(userId, onDone) {
  await drop(userId);
  const { apiId, apiHash } = apiCreds();
  const client = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 2, deviceModel: "Copixio", appVersion: "1.0", systemVersion: "server" });
  client.setLogLevel("none");
  const e = { client, status: "starting", url: null, hint: null, error: null, result: null, pw: null, at: Date.now() };
  pending.set(userId, e);
  e.timer = setTimeout(() => { if (e.status !== "done") { console.log(`${new Date().toISOString()} [tg-qr] user ${userId} expired after 3 min (${e.status}, never confirmed)`); e.status = "expired"; drop(userId); } }, TTL_MS);
  await client.connect();
  let ready;
  const first = new Promise((r) => { ready = r; });
  // 23 Nov: one log line per step, so "I scanned and nothing happened" can be answered from the server log
  const log = (m) => console.log(`${new Date().toISOString()} [tg-qr] user ${userId} ${m}`);
  let tokens = 0;
  log(`started (dc ${client.session.dcId})`);
  client.signInUserWithQrCode({ apiId, apiHash }, {
    qrCode: async ({ token, expires }) => { tokens++; if (tokens <= 2 || tokens % 5 === 0) log(`code #${tokens} ready (expires in ${expires ? Math.round(expires - Date.now() / 1000) : "?"} s)`); e.url = `tg://login?token=${Buffer.from(token).toString("base64url")}`; if (e.status === "starting") e.status = "waiting"; ready(); },
    password: async (hint) => { log("scanned; two-step password needed"); e.status = "password"; e.hint = hint || null; return new Promise((res, rej) => { e.pw = { res, rej }; }); },
    onError: async (err) => { log(`Telegram error: ${String(err?.errorMessage || err?.message || err).slice(0, 200)}`); e.error = tgError(err); return !/PASSWORD_HASH_INVALID/.test(String(err?.errorMessage || err?.message)); }, // wrong password: ask again
  }).then(async (user) => {
    log("scan confirmed by Telegram; saving the login");
    const result = { sessionSealed: seal(client.session.save()), tgUserId: String(user.id), tgName: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || "" };
    clearTimeout(e.timer);
    client.disconnect().catch(() => {});
    for (let i = 0; ; i++) { // the database is local, but a save must not be lost to one hiccup
      try { await onDone(result); break; }
      catch (err) { if (i >= 4) { e.status = "error"; e.error = "Telegram confirmed the scan but saving failed. Show a new QR code."; return; } await new Promise((r) => setTimeout(r, 1000 * (i + 1))); }
    }
    e.status = "done";
    e.timer = setTimeout(() => { if (pending.get(userId) === e) pending.delete(userId); }, 10 * 60 * 1000); // let a late poll see "done"
  }).catch((err) => {
    log(`ended without a login (${e.status}): ${String(err?.errorMessage || err?.message || err).slice(0, 200)}`);
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

export const qrCancel = (userId) => drop(userId);
