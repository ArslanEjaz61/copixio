import { z } from "zod";
import { db } from "@/lib/db";
import { Payment, PLANS } from "@/lib/models";
import { limit } from "@/lib/rate";
import { apiUser, bad, ok } from "@/lib/session-user";
import { notify } from "@/lib/notify";

const Body = z.object({
  plan: z.enum(["starter", "pro", "desk"]),
  months: z.coerce.number().int().min(1).max(12),
  txid: z.string().trim().regex(/^[A-Za-z0-9]{20,120}$/, "Paste the transaction hash (TXID) from your wallet or exchange"),
});

// The user paid USDT to our address and sends the transaction id; an admin confirms it on-chain and approves.
export async function POST(req) {
  const [user, deny] = await apiUser(req, { write: true });
  if (deny) return deny;
  if (!process.env.USDT_TRC20_ADDRESS) return bad("Payments are not open yet.", 409);
  if (!(await limit(`pay:${user._id}`, 6, 3600, { failClosed: true }))) return bad("Too many submissions this hour.", 429);
  let b;
  try { b = Body.parse(await req.json()); } catch (e) { return bad(e?.issues?.[0]?.message || "Check the form."); }
  b.txid = b.txid.toLowerCase(); // TRON hashes are hex: one case, so a replay in another case is caught
  await db();
  if (await Payment.exists({ txid: b.txid })) return bad("This transaction was already submitted.", 409);
  if (await Payment.exists({ userId: user._id, status: "submitted" })) return bad("You already have a payment waiting for confirmation.", 409);
  const p = await Payment.create({ userId: user._id, plan: b.plan, months: b.months, amountUsdt: PLANS[b.plan].price * b.months, txid: b.txid, network: "TRC20" });
  if (process.env.ADMIN_NOTIFY_CHAT && process.env.TG_BOT_TOKEN)
    await notify({ notifyChatId: process.env.ADMIN_NOTIFY_CHAT }, `💳 New payment: ${user.email} · ${b.plan} × ${b.months} · ${p.amountUsdt} USDT\nTXID ${b.txid}`).catch(() => {});
  return ok({ id: String(p._id) });
}
