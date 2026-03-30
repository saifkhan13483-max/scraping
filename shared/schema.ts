import { pgTable, text, varchar, timestamp, jsonb, integer, serial, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Jobs (Redis-backed, schema kept for type safety) ───────────────────────

export const jobs = pgTable("jobs", {
  id: varchar("id").primaryKey(),
  url: text("url").notNull(),
  status: varchar("status", { enum: ["pending", "processing", "completed", "failed"] }).notNull().default("pending"),
  priority: varchar("priority", { enum: ["high", "normal", "low"] }).notNull().default("normal"),
  result: jsonb("result"),
  error: text("error"),
  retryCount: text("retry_count").notNull().default("0"),
  workerId: varchar("worker_id", { length: 100 }),
  runAt: timestamp("run_at"),
  userId: integer("user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertJobSchema = createInsertSchema(jobs).pick({ url: true }).extend({
  url: z.string().url("Please enter a valid URL (e.g. https://example.com)"),
  priority: z.enum(["high", "normal", "low"]).default("normal"),
  delay: z.number().int().min(0).max(3_600_000).optional(),
});
export const submitResultSchema = z.object({
  id: z.string(),
  data: z.any(),
  workerId: z.string().optional(),
});
export const failJobSchema = z.object({ id: z.string(), error: z.string(), workerId: z.string().optional() });
export const retryJobSchema = z.object({ id: z.string() });

export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobs.$inferSelect;
export type JobStatus = "pending" | "processing" | "completed" | "failed";
export type JobPriority = "high" | "normal" | "low";

// ─── Users ───────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, passwordHash: true }).extend({
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email address"),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ─── Subscription Plans ──────────────────────────────────────────────────────

export type PlanType = "free" | "pro" | "business";

export const PLAN_CONFIG: Record<PlanType, { label: string; price: number; jobLimit: number; features: string[] }> = {
  free: {
    label: "Free",
    price: 0,
    jobLimit: 50,
    features: ["50 scraping jobs/month", "Standard speed", "JSON results", "Community support"],
  },
  pro: {
    label: "Pro",
    price: 29,
    jobLimit: 500,
    features: ["500 scraping jobs/month", "Priority processing", "JSON results", "API key access", "Email support"],
  },
  business: {
    label: "Business",
    price: 99,
    jobLimit: 999999,
    features: ["Unlimited scraping jobs", "Fastest processing", "JSON results", "API key access", "Dedicated support", "Team access"],
  },
};

// ─── Subscriptions ───────────────────────────────────────────────────────────

export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  plan: varchar("plan", { enum: ["free", "pro", "business"] }).notNull().default("free"),
  jobsUsedThisMonth: integer("jobs_used_this_month").notNull().default(0),
  resetAt: timestamp("reset_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Subscription = typeof subscriptions.$inferSelect;

// ─── API Keys ────────────────────────────────────────────────────────────────

export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  key: varchar("key", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const createApiKeySchema = z.object({ name: z.string().min(1, "Name is required") });
export type ApiKey = typeof apiKeys.$inferSelect;
