import helmet from "helmet";
import hpp from "hpp";
import sanitizeHtml from "sanitize-html";
import type { Request, Response, NextFunction } from "express";
import type { Express } from "express";

/**
 * Apply all security middleware to the Express app.
 * Call this before registering routes.
 */
export function applySecurityMiddleware(app: Express) {
  // ── Helmet: sets security headers + CSP ───────────────────────────────────
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

  // ── HPP: prevent HTTP parameter pollution ─────────────────────────────────
  app.use(hpp());
}

/**
 * Strip HTML/script tags from all string fields in req.body (recursive).
 * Applied selectively on auth and job routes.
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

/**
 * Centralized error handler — never leaks stack traces in production.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
) {
  if (res.headersSent) return next(err);

  const isProduction = process.env.NODE_ENV === "production";
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
