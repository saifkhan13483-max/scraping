import { pgTable, text, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const jobs = pgTable("jobs", {
  id: varchar("id").primaryKey(),
  url: text("url").notNull(),
  status: varchar("status", { enum: ["pending", "processing", "completed", "failed"] }).notNull().default("pending"),
  result: jsonb("result"),
  error: text("error"),
  retryCount: text("retry_count").notNull().default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertJobSchema = createInsertSchema(jobs).pick({ url: true });
export const submitResultSchema = z.object({ id: z.string(), data: z.any() });
export const failJobSchema = z.object({ id: z.string(), error: z.string() });
export const retryJobSchema = z.object({ id: z.string() });

export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobs.$inferSelect;
export type JobStatus = "pending" | "processing" | "completed" | "failed";
