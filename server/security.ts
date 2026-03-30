import helmet from "helmet";
import hpp from "hpp";
import sanitizeHtml from "sanitize-html";
import { doubleCsrf } from "csrf-csrf";
import type { Request, Response, NextFunction } from "express";
import type { Express } from "express";

// ─── Helmet + HPP ─────────────────────────────────────────────────────────────

/**
 * Apply all security middleware to the Express app.
 * Call this before registering routes.
 */
export function applySecurityMiddleware(app: Express) {
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "wss:", "ws:"],
          frameSrc: ["'none'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: [],
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(hpp());
}

// ─── CSRF (double-submit cookie) ──────────────────────────────────────────────

const isProduction = process.env.NODE_ENV === "production";

const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => process.env.SESSION_SECRET ?? "scraper-saas-csrf-secret",
  cookieName: isProduction ? "__Host-csrf" : "csrf",
  cookieOptions: {
    httpOnly: false, // JS must read it to send in header
    sameSite: isProduction ? "strict" : "lax",
    secure: isProduction,
    path: "/",
  },
  getTokenFromRequest: (req) => {
    return (
      (req.headers["x-csrf-token"] as string | undefined) ??
      (req.body as Record<string, string>)?._csrf
    );
  },
});

export { generateToken };

/**
 * CSRF protection middleware.
 * Skipped for:
 *  - API key authenticated requests (x-api-key header — not vulnerable to CSRF)
 *  - Stripe webhooks (use HMAC signature verification instead)
 *  - Internal process endpoint
 *  - Safe HTTP methods (GET, HEAD, OPTIONS)
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  // API key auth is not vulnerable to CSRF — skip
  if (req.headers["x-api-key"]) return next();
  // Stripe webhooks use signature verification
  if (req.path === "/api/stripe/webhook") return next();
  // Internal processing endpoint uses its own secret
  if (req.path === "/api/jobs/process") return next();
  // Apply the double-submit cookie CSRF check
  doubleCsrfProtection(req, res, next);
}

// ─── Input sanitization ───────────────────────────────────────────────────────

/**
 * Strip HTML/script tags from all string fields in req.body (recursive).
 */
export function sanitizeBody(req: Request, _res: Response, next: NextFunction) {
  if (req.body && typeof req.body === "object") {
    req.body = deepSanitize(req.body);
  }
  next();
}

function deepSanitize(obj: unknown): unknown {
  if (typeof obj === "string") {
    return sanitizeHtml(obj, { allowedTags: [], allowedAttributes: {} });
  }
  if (Array.isArray(obj)) {
    return obj.map(deepSanitize);
  }
  if (obj !== null && typeof obj === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      sanitized[key] = deepSanitize(value);
    }
    return sanitized;
  }
  return obj;
}

// ─── Centralized error handler ────────────────────────────────────────────────

/**
 * Centralized error handler — never leaks stack traces in production.
 * Must be registered AFTER all routes.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
) {
  if (res.headersSent) return next(err);

  // Handle CSRF errors
  if ((err as { code?: string })?.code === "EBADCSRFTOKEN" ||
    (err as Error)?.message?.toLowerCase().includes("csrf")) {
    return res.status(403).json({ error: "Invalid or missing CSRF token. Please refresh the page." });
  }

  const status =
    (err as { status?: number; statusCode?: number })?.status ??
    (err as { status?: number; statusCode?: number })?.statusCode ??
    500;

  const message =
    isProduction && status === 500
      ? "An internal server error occurred"
      : (err as Error)?.message ?? "Internal Server Error";

  if (status >= 500) {
    console.error("[ERROR]", err);
  }

  res.status(status).json({ error: message });
}
