import { z } from "zod";
import { db } from "@/lib/db";
import { Exchange, PLANS, planOf } from "@/lib/models";
import { seal, tail } from "@/lib/seal";
import { limit } from "@/lib/rate";
import { apiUser, bad, ok } from "@/lib/session-user";
import { exchangeView as publicView } from "@/lib/views";
import { checkKeyFor } from "@/lib/exchanges/check";
import { EXCHANGE_IDS, exchangeMeta } from "@/lib/exchanges/list";

const Body = z.object({
  exchange: z.enum(EXCHANGE_IDS),
  label: z.string().trim().max(40).optional(),
  key: z.string().trim().min(10, "Paste the whole API key").max(300),
  secret: z.string().trim().min(10, "Paste the whole secret key").max(4000), // Coinbase private keys are PEM blocks
  passphrase: z.string().trim().max(100).optional(),
});


export async function GET(req) {
  const [user, deny] = await apiUser(req);
  if (deny) return deny;
  await db();
  const list = await Exchange.find({ userId: user._id }).sort({ createdAt: 1 }).lean();
  return ok({ exchanges: list.map(publicView) });
}

export async function POST(req) {
  const [user, deny] = await apiUser(req, { write: true });
  if (deny) return deny;
  if (!(await limit(`exch-add:${user._id}`, 12, 3600, { failClosed: true }))) return bad("Too many attempts this hour. Wait a little and try again.", 429);
  let b;
  try { b = Body.parse(await req.json()); }
  catch (e) { return bad(e?.issues?.[0]?.message || "Check the form and try again."); }
  const meta = exchangeMeta(b.exchange);
  if (meta.pass && !b.passphrase) return bad(`${meta.name} keys also need the passphrase you set when creating the key.`);
  if (!meta.longSecret && b.secret.length > 200) return bad("That secret is too long. Paste only the secret key.");

  await db();
  const max = PLANS[planOf(user)].exchanges;
  if ((await Exchange.countDocuments({ userId: user._id })) >= Math.max(1, max))
    return bad(`Your plan allows ${Math.max(1, max)} exchange account${max > 1 ? "s" : ""}. Remove one first or change your plan.`, 403);

  const res = await checkKeyFor(b.exchange, b.key, b.secret, b.passphrase);
  if (!res.ok) return bad(res.error, 422);

  const doc = await Exchange.create({
    userId: user._id, exchange: b.exchange, env: res.env, label: b.label || "",
    keyTail: tail(b.key), keySealed: seal(b.key), secretSealed: seal(b.secret), passphraseSealed: b.passphrase ? seal(b.passphrase) : undefined,
    status: "ok", usdtFree: res.usdtFree, ipRestricted: res.ipRestricted, checkedAt: new Date(),
  });
  return ok({ exchange: publicView(doc.toObject()) });
}
