import { z } from "zod";
import { db } from "@/lib/db";
import { Group, Telegram } from "@/lib/models";
import { apiUser, bad, ok } from "@/lib/session-user";
import { groupView } from "@/lib/views";

export async function GET(req) {
  const [user, deny] = await apiUser(req);
  if (deny) return deny;
  await db();
  const t = await Telegram.findOne({ userId: user._id, status: "connected" }, { tgUserId: 1 }).lean();
  const list = t ? await Group.find({ userId: user._id, tgUserId: String(t.tgUserId) }).sort({ createdAt: 1 }).lean() : [];
  return ok({ groups: list.map(groupView) });
}

const Body = z.object({ chatId: z.string().regex(/^-?\d{1,20}$/), title: z.string().trim().min(1).max(200), kind: z.enum(["group", "channel"]) });

// Add a group from the user's Telegram list (off until its rules are saved and switched on).
export async function POST(req) {
  const [user, deny] = await apiUser(req, { write: true });
  if (deny) return deny;
  let b;
  try { b = Body.parse(await req.json()); } catch { return bad("That group could not be added."); }
  await db();
  const t = await Telegram.findOne({ userId: user._id, status: "connected" }, { tgUserId: 1 }).lean();
  if (!t) return bad("Connect Telegram first.", 409);
  if ((await Group.countDocuments({ userId: user._id })) >= 200) return bad("You can follow at most 200 groups.", 403);
  // 24 Nov: a group belongs to the Telegram account it was added with (re-adding it binds it to the current one)
  const g = await Group.findOneAndUpdate(
    { userId: user._id, chatId: b.chatId },
    { $setOnInsert: { userId: user._id, chatId: b.chatId, enabled: false }, $set: { title: b.title, kind: b.kind, tgUserId: String(t.tgUserId) } },
    { upsert: true, new: true }
  ).lean();
  return ok({ group: groupView(g) });
}
