import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { Pool } from "pg";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { startRecoveryWatchdog } from "./storage";

// ─── Global crash guards ───────────────────────────────────────────────────────
// Prevent unhandled rejections or uncaught exceptions from silently killing the
// process before Railway's health check can reach /api/health.
process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled promise rejection:", reason);
});

const app = express();
const httpServer = createServer(app);

// Trust reverse proxy (Railway, Vercel, nginx) so req.secure and secure cookies work
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
// Production (Railway): set CORS_ORIGIN to your Vercel frontend URL.
// Development: all origins allowed (Replit preview, localhost, etc.)
const rawOrigins = process.env.CORS_ORIGIN;
const allowedOrigins: string[] = rawOrigins
  ? rawOrigins.split(",").map((o) => o.trim())
  : [];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no Origin header — this covers Railway's health check
      // (which comes from healthcheck.railway.app with no Origin header set) and
      // server-to-server calls like curl, Postman, auto-processing, etc.
      if (!origin) return callback(null, true);
      // In development (CORS_ORIGIN not set), allow every origin.
      if (allowedOrigins.length === 0) return callback(null, true);
      // In production, only allow explicitly configured origins.
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS: origin "${origin}" is not allowed`));
    },
    credentials: true,
  }),
);

// ─── Health check ─────────────────────────────────────────────────────────────
// Registered FIRST, before session/db/auth middleware, so Railway can always
// reach it immediately on startup even if the database is still connecting.
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
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
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

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

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// ─── Start HTTP server IMMEDIATELY ────────────────────────────────────────────
// The server must be listening before Railway runs the health check.
// Railway injects PORT — we use that value, falling back to 5000 for local dev.
// Note: if PORT is not set on Railway, go to your service → Settings →
// Networking → Generate Domain to make Railway inject the PORT variable.
if (!process.env.VERCEL) {
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
    log(`health check: http://0.0.0.0:${port}/api/health`);
  });
}

// ─── Session ──────────────────────────────────────────────────────────────────
// Cross-origin (split deploy): cookies need sameSite:"none" + secure:true
// so the browser sends them from Vercel frontend to Railway backend.
const isCrossOrigin = !!process.env.CORS_ORIGIN;

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
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: isCrossOrigin ? "none" : "lax",
    },
  });
} catch (err) {
  console.error("[SESSION] Failed to create session store, using memory store:", err);
  // Fallback to memory-based sessions (not persistent across restarts)
  sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || "scraper-saas-secret-key-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: isCrossOrigin ? "none" : "lax",
    },
  });
}

app.use(sessionMiddleware);

// ─── Routes + Vite (fully async, after server is already listening) ────────────
(async () => {
  try {
    await registerRoutes(httpServer, app);
    log("Routes registered");

    if (process.env.NODE_ENV === "production") {
      startRecoveryWatchdog().catch((err) =>
        console.error("[WATCHDOG] Failed to start:", err),
      );
      if (process.env.SERVE_STATIC === "true") {
        serveStatic(app);
      }
    } else {
      await startRecoveryWatchdog();
      const { setupVite } = await import("./vite");
      await setupVite(httpServer, app);
    }
  } catch (err) {
    console.error("[INIT] Failed to initialize app:", err);
  }

  // Error handler — must be registered after all routes
  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error("[ERROR]", err);
    if (res.headersSent) return next(err);
    return res.status(status).json({ error: message });
  });
})();

// Default export used by Vercel's @vercel/node serverless handler (legacy mode)
export default async (req: any, res: any) => {
  app(req, res);
};
