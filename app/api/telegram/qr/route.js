import { z } from "zod";
import { db } from "@/lib/db";
import { Exchange, Telegram } from "@/lib/models";
import { clientMeta } from "@/lib/auth";
import { limit } from "@/lib/rate";
import { apiUser, bad, ok } from "@/lib/session-user";
import { announce } from "@/lib/redis";
import { tgError } from "@/lib/tg";
import { qrCancel, qrPassword, qrStart, qrState } from "@/lib/tg-qr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const view = (t) => ({ status: t.status, phone: t.phone ? t.phone.replace(/\d(?=\d{3})/g, "•") : null, tgName: t.tgName || null });

// Saves a confirmed QR login straight away (called by lib/tg-qr the moment Telegram confirms the scan).
const saver = (userId) => async (r) => {
  await db();
  await Telegram.findOneAndUpdate({ userId },
    { $set: { sessionSealed: r.sessionSealed, tgUserId: r.tgUserId, tgName: r.tgName, status: "connected", connectedAt: new Date(), lastError: null, pendingSessionSealed: null, phoneCodeHash: null } },
    { upsert: true });
  await announce("telegram", userId).catch(() => {}); // the listener also re-reads every few minutes
};

// Poll: the QR picture while waiting, "password" when two-step verification is on, "done" once connected.
export async function GET(req) {
  const [user, deny] = await apiUser(req);
  if (deny) return deny;
  const st = await qrState(String(user._id));
  if (st.status === "done" || st.status === "none") {
    // "none" too: the page may have lost its connection (or been reloaded) while the scan went through
    await db();
    const t = await Telegram.findOne({ userId: user._id }).lean();
    if (t?.status === "connected" && (st.status === "done" || Date.now() - new Date(t.connectedAt).getTime() < 10 * 6e4)) return ok({ status: "done", telegram: view(t) });
  }
  return ok(st);
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("password"), password: z.string().min(1).max(256) }),
  z.object({ action: z.literal("cancel") }),
]);

export async function POST(req) {
  const [user, deny] = await apiUser(req, { write: true });
  if (deny) return deny;
  let b;
  try { b = Body.parse(await req.json()); } catch { return bad("Bad request."); }
  const uid = String(user._id);

  if (b.action === "start") {
    await db();
    if (!(await Exchange.exists({ userId: user._id, status: "ok" }))) return bad("Connect your exchange first, then Telegram.", 409);
    const { ip } = await clientMeta();
    const okUser = await limit(`tg-qr:${uid}`, 12, 3600, { failClosed: true });
    const okIp = await limit(`tg-qr-ip:${ip}`, 20, 3600, { failClosed: true });
    if (!okUser || !okIp) return bad("Too many QR codes requested. Try again in a while.", 429);
    try { return ok(await qrStart(uid, saver(user._id))); }
    catch (e) { await qrCancel(uid); return bad(tgError(e), 422); }
  }
  if (b.action === "password") {
    if (!(await limit(`tg-qr-pw:${uid}`, 8, 900, { failClosed: true }))) return bad("Too many tries. Wait 15 minutes.", 429);
    if (qrPassword(uid, b.password)) return ok({ status: "checking" });
    const st = await qrState(uid); // a resend after the first one went through
    return ["checking", "done"].includes(st.status) ? ok({ status: "checking" }) : bad("The sign-in timed out. Show a new QR code.", 409);
  }
  if (b.action === "cancel") { await qrCancel(uid); return ok({ status: "none" }); }
  return bad("Unknown action.");
}
