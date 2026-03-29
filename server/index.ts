import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { Pool } from "pg";
import { serveStatic } from "./static";
import { createServer } from "http";
import { registerRoutes } from "./routes";
import { startRecoveryWatchdog } from "./storage";

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

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS: origin "${origin}" is not allowed`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
};

app.use(cors(corsOptions));

// Respond to all OPTIONS preflight requests immediately so cross-origin
// POST/PUT/DELETE from Vercel → Railway never get a 405 from downstream handlers.
app.options("/{*path}", cors(corsOptions));

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

// ─── Session ──────────────────────────────────────────────────────────────────
// isCrossOrigin = true when CORS_ORIGIN is set, meaning the frontend is on a
// different domain (e.g. Vercel). In that case cookies must be SameSite=None;Secure.
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

// ─── Routes + Vite/Static, then listen ────────────────────────────────────────
// Uses static imports (not dynamic await import()) so the esbuild CJS bundle
// correctly resolves all modules before any routes are registered.
(async () => {
  try {
    await registerRoutes(httpServer, app);
    log("Routes registered");
  } catch (err) {
    console.error("[INIT] Failed to register routes:", err);
    // Register a fallback error route so the server doesn't silently swallow requests
    app.use("/api", (_req: Request, res: Response) => {
      res.status(500).json({ error: "Server failed to initialize routes. Check server logs." });
    });
  }

  if (process.env.NODE_ENV === "production") {
    startRecoveryWatchdog().catch((err) =>
      console.error("[WATCHDOG] Failed to start:", err),
    );

    // In a split deployment (Vercel frontend + Railway backend), CORS_ORIGIN is set
    // because the frontend lives on a different domain. Railway is API-only — skip
    // the SPA catch-all (serveStatic) which would return index.html for every
    // unmatched path and silently swallow API requests.
    if (isCrossOrigin) {
      log("split-deployment mode: static file serving disabled (frontend is on Vercel)");
      app.use((_req: Request, res: Response) => {
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

  // Error handler — must be registered after all routes
  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error("[ERROR]", err);
    if (res.headersSent) return next(err);
    return res.status(status).json({ error: message });
  });

  // Start listening only after ALL routes and middleware are wired up
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

// Default export used by Vercel's @vercel/node serverless handler (legacy mode)
export default async (req: any, res: any) => {
  app(req, res);
};
