import { z } from "zod";
import { db } from "@/lib/db";
import { Exchange, Telegram } from "@/lib/models";
import { clientMeta } from "@/lib/auth";
import { limit } from "@/lib/rate";
import { apiUser, bad, ok } from "@/lib/session-user";
import { announce } from "@/lib/redis";
import { tgError } from "@/lib/tg";
import { qrCancel, qrPassword, qrStart, qrState, qrTake } from "@/lib/tg-qr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const view = (t) => ({ status: t.status, phone: t.phone ? t.phone.replace(/\d(?=\d{3})/g, "•") : null, tgName: t.tgName || null });

// Poll: the QR picture while waiting, "password" when two-step verification is on, "done" once connected.
export async function GET(req) {
  const [user, deny] = await apiUser(req);
  if (deny) return deny;
  const uid = String(user._id);
  const st = await qrState(uid);
  if (st.status === "done") {
    const r = qrTake(uid);
    if (!r) return ok({ status: "none" });
    await db();
    const t = await Telegram.findOneAndUpdate({ userId: user._id },
      { $set: { sessionSealed: r.sessionSealed, tgUserId: r.tgUserId, tgName: r.tgName, status: "connected", connectedAt: new Date(), lastError: null, pendingSessionSealed: null, phoneCodeHash: null } },
      { upsert: true, new: true }).lean();
    await announce("telegram", user._id);
    return ok({ status: "done", telegram: view(t) });
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
    try { return ok(await qrStart(uid)); }
    catch (e) { await qrCancel(uid); return bad(tgError(e), 422); }
  }
  if (b.action === "password") {
    if (!(await limit(`tg-qr-pw:${uid}`, 8, 900, { failClosed: true }))) return bad("Too many tries. Wait 15 minutes.", 429);
    return qrPassword(uid, b.password) ? ok({ status: "checking" }) : bad("The sign-in timed out. Show a new QR code.", 409);
  }
  if (b.action === "cancel") { await qrCancel(uid); return ok({ status: "none" }); }
  return bad("Unknown action.");
}
