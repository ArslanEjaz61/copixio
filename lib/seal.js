// AES-256-GCM sealing for exchange secrets and Telegram sessions. SEAL_KEY = 64 hex chars, only on the server (.env).
// Format: v1:<iv b64>:<tag b64>:<ciphertext b64>. A wrong key or a tampered value throws instead of returning garbage.
import crypto from "node:crypto";

function key() {
  const k = Buffer.from(process.env.SEAL_KEY || "", "hex");
  if (k.length !== 32) throw new Error("SEAL_KEY must be 64 hex characters");
  return k;
}

export function seal(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function unseal(sealed) {
  const [v, iv, tag, enc] = String(sealed || "").split(":");
  if (v !== "v1" || !iv || !tag || !enc) throw new Error("sealed value is not readable");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"), { authTagLength: 16 }); // a truncated tag is refused
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64")), d.final()]).toString("utf8");
}

export const tail = (s) => (s && s.length > 8 ? `${s.slice(0, 4)}…${s.slice(-4)}` : "••••");
