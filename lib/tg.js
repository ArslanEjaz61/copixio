// Telegram (MTProto user login via GramJS) for the web app: send the code, sign in (with 2FA), list chats, log out.
// One short-lived client per request; the session string is sealed in the database between steps.
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { utils } from "telegram";
import { seal, unseal } from "./seal.js";

export function apiCreds() {
  const apiId = Number(process.env.TG_API_ID), apiHash = process.env.TG_API_HASH;
  if (!apiId || !apiHash) throw Object.assign(new Error("Telegram login is not configured yet."), { plain: true });
  return { apiId, apiHash };
}

export async function withClient(sessionSealed, fn) {
  const { apiId, apiHash } = apiCreds();
  const client = new TelegramClient(new StringSession(sessionSealed ? unseal(sessionSealed) : ""), apiId, apiHash, {
    connectionRetries: 2, deviceModel: "Copixio", appVersion: "1.0", systemVersion: "server", baseLogger: undefined,
  });
  client.setLogLevel("none");
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.disconnect().catch(() => {});
    await client.destroy?.().catch?.(() => {});
  }
}

const ERR = {
  PHONE_NUMBER_INVALID: "Telegram says this phone number is not valid. Use the full number with the country code, like +923001234567.",
  PHONE_NUMBER_BANNED: "Telegram has banned this phone number.",
  PHONE_CODE_INVALID: "That code is not right. Check the latest code Telegram sent you.",
  PHONE_CODE_EXPIRED: "That code has expired. Ask for a new one.",
  PASSWORD_HASH_INVALID: "That Telegram password (two-step verification) is not right.",
  FLOOD: "Telegram asks to wait before trying again. Try again in a few minutes.",
  SEND_CODE_UNAVAILABLE: "Telegram has no other way to send the code right now. Use the code in your Telegram app, or Scan QR code.",
  PHONE_NUMBER_UNOCCUPIED: "There is no Telegram account on this number.",
  AUTH_TOKEN_EXPIRED: "The QR code expired before Telegram confirmed it. Show a new QR code and scan it within 30 seconds.",
  AUTH_TOKEN_ALREADY_ACCEPTED: "This QR code was already used. Show a new QR code.",
  AUTH_KEY_UNREGISTERED: "Telegram ended this login. Connect Telegram again.",
  SESSION_REVOKED: "This login was ended from your Telegram app. Connect Telegram again.",
};
export function tgError(e) {
  const m = String(e?.errorMessage || e?.message || "");
  if (e?.plain) return m;
  if (/FLOOD/.test(m)) return ERR.FLOOD;
  for (const k of Object.keys(ERR)) if (m.includes(k)) return ERR[k];
  return "Telegram did not accept this. Try again.";
}

// Where Telegram sent the code ("app" = the chat from "Telegram" on a device already logged in; "sms"; ...).
// 23 Nov: users waited for an SMS while the code sat in their Telegram app, and nothing recorded which one it was.
const VIA = {
  SentCodeTypeApp: "app", SentCodeTypeSms: "sms", SentCodeTypeCall: "call", SentCodeTypeFlashCall: "call", SentCodeTypeMissedCall: "call",
  SentCodeTypeEmailCode: "email", SentCodeTypeFragmentSms: "fragment", SentCodeTypeFirebaseSms: "sms", SentCodeTypeSmsWord: "sms", SentCodeTypeSmsPhrase: "sms",
  SentCodeTypeSetUpEmailRequired: "setup_email",
  CodeTypeSms: "sms", CodeTypeCall: "call", CodeTypeFlashCall: "call", CodeTypeMissedCall: "call", CodeTypeFragmentSms: "fragment",
};
const viaOf = (t) => { // className is "auth.SentCodeTypeApp"
  if (!t) return null;
  const k = String(t.className || "").replace(/^auth\./, "");
  return VIA[k] || k || "other";
};
function sentInfo(r) {
  if (r instanceof Api.auth.SentCodeSuccess) throw Object.assign(new Error("Telegram signed in without a code. Try again."), { plain: true });
  const via = viaOf(r.type);
  if (via === "setup_email") throw Object.assign(new Error("Telegram wants a login email on this account first. Use “Scan QR code” instead, or set a login email in the official Telegram app (Settings → Privacy and Security)."), { plain: true });
  return { phoneCodeHash: r.phoneCodeHash, via, nextVia: viaOf(r.nextType), timeout: r.timeout || null, email: r.type?.emailPattern || null };
}

export async function sendCode(phone) {
  return withClient(null, async (client) => {
    const { apiId, apiHash } = apiCreds();
    let r;
    try {
      r = await client.invoke(new Api.auth.SendCode({ phoneNumber: phone, apiId, apiHash, settings: new Api.CodeSettings({}) }));
    } catch (e) {
      if (String(e?.errorMessage) !== "AUTH_RESTART") throw e;
      r = await client.invoke(new Api.auth.SendCode({ phoneNumber: phone, apiId, apiHash, settings: new Api.CodeSettings({}) }));
    }
    return { ...sentInfo(r), pendingSessionSealed: seal(client.session.save()) };
  });
}

// Ask Telegram for the code the other way (usually SMS after "app"). Same session, new hash.
export async function resendCode({ pendingSessionSealed, phone, phoneCodeHash }) {
  return withClient(pendingSessionSealed, async (client) => {
    const r = await client.invoke(new Api.auth.ResendCode({ phoneNumber: phone, phoneCodeHash }));
    return { ...sentInfo(r), pendingSessionSealed: seal(client.session.save()) };
  });
}

// -> { needPassword } or { sessionSealed, tgUserId, tgName }
export async function signIn({ pendingSessionSealed, phone, phoneCodeHash, code, password }) {
  return withClient(pendingSessionSealed, async (client) => {
    const { apiId, apiHash } = apiCreds();
    if (!password) {
      try {
        await client.invoke(new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: String(code).replace(/\D/g, "") }));
      } catch (e) {
        if (/SESSION_PASSWORD_NEEDED/.test(String(e?.errorMessage || e?.message))) return { needPassword: true, pendingSessionSealed: seal(client.session.save()) };
        throw e;
      }
    } else {
      await client.signInWithPassword({ apiId, apiHash }, { password: async () => password, onError: async (err) => { throw err; } });
    }
    const me = await client.getMe();
    return {
      sessionSealed: seal(client.session.save()),
      tgUserId: String(me.id),
      tgName: [me.firstName, me.lastName].filter(Boolean).join(" ") || me.username || "",
    };
  });
}

// Groups and channels the user is in (id = marked peer id, the same the listener sees on new messages).
export async function listChats(sessionSealed) {
  return withClient(sessionSealed, async (client) => {
    const dialogs = await client.getDialogs({ limit: 300 });
    const out = [];
    for (const d of dialogs) {
      if (!d.isGroup && !d.isChannel) continue;
      out.push({ chatId: String(utils.getPeerId(d.entity)), title: d.title || d.name || "Untitled", kind: d.isChannel && !d.isGroup ? "channel" : "group" });
    }
    return out;
  });
}

export async function logOut(sessionSealed) {
  return withClient(sessionSealed, (client) => client.invoke(new Api.auth.LogOut()).catch(() => {}));
}
