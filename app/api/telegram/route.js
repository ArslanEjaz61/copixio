import { z } from "zod";
import { db } from "@/lib/db";
import { Exchange, Group, Telegram } from "@/lib/models";
import { clientMeta } from "@/lib/auth";
import { limit } from "@/lib/rate";
import { apiUser, bad, ok } from "@/lib/session-user";
import { announce } from "@/lib/redis";
import { logOut, resendCode, sendCode, signIn, tgError } from "@/lib/tg";

// 23 Nov: every step leaves one log line (masked phone), so "no code came" can be answered from the server
const mask = (p) => (p ? String(p).replace(/\d(?=\d{3})/g, "•") : "-");
const tgLog = (uid, msg) => console.log(`${new Date().toISOString()} [tg-login] user ${uid} ${msg}`);

export const runtime = "nodejs";

const view = (t) => (t ? { status: t.status, phone: t.phone ? t.phone.replace(/\d(?=\d{3})/g, "•") : null, tgName: t.tgName || null, lastError: t.lastError || null } : { status: "none" });

export async function GET(req) {
  const [user, deny] = await apiUser(req);
  if (deny) return deny;
  await db();
  return ok({ telegram: view(await Telegram.findOne({ userId: user._id }).lean()) });
}

const Body = z.discriminatedUnion("step", [
  z.object({ step: z.literal("phone"), phone: z.string().trim().regex(/^\+\d{7,15}$/, "Use the full number with the country code, like +923001234567"), retry: z.boolean().optional() }),
  z.object({ step: z.literal("code"), code: z.string().trim().regex(/^\d[\d\s-]{3,10}$/, "Enter the code Telegram sent you"), retry: z.boolean().optional() }),
  z.object({ step: z.literal("password"), password: z.string().min(1).max(256), retry: z.boolean().optional() }),
  z.object({ step: z.literal("resend") }),
  z.object({ step: z.literal("logout") }),
]);

