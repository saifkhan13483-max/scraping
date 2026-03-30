import Redis from "ioredis";

const rawUrl = process.env.REDIS_URL?.trim();

// ─── In-memory fallback ───────────────────────────────────────────────────────
// Used when REDIS_URL is absent, invalid, or the Redis client fails to init.

function makeInMemoryRedis(): Redis {
  const store = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const sortedSets = new Map<string, Array<{ score: number; member: string }>>();

  const client = {
    pipeline: () => {
      const ops: Array<() => Promise<any>> = [];
      const pipe: any = {
        hset: (key: string, obj: Record<string, string>) => {
          ops.push(async () => {
            const existing = JSON.parse(store.get(key) ?? "{}");
            store.set(key, JSON.stringify({ ...existing, ...obj }));
          });
          return pipe;
        },
        lpush: (key: string, val: string) => {
          ops.push(async () => {
            const list = lists.get(key) ?? [];
            list.unshift(val);
            lists.set(key, list);
          });
          return pipe;
        },
        lrem: (key: string, _count: number, val: string) => {
          ops.push(async () => {
            lists.set(key, (lists.get(key) ?? []).filter((v) => v !== val));
          });
          return pipe;
        },
        del: (key: string) => {
          ops.push(async () => {
            store.delete(key);
            lists.delete(key);
            sortedSets.delete(key);
          });
          return pipe;
        },
        hgetall: (key: string) => {
          ops.push(async () => {
            const val = store.get(key);
            return val ? JSON.parse(val) : {};
          });
          return pipe;
        },
        set: (key: string, val: string, ..._args: any[]) => {
          ops.push(async () => store.set(key, val));
          return pipe;
        },
        zadd: (key: string, score: number, member: string) => {
          ops.push(async () => {
            const set = sortedSets.get(key) ?? [];
            const idx = set.findIndex((e) => e.member === member);
            if (idx >= 0) set[idx].score = score;
            else set.push({ score, member });
            set.sort((a, b) => a.score - b.score);
            sortedSets.set(key, set);
          });
          return pipe;
        },
        zrem: (key: string, member: string) => {
          ops.push(async () => {
            sortedSets.set(key, (sortedSets.get(key) ?? []).filter((e) => e.member !== member));
          });
          return pipe;
        },
        exec: async () => {
          const results: Array<[null, any]> = [];
          for (const op of ops) results.push([null, await op()]);
          return results;
        },
      };
      return pipe;
    },
    hset: async (key: string, obj: Record<string, string>) => {
      const existing = JSON.parse(store.get(key) ?? "{}");
      store.set(key, JSON.stringify({ ...existing, ...obj }));
    },
    hgetall: async (key: string) => {
      const val = store.get(key);
      return val ? JSON.parse(val) : {};
    },
    lpush: async (key: string, val: string) => {
      const list = lists.get(key) ?? [];
      list.unshift(val);
      lists.set(key, list);
    },
    rpoplpush: async (src: string, dst: string) => {
      const srcList = lists.get(src) ?? [];
      if (srcList.length === 0) return null;
      const val = srcList.pop()!;
      lists.set(src, srcList);
      const dstList = lists.get(dst) ?? [];
      dstList.unshift(val);
      lists.set(dst, dstList);
      return val;
    },
    lrange: async (key: string, _start: number, _end: number) => lists.get(key) ?? [],
    lrem: async (key: string, _count: number, val: string) => {
      lists.set(key, (lists.get(key) ?? []).filter((v) => v !== val));
    },
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, val: string, ..._args: any[]) => { store.set(key, val); },
    del: async (key: string) => {
      store.delete(key);
      lists.delete(key);
      sortedSets.delete(key);
    },
    exists: async (key: string) => (store.has(key) ? 1 : 0),
    scan: async (_cursor: string, _matchKw: string, pattern: string, _countKw: string, _num: number) => {
      const regex = new RegExp(
        "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
      );
      return ["0", Array.from(store.keys()).filter((k) => regex.test(k))];
    },
    zadd: async (key: string, score: number, member: string) => {
      const set = sortedSets.get(key) ?? [];
      const idx = set.findIndex((e) => e.member === member);
      if (idx >= 0) set[idx].score = score;
      else set.push({ score, member });
      set.sort((a, b) => a.score - b.score);
      sortedSets.set(key, set);
    },
    zrangebyscore: async (key: string, min: number | string, max: number | string) => {
      const set = sortedSets.get(key) ?? [];
      const minN = min === "-inf" ? -Infinity : Number(min);
      const maxN = max === "+inf" ? Infinity : Number(max);
      return set.filter((e) => e.score >= minN && e.score <= maxN).map((e) => e.member);
    },
    zrevrangebyscore: async (key: string, max: number | string, min: number | string) => {
      const set = sortedSets.get(key) ?? [];
      const minN = min === "-inf" ? -Infinity : Number(min);
      const maxN = max === "+inf" ? Infinity : Number(max);
      return set
        .filter((e) => e.score >= minN && e.score <= maxN)
        .sort((a, b) => b.score - a.score)
        .map((e) => e.member);
    },
    zrem: async (key: string, member: string) => {
      sortedSets.set(key, (sortedSets.get(key) ?? []).filter((e) => e.member !== member));
    },
    on: (_event: string, _handler: (...args: any[]) => void) => {},
    disconnect: () => {},
  };

  return client as unknown as Redis;
}

// ─── Redis client initialisation ─────────────────────────────────────────────

let redis: Redis;

if (rawUrl && /^rediss?(\+tls)?:\/\//i.test(rawUrl)) {
  console.log(`[Redis] Connecting to ${rawUrl.replace(/:\/\/[^@]*@/, "://<credentials>@")}`);
  try {
    redis = new Redis(rawUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: true,
      tls: rawUrl.startsWith("rediss://") ? {} : undefined,
    });
    redis.on("connect", () => console.log("[Redis] Connected"));
    redis.on("ready",   () => console.log("[Redis] Ready"));
    redis.on("error",   (err) => console.error("[Redis] Error:", err.message));
    redis.on("close",   () => console.warn("[Redis] Connection closed"));
  } catch (err) {
    console.error("[Redis] Client init failed — falling back to in-memory store:", err);
    redis = makeInMemoryRedis();
  }
} else {
  if (rawUrl) {
    console.warn(`[Redis] REDIS_URL format invalid — falling back to in-memory store`);
  } else {
    console.log("[Redis] No REDIS_URL set — using in-memory store");
  }
  redis = makeInMemoryRedis();
}

export { redis };

export const KEYS = {
  job: (id: string) => `job:${id}`,
  // Priority queues — worker always processes high → normal → low
  queueHigh: "queue:high",
  queueNormal: "queue:normal",
  queueLow: "queue:low",
  // Delayed jobs sorted set (score = runAt timestamp ms)
  queueDelayed: "queue:delayed",
  // Processing queue (jobs handed off to a worker)
  queueProcessing: "queue:processing",
  // Legacy alias kept for the watchdog
  queuePending: "queue:normal",
  jobTimestamp: (id: string) => `job:${id}:started_at`,
  // Per-user job index: sorted set scored by creation timestamp
  userJobs: (userId: number) => `user:${userId}:jobs`,
} as const;

export function priorityQueue(priority: "high" | "normal" | "low"): string {
  if (priority === "high") return KEYS.queueHigh;
  if (priority === "low") return KEYS.queueLow;
  return KEYS.queueNormal;
}
