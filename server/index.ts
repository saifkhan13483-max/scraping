import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { Pool } from "pg";
import { serveStatic } from "./static";
import { createServer } from "http";
import { registerRoutes } from "./routes";
import { startRecoveryWatchdog } from "./storage";
import { applySecurityMiddleware, errorHandler } from "./security";
import { runMigrations } from "./db";
import { redis, KEYS } from "./redis";

// ─── Global crash guards ───────────────────────────────────────────────────────
process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled promise rejection:", reason);
});

const app = express();
const httpServer = createServer(app);

app.set("trust proxy", 1);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

declare module "express-session" {
  interface SessionData {
    userId: number;
  }
}

// ─── CORS ─────────────────────────────────────────────────────────────────────
const rawOrigins = process.env.CORS_ORIGIN;
const allowedOrigins: string[] = rawOrigins
  ? rawOrigins.split(",").map((o) => o.trim().replace(/\/+$/, ""))
  : [];

if (allowedOrigins.length > 0) {
  console.log(`[CORS] Allowed origins: ${allowedOrigins.join(", ")}`);
} else {
  console.warn("[CORS] CORS_ORIGIN is not set — all origins allowed (development mode)");
}

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    console.error(`[CORS] Blocked origin: "${origin}". Allowed: [${allowedOrigins.join(", ")}]`);
    return callback(new Error(`CORS: origin "${origin}" is not allowed`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key", "X-CSRF-Token"],
};

app.use(cors(corsOptions));
app.options("/{*path}", cors(corsOptions));

// ─── Security middleware (helmet, hpp) ────────────────────────────────────────
applySecurityMiddleware(app);

// ─── Health check routes ───────────────────────────────────────────────────────
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});
app.get("/api/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, unknown> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      log(logLine);
    }
  });

  next();
});

// ─── Body parsing — 10kb limit for regular routes, 100kb for admin ────────────
app.use((req, res, next) => {
  const limit = req.path.startsWith("/api/admin") ? "100kb" : "10kb";
  express.json({
    limit,
    verify: (req, _res, buf) => {
      (req as Request & { rawBody: unknown }).rawBody = buf;
    },
  })(req, res, next);
});

app.use(express.urlencoded({ extended: false, limit: "10kb" }));

// ─── Session ──────────────────────────────────────────────────────────────────
const isCrossOrigin = !!process.env.CORS_ORIGIN;
const isProduction = process.env.NODE_ENV === "production";

const cookieOptions = {
  maxAge: 30 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  secure: isProduction,
  sameSite: (isCrossOrigin ? "none" : "lax") as "none" | "lax",
};

if (isCrossOrigin) {
  console.log("[SESSION] Cross-origin mode: SameSite=None; Secure cookies enabled");
}

let sessionMiddleware: express.RequestHandler;

try {
  const PgSession = connectPgSimple(session);
  const sessionPool = new Pool({ connectionString: process.env.DATABASE_URL });

  sessionMiddleware = session({
    store: new PgSession({
      pool: sessionPool,
      createTableIfMissing: true,
      errorLog: (err) => console.error("[SESSION STORE]", err.message),
    }),
    secret: process.env.SESSION_SECRET || "scraper-saas-secret-key-change-in-production",
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: cookieOptions,
  });
  console.log("[SESSION] PostgreSQL session store initialised");
} catch (err) {
  console.error("[SESSION] Failed to create PostgreSQL session store, using memory store:", err);
  sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || "scraper-saas-secret-key-change-in-production",
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: cookieOptions,
  });
}

app.use(sessionMiddleware);

// ─── Redis backfill helper ─────────────────────────────────────────────────────

/**
 * Scan all `job:*` keys (excluding helper keys) and populate any missing
 * per-user `user:{userId}:jobs` sorted set entries.
 * This is a one-time idempotent backfill for pre-existing data.
 */
async function backfillRedisSecondaryIndexes() {
  console.log("[BACKFILL] Scanning Redis for orphan job keys…");
  let cursor = "0";
  let populated = 0;
  let skipped = 0;

  try {
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", "job:*", "COUNT", 100);
      cursor = next;

      for (const key of keys) {
        // Skip non-hash keys like "job:abc:started_at"
        if (key.split(":").length > 2) { skipped++; continue; }

        const job = await redis.hgetall(key);
        if (!job || !job.userId || !job.id || !job.createdAt) { skipped++; continue; }

        const userId = parseInt(job.userId, 10);
        if (isNaN(userId)) { skipped++; continue; }

        const score = new Date(job.createdAt).getTime();
        const setKey = KEYS.userJobs(userId);

        // ZADD NX — only add if member doesn't already exist
        // ioredis ZADD with NX: zadd(key, 'NX', score, member)
        await (redis as any).zadd(setKey, "NX", score, job.id);
        populated++;
      }
    } while (cursor !== "0");

    console.log(`[BACKFILL] Complete — indexed: ${populated}, skipped: ${skipped}`);
  } catch (err) {
    console.error("[BACKFILL] Failed:", (err as Error).message);
  }
}

