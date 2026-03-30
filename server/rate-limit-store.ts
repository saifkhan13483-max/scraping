import type { Store, Options, IncrementResponse } from "express-rate-limit";
import { redis, KEYS } from "./redis";

/**
 * A Redis-backed store for express-rate-limit.
 * Works with both ioredis (real Redis) and our in-memory fallback.
 * This ensures rate limits are shared across processes in multi-process deployments.
 */
export class RedisRateLimitStore implements Store {
  private prefix: string;
  private windowMs: number;

  constructor(prefix = "rl:", windowMs = 60_000) {
    this.prefix = prefix;
    this.windowMs = windowMs;
  }

  /**
   * Called by express-rate-limit when the store is initialized.
   * We capture windowMs here so each store instance is self-contained.
   */
  init(options: Options): void {
    this.windowMs = options.windowMs ?? this.windowMs;
  }

  async increment(key: string): Promise<IncrementResponse> {
    const rKey = KEYS.rateLimit(`${this.prefix}${key}`);
    const ttlSecs = Math.ceil(this.windowMs / 1000);

    const pipeline = redis.pipeline();
    (pipeline as any).incr(rKey);
    (pipeline as any).pttl(rKey);
    const results = await pipeline.exec();

    const totalHits = ((results?.[0]?.[1] as number) ?? 1);
    const pttlMs = ((results?.[1]?.[1] as number) ?? -1);

    // Set expiry if the key is new or has no TTL
    if (pttlMs === -1 || pttlMs === -2) {
      await (redis as any).expire(rKey, ttlSecs);
    }

    const remaining = pttlMs > 0 ? pttlMs : this.windowMs;
    const resetTime = new Date(Date.now() + remaining);
    return { totalHits, resetTime };
  }

  async decrement(key: string): Promise<void> {
    const rKey = KEYS.rateLimit(`${this.prefix}${key}`);
    await (redis as any).decr(rKey);
  }

  async resetKey(key: string): Promise<void> {
    const rKey = KEYS.rateLimit(`${this.prefix}${key}`);
    await redis.del(rKey);
  }

  async resetAll(): Promise<void> {
    // Scan and delete all keys with this prefix
    const pattern = `rl:${this.prefix}*`;
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = next;
      for (const k of keys) {
        await redis.del(k);
      }
    } while (cursor !== "0");
  }
}

/** Create a Redis-backed store instance for a given window. */
export function createRedisStore(prefix: string, windowMs: number): RedisRateLimitStore {
  return new RedisRateLimitStore(prefix, windowMs);
}
