// 24 Nov, once: groups saved before they were tied to a Telegram account get the user's CURRENT account.
//   node --env-file=.env scripts/bind-groups.mjs [--dry]
import mongoose from "mongoose";
import { Group, Telegram } from "../lib/models.js";

await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/copixio");
const dry = process.argv.includes("--dry");
for (const t of await Telegram.find({ tgUserId: { $nin: [null, ""] } }, { userId: 1, tgUserId: 1 }).lean()) {
  const q = { userId: t.userId, tgUserId: null };
  const n = await Group.countDocuments(q);
  if (!n) continue;
  if (!dry) await Group.updateMany(q, { $set: { tgUserId: String(t.tgUserId) } });
  console.log(`${dry ? "would bind" : "bound"} ${n} groups of user ${t.userId} to Telegram ${t.tgUserId}`);
}
process.exit(0);
