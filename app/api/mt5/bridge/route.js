import { db } from "@/lib/db";
import { Exchange } from "@/lib/models";
import { limit } from "@/lib/rate";
import { formatResponse, hashToken, ingest, parseReport, takeCommands } from "@/lib/mt5";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const text = (body, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

// The Copixio EA calls this about once a second: it reports the account, its positions and deals, and gets orders back.
// Authentication is the private token (header Authorization: Bearer <token>); no cookie, no browser.
export async function POST(req) {
  const auth = req.headers.get("authorization") || req.headers.get("x-copixio-token") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!/^[0-9a-f]{64}$/.test(token)) return text("ERR|bad token", 401);
  if (Number(req.headers.get("content-length") || 0) > 300000) return text("ERR|too large", 413);
  await db();
  const conn = await Exchange.findOne({ exchange: "mt5", "bridge.tokenHash": hashToken(token) }).lean();
  if (!conn) return text("ERR|unknown token (make a new one in Copixio → Connections)", 401);
  if (!(await limit(`mt5-poll:${conn._id}`, 600, 60))) return text("ERR|slow down", 429); // 10 per second is plenty
  try {
    await ingest(conn, parseReport(await req.text()));
    return text(formatResponse(await takeCommands(conn)));
  } catch (e) {
    console.error("mt5 bridge:", e.message);
    return text("ERR|server error", 500);
  }
}
