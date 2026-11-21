import mongoose from "mongoose";
import { z } from "zod";
import { db } from "@/lib/db";
import { Payment, User } from "@/lib/models";
import { apiUser, bad, ok } from "@/lib/session-user";
import { notify } from "@/lib/notify";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("payment"), id: z.string(), decision: z.enum(["approve", "reject"]), note: z.string().max(300).optional() }),
  z.object({ action: z.literal("plan"), userId: z.string(), plan: z.enum(["none", "starter", "pro", "desk"]), days: z.coerce.number().int().min(0).max(3660) }),
]);

const addMonths = (from, m) => { const d = new Date(Math.max(Date.now(), from ? new Date(from).getTime() : 0)); d.setUTCMonth(d.getUTCMonth() + m); return d; };

export async function POST(req) {
  const [admin, deny] = await apiUser(req, { write: true, admin: true });
  if (deny) return deny;
  let b;
  try { b = Body.parse(await req.json()); } catch { return bad("Bad request."); }
  await db();

  if (b.action === "payment") {
    if (!mongoose.isValidObjectId(b.id)) return bad("Not found.", 404);
    const p = await Payment.findOneAndUpdate({ _id: b.id, status: "submitted" },
      { $set: { status: b.decision === "approve" ? "approved" : "rejected", note: b.note || null, decidedAt: new Date(), decidedBy: admin._id } }, { new: true });
    if (!p) return bad("This payment was already decided.", 409);
    const u = await User.findById(p.userId);
    if (b.decision === "approve") {
      const keep = u.plan === p.plan ? u.planUntil : null; // the same plan extends; another plan starts now
      // a paid plan starts from today when it replaces the free trial
      u.plan = p.plan; u.planUntil = addMonths(u.trial ? null : keep, p.months); u.trial = false; await u.save();
      await notify(u, `✅ Payment confirmed. Your ${p.plan} plan is active until ${u.planUntil.toDateString()}. The bot is on.`);
    } else {
      await notify(u, `⚠️ We could not confirm your payment (TXID ${p.txid}).${b.note ? ` ${b.note}` : ""} Reply to support if you think this is wrong.`);
    }
    return ok();
  }

  if (b.action === "plan") {
    if (!mongoose.isValidObjectId(b.userId)) return bad("Not found.", 404);
    const until = b.plan === "none" || b.days === 0 ? null : new Date(Date.now() + b.days * 864e5);
    await User.updateOne({ _id: b.userId }, { $set: { plan: b.plan, planUntil: until, trial: false } });
    return ok();
  }
  return bad("Unknown action.");
}
