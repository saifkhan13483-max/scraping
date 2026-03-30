import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "@shared/schema";
import path from "path";
import { fileURLToPath } from "url";

if (!process.env.DATABASE_URL) {
  console.error("[DB] DATABASE_URL is not set — database operations will fail until it is configured");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "",
  min: 2,
  max: 10,
});

export const db = drizzle(pool, { schema });

/**
 * Run all pending Drizzle migrations.
 * Safe to call on existing databases — uses IF NOT EXISTS guards in SQL.
 * Tracks applied migrations in `__drizzle_migrations` table.
 */
export async function runMigrations(): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = path.resolve(__dirname, "../migrations");

  try {
    await migrate(db, { migrationsFolder });
    console.log("[DB] Migrations applied successfully");
  } catch (err) {
    console.error("[DB] Migration failed:", (err as Error).message);
    throw err;
  }
}

export { pool };
