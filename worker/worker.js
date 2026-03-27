/**
 * Browser Automation Worker
 *
 * Polls the job queue API and processes each job using Playwright.
 * Runs on your LOCAL machine — not inside the server.
 *
 * Setup:
 *   cd worker
 *   npm install
 *   npm run install-browsers
 *   npm start
 */

import axios from "axios";
import { chromium } from "playwright";

// ─────────────────────────────────────────────
// Config — change BASE_URL to your deployed API
// or keep localhost:5000 when running locally.
// ─────────────────────────────────────────────
const BASE_URL = process.env.API_URL?.trim() || "http://localhost:5000";

/** Seconds to wait when the queue is empty before polling again */
const IDLE_WAIT_SEC = 4;

/** Seconds to wait between jobs (prevents hammering the API) */
const BETWEEN_JOBS_SEC = 1;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  headers: { "Content-Type": "application/json" },
});

function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

function log(level, message, extra = "") {
  const time = new Date().toLocaleTimeString("en-US", { hour12: false });
  const prefix =
    level === "info"  ? "\x1b[36m[INFO]\x1b[0m"  :
    level === "ok"    ? "\x1b[32m[DONE]\x1b[0m"  :
    level === "warn"  ? "\x1b[33m[WAIT]\x1b[0m"  :
    level === "error" ? "\x1b[31m[FAIL]\x1b[0m"  :
                        "[LOG] ";
  console.log(`${time} ${prefix} ${message}${extra ? "  " + extra : ""}`);
}

// ─────────────────────────────────────────────
// Core: fetch next job from the API
// ─────────────────────────────────────────────

async function fetchNextJob() {
  const response = await api.get("/api/job", {
    validateStatus: (s) => s === 200 || s === 204,
  });
  if (response.status === 204) return null;
  return response.data;
}

// ─────────────────────────────────────────────
// Core: process one job with Playwright
// ─────────────────────────────────────────────

async function processJob(job) {
  log("info", `Job received  id=${job.id.slice(0, 8)}…  url=${job.url}`);
  log("info", "Launching browser…");

  const browser = await chromium.launch({
    headless: false,      // Set true to run silently in background
    slowMo: 50,           // Slight slow-down so you can watch it work
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  try {
    log("info", `Navigating to ${job.url}`);

    await page.goto(job.url, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    // ── Extract page title ──
    const title = await page.title();
    log("info", `Title: "${title}"`);

    // ── Extract all links ──
    const links = await page.$$eval("a[href]", (anchors) =>
      anchors
        .map((a) => ({
          text: a.innerText.trim().slice(0, 120),
          href: a.href,
        }))
        .filter((l) => l.href.startsWith("http"))
        .slice(0, 100)   // Cap at 100 links per page
    );

    log("info", `Found ${links.length} links`);

    // ── Report success ──
    await api.post("/api/result", {
      id: job.id,
      data: { title, links, scrapedAt: new Date().toISOString() },
    });

    log("ok", `Completed  id=${job.id.slice(0, 8)}…  "${title}"`);

  } catch (err) {
    const message = err.message || "Unknown error";
    log("error", `Failed  id=${job.id.slice(0, 8)}…  ${message}`);

    // ── Report failure ──
    try {
      await api.post("/api/fail", {
        id: job.id,
        error: message,
      });
    } catch (reportErr) {
      log("error", "Could not report failure to API:", reportErr.message);
    }

  } finally {
    await browser.close();
    log("info", "Browser closed");
  }
}

// ─────────────────────────────────────────────
// Main polling loop
// ─────────────────────────────────────────────

async function main() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Browser Automation Worker");
  console.log(`  API: ${BASE_URL}`);
  console.log("  Press Ctrl+C to stop");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Quick connectivity check
  try {
    await api.get("/api/jobs");
    log("ok", `Connected to API at ${BASE_URL}`);
  } catch (err) {
    log("error", `Cannot reach API at ${BASE_URL} — is the server running?`);
    log("error", err.message);
    process.exit(1);
  }

  // Poll forever
  while (true) {
    try {
      const job = await fetchNextJob();

      if (!job) {
        log("warn", `Queue is empty — waiting ${IDLE_WAIT_SEC}s…`);
        await sleep(IDLE_WAIT_SEC);
        continue;
      }

      await processJob(job);
      await sleep(BETWEEN_JOBS_SEC);

    } catch (err) {
      // Network / API error — don't crash, just wait and retry
      log("error", `Loop error: ${err.message} — retrying in 5s`);
      await sleep(5);
    }
  }
}

// Handle Ctrl+C gracefully
process.on("SIGINT", () => {
  console.log("\n\n[Worker] Shutting down. Goodbye!\n");
  process.exit(0);
});

main();
