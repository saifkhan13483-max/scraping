import { Request, Response, NextFunction } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { storage } from "./storage";

declare global {
  namespace Express {
    interface Request {
      resolvedUserId?: number;
      apiKeyScope?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = req.session?.userId ?? req.resolvedUserId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

export function requireScope(scope: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const userId = req.session?.userId ?? req.resolvedUserId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    // Session users have full access; API key users must have the right scope
    if (req.apiKeyScope !== undefined) {
      const allowed = req.apiKeyScope === "full_access" ||
        req.apiKeyScope === scope ||
        (scope === "read" && ["read", "create_jobs", "full_access"].includes(req.apiKeyScope));
      if (!allowed) {
        return res.status(403).json({ error: `This API key does not have '${scope}' permission.` });
      }
    }
    next();
  };
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const userId = req.session?.userId ?? req.resolvedUserId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const result = await db.execute(
    sql`SELECT is_admin as "isAdmin" FROM users WHERE id = ${userId}`
  );
  const row = (result.rows as Array<{ isAdmin: boolean }>)[0];
  if (!row?.isAdmin) {
    return res.status(403).json({ error: "Forbidden: admin access required" });
  }
  next();
}

export async function resolveUser(req: Request, res: Response, next: NextFunction) {
  if (req.session?.userId) {
    req.resolvedUserId = req.session.userId;
    return next();
  }
  const rawApiKey = req.headers["x-api-key"] as string | undefined;
  if (rawApiKey) {
    const keyRow = await storage.validateApiKey(rawApiKey);
    if (keyRow) {
      req.resolvedUserId = keyRow.userId;
      req.apiKeyScope = keyRow.scope ?? "full_access";
      return next();
    }
  }
  next();
}
