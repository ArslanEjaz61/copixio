import { db } from "@/lib/db";
import { Group, Telegram } from "@/lib/models";
import { limit } from "@/lib/rate";
import { apiUser, bad, ok } from "@/lib/session-user";
import { listChats, tgError } from "@/lib/tg";

export const runtime = "nodejs";

// The user's Telegram groups and channels, marked with the ones already added to Copixio.
export async function GET(req) {
  const [user, deny] = await apiUser(req);
  if (deny) return deny;
  if (!(await limit(`tg-chats:${user._id}`, 30, 600, { failClosed: true }))) return bad("Too many refreshes. Wait a few minutes.", 429);
  await db();
  const t = await Telegram.findOne({ userId: user._id, status: "connected" }).lean();
  if (!t) return bad("Connect Telegram first.", 409);
  try {
    const chats = await listChats(t.sessionSealed);
    const added = new Set((await Group.find({ userId: user._id }, { chatId: 1 }).lean()).map((g) => g.chatId));
    return ok({ chats: chats.map((c) => ({ ...c, added: added.has(c.chatId) })) });
  } catch (e) {
    const msg = tgError(e);
    if (/AUTH_KEY_UNREGISTERED|SESSION_REVOKED/.test(String(e?.errorMessage || e?.message)))
      await Telegram.updateOne({ userId: user._id }, { $set: { status: "logged_out", lastError: msg } });
    return bad(msg, 422);
  }
}
