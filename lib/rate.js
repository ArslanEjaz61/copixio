import "server-only";
import Redis from "ioredis";

// Fixed-window rate limit in Redis. INCR and EXPIRE run as one Lua script, so a key can never be left without a TTL
// (which would lock that IP or account out for good). Auth routes pass failClosed so a Redis outage cannot be used
// to brute-force passwords.
const g = globalThis;
function redis() {
  if (!g.__cxRedis) {
    g.__cxRedis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", { maxRetriesPerRequest: 1, enableOfflineQueue: false });
    g.__cxRedis.on("error", () => {});
  }
  return g.__cxRedis;
}

const SCRIPT = "local n = redis.call('INCR', KEYS[1]) if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return n";

export async function limit(key, max, windowSec, { failClosed = false } = {}) {
  try {
    const n = await redis().eval(SCRIPT, 1, `rl:${key}`, String(windowSec));
    return Number(n) <= max;
  } catch {
    return !failClosed;
  }
}