// Sign-in in three steps: phone -> code -> (password when two-step verification is on). Then log out when asked.
export async function POST(req) {
  const [user, deny] = await apiUser(req, { write: true });
  if (deny) return deny;
  let b;
  try { b = Body.parse(await req.json()); }
  catch (e) { return bad(e?.issues?.[0]?.message || "Check the form and try again."); }
  await db();
  let t = await Telegram.findOne({ userId: user._id });

  try {
    // 24 Nov: QR only (Telegram holds back codes for apps like Copixio). TG_PHONE_LOGIN=on brings the phone sign-in back.
    if ((b.step === "phone" || b.step === "resend") && process.env.TG_PHONE_LOGIN !== "on") return bad("Sign in with Scan QR code: in Telegram open Settings → Devices → Link Desktop Device.", 410);
    if (b.step === "phone") {
      // codes go to real phones: a working exchange key first, then limits per account, per network and for the whole
      // site (so nobody can use Copixio to spam login codes, or get our Telegram app id rate-limited for everyone)
      if (!(await Exchange.exists({ userId: user._id, status: "ok" }))) return bad("Connect your exchange first, then Telegram.", 409);
      // the page retries when the network drops; if the first request already sent a code, don't send another
      if (b.retry && t?.phone === b.phone && t.phoneCodeHash && Date.now() - new Date(t.pendingAt).getTime() < 90e3) return ok({ next: "code", via: t.codeVia || null, nextVia: t.codeNextVia || null });
      const { ip } = await clientMeta();
      const okUser = await limit(`tg-code:${user._id}`, 8, 3600, { failClosed: true }); // 23 Nov: 8 (was 5) -- "Send again" counts too
      const okIp = await limit(`tg-code-ip:${ip}`, 10, 3600, { failClosed: true });
      const okAll = await limit("tg-code-all", 120, 3600, { failClosed: true });
      if (!okUser || !okIp || !okAll) return bad("Too many codes requested. Try again later.", 429);
      const reuse = t?.phone === b.phone && t?.pendingSessionSealed && t.status !== "connected" && Date.now() - new Date(t.pendingAt).getTime() < 60 * 6e4 ? t.pendingSessionSealed : null;
      const r = await sendCode(b.phone, reuse).catch((e) => (reuse ? sendCode(b.phone) : Promise.reject(e)));
      tgLog(user._id, `code sent to ${mask(b.phone)} via ${r.via} (other way: ${r.nextVia || "none"}, timeout ${r.timeout ?? "-"} s)`);
      t ||= new Telegram({ userId: user._id });
      Object.assign(t, { phone: b.phone, phoneCodeHash: r.phoneCodeHash, pendingSessionSealed: r.pendingSessionSealed, pendingAt: new Date(), lastError: null, codeVia: r.via, codeNextVia: r.nextVia });
      if (t.status !== "connected") t.status = "pending";
      await t.save();
      return ok({ next: "code", via: r.via, nextVia: r.nextVia, email: r.email });
    }

    // 23 Nov: "the code did not come" -> ask Telegram to send it the other way (usually SMS)
    if (b.step === "resend") {
      if (!t?.pendingSessionSealed || !t.phoneCodeHash || Date.now() - new Date(t.pendingAt).getTime() > 15 * 6e4)
        return bad("The sign-in timed out. Enter your phone number again.", 409);
      if (Date.now() - new Date(t.pendingAt).getTime() < 25e3) return bad("Wait a few seconds before asking for another code.", 429);
      if (!(await limit(`tg-code:${user._id}`, 8, 3600, { failClosed: true }))) return bad("Too many codes requested. Try again in an hour, or use Scan QR code.", 429);
      // the other way when Telegram offers one (usually SMS); otherwise a fresh code
      const r = t.codeNextVia
        ? await resendCode({ pendingSessionSealed: t.pendingSessionSealed, phone: t.phone, phoneCodeHash: t.phoneCodeHash }).catch((e) => (/SEND_CODE_UNAVAILABLE|PHONE_CODE_EXPIRED/.test(String(e?.errorMessage)) ? sendCode(t.phone, t.pendingSessionSealed) : Promise.reject(e)))
        : await sendCode(t.phone, t.pendingSessionSealed).catch(() => sendCode(t.phone));
      tgLog(user._id, `code re-sent to ${mask(t.phone)} via ${r.via} (other way: ${r.nextVia || "none"})`);
      Object.assign(t, { phoneCodeHash: r.phoneCodeHash, pendingSessionSealed: r.pendingSessionSealed, pendingAt: new Date(), codeVia: r.via, codeNextVia: r.nextVia });
      await t.save();
      return ok({ next: "code", via: r.via, nextVia: r.nextVia, email: r.email });
    }

    if (b.step === "code" || b.step === "password") {
      // a retry after the first try already signed in (its answer was lost on the way back)
      if (b.retry && t?.status === "connected" && !t.pendingSessionSealed && Date.now() - new Date(t.connectedAt).getTime() < 5 * 6e4)
        return ok({ next: "done", telegram: view(t.toObject()) });
      if (!t?.pendingSessionSealed || !t.phoneCodeHash || Date.now() - new Date(t.pendingAt).getTime() > 15 * 6e4)
        return bad("The sign-in timed out. Enter your phone number again.", 409);
      if (!(await limit(`tg-signin:${user._id}`, 10, 900, { failClosed: true }))) return bad("Too many tries. Wait 15 minutes.", 429);
      const r = await signIn({ pendingSessionSealed: t.pendingSessionSealed, phone: t.phone, phoneCodeHash: t.phoneCodeHash, code: b.code, password: b.password });
      if (r.needPassword) {
        tgLog(user._id, "code accepted, two-step password needed");
        t.pendingSessionSealed = r.pendingSessionSealed; await t.save();
        return ok({ next: "password" });
      }
      Object.assign(t, { sessionSealed: r.sessionSealed, tgUserId: r.tgUserId, tgName: r.tgName, status: "connected", connectedAt: new Date(), lastError: null, pendingSessionSealed: null, phoneCodeHash: null });
      await t.save();
      tgLog(user._id, `connected by phone (${b.step})`);
      await announce("telegram", user._id);
      return ok({ next: "done", telegram: view(t.toObject()) });
    }

    if (b.step === "logout") {
      if (t?.sessionSealed) await logOut(t.sessionSealed).catch(() => {});
      await Telegram.deleteOne({ userId: user._id });
      await Group.updateMany({ userId: user._id }, { $set: { enabled: false } });
      await announce("telegram", user._id);
      return ok({ telegram: { status: "none" } });
    }
  } catch (e) {
    tgLog(user._id, `${b.step} failed: ${String(e?.errorMessage || e?.message || e).slice(0, 200)}`);
    return bad(tgError(e), 422);
  }
  return bad("Unknown step.");
}
