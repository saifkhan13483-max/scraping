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
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
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

// ─── Routes + Vite/Static, then listen ────────────────────────────────────────
(async () => {
  // ── Startup migrations (idempotent) ────────────────────────────────────────
  try {
    const migPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await migPool.query(
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false"
    );
    // API key security upgrade: add new columns if missing
    await migPool.query(`
      ALTER TABLE api_keys
        ADD COLUMN IF NOT EXISTS key_hash varchar(64),
        ADD COLUMN IF NOT EXISTS key_prefix varchar(12),
        ADD COLUMN IF NOT EXISTS scope varchar(32) NOT NULL DEFAULT 'full_access',
        ADD COLUMN IF NOT EXISTS expires_at timestamp,
        ADD COLUMN IF NOT EXISTS last_used_at timestamp
    `);
    // Migrate any legacy plain-text keys only if the 'key' column still exists
    const keyColExists = await migPool.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'api_keys' AND column_name = 'key'
    `);
    if (keyColExists.rowCount && keyColExists.rowCount > 0) {
      const legacyKeys = await migPool.query(
        "SELECT id, key FROM api_keys WHERE key IS NOT NULL AND key_hash IS NULL"
      );
      if (legacyKeys.rowCount && legacyKeys.rowCount > 0) {
        const { createHash } = await import("crypto");
        for (const row of legacyKeys.rows as Array<{ id: number; key: string }>) {
          const hash = createHash("sha256").update(row.key).digest("hex");
          const prefix = row.key.slice(0, 10);
          await migPool.query(
            "UPDATE api_keys SET key_hash = $1, key_prefix = $2 WHERE id = $3",
            [hash, prefix, row.id]
          );
        }
        console.log(`[MIGRATE] Hashed ${legacyKeys.rowCount} legacy API key(s)`);
      }
      await migPool.query("ALTER TABLE api_keys DROP COLUMN key");
    }
    await migPool.end();
    console.log("[MIGRATE] Schema up to date");
  } catch (err) {
    console.error("[MIGRATE] Startup migration failed:", (err as Error).message);
  }

  // ── Ensure owner email always has admin rights ──────────────────────────────
  try {
    const ownerEmail = (process.env.OWNER_EMAIL ?? "saifkhan16382@gmail.com").toLowerCase().trim();
    const ownerPool = new Pool({ connectionString: process.env.DATABASE_URL });
    const result = await ownerPool.query(
      "UPDATE users SET is_admin = true WHERE email = $1 AND is_admin = false RETURNING id, email",
      [ownerEmail]
    );
    if (result.rowCount && result.rowCount > 0) {
      console.log(`[MIGRATE] Admin granted to owner: ${result.rows[0].email} (id=${result.rows[0].id})`);
    } else {
      console.log(`[MIGRATE] Owner admin check: ${ownerEmail} already admin or not yet registered`);
    }
    await ownerPool.end();
  } catch (err) {
    console.error("[MIGRATE] Owner admin grant failed:", (err as Error).message);
  }

  try {
    await registerRoutes(httpServer, app);
    log("Routes registered");
  } catch (err) {
    console.error("[INIT] Failed to register routes:", err);
    app.use("/api", (_req: Request, res: Response) => {
      res.status(500).json({ error: "Server failed to initialize routes. Check server logs." });
    });
  }

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

  // ── Centralized error handler (must be last) ───────────────────────────────
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
