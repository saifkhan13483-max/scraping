import Redis from "ioredis";

const rawUrl = process.env.REDIS_URL?.trim();

if (!rawUrl) {
  throw new Error("REDIS_URL environment variable is required and must not be empty");
}

// Validate it looks like a Redis URL before passing to ioredis
// Valid prefixes: redis://, rediss://, redis+tls://
if (!/^rediss?(\+tls)?:\/\//i.test(rawUrl)) {
  throw new Error(
    `REDIS_URL must start with redis:// or rediss:// — got: "${rawUrl.slice(0, 30)}"`
  );
}

console.log(
  `[Redis] Connecting to ${rawUrl.replace(/:\/\/[^@]*@/, "://<credentials>@")}`
);

export const redis = new Redis(rawUrl, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
  tls: rawUrl.startsWith("rediss://") ? {} : undefined,
});

redis.on("connect", () => console.log("[Redis] Connected"));
redis.on("ready", () => console.log("[Redis] Ready"));
redis.on("error", (err) => console.error("[Redis] Error:", err.message));
redis.on("close", () => console.warn("[Redis] Connection closed"));

// Key constants
export const KEYS = {
  job: (id: string) => `job:${id}`,
  queuePending: "queue:pending",
  queueProcessing: "queue:processing",
  jobTimestamp: (id: string) => `job:${id}:started_at`,
} as const;
