/**
 * AI Insights Module
 *
 * Generates a summary, key insights, and category from scraped page data.
 * Uses OpenAI if OPENAI_API_KEY is set; otherwise produces mock insights
 * from the scraped content so the feature always works.
 */

import type { ScrapeResult } from "./scraper";

export interface AiInsights {
  summary: string;
  insights: string[];
  category: string;
}

// ─── Category detection from content ─────────────────────────────────────────

function detectCategory(result: ScrapeResult): string {
  const text = (result.title + " " + result.description + " " + result.textSnippet).toLowerCase();
  if (/shop|cart|buy|price|product|checkout|add to bag|ecommerce|store/i.test(text)) return "E-commerce";
  if (/blog|article|post|author|published|read more|subscribe/i.test(text)) return "Blog / Article";
  if (/news|breaking|report|journalist|editorial|press/i.test(text)) return "News";
  if (/docs|documentation|api|reference|sdk|guide|getting started/i.test(text)) return "Documentation";
  if (/portfolio|about me|resume|cv|hire me|freelance/i.test(text)) return "Portfolio";
  if (/saas|sign up|pricing|free trial|dashboard|software/i.test(text)) return "SaaS / Landing Page";
  if (/university|course|learn|education|tutorial|lesson/i.test(text)) return "Education";
  if (/github|gitlab|repository|open source|commit|pull request/i.test(text)) return "Code Repository";
  if (/forum|community|discussion|thread|reply|upvote/i.test(text)) return "Community / Forum";
  return "Landing Page";
}

// ─── Mock insights from scraped content ──────────────────────────────────────

function mockInsights(result: ScrapeResult): AiInsights {
  const category = detectCategory(result);
  const title = result.title || result.url;

  const summary = result.description
    ? `${title} — ${result.description.slice(0, 180)}${result.description.length > 180 ? "…" : ""}`
    : `This page at ${result.url} appears to be a ${category.toLowerCase()} page. The page loaded in ${result.loadTime}ms with HTTP ${result.statusCode}.`;

  const insights: string[] = [];

  if (result.title) insights.push(`Page title: "${result.title}"`);
  if (result.description) insights.push(`Meta description is present and describes the page content`);
  else insights.push(`No meta description found — consider adding one for better SEO`);

  if (result.headings.length > 0) {
    insights.push(`Found ${result.headings.length} heading(s) — top heading: "${result.headings[0].text}"`);
  }
  if (result.links.length > 0) {
    insights.push(`Contains ${result.links.length} link(s) — page appears to have rich navigation or content`);
  }
  if (result.images.length > 0) {
    insights.push(`${result.images.length} image(s) found on the page`);
  }
  if (result.keywords) {
    insights.push(`Keywords: ${result.keywords.slice(0, 100)}`);
  }
  if (result.loadTime < 500) {
    insights.push(`Excellent load time of ${result.loadTime}ms`);
  } else if (result.loadTime < 2000) {
    insights.push(`Good load time of ${result.loadTime}ms`);
  } else {
    insights.push(`Slow load time of ${result.loadTime}ms — may indicate server-side rendering or large assets`);
  }

  return { summary, insights: insights.slice(0, 5), category };
}

// ─── OpenAI-powered insights ──────────────────────────────────────────────────

async function openAiInsights(result: ScrapeResult): Promise<AiInsights> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return mockInsights(result);

  const content = [
    `URL: ${result.url}`,
    `Title: ${result.title}`,
    `Description: ${result.description}`,
    `Keywords: ${result.keywords}`,
    `Headings: ${result.headings.map((h) => h.text).join(", ")}`,
    `Text snippet: ${result.textSnippet.slice(0, 400)}`,
  ].join("\n");

  const prompt = `Analyze the following scraped web page data and respond ONLY with a valid JSON object (no markdown, no extra text).

Page data:
${content}

Respond with exactly this JSON structure:
{
  "summary": "A concise 2-3 sentence summary of the page",
  "insights": ["insight 1", "insight 2", "insight 3", "insight 4", "insight 5"],
  "category": "One of: E-commerce, Blog / Article, News, Documentation, Portfolio, SaaS / Landing Page, Education, Code Repository, Community / Forum, Landing Page"
}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);

    const data = await response.json() as any;
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = JSON.parse(text) as AiInsights;

    if (!parsed.summary || !Array.isArray(parsed.insights) || !parsed.category) {
      throw new Error("Invalid AI response shape");
    }

    return parsed;
  } catch (err) {
    console.warn("[AI] OpenAI failed, falling back to mock:", (err as Error).message);
    return mockInsights(result);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function generateInsights(result: ScrapeResult): Promise<AiInsights> {
  if (process.env.OPENAI_API_KEY) {
    return openAiInsights(result);
  }
  return mockInsights(result);
}
