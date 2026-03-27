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
  const prefix =
    level === "info"  ? "\x1b[36m[INFO]\x1b[0m"  :
    level === "ok"    ? "\x1b[32m[DONE]\x1b[0m"  :
    level === "warn"  ? "\x1b[33m[WAIT]\x1b[0m"  :
    level === "error" ? "\x1b[31m[FAIL]\x1b[0m"  :
                        "[LOG] ";
  console.log(`${time} ${prefix} ${message}${extra ? "  " + extra : ""}`);
}

/**
 * Wraps a promise with a hard timeout.
 * Rejects with a TimeoutError if the promise does not resolve in time.
 */
function withTimeout(promise, ms, label = "Operation") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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
// Core: extract structured data from the page
// ─────────────────────────────────────────────

async function extractPageData(page, targetUrl) {
  // ── SEO: title, description, keywords ──
  const title = await page.title();

  const description = await page.$eval(
    'meta[name="description"], meta[property="og:description"]',
    (el) => el.getAttribute("content") || "",
  ).catch(() => "");

  const keywords = await page.$eval(
    'meta[name="keywords"]',
    (el) => el.getAttribute("content") || "",
  ).catch(() => "");

  // ── Content: first 5 headings (h1, h2, h3) ──
  const headings = await page.$$eval("h1, h2, h3", (els) =>
    els
      .slice(0, 5)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: el.innerText.trim().slice(0, 200),
      }))
      .filter((h) => h.text.length > 0)
  );

  // ── Content: main visible text snippet (~500 chars) ──
  const textSnippet = await page.evaluate(() => {
    const selectors = ["main", "article", '[role="main"]', "body"];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = (el.innerText || "").replace(/\s+/g, " ").trim();
        if (text.length > 50) return text.slice(0, 500);
      }
    }
    return "";
  });

  // ── Links (up to 50) ──
  const links = await page.$$eval("a[href]", (anchors) =>
    anchors
      .map((a) => ({
        text: a.innerText.trim().slice(0, 120),
        href: a.href,
      }))
      .filter((l) => l.href.startsWith("http"))
      .slice(0, 50)
  );

  // ── Media: image URLs (limit 10) ──
  const images = await page.$$eval("img[src]", (imgs) =>
    imgs
      .map((img) => img.src)
      .filter((src) => src.startsWith("http"))
      .slice(0, 10)
  );

  // ── Media: favicon ──
  const favicon = await page.evaluate(() => {
    const selectors = [
      'link[rel="icon"]',
      'link[rel="shortcut icon"]',
      'link[rel="apple-touch-icon"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el?.href) return el.href;
    }
    // Fallback to /favicon.ico
    try {
      return new URL("/favicon.ico", location.origin).href;
    } catch {
      return null;
    }
  });

  // ── Page URL (after any redirects) ──
  const url = page.url();

  return {
    title,
    description,
    keywords,
    headings,
    textSnippet,
    links,
    images,
    favicon,
    url,
  };
}

// ─────────────────────────────────────────────
// Core: process one job with Playwright
// ─────────────────────────────────────────────

async function processJob(job) {
  log("info", `Job received  id=${job.id.slice(0, 8)}…  url=${job.url}`);
  log("info", "Launching browser…");

  const browser = await chromium.launch({
    headless: false,    // Set true to run silently in background
    slowMo: 50,         // Slight slow-down so you can watch it work
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

    const navStart = Date.now();

    // Navigate with a timeout — treat navigation errors as a recoverable failure
    await page.goto(job.url, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });

    const loadTime = Date.now() - navStart;
    log("info", `Page loaded in ${loadTime}ms`);

    // Extract all structured data, with a hard outer timeout
    const extracted = await withTimeout(
      extractPageData(page, job.url),
      JOB_TIMEOUT_MS - loadTime,
      "Data extraction",
    );

    // ── Log a clear summary ──
    log("info", `Title:       "${extracted.title}"`);
    log("info", `Description: "${extracted.description.slice(0, 80)}${extracted.description.length > 80 ? "…" : ""}"`);
    log("info", `Headings:    ${extracted.headings.length} found  ${extracted.headings.map((h) => `[${h.tag}] ${h.text.slice(0, 40)}`).join(" | ")}`);
    log("info", `Links:       ${extracted.links.length} found`);
    log("info", `Images:      ${extracted.images.length} found`);
    log("info", `Favicon:     ${extracted.favicon || "none"}`);
    log("info", `Load time:   ${loadTime}ms`);

    // ── Report success ──
    await api.post("/api/result", {
      id: job.id,
      data: {
        title:       extracted.title,
        description: extracted.description,
        keywords:    extracted.keywords,
        headings:    extracted.headings,
        textSnippet: extracted.textSnippet,
        links:       extracted.links,
        images:      extracted.images,
        favicon:     extracted.favicon,
        url:         extracted.url,
        loadTime,
        scrapedAt:   new Date().toISOString(),
      },
    });

    log("ok", `Completed  id=${job.id.slice(0, 8)}…  "${extracted.title}"`);

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

  // Quick connectivity check (uses the public /api/job endpoint — no auth required)
  try {
    await api.get("/api/job", { validateStatus: (s) => s === 200 || s === 204 });
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
