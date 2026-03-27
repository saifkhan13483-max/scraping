import { type Job, type InsertJob, type User, type InsertUser, type Subscription, type ApiKey, type PlanType, PLAN_CONFIG, users, subscriptions, apiKeys } from "@shared/schema";
import { randomUUID, randomBytes } from "crypto";
import { redis, KEYS } from "./redis";
import { db } from "./db";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";

// How long (ms) a job can stay "processing" before being considered stuck
const JOB_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

export interface IStorage {
  // Job operations (Redis)
  createJob(job: InsertJob, userId?: number): Promise<Job>;
  getNextPendingJob(): Promise<Job | undefined>;
  getJobById(id: string): Promise<Job | undefined>;
  getAllJobs(userId?: number): Promise<Job[]>;
  completeJob(id: string, data: any): Promise<Job | undefined>;
  failJob(id: string, error: string): Promise<Job | undefined>;
  retryJob(id: string): Promise<Job | undefined>;
  deleteJob(id: string): Promise<boolean>;

  // User operations (PostgreSQL)
  createUser(data: InsertUser): Promise<User>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserById(id: number): Promise<User | undefined>;
  validatePassword(user: User, password: string): Promise<boolean>;

  // Subscription operations (PostgreSQL)
  getSubscription(userId: number): Promise<Subscription | undefined>;
  incrementJobUsage(userId: number): Promise<Subscription | undefined>;
  updatePlan(userId: number, plan: PlanType): Promise<Subscription | undefined>;
  checkQuota(userId: number): Promise<{ allowed: boolean; used: number; limit: number; plan: PlanType }>;

  // API Key operations (PostgreSQL)
  getApiKeys(userId: number): Promise<ApiKey[]>;
  createApiKey(userId: number, name: string): Promise<ApiKey>;
  deleteApiKey(userId: number, id: number): Promise<boolean>;
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
    userId: job.userId !== null && job.userId !== undefined ? String(job.userId) : "",
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
    userId: hash.userId ? parseInt(hash.userId, 10) : null,
    createdAt: new Date(hash.createdAt),
    updatedAt: new Date(hash.updatedAt),
  };
}

// ─────────────────────────────────────────────
// Storage Implementation
// ─────────────────────────────────────────────

export class AppStorage implements IStorage {

  // ── Job Operations (Redis) ──────────────────

  async createJob(insert: InsertJob, userId?: number): Promise<Job> {
    const id = randomUUID();
    const now = new Date();
    const job: Job = {
      id,
      url: insert.url,
      status: "pending",
      result: null,
      error: null,
      retryCount: "0",
      userId: userId ?? null,
      createdAt: now,
      updatedAt: now,
    };

    const pipeline = redis.pipeline();
    pipeline.hset(KEYS.job(id), serializeJob(job));
    pipeline.lpush(KEYS.queuePending, id);
    await pipeline.exec();

    console.log(`[JOB CREATED] id=${id} url=${insert.url} userId=${userId}`);
    return job;
  }

  async getNextPendingJob(): Promise<Job | undefined> {
    const id = await redis.rpoplpush(KEYS.queuePending, KEYS.queueProcessing);
    if (!id) return undefined;

    const now = new Date();
    const hash = await redis.hgetall(KEYS.job(id));
    if (!hash || !hash.id) {
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
    pipeline.set(KEYS.jobTimestamp(id), now.toISOString(), "EX", 600);
    await pipeline.exec();

    console.log(`[JOB PROCESSING] id=${id} url=${updated.url}`);
    return updated;
  }

  async getJobById(id: string): Promise<Job | undefined> {
    const hash = await redis.hgetall(KEYS.job(id));
    if (!hash || !hash.id) return undefined;
    return deserializeJob(hash as Record<string, string>);
  }

  async getAllJobs(userId?: number): Promise<Job[]> {
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [next, found] = await redis.scan(cursor, "MATCH", "job:*", "COUNT", 100);
      cursor = next;
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
        const job = deserializeJob(hash);
        if (userId !== undefined) {
          if (job.userId === userId) jobs.push(job);
        } else {
          jobs.push(job);
        }
      }
    }

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

  // ── User Operations (PostgreSQL) ─────────────

