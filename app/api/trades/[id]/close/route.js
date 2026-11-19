import mongoose from "mongoose";
import { db } from "@/lib/db";
import { Trade } from "@/lib/models";
import { apiUser, bad, ok } from "@/lib/session-user";

// Ask the trader to sell the whole position at market (it does so within a few seconds).
export async function POST(req, { params }) {
  const [user, deny] = await apiUser(req, { write: true });
  if (deny) return deny;
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return bad("Not found.", 404);
  await db();
  const r = await Trade.updateOne({ _id: id, userId: user._id, status: "open" }, { $set: { closeRequested: true } });
  if (!r.matchedCount) return bad("This trade is not open any more.", 409);
  return ok();
}
