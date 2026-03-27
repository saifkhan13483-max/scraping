import { type Job, type InsertJob } from "@shared/schema";
import { randomUUID } from "crypto";
import { redis, KEYS } from "./redis";

// How long (ms) a job can stay "processing" before being considered stuck
const JOB_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

export interface IStorage {
  createJob(job: InsertJob): Promise<Job>;
  getNextPendingJob(): Promise<Job | undefined>;
  getJobById(id: string): Promise<Job | undefined>;
  getAllJobs(): Promise<Job[]>;
  completeJob(id: string, data: any): Promise<Job | undefined>;
  failJob(id: string, error: string): Promise<Job | undefined>;
  retryJob(id: string): Promise<Job | undefined>;
  deleteJob(id: string): Promise<boolean>;
}

// ─────────────────────────────────────────────
// Helper: serialize/deserialize Job ↔ Redis hash
// ─────────────────────────────────────────────

function serializeJob(job: Job): Record<string, string> {
  return {
    id: job.id,
    url: job.url,
    status: job.status,
    result: job.result !== null ? JSON.stringify(job.result) : "",
    error: job.error ?? "",
    retryCount: String(job.retryCount),
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

function deserializeJob(hash: Record<string, string>): Job {
  return {
    id: hash.id,
    url: hash.url,
    status: hash.status as Job["status"],
    result: hash.result ? JSON.parse(hash.result) : null,
    error: hash.error || null,
    retryCount: parseInt(hash.retryCount ?? "0", 10) as unknown as string,
    createdAt: new Date(hash.createdAt),
    updatedAt: new Date(hash.updatedAt),
  };
}

// ─────────────────────────────────────────────
// Redis Storage Implementation
// ─────────────────────────────────────────────

export class RedisStorage implements IStorage {

  async createJob(insert: InsertJob): Promise<Job> {
    const id = randomUUID();
    const now = new Date();
    const job: Job = {
      id,
      url: insert.url,
      status: "pending",
      result: null,
      error: null,
      retryCount: "0",
      createdAt: now,
      updatedAt: now,
    };

    const pipeline = redis.pipeline();
    pipeline.hset(KEYS.job(id), serializeJob(job));
    pipeline.lpush(KEYS.queuePending, id);
    await pipeline.exec();

    console.log(`[JOB CREATED] id=${id} url=${insert.url}`);
    return job;
  }

  async getNextPendingJob(): Promise<Job | undefined> {
    // RPOPLPUSH atomically moves one ID: pending → processing.
    // This guarantees that even with multiple workers polling at the same
    // time, only one worker receives each job — no duplicates.
    const id = await redis.rpoplpush(KEYS.queuePending, KEYS.queueProcessing);
    if (!id) return undefined;

    const now = new Date();
    const hash = await redis.hgetall(KEYS.job(id));
    if (!hash || !hash.id) {
      // Job data missing — clean up the stray ID from the processing queue
      await redis.lrem(KEYS.queueProcessing, 1, id);
      return undefined;
    }

    const updated: Job = {
      ...deserializeJob(hash as Record<string, string>),
      status: "processing",
      updatedAt: now,
    };

    const pipeline = redis.pipeline();
    pipeline.hset(KEYS.job(id), serializeJob(updated));
    // Record when processing started (used for timeout/recovery)
    pipeline.set(KEYS.jobTimestamp(id), now.toISOString(), "EX", 600); // expires in 10 min
    await pipeline.exec();

    console.log(`[JOB PROCESSING] id=${id} url=${updated.url}`);
    return updated;
  }

  async getJobById(id: string): Promise<Job | undefined> {
    const hash = await redis.hgetall(KEYS.job(id));
    if (!hash || !hash.id) return undefined;
    return deserializeJob(hash as Record<string, string>);
  }

  async getAllJobs(): Promise<Job[]> {
    // Scan for all job:* keys
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [next, found] = await redis.scan(cursor, "MATCH", "job:*", "COUNT", 100);
      cursor = next;
      // Filter out timestamp keys like job:xxx:started_at
      keys.push(...found.filter((k) => !k.includes(":started_at")));
    } while (cursor !== "0");

    if (keys.length === 0) return [];

    const pipeline = redis.pipeline();
    for (const key of keys) {
      pipeline.hgetall(key);
    }
    const results = await pipeline.exec();

    const jobs: Job[] = [];
    for (const result of results ?? []) {
      const [err, hash] = result as [Error | null, Record<string, string>];
      if (!err && hash && hash.id) {
        jobs.push(deserializeJob(hash));
      }
    }

    // Sort newest first
    return jobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async completeJob(id: string, data: any): Promise<Job | undefined> {
    const hash = await redis.hgetall(KEYS.job(id));
    if (!hash || !hash.id) return undefined;

    const updated: Job = {
      ...deserializeJob(hash as Record<string, string>),
      status: "completed",
      result: data,
      updatedAt: new Date(),
    };

    const pipeline = redis.pipeline();
    pipeline.hset(KEYS.job(id), serializeJob(updated));
    pipeline.lrem(KEYS.queueProcessing, 1, id);
    pipeline.del(KEYS.jobTimestamp(id));
    await pipeline.exec();

    console.log(`[JOB COMPLETED] id=${id}`);
    return updated;
  }

  async failJob(id: string, error: string): Promise<Job | undefined> {
    const hash = await redis.hgetall(KEYS.job(id));
    if (!hash || !hash.id) return undefined;

    const updated: Job = {
      ...deserializeJob(hash as Record<string, string>),
      status: "failed",
      error,
      updatedAt: new Date(),
    };

    const pipeline = redis.pipeline();
    pipeline.hset(KEYS.job(id), serializeJob(updated));
    pipeline.lrem(KEYS.queueProcessing, 1, id);
    pipeline.del(KEYS.jobTimestamp(id));
    await pipeline.exec();

    console.log(`[JOB FAILED] id=${id} error=${error}`);
    return updated;
  }

  async retryJob(id: string): Promise<Job | undefined> {
    const hash = await redis.hgetall(KEYS.job(id));
    if (!hash || !hash.id) return undefined;
    if (hash.status !== "failed") return undefined;

    const retryCount = parseInt(hash.retryCount ?? "0", 10) + 1;
    const updated: Job = {
      ...deserializeJob(hash as Record<string, string>),
      status: "pending",
      error: null,
      retryCount: String(retryCount),
      updatedAt: new Date(),
    };

    const pipeline = redis.pipeline();
    pipeline.hset(KEYS.job(id), serializeJob(updated));
    pipeline.lpush(KEYS.queuePending, id);
    await pipeline.exec();

    console.log(`[JOB RETRY] id=${id} attempt=${retryCount}`);
    return updated;
  }

  async deleteJob(id: string): Promise<boolean> {
    const exists = await redis.exists(KEYS.job(id));
    if (!exists) return false;

    const pipeline = redis.pipeline();
    pipeline.del(KEYS.job(id));
    pipeline.del(KEYS.jobTimestamp(id));
    pipeline.lrem(KEYS.queuePending, 1, id);
    pipeline.lrem(KEYS.queueProcessing, 1, id);
    await pipeline.exec();

    console.log(`[JOB DELETED] id=${id}`);
    return true;
  }
}

// ─────────────────────────────────────────────
// Job Recovery Watchdog
//
// Runs every 30 seconds. Any job that has been
// "processing" for longer than JOB_TIMEOUT_MS
// (2 minutes) is assumed to belong to a crashed
// worker and is moved back to "pending".
// ─────────────────────────────────────────────

export async function startRecoveryWatchdog() {
  const run = async () => {
    try {
      const processingIds = await redis.lrange(KEYS.queueProcessing, 0, -1);
      if (processingIds.length === 0) return;

      const now = Date.now();
      for (const id of processingIds) {
        const startedAt = await redis.get(KEYS.jobTimestamp(id));

        // No timestamp means very old stuck job — recover it
        const isStuck =
          !startedAt || now - new Date(startedAt).getTime() > JOB_TIMEOUT_MS;

        if (isStuck) {
          const hash = await redis.hgetall(KEYS.job(id));
          if (!hash || !hash.id) {
            // Orphaned ID, just remove it
            await redis.lrem(KEYS.queueProcessing, 1, id);
            continue;
          }

          const recovered: Job = {
            ...deserializeJob(hash as Record<string, string>),
            status: "pending",
            updatedAt: new Date(),
          };

          const pipeline = redis.pipeline();
          pipeline.hset(KEYS.job(id), serializeJob(recovered));
          pipeline.lrem(KEYS.queueProcessing, 1, id);
          pipeline.lpush(KEYS.queuePending, id);
          pipeline.del(KEYS.jobTimestamp(id));
          await pipeline.exec();

          console.log(`[JOB RECOVERED] id=${id} — moved back to pending after timeout`);
        }
      }
    } catch (err) {
      console.error("[WATCHDOG] Error during recovery scan:", err);
    }
  };

  // Run immediately on startup, then every 30 seconds
  await run();
  setInterval(run, 30_000);
  console.log("[WATCHDOG] Job recovery watchdog started (checks every 30s, timeout=2min)");
}

export const storage = new RedisStorage();
