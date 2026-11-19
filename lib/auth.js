import "server-only";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { cookies, headers } from "next/headers";
import { db } from "./db";
import { Session, Token, User } from "./models";

const scrypt = promisify(crypto.scrypt);
export const SESSION_COOKIE = "cx_session";
const SESSION_DAYS = 30;

// ---- passwords: scrypt (N=16384, r=8, p=1), 16-byte salt, 64-byte key; stored as "scrypt$<salt>$<key>" (hex)
export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw.normalize("NFKC"), salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}
export async function verifyPassword(pw, stored) {
  const [alg, saltHex, keyHex] = String(stored || "").split("$");
  if (alg !== "scrypt" || !saltHex || !keyHex) return false;
  const key = await scrypt(pw.normalize("NFKC"), Buffer.from(saltHex, "hex"), 64);
  const want = Buffer.from(keyHex, "hex");
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
export const newToken = () => crypto.randomBytes(32).toString("base64url");

export async function clientMeta() {
  const h = await headers();
  return {
    // nginx sets X-Real-IP to $remote_addr (and overwrites X-Forwarded-For), so a client cannot pick its own IP
    ip: h.get("x-real-ip") || "",
    ua: (h.get("user-agent") || "").slice(0, 300),
  };
}

// ---- sessions
export async function createSession(userId) {
  await db();
  const token = newToken();
  const { ip, ua } = await clientMeta();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  await Session.create({ userId, tokenHash: sha256(token), expiresAt, ip, ua });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) { await db(); await Session.deleteOne({ tokenHash: sha256(token) }); }
  jar.delete(SESSION_COOKIE);
}

// The signed-in user (lean object without the password hash) or null.
export async function currentUser() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  await db();
  const s = await Session.findOne({ tokenHash: sha256(token), expiresAt: { $gt: new Date() } }).lean();
  if (!s) return null;
  return User.findById(s.userId, { passwordHash: 0 }).lean();
}

// ---- one-time tokens (email verify, password reset)
export async function issueToken(userId, kind, hours) {
  await db();
  const token = newToken();
  await Token.create({ userId, kind, tokenHash: sha256(token), expiresAt: new Date(Date.now() + hours * 36e5) });
  return token;
}
export async function consumeToken(token, kind) {
  if (!token || token.length > 100) return null;
  await db();
  const t = await Token.findOneAndUpdate(
    { tokenHash: sha256(token), kind, usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { new: true }
  ).lean();
  return t ? t.userId : null;
}

// Same-origin check for state-changing API calls (the session cookie is SameSite=Lax; this closes the rest).
export async function sameOrigin(req) {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    // compare with the configured site, never with a client-supplied forwarded host
    const host = process.env.APP_URL ? new URL(process.env.APP_URL).host : req.headers.get("host");
    return new URL(origin).host === host;
  } catch { return false; }
}
