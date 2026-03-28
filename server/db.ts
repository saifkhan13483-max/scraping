import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  console.error("[DB] DATABASE_URL is not set — database operations will fail until it is configured");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL || "" });

export const db = drizzle(pool, { schema });