// ─── Owner admin grant ────────────────────────────────────────────────────────

async function ensureOwnerAdmin() {
  try {
    const { db } = await import("./db");
    const { users } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");

    const ownerEmail = (process.env.OWNER_EMAIL ?? "saifkhan16382@gmail.com").toLowerCase().trim();
    const [updated] = await db
      .update(users)
      .set({ isAdmin: true })
      .where(eq(users.email, ownerEmail))
      .returning({ id: users.id, email: users.email });

    if (updated) {
      console.log(`[INIT] Admin granted to owner: ${updated.email} (id=${updated.id})`);
    } else {
      console.log(`[INIT] Owner not yet registered or already admin: ${ownerEmail}`);
    }
  } catch (err) {
    console.error("[INIT] Owner admin grant failed:", (err as Error).message);
  }
}

// ─── Migration: hash any legacy plain-text API keys ──────────────────────────

async function migrateLegacyApiKeys() {
  try {
    const { pool } = await import("./db");
    const { createHash } = await import("crypto");

    // Only proceed if the old 'key' column still exists
    const { rows: colCheck } = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_name = 'api_keys' AND column_name = 'key'`
    );
    if (!colCheck.length) return; // Already migrated

    const { rows: legacyKeys } = await pool.query(
      "SELECT id, key FROM api_keys WHERE key IS NOT NULL AND key_hash IS NULL"
    );

    for (const row of legacyKeys as Array<{ id: number; key: string }>) {
      const hash = createHash("sha256").update(row.key).digest("hex");
      const prefix = row.key.slice(0, 10);
      await pool.query(
        "UPDATE api_keys SET key_hash = $1, key_prefix = $2 WHERE id = $3",
        [hash, prefix, row.id]
      );
    }

    if (legacyKeys.length > 0) {
      console.log(`[INIT] Hashed ${legacyKeys.length} legacy API key(s)`);
    }

    await pool.query("ALTER TABLE api_keys DROP COLUMN IF EXISTS key");
  } catch (err) {
    console.error("[INIT] Legacy API key migration failed:", (err as Error).message);
  }
}

// ─── Routes + Vite/Static, then listen ────────────────────────────────────────
(async () => {
  // 1. Run Drizzle schema migrations
  try {
    await runMigrations();
  } catch (err) {
    console.error("[INIT] Drizzle migrations failed — continuing with existing schema:", (err as Error).message);
  }

  // 2. Data migrations (idempotent, safe to run every startup)
  await migrateLegacyApiKeys();
  await ensureOwnerAdmin();

  // 3. Backfill Redis secondary indexes for existing jobs
  await backfillRedisSecondaryIndexes();

  // 4. Register API routes
  try {
    await registerRoutes(httpServer, app);
    log("Routes registered");
  } catch (err) {
    console.error("[INIT] Failed to register routes:", err);
    app.use("/api", (_req: Request, res: Response) => {
      res.status(500).json({ error: "Server failed to initialize routes. Check server logs." });
    });
  }

  // 5. Vite / Static
  if (process.env.NODE_ENV === "production") {
    startRecoveryWatchdog().catch((err) =>
      console.error("[WATCHDOG] Failed to start:", err),
    );

    if (isCrossOrigin) {
      log("split-deployment mode: static file serving disabled (frontend is on Vercel)");
      app.use((req: Request, res: Response) => {
        console.warn(`[404] Unmatched route: ${req.method} ${req.path}`);
        res.status(404).json({ error: "Not found" });
      });
    } else {
      serveStatic(app);
    }
  } else {
    try {
      await startRecoveryWatchdog();
    } catch (err) {
      console.error("[WATCHDOG] Failed to start:", err);
    }
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // 6. Centralized error handler (must be last)
  app.use(errorHandler);

  if (!process.env.VERCEL) {
    const port = parseInt(process.env.PORT || "5000", 10);
    const env = process.env.NODE_ENV || "development";
    httpServer.listen(port, "0.0.0.0", () => {
      log(`serving on port ${port}`);
      log(`environment: ${env}`);
      log(`health check: http://0.0.0.0:${port}/health`);
      log(`redis: ${process.env.REDIS_URL ? "external" : "in-memory"}`);
    });
  }
})();

export default async (req: Request, res: Response) => {
  app(req, res);
};
