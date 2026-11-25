import { z } from "zod";
import { db } from "@/lib/db";
import { Exchange, PLANS, planOf } from "@/lib/models";
import { limit } from "@/lib/rate";
import { apiUser, bad, ok } from "@/lib/session-user";
import { exchangeView } from "@/lib/views";
import { hashToken, newToken } from "@/lib/mt5";

export const runtime = "nodejs";

const Body = z.object({ label: z.string().trim().max(40).optional() });

// Connect MetaTrader 5: makes the private token the Copixio EA uses. The token is shown ONCE; only its hash is kept.
export async function POST(req) {
  const [user, deny] = await apiUser(req, { write: true });
  if (deny) return deny;
  if (!(await limit(`mt5-add:${user._id}`, 10, 3600, { failClosed: true }))) return bad("Too many attempts this hour. Wait a little and try again.", 429);
  let b;
  try { b = Body.parse(await req.json().catch(() => ({}))); } catch (e) { return bad(e?.issues?.[0]?.message || "Check the form and try again."); }
  await db();
  const max = PLANS[planOf(user)].exchanges;
  if ((await Exchange.countDocuments({ userId: user._id })) >= Math.max(1, max))
    return bad(`Your plan allows ${Math.max(1, max)} exchange account${max > 1 ? "s" : ""}. Remove one first or change your plan.`, 403);
  const token = newToken();
  const doc = await Exchange.create({ userId: user._id, exchange: "mt5", env: "demo", label: b.label || "", keyTail: `••••${token.slice(-4)}`, status: "ok", bridge: { tokenHash: hashToken(token) } });
  return ok({ exchange: exchangeView(doc.toObject()), token });
}
