// 24 Nov: before sign-up codes go on, every account that already exists is marked as confirmed, so nobody who signed
// up earlier is asked for a code. Run once:  node --env-file=.env scripts/verify-existing.mjs [--dry]
import mongoose from "mongoose";
import { User } from "../lib/models.js";

await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/copixio");
const q = { emailVerifiedAt: null };
const n = await User.countDocuments(q);
if (process.argv.includes("--dry")) console.log(`would mark ${n} accounts as confirmed`);
else { const r = await User.updateMany(q, { $set: { emailVerifiedAt: new Date() } }); console.log(`marked ${r.modifiedCount} accounts as confirmed`); }
process.exit(0);
