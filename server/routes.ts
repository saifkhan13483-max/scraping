import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { scrapeUrl } from "./scraper";
import { insertJobSchema, submitResultSchema, failJobSchema, retryJobSchema, insertUserSchema, createApiKeySchema } from "@shared/schema";
import { ZodError, z } from "zod";
import { requireAuth, resolveUser } from "./auth";
import rateLimit from "express-rate-limit";

// ─── Rate limiters ─────────────────────────────────────────────────────────────

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
  skip: (req) => req.path === "/api/health",
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many auth attempts. Please wait before trying again." },
});

const jobLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many job submissions. Please slow down." },
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // Apply global rate limiter to all routes
  app.use(globalLimiter);
  app.use(resolveUser);

  // ── Auth Routes ─────────────────────────────────────────────────────────────

  app.post("/api/auth/register", authLimiter, async (req: Request, res: Response) => {
    try {
      const parsed = insertUserSchema.parse(req.body);
      const existing = await storage.getUserByEmail(parsed.email);
      if (existing) {
        return res.status(409).json({ error: "An account with this email already exists" });
      }
      const user = await storage.createUser(parsed);
      req.session!.userId = user.id;
      req.resolvedUserId = user.id;
      return res.status(201).json({ id: user.id, email: user.email, name: user.name });
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ error: err.errors[0].message });
      }
      throw err;
    }
  });

  app.post("/api/auth/login", authLimiter, async (req: Request, res: Response) => {
    try {
      const { email, password } = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
      const user = await storage.getUserByEmail(email);
      if (!user) return res.status(401).json({ error: "Invalid email or password" });
      const valid = await storage.validatePassword(user, password);
      if (!valid) return res.status(401).json({ error: "Invalid email or password" });
      req.session!.userId = user.id;
      req.resolvedUserId = user.id;
      return res.json({ id: user.id, email: user.email, name: user.name });
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
    return res.json({ id: user.id, email: user.email, name: user.name, subscription: sub });
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
    return res.json(keys.map((k) => ({ ...k, key: k.key.slice(0, 10) + "…" })));
  });

  app.post("/api/keys", requireAuth, async (req: Request, res: Response) => {
    try {
      const { name } = createApiKeySchema.parse(req.body);
      const sub = await storage.getSubscription(req.resolvedUserId!);
      if (!sub || sub.plan === "free") {
        return res.status(403).json({ error: "API key access requires a Pro or Business plan. Please upgrade to create API keys." });
      }
      const key = await storage.createApiKey(req.resolvedUserId!, name);
      return res.status(201).json(key);
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

  app.post("/api/job", requireAuth, jobLimiter, async (req: Request, res: Response) => {
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

      // Fire-and-forget: trigger server-side processing so jobs run without an external worker.
      const host = req.get("host") || "localhost:5000";
      const protocol = req.secure || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
      fetch(`${protocol}://${host}/api/jobs/process`, { method: "POST" }).catch((e) =>
        console.warn("[AUTO-PROCESS] Could not trigger processing:", e.message)
      );

      return res.status(201).json(job);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ error: "Validation error", details: err.errors });
      }
      throw err;
    }
  });

  // Worker endpoint — no auth required (external Playwright workers use this)
  app.get("/api/job", async (_req: Request, res: Response) => {
    const job = await storage.getNextPendingJob();
    if (!job) return res.status(204).send();
    return res.json(job);
  });

  // Server-side job processor — picks up one pending job and scrapes it in-process.
  app.post("/api/jobs/process", async (_req: Request, res: Response) => {
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

  app.post("/api/result", async (req: Request, res: Response) => {
    try {
      const parsed = submitResultSchema.parse(req.body);
      const job = await storage.completeJob(parsed.id, parsed.data, parsed.workerId);
      if (!job) return res.status(404).json({ error: "Job not found" });
      return res.json(job);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ error: "Validation error", details: err.errors });
      }
      throw err;
    }
  });

  app.post("/api/fail", async (req: Request, res: Response) => {
    try {
      const parsed = failJobSchema.parse(req.body);
      const job = await storage.failJob(parsed.id, parsed.error, parsed.workerId);
      if (!job) return res.status(404).json({ error: "Job not found" });
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

  return httpServer;
}
