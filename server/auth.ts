import { Request, Response, NextFunction } from "express";
import { db } from "./db";
import { apiKeys } from "@shared/schema";
import { eq } from "drizzle-orm";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

export async function resolveUser(req: Request, res: Response, next: NextFunction) {
  // Check session first
  if (req.session?.userId) {
    return next();
  }
  // Check API key header
  const apiKey = req.headers["x-api-key"] as string | undefined;
  if (apiKey) {
    const [keyRow] = await db.select().from(apiKeys).where(eq(apiKeys.key, apiKey));
    if (keyRow) {
      req.session!.userId = keyRow.userId;
      return next();
    }
  }
  next();
}
