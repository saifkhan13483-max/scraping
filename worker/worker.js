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
 *   WORKER_ID=worker-1 API_URL=https://your-api.com npm start
 */

import axios from "axios";
import { chromium } from "playwright";
import { randomBytes } from "crypto";

// ─────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────
const BASE_URL = process.env.API_URL?.trim() || "http://localhost:5000";

/** Unique ID for this worker instance — used in job logs */
const WORKER_ID = process.env.WORKER_ID?.trim() || `worker-${randomBytes(4).toString("hex")}`;

/** Seconds to wait when the queue is empty before polling again */
const IDLE_WAIT_SEC = 4;

/** Seconds to wait between jobs (prevents hammering the API) */
const BETWEEN_JOBS_SEC = 1;

/** Max ms to wait for page navigation */
const NAV_TIMEOUT_MS = 30_000;

/** Max ms for the entire job (navigation + extraction) */
const JOB_TIMEOUT_MS = 60_000;

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
  const workerTag = `\x1b[35m[${WORKER_ID}]\x1b[0m`;
  const prefix =
    level === "info"  ? "\x1b[36m[INFO]\x1b[0m"  :
    level === "ok"    ? "\x1b[32m[DONE]\x1b[0m"  :
    level === "warn"  ? "\x1b[33m[WAIT]\x1b[0m"  :
    level === "error" ? "\x1b[31m[FAIL]\x1b[0m"  :
                        "[LOG] ";
  console.log(`${time} ${workerTag} ${prefix} ${message}${extra ? "  " + extra : ""}`);
}

// ─────────────────────────────────────────────
// Data extraction helpers
// ─────────────────────────────────────────────

async function extractData(page, url) {
  return page.evaluate((pageUrl) => {
    const getMeta = (...names) => {
      for (const name of names) {
        const el =
          document.querySelector(`meta[name="${name}"]`) ||
          document.querySelector(`meta[property="${name}"]`);
        if (el?.content) return el.content;
      }
      return "";
    };

    const headings = [];
    for (const tag of ["h1", "h2", "h3"]) {
      document.querySelectorAll(tag).forEach((el) => {
        if (headings.length < 5 && el.textContent?.trim()) {
          headings.push({ tag, text: el.textContent.trim().slice(0, 200) });
        }
      });
    }

    const links = [];
    document.querySelectorAll("a[href]").forEach((el) => {
      if (links.length < 50) {
        const href = el.href;
        if (href?.startsWith("http")) {
          links.push({ text: el.textContent?.trim().slice(0, 120) || "", href });
        }
      }
    });

    const images = [];
    document.querySelectorAll("img[src]").forEach((el) => {
      if (images.length < 10 && el.src?.startsWith("http")) {
        images.push(el.src);
      }
    });

    const favicon =
      document.querySelector("link[rel~='icon']")?.href ||
      document.querySelector("link[rel~='shortcut icon']")?.href ||
      new URL("/favicon.ico", pageUrl).href;

    const bodyText = document.body?.innerText?.replace(/\s+/g, " ").trim().slice(0, 500) || "";

    return {
      title: document.title || "",
      description: getMeta("description", "og:description", "twitter:description"),
      keywords: getMeta("keywords"),
      headings,
      textSnippet: bodyText,
      links,
      images,
      favicon,
    };
  }, url);
}

// ─────────────────────────────────────────────
// Main worker loop
// ─────────────────────────────────────────────

async function runWorker() {
  log("info", `Starting worker`, `id=${WORKER_ID} api=${BASE_URL}`);

  const browser = await chromium.launch({ headless: true });
  log("ok", "Browser launched");

  let consecutiveErrors = 0;

  while (true) {
    let job = null;

    try {
      const { status, data } = await api.get("/api/job");

      if (status === 204 || !data?.id) {
        log("warn", "Queue empty — waiting…");
        await sleep(IDLE_WAIT_SEC);
        consecutiveErrors = 0;
        continue;
      }

      job = data;
      log("info", `Processing job`, `id=${job.id} url=${job.url} priority=${job.priority || "normal"}`);

      const result = await Promise.race([
        processJob(browser, job.url),
        sleep(JOB_TIMEOUT_MS / 1000).then(() => { throw new Error(`Job timed out after ${JOB_TIMEOUT_MS}ms`); }),
      ]);

      await api.post("/api/result", { id: job.id, data: result, workerId: WORKER_ID });
      log("ok", `Completed job`, `id=${job.id} title="${result.title}"`);
      consecutiveErrors = 0;

    } catch (err) {
      consecutiveErrors++;
      const msg = err?.response?.data?.error || err.message || "Unknown error";

      if (job?.id) {
        try {
          await api.post("/api/fail", { id: job.id, error: msg, workerId: WORKER_ID });
        } catch (failErr) {
          log("error", "Could not report failure", failErr.message);
        }
      }

      log("error", `Error${job ? ` on job ${job.id}` : ""}`, msg);

      const backoff = Math.min(consecutiveErrors * 2, 30);
      if (consecutiveErrors > 3) {
        log("warn", `Backing off ${backoff}s due to repeated errors`);
        await sleep(backoff);
      }
    }

    await sleep(BETWEEN_JOBS_SEC);
  }
}

async function processJob(browser, url) {
  const start = Date.now();
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (compatible; ScraperCloud-Worker/1.0; +https://scrapercloud.io)",
  });
  const page = await context.newPage();

  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });

    const statusCode = response?.status() ?? 0;
    const finalUrl = page.url();
    const loadTime = Date.now() - start;

    const data = await extractData(page, finalUrl);

    return {
      ...data,
      url: finalUrl,
      loadTime,
      statusCode,
      scrapedAt: new Date().toISOString(),
      workerMode: "playwright",
    };
  } finally {
    await context.close();
  }
}

runWorker().catch((err) => {
  console.error("[FATAL] Worker crashed:", err);
  process.exit(1);
});
