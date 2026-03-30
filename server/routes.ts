import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { scrapeUrl } from "./scraper";
import { insertJobSchema, submitResultSchema, failJobSchema, retryJobSchema, insertUserSchema, createApiKeySchema, PLAN_CONFIG } from "@shared/schema";
import { ZodError, z } from "zod";
import { requireAuth, requireAdmin, requireScope, resolveUser } from "./auth";
import { sanitizeBody } from "./security";
import rateLimit from "express-rate-limit";
import { randomBytes } from "crypto";

// One-time secret generated at startup to protect the internal process endpoint.
const INTERNAL_PROCESS_SECRET = randomBytes(32).toString("hex");

// ─── Rate limiters ─────────────────────────────────────────────────────────────

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
  skip: (req) => req.path === "/api/health" || req.path === "/health",
});

// Stricter auth limits: 5 attempts per 15 minutes for login, 3/hour for register
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please wait before trying again." },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many registration attempts. Please try again later." },
});

/**
 * Dynamic job rate limiter based on the user's plan.
 * Free: 10/min, Pro: 60/min, Business: 200/min
 */
async function planBasedJobLimiter(req: Request, res: Response, next: NextFunction) {
  const userId = req.session?.userId ?? req.resolvedUserId;
  let max = PLAN_CONFIG.free.jobsPerMinute; // default to free tier

  if (userId) {
    try {
      const quota = await storage.checkQuota(userId);
      max = PLAN_CONFIG[quota.plan]?.jobsPerMinute ?? max;
    } catch {
      // fall through with free-tier limit
    }
  }

  rateLimit({
    windowMs: 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (r) => `job:${userId ?? r.ip}`,
    message: {
      error: `Rate limit exceeded. Your plan allows ${max} job submissions per minute.`,
    },
  })(req, res, next);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  app.use(globalLimiter);
  app.use(resolveUser);

  // ── Auth Routes ─────────────────────────────────────────────────────────────

  app.post("/api/auth/register", registerLimiter, sanitizeBody, async (req: Request, res: Response) => {
    try {
      const parsed = insertUserSchema.parse(req.body);
      const existing = await storage.getUserByEmail(parsed.email);
      if (existing) {
        return res.status(409).json({ error: "An account with this email already exists" });
      }
      const user = await storage.createUser(parsed);
      req.session!.userId = user.id;
      req.resolvedUserId = user.id;
      return res.status(201).json({ id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin ?? false });
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ error: err.errors[0].message });
      }
      throw err;
    }
  });

  app.post("/api/auth/login", loginLimiter, sanitizeBody, async (req: Request, res: Response) => {
    try {
      const { email, password } = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
      const user = await storage.getUserByEmail(email);
      if (!user) return res.status(401).json({ error: "Invalid email or password" });
      const valid = await storage.validatePassword(user, password);
      if (!valid) return res.status(401).json({ error: "Invalid email or password" });
      req.session!.userId = user.id;
      req.resolvedUserId = user.id;
      return res.json({ id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin ?? false });
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ error: err.errors[0].message });
      }
      throw err;
    }
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session!.destroy(() => res.json({ success: true }));
  });

  app.get("/api/auth/me", requireAuth, async (req: Request, res: Response) => {
    const userId = req.resolvedUserId!;
    const user = await storage.getUserById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    const sub = await storage.getSubscription(user.id);
    return res.json({ id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin, subscription: sub });
  });

  // ── Subscription Routes ─────────────────────────────────────────────────────

  app.get("/api/subscription", requireAuth, async (req: Request, res: Response) => {
    const sub = await storage.getSubscription(req.resolvedUserId!);
    return res.json(sub);
  });

  app.post("/api/subscription/upgrade", requireAuth, async (req: Request, res: Response) => {
    try {
      const { plan } = z.object({ plan: z.enum(["free", "pro", "business"]) }).parse(req.body);
      const sub = await storage.updatePlan(req.resolvedUserId!, plan);
      return res.json(sub);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ error: err.errors[0].message });
      }
      throw err;
    }
  });

  // ── API Key Routes ──────────────────────────────────────────────────────────

  app.get("/api/keys", requireAuth, async (req: Request, res: Response) => {
    const keys = await storage.getApiKeys(req.resolvedUserId!);
    return res.json(keys.map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      scope: k.scope,
      expiresAt: k.expiresAt,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
    })));
  });

  app.post("/api/keys", requireAuth, async (req: Request, res: Response) => {
    try {
      const { name, scope, expiresAt } = createApiKeySchema.parse(req.body);
      const sub = await storage.getSubscription(req.resolvedUserId!);
      if (!sub || sub.plan === "free") {
        return res.status(403).json({ error: "API key access requires a Pro or Business plan. Please upgrade to create API keys." });
      }
      const expiryDate = expiresAt ? new Date(expiresAt) : undefined;
      const key = await storage.createApiKey(req.resolvedUserId!, name, scope, expiryDate);
      // Return the full secret ONCE — it won't be retrievable again
      return res.status(201).json({
        id: key.id,
        name: key.name,
        secret: key.secret,
        keyPrefix: key.keyPrefix,
        scope: key.scope,
        expiresAt: key.expiresAt,
        createdAt: key.createdAt,
      });
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ error: err.errors[0].message });
      }
      throw err;
    }
  });

  app.delete("/api/keys/:id", requireAuth, async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    const deleted = await storage.deleteApiKey(req.resolvedUserId!, id);
    if (!deleted) return res.status(404).json({ error: "API key not found" });
    return res.json({ success: true });
  });

  // ── Job Routes ──────────────────────────────────────────────────────────────

  app.post("/api/job", requireAuth, requireScope("create_jobs"), planBasedJobLimiter, sanitizeBody, async (req: Request, res: Response) => {
    try {
      const parsed = insertJobSchema.parse(req.body);
      if (!isValidUrl(parsed.url)) {
        return res.status(400).json({ error: "Invalid URL format" });
      }
      const userId = req.resolvedUserId!;
      const quota = await storage.checkQuota(userId);
      if (!quota.allowed) {
        return res.status(429).json({
          error: `Job limit reached. You've used ${quota.used} of ${quota.limit} jobs this month on the ${quota.plan} plan. Please upgrade to continue.`,
          quota,
        });
      }
      const job = await storage.createJob(parsed, userId);
      await storage.incrementJobUsage(userId);

      const host = req.get("host") || "localhost:5000";
      const protocol = req.secure || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
      fetch(`${protocol}://${host}/api/jobs/process`, {
        method: "POST",
        headers: { "x-internal-secret": INTERNAL_PROCESS_SECRET },
      }).catch((e) =>
        console.warn("[AUTO-PROCESS] Could not trigger processing:", (e as Error).message)
      );

      return res.status(201).json(job);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ error: "Validation error", details: err.errors });
      }
      throw err;
    }
  });

  app.get("/api/job", requireAuth, requireScope("create_jobs"), async (_req: Request, res: Response) => {
    const job = await storage.getNextPendingJob();
    if (!job) return res.status(204).send();
    return res.json(job);
  });

  app.post("/api/jobs/process", async (req: Request, res: Response) => {
    const secret = req.headers["x-internal-secret"];
    if (secret !== INTERNAL_PROCESS_SECRET) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const job = await storage.getNextPendingJob();
    if (!job) return res.status(204).send();

    const workerId = `server-${process.pid}`;
    try {
      const result = await scrapeUrl(job.url);
      await storage.completeJob(job.id, result, workerId);
      console.log(`[PROCESS] Completed job ${job.id} — "${result.title}" [worker=${workerId}]`);
      return res.json({ success: true, jobId: job.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown scrape error";
      await storage.failJob(job.id, message, workerId);
      console.error(`[PROCESS] Failed job ${job.id}: ${message} [worker=${workerId}]`);
      return res.json({ success: false, jobId: job.id, error: message });
    }
  });

  app.get("/api/jobs", requireAuth, async (req: Request, res: Response) => {
    const jobs = await storage.getAllJobs(req.resolvedUserId!);
    return res.json(jobs);
  });

  app.get("/api/jobs/:id", requireAuth, async (req: Request, res: Response) => {
    const job = await storage.getJobById(req.params.id as string);
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (job.userId !== req.resolvedUserId) return res.status(403).json({ error: "Forbidden" });
    return res.json(job);
  });

  app.post("/api/result", requireAuth, async (req: Request, res: Response) => {
    try {
      const parsed = submitResultSchema.parse(req.body);
      const job = await storage.completeJob(parsed.id, parsed.data, parsed.workerId);
      if (!job) return res.status(404).json({ error: "Job not found" });
      if (job.userId !== null && job.userId !== req.resolvedUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      return res.json(job);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ error: "Validation error", details: err.errors });
      }
      throw err;
    }
  });

  app.post("/api/fail", requireAuth, async (req: Request, res: Response) => {
    try {
      const parsed = failJobSchema.parse(req.body);
      const job = await storage.failJob(parsed.id, parsed.error, parsed.workerId);
      if (!job) return res.status(404).json({ error: "Job not found" });
      if (job.userId !== null && job.userId !== req.resolvedUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      return res.json(job);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ error: "Validation error", details: err.errors });
      }
      throw err;
    }
  });

  app.post("/api/retry", requireAuth, async (req: Request, res: Response) => {
    try {
      const parsed = retryJobSchema.parse(req.body);
      const existing = await storage.getJobById(parsed.id);
      if (!existing) return res.status(404).json({ error: "Job not found" });
      if (existing.userId !== req.resolvedUserId) return res.status(403).json({ error: "Forbidden" });
      const job = await storage.retryJob(parsed.id);
      if (!job) return res.status(404).json({ error: "Job not found or not in failed state" });

      const host = req.get("host") || "localhost:5000";
      const protocol = req.secure || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
      fetch(`${protocol}://${host}/api/jobs/process`, {
        method: "POST",
        headers: { "x-internal-secret": INTERNAL_PROCESS_SECRET },
      }).catch((e) =>
        console.warn("[AUTO-PROCESS] Could not trigger retry processing:", (e as Error).message)
      );

      return res.json(job);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ error: "Validation error", details: err.errors });
      }
      throw err;
    }
  });

  app.delete("/api/jobs/:id", requireAuth, async (req: Request, res: Response) => {
    const jobId = req.params.id as string;
    const job = await storage.getJobById(jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (job.userId !== req.resolvedUserId) return res.status(403).json({ error: "Forbidden" });
    const deleted = await storage.deleteJob(jobId);
    if (!deleted) return res.status(404).json({ error: "Job not found" });
    return res.json({ success: true });
  });

  // ── Admin Bootstrap ──────────────────────────────────────────────────────────

  app.post("/api/admin/bootstrap", requireAuth, async (req: Request, res: Response) => {
    const { db } = await import("./db");
    const { users } = await import("@shared/schema");
    const allUsers = await db.select().from(users);
    const adminExists = allUsers.some((u) => u.isAdmin);
    if (adminExists) {
      return res.status(403).json({ error: "An admin already exists. Use the admin panel to promote others." });
    }
    const userId = req.resolvedUserId!;
    const user = await storage.setUserAdmin(userId, true);
    if (!user) return res.status(404).json({ error: "User not found" });
    console.log(`[ADMIN BOOTSTRAP] User ${user.email} promoted to admin`);
    return res.json({ success: true, message: `${user.email} is now an admin. Refresh the page.` });
  });

  // ── Admin Routes ────────────────────────────────────────────────────────────

  app.get("/api/admin/stats", requireAdmin, async (_req: Request, res: Response) => {
    const stats = await storage.getAdminStats();
    return res.json(stats);
  });

  app.get("/api/admin/users", requireAdmin, async (_req: Request, res: Response) => {
    const usersWithSubs = await storage.getAllUsers();
    return res.json(usersWithSubs.map((u) => ({ ...u, passwordHash: undefined })));
  });

  app.patch("/api/admin/users/:id/plan", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.id as string);
      if (isNaN(userId)) return res.status(400).json({ error: "Invalid user ID" });
      const { plan } = z.object({ plan: z.enum(["free", "pro", "business"]) }).parse(req.body);
      const sub = await storage.updatePlan(userId, plan);
      if (!sub) return res.status(404).json({ error: "User not found" });
      return res.json(sub);
    } catch (err) {
      if (err instanceof ZodError) return res.status(400).json({ error: err.errors[0].message });
      throw err;
    }
  });

  app.patch("/api/admin/users/:id/admin", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.id as string);
      if (isNaN(userId)) return res.status(400).json({ error: "Invalid user ID" });
      const { isAdmin } = z.object({ isAdmin: z.boolean() }).parse(req.body);
      const user = await storage.setUserAdmin(userId, isAdmin);
      if (!user) return res.status(404).json({ error: "User not found" });
      return res.json({ id: user.id, isAdmin: user.isAdmin });
    } catch (err) {
      if (err instanceof ZodError) return res.status(400).json({ error: err.errors[0].message });
      throw err;
    }
  });

  app.delete("/api/admin/users/:id", requireAdmin, async (req: Request, res: Response) => {
    const userId = parseInt(req.params.id as string);
    if (isNaN(userId)) return res.status(400).json({ error: "Invalid user ID" });
    const deleted = await storage.deleteUser(userId);
    if (!deleted) return res.status(404).json({ error: "User not found" });
    return res.json({ success: true });
  });

  app.get("/api/admin/jobs", requireAdmin, async (_req: Request, res: Response) => {
    const jobs = await storage.getAllJobs();
    return res.json(jobs);
  });

  app.delete("/api/admin/jobs/:id", requireAdmin, async (req: Request, res: Response) => {
    const jobId = req.params.id as string;
    const deleted = await storage.deleteJob(jobId);
    if (!deleted) return res.status(404).json({ error: "Job not found" });
    return res.json({ success: true });
  });

  return httpServer;
}
