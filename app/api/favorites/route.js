import { z } from "zod";
import { db } from "@/lib/db";
import { Exchange, User } from "@/lib/models";
import { apiUser, bad, ok } from "@/lib/session-user";
import { catalog, coinTerm, search } from "@/lib/coins";
import { MAX_FAVS, normBase } from "@/lib/favs";
import { limit } from "@/lib/rate";

export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), base: z.string().trim().min(1).max(20) }),
  z.object({ action: z.literal("remove"), base: z.string().trim().min(1).max(20) }),
  z.object({ action: z.literal("only"), on: z.boolean() }),
  z.object({ action: z.literal("clear") }),
]);

const exchangeIds = async (userId) => (await Exchange.find({ userId, status: "ok" }, { exchange: 1 }).lean()).map((e) => e.exchange);

// GET /api/favorites            -> { favs, only }
// GET /api/favorites?q=pepe     -> { results: [{ base, venues, fav }] }  (search the coins of Binance, KuCoin and the user's exchanges)
export async function GET(req) {
  const [user, deny] = await apiUser(req);
  if (deny) return deny;
  const q = new URL(req.url).searchParams.get("q")?.slice(0, 30) ?? null;
  if (q === null) return ok({ favs: user.favCoins || [], only: !!user.favOnly });
  if (!(await limit(`coins:${user._id}`, 120, 60))) return bad("Slow down a little.", 429);
  await db();
  const all = await catalog(await exchangeIds(user._id));
  if (!all.size) return bad("The coin list is not available right now. Try again in a minute.", 503);
  const found = search(all, q);
  const mine = new Set((user.favCoins || []).map(normBase));
  return ok({ term: coinTerm(q, all), results: found.map((r) => ({ ...r, fav: mine.has(normBase(r.base)) })) });
}

export async function POST(req) {
  const [user, deny] = await apiUser(req, { write: true });
  if (deny) return deny;
  let b;
  try { b = Body.parse(await req.json()); } catch (e) { return bad(e?.issues?.[0]?.message || "Check the request."); }
  if (!(await limit(`favw:${user._id}`, 60, 60))) return bad("Slow down a little.", 429);
  await db();
  if (b.action === "only") { await User.updateOne({ _id: user._id }, { $set: { favOnly: b.on } }); return ok({ only: b.on }); }
  if (b.action === "clear") { await User.updateOne({ _id: user._id }, { $set: { favCoins: [] } }); return ok({ favs: [] }); }
  if (b.action === "remove") { // exactly as saved
    const base = b.base.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const u = await User.findByIdAndUpdate(user._id, { $pull: { favCoins: base } }, { new: true, projection: { favCoins: 1 } }).lean();
    return ok({ favs: u?.favCoins || [] });
  }
  const all = await catalog(await exchangeIds(user._id));
  if (!all.size) return bad("The coin list is not available right now. Try again in a minute.", 503);
  const base = coinTerm(b.base, all);
  if (!all.has(base)) return bad(`${base} was not found on Binance, KuCoin or your connected exchanges.`, 404);
  const have = (await User.findById(user._id, { favCoins: 1 }).lean())?.favCoins || [];
  if (have.some((c) => normBase(c) === normBase(base))) return ok({ favs: have }); // PEPE and 1000PEPE are one coin
  // the cap holds even when two adds race: only a list shorter than MAX_FAVS takes the new coin
  const u = await User.findOneAndUpdate({ _id: user._id, [`favCoins.${MAX_FAVS - 1}`]: { $exists: false } }, { $addToSet: { favCoins: base } }, { new: true, projection: { favCoins: 1 } }).lean();
  if (!u) return bad(`You can keep up to ${MAX_FAVS} favourite coins.`, 409);
  return ok({ favs: u.favCoins || [] });
}
