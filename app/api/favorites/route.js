import { z } from "zod";
import { db } from "@/lib/db";
import { Exchange, User } from "@/lib/models";
import { apiUser, bad, ok } from "@/lib/session-user";
import { catalog, search } from "@/lib/coins";
import { MAX_FAVS, normBase } from "@/lib/favs";
import { limit } from "@/lib/rate";

export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), base: z.string().trim().min(1).max(20) }),
  z.object({ action: z.literal("remove"), base: z.string().trim().min(1).max(20) }),
  z.object({ action: z.literal("only"), on: z.boolean() }),
]);

const exchangeIds = async (userId) => (await Exchange.find({ userId, status: "ok" }, { exchange: 1 }).lean()).map((e) => e.exchange);

// GET /api/favorites            -> { favs, only }
// GET /api/favorites?q=pepe     -> { results: [{ base, venues, fav }] }  (search the coins of Binance, KuCoin and the user's exchanges)
export async function GET(req) {
  const [user, deny] = await apiUser(req);
  if (deny) return deny;
  const q = new URL(req.url).searchParams.get("q");
  if (q === null) return ok({ favs: user.favCoins || [], only: !!user.favOnly });
  if (!(await limit(`coins:${user._id}`, 120, 60))) return bad("Slow down a little.", 429);
  await db();
  const found = search(await catalog(await exchangeIds(user._id)), q);
  const mine = new Set((user.favCoins || []).map(normBase));
  return ok({ results: found.map((r) => ({ ...r, fav: mine.has(normBase(r.base)) })) });
}

export async function POST(req) {
  const [user, deny] = await apiUser(req, { write: true });
  if (deny) return deny;
  let b;
  try { b = Body.parse(await req.json()); } catch (e) { return bad(e?.issues?.[0]?.message || "Check the request."); }
  await db();
  if (b.action === "only") { await User.updateOne({ _id: user._id }, { $set: { favOnly: b.on } }); return ok({ only: b.on }); }
  const base = b.base.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (b.action === "remove") {
    const u = await User.findByIdAndUpdate(user._id, { $pull: { favCoins: base } }, { new: true, projection: { favCoins: 1 } }).lean();
    return ok({ favs: u?.favCoins || [] });
  }
  if ((user.favCoins || []).length >= MAX_FAVS) return bad(`You can keep up to ${MAX_FAVS} favourite coins.`, 409);
  const all = await catalog(await exchangeIds(user._id));
  if (!all.has(base)) return bad(`${base} was not found on Binance, KuCoin or your connected exchanges.`, 404);
  const u = await User.findByIdAndUpdate(user._id, { $addToSet: { favCoins: base } }, { new: true, projection: { favCoins: 1 } }).lean();
  return ok({ favs: u?.favCoins || [] });
}
