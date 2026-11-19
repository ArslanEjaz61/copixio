import crypto from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { Session, User } from "@/lib/models";
import { hashPassword, verifyPassword, createSession } from "@/lib/auth";
import { limit } from "@/lib/rate";
import { apiUser, bad, ok } from "@/lib/session-user";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("profile"), name: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal("password"), current: z.string().min(1).max(200), next: z.string().min(10, "Use at least 10 characters").max(200) }),
  z.object({ action: z.literal("pause"), paused: z.boolean() }),
  z.object({ action: z.literal("notify-link") }),
  z.object({ action: z.literal("notify-off") }),
]);

export async function POST(req) {
  const [user, deny] = await apiUser(req, { write: true });
  if (deny) return deny;
  let b;
  try { b = Body.parse(await req.json()); } catch (e) { return bad(e?.issues?.[0]?.message || "Check the form."); }
  await db();

  if (b.action === "profile") { await User.updateOne({ _id: user._id }, { $set: { name: b.name } }); return ok(); }

  if (b.action === "password") {
    if (!(await limit(`pw:${user._id}`, 6, 900, { failClosed: true }))) return bad("Too many tries. Wait 15 minutes.", 429);
    const u = await User.findById(user._id);
    if (!(await verifyPassword(b.current, u.passwordHash))) return bad("Your current password is not right.", 401);
    u.passwordHash = await hashPassword(b.next);
    await u.save();
    await Session.deleteMany({ userId: u._id }); // every other device is signed out
    await createSession(u._id); // this one stays signed in
    return ok();
  }

  if (b.action === "pause") { await User.updateOne({ _id: user._id }, { $set: { botPaused: b.paused } }); return ok({ paused: b.paused }); }

  if (b.action === "notify-link") {
    if (!process.env.TG_BOT_TOKEN || !process.env.TG_BOT_USERNAME) return bad("Notifications are not available yet.", 409);
    const code = crypto.randomBytes(12).toString("base64url");
    await User.updateOne({ _id: user._id }, { $set: { notifyLinkHash: crypto.createHash("sha256").update(code).digest("hex"), notifyLinkExpires: new Date(Date.now() + 15 * 6e4) } });
    return ok({ url: `https://t.me/${process.env.TG_BOT_USERNAME}?start=${code}` });
  }

  if (b.action === "notify-off") { await User.updateOne({ _id: user._id }, { $set: { notifyChatId: null } }); return ok(); }
  return bad("Unknown action.");
}
