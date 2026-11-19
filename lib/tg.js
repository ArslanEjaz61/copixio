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

export async function sendCode(phone) {
  return withClient(null, async (client) => {
    const { apiId, apiHash } = apiCreds();
    const r = await client.sendCode({ apiId, apiHash }, phone);
    return { phoneCodeHash: r.phoneCodeHash, pendingSessionSealed: seal(client.session.save()) };
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
