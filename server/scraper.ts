/**
 * Lightweight HTTP-based scraper (no Playwright / no browser required).
 * Uses native fetch + regex extraction — runs on Vercel serverless functions.
 */

const USER_AGENT =
  "Mozilla/5.0 (compatible; ScraperCloud/1.0; +https://scrapercloud.io)";

export interface ScrapeResult {
  title: string;
  description: string;
  keywords: string;
  headings: { tag: string; text: string }[];
  textSnippet: string;
  links: { text: string; href: string }[];
  images: string[];
  favicon: string | null;
  url: string;
  loadTime: number;
  statusCode: number;
  scrapedAt: string;
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#?\w+;/g, " ");
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(stripTags(m[1])).trim() : "";
}

function extractMeta(html: string, ...names: string[]): string {
  for (const name of names) {
    // Try content first then name/property order
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*?)["'][^>]*>`,
        "i"
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']*?)["'][^>]+(?:name|property)=["']${name}["'][^>]*>`,
        "i"
      ),
    ];
    for (const pat of patterns) {
      const m = html.match(pat);
      if (m?.[1]) return decodeEntities(m[1].trim());
    }
  }
  return "";
}

function extractHeadings(
  html: string
): { tag: string; text: string }[] {
  const results: { tag: string; text: string }[] = [];
  const re = /<(h[1-3])[^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && results.length < 5) {
    const text = decodeEntities(stripTags(m[2])).slice(0, 200);
    if (text.length > 1) results.push({ tag: m[1].toLowerCase(), text });
  }
  return results;
}

function extractLinks(
  html: string,
  baseUrl: string
): { text: string; href: string }[] {
  const results: { text: string; href: string }[] = [];
  const re = /<a[^>]+href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && results.length < 50) {
    const rawHref = m[1].trim();
    if (!rawHref || rawHref.startsWith("javascript:") || rawHref.startsWith("mailto:")) continue;
    let href: string;
    try {
      href = new URL(rawHref, baseUrl).href;
      if (!href.startsWith("http")) continue;
    } catch {
      continue;
    }
    const text = decodeEntities(stripTags(m[2])).slice(0, 120).trim();
    results.push({ text, href });
  }
  return results;
}

function extractImages(html: string, baseUrl: string): string[] {
  const results: string[] = [];
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && results.length < 10) {
    const src = m[1].trim();
    if (!src || src.startsWith("data:")) continue;
    try {
      const full = new URL(src, baseUrl).href;
      if (full.startsWith("http")) results.push(full);
    } catch { /* skip */ }
  }
  return results;
}

function extractFavicon(html: string, baseUrl: string): string | null {
  const patterns = [
    /rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i,
    /href=["']([^"']+)["'][^>]+rel=["'](?:shortcut )?icon["']/i,
    /rel=["']apple-touch-icon(?:-precomposed)?["'][^>]+href=["']([^"']+)["']/i,
    /href=["']([^"']+)["'][^>]+rel=["']apple-touch-icon(?:-precomposed)?["']/i,
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m?.[1]) {
      try { return new URL(m[1].trim(), baseUrl).href; } catch { /* skip */ }
    }
  }
  try { return new URL("/favicon.ico", baseUrl).href; } catch { return null; }
}

function extractTextSnippet(html: string): string {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  return decodeEntities(cleaned).trim().slice(0, 500);
}

// ─── Main scrape function ─────────────────────────────────────────────────────

export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  const start = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
      redirect: "follow",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const loadTime = Date.now() - start;

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get("content-type") || "";
  const finalUrl = res.url || url;

  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    return {
      title: "",
      description: "",
      keywords: "",
      headings: [],
      textSnippet: `Non-HTML content (${contentType})`,
      links: [],
      images: [],
      favicon: null,
      url: finalUrl,
      loadTime,
      statusCode: res.status,
      scrapedAt: new Date().toISOString(),
    };
  }

  const html = await res.text();

  return {
    title: extractTitle(html),
    description: extractMeta(html, "description", "og:description", "twitter:description"),
    keywords: extractMeta(html, "keywords"),
    headings: extractHeadings(html),
    textSnippet: extractTextSnippet(html),
    links: extractLinks(html, finalUrl),
    images: extractImages(html, finalUrl),
    favicon: extractFavicon(html, finalUrl),
    url: finalUrl,
    loadTime,
    statusCode: res.status,
    scrapedAt: new Date().toISOString(),
  };
}
