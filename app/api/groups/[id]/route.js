import mongoose from "mongoose";
import { z } from "zod";
import { db } from "@/lib/db";
import { Exchange, Group, PLANS, planOf } from "@/lib/models";
import { apiUser, bad, ok } from "@/lib/session-user";
import { announce } from "@/lib/redis";
import { groupView } from "@/lib/views";
import { FUTURES_IDS, exchangeName } from "@/lib/exchanges/list";

const num = (min, max) => z.coerce.number().min(min).max(max);
const Rules = z.object({
  enabled: z.boolean(),
  exchangeId: z.string().optional().default(""),
  sizeMode: z.enum(["fixed", "percent"]),
  sizeUsdt: num(1, 1e6),
  sizePercent: num(0.1, 100),
  maxOpen: z.coerce.number().int().min(1).max(100),
  slMode: z.enum(["signal", "percent"]),
  slPercent: num(0.1, 50),
  tpMode: z.enum(["signal", "percent"]),
  tpPercent: num(0.1, 500),
  tpSplit: z.enum(["first", "even", "half"]),
  moveSlToEntry: z.boolean(),
  dailyLossUsdt: num(0, 1e6),
  maxEntryGapPct: num(0, 50),
  market: z.enum(["spot", "futures", "both"]).optional().default("spot"), // 24 Nov
  leverage: z.coerce.number().int().min(1).max(20).optional().default(5),
});

async function own(user, id) {
  if (!mongoose.isValidObjectId(id)) return null;
  await db();
  return Group.findOne({ _id: id, userId: user._id });
}

export async function PUT(req, { params }) {
  const [user, deny] = await apiUser(req, { write: true });
  if (deny) return deny;
  const { id } = await params;
  const g = await own(user, id);
  if (!g) return bad("Not found.", 404);
  let b;
  try { b = Rules.parse(await req.json()); } catch (e) { return bad(e?.issues?.[0] ? `${e.issues[0].path.join(".")}: ${e.issues[0].message}` : "Check the rules and try again."); }

  if (b.exchangeId) {
    const x = mongoose.isValidObjectId(b.exchangeId) ? await Exchange.findOne({ _id: b.exchangeId, userId: user._id }, { exchange: 1 }).lean() : null;
    if (!x) return bad("Choose one of your connected exchanges.");
    if (b.market !== "spot" && !FUTURES_IDS.includes(x.exchange)) return bad(`Futures are not available on ${exchangeName(x.exchange)} in Copixio yet. Use Spot, or an exchange with futures (Binance, KuCoin, OKX, Bitget, HTX).`);
  }
  if (b.enabled) {
    if (!b.exchangeId) return bad("Choose the exchange this group trades on before switching it on.");
    const cap = Math.max(2, PLANS[planOf(user)].groups); // 2 can be set up before a plan is paid
    const on = await Group.countDocuments({ userId: user._id, enabled: true, _id: { $ne: g._id } });
    if (on >= cap) return bad(`Your plan trades at most ${cap} group${cap > 1 ? "s" : ""} at a time. Switch another one off or change your plan.`, 403);
  }
  Object.assign(g, { ...b, exchangeId: b.exchangeId || null });
  await g.save();
  await announce("groups", user._id);
  return ok({ group: groupView(g.toObject()) });
}

export async function DELETE(req, { params }) {
  const [user, deny] = await apiUser(req, { write: true });
  if (deny) return deny;
  const { id } = await params;
  const g = await own(user, id);
  if (!g) return bad("Not found.", 404);
  await g.deleteOne();
  await announce("groups", user._id);
  return ok();
}
