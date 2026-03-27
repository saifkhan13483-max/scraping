import Redis from "ioredis";

const rawUrl = process.env.REDIS_URL?.trim();

let redis: Redis;

if (rawUrl) {
  if (!/^rediss?(\+tls)?:\/\//i.test(rawUrl)) {
    throw new Error(
      `REDIS_URL must start with redis:// or rediss:// — got: "${rawUrl.slice(0, 30)}"`
    );
  }

  console.log(
    `[Redis] Connecting to ${rawUrl.replace(/:\/\/[^@]*@/, "://<credentials>@")}`
  );

  redis = new Redis(rawUrl, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    tls: rawUrl.startsWith("rediss://") ? {} : undefined,
  });

  redis.on("connect", () => console.log("[Redis] Connected"));
  redis.on("ready", () => console.log("[Redis] Ready"));
  redis.on("error", (err) => console.error("[Redis] Error:", err.message));
  redis.on("close", () => console.warn("[Redis] Connection closed"));
} else {
  console.log("[Redis] No REDIS_URL set — using in-memory store");
  redis = new Redis({ lazyConnect: true, enableOfflineQueue: true });
  redis.disconnect();

  const store = new Map<string, string | string[]>();
  const lists = new Map<string, string[]>();

  const inMemoryClient = {
    pipeline: () => {
      const ops: Array<() => Promise<any>> = [];
      const pipe: any = {
        hset: (key: string, obj: Record<string, string>) => {
          ops.push(async () => {
            const existing = JSON.parse((store.get(key) as string) ?? "{}");
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
            const list = lists.get(key) ?? [];
            lists.set(key, list.filter((v) => v !== val));
          });
          return pipe;
        },
        del: (key: string) => {
          ops.push(async () => {
            store.delete(key);
            lists.delete(key);
          });
          return pipe;
        },
        hgetall: (key: string) => {
          ops.push(async () => {
            const val = store.get(key);
            return val ? JSON.parse(val as string) : {};
          });
          return pipe;
        },
        set: (key: string, val: string, _ex?: string, _ttl?: number) => {
          ops.push(async () => store.set(key, val));
          return pipe;
        },
        exec: async () => {
          const results: Array<[null, any]> = [];
          for (const op of ops) {
            results.push([null, await op()]);
          }
          return results;
        },
      };
      return pipe;
    },
    hset: async (key: string, obj: Record<string, string>) => {
      const existing = JSON.parse((store.get(key) as string) ?? "{}");
      store.set(key, JSON.stringify({ ...existing, ...obj }));
    },
    hgetall: async (key: string) => {
      const val = store.get(key);
      return val ? JSON.parse(val as string) : {};
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
    lrange: async (key: string, _start: number, _end: number) => {
      return lists.get(key) ?? [];
    },
    lrem: async (key: string, _count: number, val: string) => {
      const list = lists.get(key) ?? [];
      lists.set(key, list.filter((v) => v !== val));
    },
    get: async (key: string) => {
      return (store.get(key) as string) ?? null;
    },
    set: async (key: string, val: string, _ex?: string, _ttl?: number) => {
      store.set(key, val);
    },
    del: async (key: string) => {
      store.delete(key);
      lists.delete(key);
    },
    exists: async (key: string) => {
      return store.has(key) ? 1 : 0;
    },
    scan: async (_cursor: string, _matchKeyword: string, pattern: string, _countKeyword: string, _num: number) => {
      // Convert Redis glob pattern (e.g. "job:*") to a JS regex
      const regexStr = "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$";
      const regex = new RegExp(regexStr);
      const keys = Array.from(store.keys()).filter((k) => regex.test(k));
      return ["0", keys];
    },
    on: (_event: string, _handler: (...args: any[]) => void) => {},
    disconnect: () => {},
  };

  redis = inMemoryClient as unknown as Redis;
}

export { redis };

export const KEYS = {
  job: (id: string) => `job:${id}`,
  queuePending: "queue:pending",
  queueProcessing: "queue:processing",
  jobTimestamp: (id: string) => `job:${id}:started_at`,
} as const;
