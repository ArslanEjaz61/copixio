import mongoose from "mongoose";
import { db } from "@/lib/db";
import { Exchange } from "@/lib/models";
import { limit } from "@/lib/rate";
import { apiUser, bad, ok } from "@/lib/session-user";
import { exchangeView } from "@/lib/views";
import { hashToken, newToken } from "@/lib/mt5";

export const runtime = "nodejs";

// A new token for this MetaTrader 5 connection (the old one stops working at once). Shown once.
export async function POST(req, { params }) {
  const [user, deny] = await apiUser(req, { write: true });
  if (deny) return deny;
  if (!(await limit(`mt5-token:${user._id}`, 10, 3600, { failClosed: true }))) return bad("Too many attempts this hour.", 429);
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return bad("Not found.", 404);
  await db();
  const x = await Exchange.findOne({ _id: id, userId: user._id, exchange: "mt5" });
  if (!x) return bad("Not found.", 404);
  const token = newToken();
  x.bridge = { ...(x.bridge?.toObject?.() || x.bridge || {}), tokenHash: hashToken(token), lastSeenAt: null };
  x.keyTail = `••••${token.slice(-4)}`;
  await x.save();
  return ok({ exchange: exchangeView(x.toObject()), token });
}
