import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertJobSchema, submitResultSchema, failJobSchema, retryJobSchema } from "@shared/schema";
import { ZodError } from "zod";

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // Request logger
  app.use((req: Request, _res: Response, next: NextFunction) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });

  // POST /api/job - add a new job
  app.post("/api/job", async (req: Request, res: Response) => {
    try {
      const parsed = insertJobSchema.parse(req.body);
      if (!isValidUrl(parsed.url)) {
        return res.status(400).json({ error: "Invalid URL format" });
      }
      const job = await storage.createJob(parsed);
      return res.status(201).json(job);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ error: "Validation error", details: err.errors });
      }
      throw err;
    }
  });

  // GET /api/job - worker fetches next pending job
  app.get("/api/job", async (_req: Request, res: Response) => {
    const job = await storage.getNextPendingJob();
    if (!job) return res.status(204).send();
    return res.json(job);
  });

  // GET /api/jobs - return all jobs (for dashboard/debugging)
  app.get("/api/jobs", async (_req: Request, res: Response) => {
    const jobs = await storage.getAllJobs();
    return res.json(jobs);
  });

  // GET /api/jobs/:id - return a specific job
  app.get("/api/jobs/:id", async (req: Request, res: Response) => {
    const job = await storage.getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found" });
    return res.json(job);
  });

  // POST /api/result - worker submits result
  app.post("/api/result", async (req: Request, res: Response) => {
    try {
      const parsed = submitResultSchema.parse(req.body);
      const job = await storage.completeJob(parsed.id, parsed.data);
      if (!job) return res.status(404).json({ error: "Job not found" });
      return res.json(job);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ error: "Validation error", details: err.errors });
      }
      throw err;
    }
  });

  // POST /api/fail - mark job as failed
  app.post("/api/fail", async (req: Request, res: Response) => {
    try {
      const parsed = failJobSchema.parse(req.body);
      const job = await storage.failJob(parsed.id, parsed.error);
      if (!job) return res.status(404).json({ error: "Job not found" });
      return res.json(job);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ error: "Validation error", details: err.errors });
      }
      throw err;
    }
  });

  // POST /api/retry - retry a failed job
  app.post("/api/retry", async (req: Request, res: Response) => {
    try {
      const parsed = retryJobSchema.parse(req.body);
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

  // DELETE /api/jobs/:id - delete a job
  app.delete("/api/jobs/:id", async (req: Request, res: Response) => {
    const deleted = await storage.deleteJob(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Job not found" });
    return res.json({ success: true });
  });

  // Centralized error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[ERROR]", err);
    res.status(500).json({ error: "Internal server error", message: err.message });
  });

  return httpServer;
}
