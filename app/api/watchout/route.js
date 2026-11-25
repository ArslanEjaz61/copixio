import crypto from "node:crypto";
import { redis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Watchout coins (workers/watchout.mjs) for the Smartbot dashboard. Read-only market data, behind a shared key
// (header x-watchout-key = WATCHOUT_KEY) so it is not a public API.
export async function GET(req) {
  const want = process.env.WATCHOUT_KEY || "";
  const got = req.headers.get("x-watchout-key") || "";
  const same = want.length >= 32 && got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
  if (!same) return Response.json({ error: "not allowed" }, { status: 401 });
  const raw = await redis().get("wo:list").catch(() => null);
  if (!raw) return Response.json({ error: "not ready yet" }, { status: 503 });
  return new Response(raw, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
