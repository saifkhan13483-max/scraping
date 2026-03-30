import { Request, Response, NextFunction } from "express";
import { db } from "./db";
import { apiKeys } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

declare global {
  namespace Express {
    interface Request {
      resolvedUserId?: number;
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

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const userId = req.session?.userId ?? req.resolvedUserId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const result = await db.execute(
    sql`SELECT is_admin as "isAdmin" FROM users WHERE id = ${userId}`
  );
  const row = (result.rows as any[])[0];
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
  const apiKey = req.headers["x-api-key"] as string | undefined;
  if (apiKey) {
    const [keyRow] = await db.select().from(apiKeys).where(eq(apiKeys.key, apiKey));
    if (keyRow) {
      req.resolvedUserId = keyRow.userId;
      return next();
    }
  }
  next();
}
