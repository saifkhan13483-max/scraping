import Redis from "ioredis";

if (!process.env.REDIS_URL) {
  throw new Error("REDIS_URL environment variable is required");
}

export const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

redis.on("connect", () => console.log("[Redis] Connected"));
redis.on("error", (err) => console.error("[Redis] Error:", err.message));
redis.on("close", () => console.warn("[Redis] Connection closed"));

// Key constants
export const KEYS = {
  job: (id: string) => `job:${id}`,
  queuePending: "queue:pending",
  queueProcessing: "queue:processing",
  jobTimestamp: (id: string) => `job:${id}:started_at`,
} as const;
