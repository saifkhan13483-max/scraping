import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { Pool } from "pg";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { startRecoveryWatchdog } from "./storage";

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
// Development: all origins are allowed (Replit preview, localhost, etc.)
const rawOrigins = process.env.CORS_ORIGIN;
const allowedOrigins: string[] = rawOrigins
  ? rawOrigins.split(",").map((o) => o.trim())
  : [];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS: origin "${origin}" is not allowed`));
    },
    credentials: true,
  }),
);

// ─── Health check (registered FIRST, before session/db middleware) ────────────
// Must respond immediately so Railway's startup health check always succeeds,
// even if the database is still connecting or unreachable.
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// ─── Start listening immediately ──────────────────────────────────────────────
// The HTTP server starts BEFORE any async database work so that Railway's
// health check can reach /api/health within the first few seconds of startup.
if (!process.env.VERCEL) {
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen({ port, host: "0.0.0.0" }, () => {
    log(`serving on port ${port}`);
  });
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

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

// ─── Session (async — set up after listen so health check isn't blocked) ──────
const PgSession = connectPgSimple(session);
const sessionPool = new Pool({ connectionString: process.env.DATABASE_URL });

// Cross-origin (split deploy): cookies must be sameSite:"none" + secure:true
// so the browser sends them from the Vercel frontend to the Railway backend.
const isCrossOrigin = !!process.env.CORS_ORIGIN;

app.use(
  session({
    store: new PgSession({
      pool: sessionPool,
      createTableIfMissing: true,
      // Don't let session table creation errors crash the app
      errorLog: (err) => console.error("[SESSION STORE]", err),
    }),
    secret: process.env.SESSION_SECRET || "scraper-saas-secret-key-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: isCrossOrigin ? "none" : "lax",
    },
  }),
);

// ─── Routes + Vite (fully async, runs after server is already listening) ──────
(async () => {
  try {
    await registerRoutes(httpServer, app);

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
    console.error("[INIT] Failed to initialize routes:", err);
  }

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error("[ERROR]", err);
    if (res.headersSent) return next(err);
    return res.status(status).json({ error: message });
  });
})();

// Default export used by Vercel's @vercel/node serverless handler (legacy monorepo mode)
export default async (req: any, res: any) => {
  // For Vercel: wait until routes are registered before handling requests
  await new Promise<void>((resolve) => {
    const check = () => {
      if ((app as any)._router) resolve();
      else setTimeout(check, 50);
    };
    check();
  });
  app(req, res);
};
