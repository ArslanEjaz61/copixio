// On the server: node scripts/make-admin.mjs someone@example.com [--remove]
// Grants (or removes) the admin role for an existing account. Run it only for an account you created yourself.
try { process.loadEnvFile(new URL("../.env", import.meta.url)); } catch { /* env from shell */ }
import mongoose from "mongoose";
import { db } from "../lib/db.js";
import { User } from "../lib/models.js";

const email = String(process.argv[2] || "").toLowerCase().trim();
if (!email) { console.error("usage: node scripts/make-admin.mjs <email> [--remove]"); process.exit(2); }
await db();
const r = await User.updateOne({ email }, { $set: { role: process.argv.includes("--remove") ? "user" : "admin" } });
console.log(r.matchedCount ? `${email}: role ${process.argv.includes("--remove") ? "user" : "admin"}` : `${email}: no such account`);
await mongoose.disconnect();