  async createUser(data: InsertUser): Promise<User> {
    const passwordHash = await bcrypt.hash(data.password, 12);
    const [user] = await db.insert(users).values({
      email: data.email,
      name: data.name,
      passwordHash,
    }).returning();

    // Create default free subscription
    const resetAt = new Date();
    resetAt.setMonth(resetAt.getMonth() + 1);
    await db.insert(subscriptions).values({
      userId: user.id,
      plan: "free",
      jobsUsedThisMonth: 0,
      resetAt,
    });

    console.log(`[USER CREATED] id=${user.id} email=${user.email}`);
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
    return user;
  }

  async getUserById(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async validatePassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.passwordHash);
  }

  // ── Subscription Operations (PostgreSQL) ─────

  async getSubscription(userId: number): Promise<Subscription | undefined> {
    let [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
    if (!sub) {
      // Auto-create free subscription if missing
      const resetAt = new Date();
      resetAt.setMonth(resetAt.getMonth() + 1);
      [sub] = await db.insert(subscriptions).values({ userId, plan: "free", jobsUsedThisMonth: 0, resetAt }).returning();
    }
    // Check if monthly reset is due
    if (new Date() > new Date(sub.resetAt)) {
      const newResetAt = new Date();
      newResetAt.setMonth(newResetAt.getMonth() + 1);
      [sub] = await db.update(subscriptions)
        .set({ jobsUsedThisMonth: 0, resetAt: newResetAt })
        .where(eq(subscriptions.userId, userId))
        .returning();
    }
    return sub;
  }

  async incrementJobUsage(userId: number): Promise<Subscription | undefined> {
    const sub = await this.getSubscription(userId);
    if (!sub) return undefined;
    const [updated] = await db.update(subscriptions)
      .set({ jobsUsedThisMonth: sub.jobsUsedThisMonth + 1 })
      .where(eq(subscriptions.userId, userId))
      .returning();
    return updated;
  }

  async updatePlan(userId: number, plan: PlanType): Promise<Subscription | undefined> {
    const [updated] = await db.update(subscriptions)
      .set({ plan })
      .where(eq(subscriptions.userId, userId))
      .returning();
    return updated;
  }

  async checkQuota(userId: number): Promise<{ allowed: boolean; used: number; limit: number; plan: PlanType }> {
    const sub = await this.getSubscription(userId);
    if (!sub) return { allowed: false, used: 0, limit: 0, plan: "free" };
    const plan = sub.plan as PlanType;
    const limit = PLAN_CONFIG[plan].jobLimit;
    const used = sub.jobsUsedThisMonth;
    return { allowed: used < limit, used, limit, plan };
  }

  // ── API Key Operations (PostgreSQL) ──────────

  async getApiKeys(userId: number): Promise<ApiKey[]> {
    return db.select().from(apiKeys).where(eq(apiKeys.userId, userId));
  }

  async createApiKey(userId: number, name: string): Promise<ApiKey> {
    const key = "sk_" + randomBytes(24).toString("hex");
    const [apiKey] = await db.insert(apiKeys).values({ userId, key, name }).returning();
    return apiKey;
  }

  async deleteApiKey(userId: number, id: number): Promise<boolean> {
    const result = await db.delete(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId))).returning();
    return result.length > 0;
  }
}

// ─────────────────────────────────────────────
// Job Recovery Watchdog
// ─────────────────────────────────────────────

export async function startRecoveryWatchdog() {
  const run = async () => {
    try {
      const processingIds = await redis.lrange(KEYS.queueProcessing, 0, -1);
      if (processingIds.length === 0) return;

      const now = Date.now();
      for (const id of processingIds) {
        const startedAt = await redis.get(KEYS.jobTimestamp(id));
        const isStuck = !startedAt || now - new Date(startedAt).getTime() > JOB_TIMEOUT_MS;

        if (isStuck) {
          const hash = await redis.hgetall(KEYS.job(id));
          if (!hash || !hash.id) {
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

  await run();
  setInterval(run, 30_000);
  console.log("[WATCHDOG] Job recovery watchdog started (checks every 30s, timeout=2min)");
}

export const storage = new AppStorage();
