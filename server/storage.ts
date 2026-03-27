import { type Job, type InsertJob, type JobStatus } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  createJob(job: InsertJob): Promise<Job>;
  getNextPendingJob(): Promise<Job | undefined>;
  getJobById(id: string): Promise<Job | undefined>;
  getAllJobs(): Promise<Job[]>;
  completeJob(id: string, data: any): Promise<Job | undefined>;
  failJob(id: string, error: string): Promise<Job | undefined>;
  retryJob(id: string): Promise<Job | undefined>;
  deleteJob(id: string): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private jobs: Map<string, Job>;

  constructor() {
    this.jobs = new Map();
  }

  async createJob(insert: InsertJob): Promise<Job> {
    const id = randomUUID();
    const now = new Date();
    const job: Job = {
      id,
      url: insert.url,
      status: "pending",
      result: null,
      error: null,
      retryCount: "0",
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(id, job);
    console.log(`[JOB CREATED] id=${id} url=${insert.url}`);
    return job;
  }

  async getNextPendingJob(): Promise<Job | undefined> {
    const pending = Array.from(this.jobs.values())
      .filter((j) => j.status === "pending")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (!pending.length) return undefined;
    const job = pending[0];
    const updated: Job = { ...job, status: "processing", updatedAt: new Date() };
    this.jobs.set(job.id, updated);
    console.log(`[JOB PROCESSING] id=${job.id} url=${job.url}`);
    return updated;
  }

  async getJobById(id: string): Promise<Job | undefined> {
    return this.jobs.get(id);
  }

  async getAllJobs(): Promise<Job[]> {
    return Array.from(this.jobs.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  async completeJob(id: string, data: any): Promise<Job | undefined> {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    const updated: Job = { ...job, status: "completed", result: data, updatedAt: new Date() };
    this.jobs.set(id, updated);
    console.log(`[JOB COMPLETED] id=${id}`);
    return updated;
  }

  async failJob(id: string, error: string): Promise<Job | undefined> {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    const updated: Job = {
      ...job,
      status: "failed",
      error,
      updatedAt: new Date(),
    };
    this.jobs.set(id, updated);
    console.log(`[JOB FAILED] id=${id} error=${error}`);
    return updated;
  }

  async retryJob(id: string): Promise<Job | undefined> {
    const job = this.jobs.get(id);
    if (!job || job.status !== "failed") return undefined;
    const retryCount = parseInt(job.retryCount) + 1;
    const updated: Job = {
      ...job,
      status: "pending",
      error: null,
      retryCount: String(retryCount),
      updatedAt: new Date(),
    };
    this.jobs.set(id, updated);
    console.log(`[JOB RETRY] id=${id} attempt=${retryCount}`);
    return updated;
  }

  async deleteJob(id: string): Promise<boolean> {
    const existed = this.jobs.has(id);
    this.jobs.delete(id);
    if (existed) console.log(`[JOB DELETED] id=${id}`);
    return existed;
  }
}

export const storage = new MemStorage();
