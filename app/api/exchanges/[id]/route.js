import mongoose from "mongoose";
import { db } from "@/lib/db";
import { Exchange, Group, Trade } from "@/lib/models";
import { unseal } from "@/lib/seal";
import { limit } from "@/lib/rate";
import { apiUser, bad, ok } from "@/lib/session-user";
import { checkKey as binanceCheck } from "@/lib/exchanges/binance";
import { checkKey as kucoinCheck } from "@/lib/exchanges/kucoin";
import { exchangeView as publicView } from "@/lib/views";

async function own(user, id) {
  if (!mongoose.isValidObjectId(id)) return null;
  await db();
  return Exchange.findOne({ _id: id, userId: user._id });
}

// Test the saved key again (balance, permissions).
export async function POST(req, { params }) {
  const [user, deny] = await apiUser(req, { write: true });
  if (deny) return deny;
  if (!(await limit(`exch-check:${user._id}`, 30, 3600, { failClosed: true }))) return bad("Too many checks this hour.", 429);
  const { id } = await params;
  const x = await own(user, id);
  if (!x) return bad("Not found.", 404);
  let res;
  try {
    const key = unseal(x.keySealed), secret = unseal(x.secretSealed);
    res = x.exchange === "binance" ? await binanceCheck(key, secret) : await kucoinCheck(key, secret, unseal(x.passphraseSealed));
  } catch { res = { ok: false, error: "The saved key could not be read. Remove it and add it again." }; }
  x.checkedAt = new Date();
  if (res.ok) Object.assign(x, { status: "ok", lastError: null, usdtFree: res.usdtFree, ipRestricted: res.ipRestricted, env: res.env });
  else Object.assign(x, { status: "error", lastError: res.error });
  await x.save();
  return ok({ exchange: publicView(x.toObject()) });
}

// Remove a key. Refused while the bot still holds a position on it (the position would be left unmanaged).
export async function DELETE(req, { params }) {
  const [user, deny] = await apiUser(req, { write: true });
  if (deny) return deny;
  const { id } = await params;
  const x = await own(user, id);
  if (!x) return bad("Not found.", 404);
  const openTrades = await Trade.countDocuments({ exchangeId: x._id, status: { $in: ["opening", "open", "closing"] } });
  if (openTrades) return bad(`The bot still has ${openTrades} open trade${openTrades > 1 ? "s" : ""} on this account. Close ${openTrades > 1 ? "them" : "it"} first.`, 409);
  await Group.updateMany({ userId: user._id, exchangeId: x._id }, { $set: { exchangeId: null, enabled: false } });
  await x.deleteOne();
  return ok();
}
