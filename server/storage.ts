import { type Job, type InsertJob, type User, type InsertUser, type Subscription, type ApiKey, type PlanType, PLAN_CONFIG, users, subscriptions, apiKeys } from "@shared/schema";
import { randomUUID, randomBytes } from "crypto";
import { redis, KEYS, priorityQueue } from "./redis";
import { db } from "./db";
import { eq, and, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";

// How long (ms) a job can stay "processing" before being considered stuck
const JOB_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

export interface IStorage {
  // Job operations (Redis)
  createJob(job: InsertJob, userId?: number): Promise<Job>;
  getNextPendingJob(): Promise<Job | undefined>;
  getJobById(id: string): Promise<Job | undefined>;
  getAllJobs(userId?: number): Promise<Job[]>;
  completeJob(id: string, data: any, workerId?: string): Promise<Job | undefined>;
  failJob(id: string, error: string, workerId?: string): Promise<Job | undefined>;
  retryJob(id: string): Promise<Job | undefined>;
  deleteJob(id: string): Promise<boolean>;
  promoteDelayedJobs(): Promise<void>;

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

  // Admin operations
  getAllUsers(): Promise<(User & { subscription?: Subscription })[]>;
  deleteUser(userId: number): Promise<boolean>;
  setUserAdmin(userId: number, isAdmin: boolean): Promise<User | undefined>;
  getAdminStats(): Promise<{
    totalUsers: number;
    planCounts: Record<string, number>;
    totalJobs: number;
    jobStatusCounts: Record<string, number>;
  }>;
}

// ─────────────────────────────────────────────
// Helper: serialize/deserialize Job ↔ Redis hash
// ─────────────────────────────────────────────

function serializeJob(job: Job): Record<string, string> {
  return {
    id: job.id,
    url: job.url,
    status: job.status,
    priority: job.priority ?? "normal",
    result: job.result !== null ? JSON.stringify(job.result) : "",
    error: job.error ?? "",
    retryCount: String(job.retryCount),
    workerId: job.workerId ?? "",
    runAt: job.runAt ? job.runAt.toISOString() : "",
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
    priority: (hash.priority as Job["priority"]) ?? "normal",
    result: hash.result ? JSON.parse(hash.result) : null,
    error: hash.error || null,
    retryCount: String(parseInt(hash.retryCount ?? "0", 10)),
    workerId: hash.workerId || null,
    runAt: hash.runAt ? new Date(hash.runAt) : null,
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
    const priority = (insert.priority ?? "normal") as Job["priority"];
    const delay = (insert as any).delay as number | undefined;
    const runAt = delay ? new Date(now.getTime() + delay) : null;

    const job: Job = {
      id,
      url: insert.url,
      status: "pending",
      priority,
      result: null,
      error: null,
      retryCount: "0",
      workerId: null,
      runAt,
      userId: userId ?? null,
      createdAt: now,
      updatedAt: now,
    };

    const pipeline = redis.pipeline();
    pipeline.hset(KEYS.job(id), serializeJob(job));

    if (runAt && runAt.getTime() > now.getTime()) {
      // Delayed: add to sorted set — score = run timestamp
      (pipeline as any).zadd(KEYS.queueDelayed, runAt.getTime(), id);
      console.log(`[JOB CREATED] id=${id} url=${insert.url} priority=${priority} delay=${delay}ms`);
    } else {
      // Immediate: push to priority queue
      pipeline.lpush(priorityQueue(priority), id);
      console.log(`[JOB CREATED] id=${id} url=${insert.url} priority=${priority}`);
    }

    await pipeline.exec();
    return job;
  }

  async getNextPendingJob(): Promise<Job | undefined> {
    // Promote any delayed jobs that are due
    await this.promoteDelayedJobs();

    // Try queues in priority order: high → normal → low
    let id: string | null = null;
    for (const queue of [KEYS.queueHigh, KEYS.queueNormal, KEYS.queueLow]) {
      id = await redis.rpoplpush(queue, KEYS.queueProcessing);
      if (id) break;
    }
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

    console.log(`[JOB PROCESSING] id=${id} url=${updated.url} priority=${updated.priority}`);
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

  async completeJob(id: string, data: any, workerId?: string): Promise<Job | undefined> {
    const hash = await redis.hgetall(KEYS.job(id));
    if (!hash || !hash.id) return undefined;

    const updated: Job = {
      ...deserializeJob(hash as Record<string, string>),
      status: "completed",
      result: data,
      workerId: workerId ?? hash.workerId ?? null,
      updatedAt: new Date(),
    };

    const pipeline = redis.pipeline();
    pipeline.hset(KEYS.job(id), serializeJob(updated));
    pipeline.lrem(KEYS.queueProcessing, 1, id);
    pipeline.del(KEYS.jobTimestamp(id));
    await pipeline.exec();

    console.log(`[JOB COMPLETED] id=${id}${workerId ? ` worker=${workerId}` : ""}`);
    return updated;
  }

  async failJob(id: string, error: string, workerId?: string): Promise<Job | undefined> {
    const hash = await redis.hgetall(KEYS.job(id));
    if (!hash || !hash.id) return undefined;

    const updated: Job = {
      ...deserializeJob(hash as Record<string, string>),
      status: "failed",
      error,
      workerId: workerId ?? hash.workerId ?? null,
      updatedAt: new Date(),
    };

    const pipeline = redis.pipeline();
    pipeline.hset(KEYS.job(id), serializeJob(updated));
    pipeline.lrem(KEYS.queueProcessing, 1, id);
    pipeline.del(KEYS.jobTimestamp(id));
    await pipeline.exec();

    console.log(`[JOB FAILED] id=${id} error=${error}${workerId ? ` worker=${workerId}` : ""}`);
    return updated;
  }

  async retryJob(id: string): Promise<Job | undefined> {
    const hash = await redis.hgetall(KEYS.job(id));
    if (!hash || !hash.id) return undefined;
    if (hash.status !== "failed") return undefined;

    const retryCount = parseInt(hash.retryCount ?? "0", 10) + 1;
    const priority = (hash.priority ?? "normal") as Job["priority"];
    const updated: Job = {
      ...deserializeJob(hash as Record<string, string>),
      status: "pending",
      error: null,
      retryCount: String(retryCount),
      updatedAt: new Date(),
    };

    const pipeline = redis.pipeline();
    pipeline.hset(KEYS.job(id), serializeJob(updated));
    pipeline.lpush(priorityQueue(priority), id);
    await pipeline.exec();

    console.log(`[JOB RETRY] id=${id} attempt=${retryCount} priority=${priority}`);
    return updated;
  }

  async deleteJob(id: string): Promise<boolean> {
    const exists = await redis.exists(KEYS.job(id));
    if (!exists) return false;

    const pipeline = redis.pipeline();
    pipeline.del(KEYS.job(id));
    pipeline.del(KEYS.jobTimestamp(id));
    pipeline.lrem(KEYS.queueHigh, 1, id);
    pipeline.lrem(KEYS.queueNormal, 1, id);
    pipeline.lrem(KEYS.queueLow, 1, id);
    pipeline.lrem(KEYS.queueProcessing, 1, id);
    (pipeline as any).zrem(KEYS.queueDelayed, id);
    await pipeline.exec();

    console.log(`[JOB DELETED] id=${id}`);
    return true;
  }

  async promoteDelayedJobs(): Promise<void> {
    try {
      const now = Date.now();
      const dueIds = await (redis as any).zrangebyscore(KEYS.queueDelayed, 0, now);
      if (!dueIds || dueIds.length === 0) return;

      for (const id of dueIds) {
        const hash = await redis.hgetall(KEYS.job(id));
        if (!hash || !hash.id) {
          await (redis as any).zrem(KEYS.queueDelayed, id);
          continue;
        }
        const priority = (hash.priority ?? "normal") as "high" | "normal" | "low";
        const pipeline = redis.pipeline();
        pipeline.lpush(priorityQueue(priority), id);
        (pipeline as any).zrem(KEYS.queueDelayed, id);
        await pipeline.exec();
        console.log(`[JOB PROMOTED] id=${id} priority=${priority} (was delayed)`);
      }
    } catch (err) {
      console.warn("[DELAYED] Failed to promote delayed jobs:", (err as Error).message);
    }
  }

  // ── User Operations (PostgreSQL) ─────────────

  async createUser(data: InsertUser): Promise<User> {
    const passwordHash = await bcrypt.hash(data.password, 12);
    const resetAt = new Date();
    resetAt.setMonth(resetAt.getMonth() + 1);

    const ownerEmail = (process.env.OWNER_EMAIL ?? "saifkhan16382@gmail.com").toLowerCase().trim();
    const grantAdmin = data.email.toLowerCase().trim() === ownerEmail;

    const user = await db.transaction(async (tx) => {
      const [newUser] = await tx.insert(users).values({
        email: data.email.toLowerCase().trim(),
        name: data.name.trim(),
        passwordHash,
      }).returning();

      await tx.insert(subscriptions).values({
        userId: newUser.id,
        plan: "free",
        jobsUsedThisMonth: 0,
        resetAt,
      });

      return newUser;
    });

    // Grant admin via raw SQL to avoid any ORM schema caching issues
    if (grantAdmin) {
      await db.execute(sql`UPDATE users SET is_admin = true WHERE id = ${user.id}`);
      console.log(`[ADMIN GRANTED] id=${user.id} email=${user.email} is now admin`);
      return { ...user, isAdmin: true };
    }

    console.log(`[USER CREATED] id=${user.id} email=${user.email}`);
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim()));
    return user;
  }

  async getUserById(id: number): Promise<User | undefined> {
    const result = await db.execute(sql`SELECT id, email, password_hash as "passwordHash", name, is_admin as "isAdmin", created_at as "createdAt" FROM users WHERE id = ${id}`);
    const rows = result.rows as any[];
    if (!rows.length) return undefined;
    return rows[0] as User;
  }

  async validatePassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.passwordHash);
  }

  // ── Subscription Operations (PostgreSQL) ─────

  async getSubscription(userId: number): Promise<Subscription | undefined> {
    let [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
    if (!sub) {
      const resetAt = new Date();
      resetAt.setMonth(resetAt.getMonth() + 1);
      [sub] = await db.insert(subscriptions).values({ userId, plan: "free", jobsUsedThisMonth: 0, resetAt }).returning();
    }
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
    const [updated] = await db.update(subscriptions)
      .set({ jobsUsedThisMonth: sql`${subscriptions.jobsUsedThisMonth} + 1` })
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

  // ── Admin Operations ──────────────────────────

  async getAllUsers(): Promise<(User & { subscription?: Subscription })[]> {
    const result = await db.execute(sql`SELECT id, email, password_hash as "passwordHash", name, is_admin as "isAdmin", created_at as "createdAt" FROM users ORDER BY created_at`);
    const allUsers = result.rows as any[];
    const allSubs = await db.select().from(subscriptions);
    const subMap = new Map(allSubs.map((s) => [s.userId, s]));
    return allUsers.map((u) => ({ ...u, subscription: subMap.get(u.id) }));
  }

  async deleteUser(userId: number): Promise<boolean> {
    await db.delete(apiKeys).where(eq(apiKeys.userId, userId));
    await db.delete(subscriptions).where(eq(subscriptions.userId, userId));
    const result = await db.delete(users).where(eq(users.id, userId)).returning();
    return result.length > 0;
  }

  async setUserAdmin(userId: number, isAdmin: boolean): Promise<User | undefined> {
    await db.execute(sql`UPDATE users SET is_admin = ${isAdmin} WHERE id = ${userId}`);
    return this.getUserById(userId);
  }

  async getAdminStats(): Promise<{
    totalUsers: number;
    planCounts: Record<string, number>;
    totalJobs: number;
    jobStatusCounts: Record<string, number>;
  }> {
    const allUsers = await db.select().from(users);
    const allSubs = await db.select().from(subscriptions);
    const planCounts: Record<string, number> = { free: 0, pro: 0, business: 0 };
    for (const sub of allSubs) {
      planCounts[sub.plan] = (planCounts[sub.plan] ?? 0) + 1;
    }
    const allJobs = await this.getAllJobs();
    const jobStatusCounts: Record<string, number> = { pending: 0, processing: 0, completed: 0, failed: 0 };
    for (const job of allJobs) {
      jobStatusCounts[job.status] = (jobStatusCounts[job.status] ?? 0) + 1;
    }
    return {
      totalUsers: allUsers.length,
      planCounts,
      totalJobs: allJobs.length,
      jobStatusCounts,
    };
  }
}

// ─────────────────────────────────────────────
// Job Recovery Watchdog
// ─────────────────────────────────────────────

export async function startRecoveryWatchdog() {
  const appStorage = storage as AppStorage;

  const run = async () => {
    try {
      // Promote any delayed jobs that are now due
      await appStorage.promoteDelayedJobs();

      // Recover stuck processing jobs
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

          const priority = (hash.priority ?? "normal") as "high" | "normal" | "low";
          const recovered: Job = {
            ...deserializeJob(hash as Record<string, string>),
            status: "pending",
            updatedAt: new Date(),
          };

          const pipeline = redis.pipeline();
          pipeline.hset(KEYS.job(id), serializeJob(recovered));
          pipeline.lrem(KEYS.queueProcessing, 1, id);
          pipeline.lpush(priorityQueue(priority), id);
          pipeline.del(KEYS.jobTimestamp(id));
          await pipeline.exec();

          console.log(`[JOB RECOVERED] id=${id} priority=${priority} — moved back to pending after timeout`);
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
