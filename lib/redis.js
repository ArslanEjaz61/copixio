// One Redis client per process (web app and workers). The offline queue stays on so the first command after a start
// waits for the connection; commandTimeout bounds every wait.
import Redis from "ioredis";

const g = globalThis;
export function redis() {
  if (!g.__cxRedis) {
    g.__cxRedis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", { maxRetriesPerRequest: 1, commandTimeout: 3000, connectTimeout: 3000 });
    g.__cxRedis.on("error", () => {});
  }
  return g.__cxRedis;
}

// Tell the workers that a user's Telegram login or groups changed (they reload that user).
export const announce = (kind, userId) => redis().publish("cx:changed", JSON.stringify({ kind, userId: String(userId) })).catch(() => {});
