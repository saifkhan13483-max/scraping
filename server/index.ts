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

// Trust reverse proxy (Railway, Vercel, nginx, etc.) so req.secure and secure cookies work correctly
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
// In production (Railway), set CORS_ORIGIN to your Vercel frontend URL.
// Multiple origins can be separated by commas: "https://app.vercel.app,https://custom.domain.com"
// In development, all localhost origins are allowed.
const rawOrigins = process.env.CORS_ORIGIN;
const allowedOrigins: string[] = rawOrigins
  ? rawOrigins.split(",").map((o) => o.trim())
  : ["http://localhost:5173", "http://localhost:5000"];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no Origin header (curl, Postman, server-to-server)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
        return callback(null, true);
      }
      return callback(new Error(`CORS: origin "${origin}" is not allowed`));
    },
    credentials: true,
  }),
);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// ─── Sessions ─────────────────────────────────────────────────────────────────
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
    }),
    secret: process.env.SESSION_SECRET || "scraper-saas-secret-key-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      // "none" is required when frontend and backend are on different domains
      sameSite: isCrossOrigin ? "none" : "lax",
    },
  }),
);

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

// Initialize all async setup once — shared across hot reloads and Vercel invocations
const initPromise = (async () => {
  await registerRoutes(httpServer, app);

  if (process.env.NODE_ENV === "production") {
    // Fire-and-forget — watchdog won't persist in serverless but runs on warm instances
    startRecoveryWatchdog().catch((err) =>
      console.error("[WATCHDOG] Failed to start:", err),
    );

    // Only serve the built frontend when explicitly requested.
    // On Railway (API-only), SERVE_STATIC is not set — the frontend is on Vercel.
    // On a monorepo/single-host deployment, set SERVE_STATIC=true.
    if (process.env.SERVE_STATIC === "true") {
      serveStatic(app);
    }
  } else {
    await startRecoveryWatchdog();
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error("[ERROR]", err);
    if (res.headersSent) return next(err);
    return res.status(status).json({ error: message });
  });

  // Start HTTP server only when NOT running as a Vercel serverless function
  if (!process.env.VERCEL) {
    const port = parseInt(process.env.PORT || "5000", 10);
    httpServer.listen(
      { port, host: "0.0.0.0", reusePort: true },
      () => { log(`serving on port ${port}`); },
    );
  }
})();

// Default export used by Vercel's @vercel/node serverless handler (legacy monorepo mode)
export default async (req: any, res: any) => {
  await initPromise;
  app(req, res);
};
