# ScraperCloud — SaaS Web Scraping Platform

A full-stack SaaS browser automation job queue system with multi-user authentication, subscription plans, and API key management.

## Architecture

- **Frontend**: React + TypeScript + Vite + TailwindCSS + shadcn/ui
- **Backend**: Express.js (TypeScript)
- **Job Queue**: Redis (via ioredis) — atomic job handoff with RPOPLPUSH
- **User Data**: PostgreSQL via Drizzle ORM (users, subscriptions, API keys)
- **Auth**: Session-based (express-session + connect-pg-simple)
- **Routing**: wouter (client-side)
- **Data Fetching**: TanStack Query v5

## Features

### SaaS / Auth
- User registration and login with bcrypt password hashing
- Session-based authentication (30-day sessions)
- API key management (workers can authenticate via `x-api-key` header)

### Subscription Plans
- **Free**: 50 jobs/month
- **Pro** ($29/mo): 500 jobs/month
- **Business** ($99/mo): Unlimited jobs/month
- Monthly usage tracking with automatic reset
- Real-time quota meter on the dashboard

### Job Queue
- Submit URLs for scraping — no browser or Playwright required
- Server-side HTTP scraper (`server/scraper.ts`) runs directly inside Express, fully compatible with Vercel serverless functions
- Jobs are auto-triggered after creation via fire-and-forget `POST /api/jobs/process` — no external worker needed
- Per-user job isolation — users only see their own jobs
- Job states: `pending → processing → completed / failed`
- Auto-refreshing dashboard (every 3 seconds)
- Job retry, delete, and detail view

### What the scraper extracts
- Page title, meta description, keywords (+ Open Graph / Twitter variants)
- Top 5 headings (h1–h3)
- 500-character text snippet (scripts/styles stripped)
- Up to 50 links with anchor text
- Up to 10 image URLs
- Favicon URL
- Final resolved URL (after redirects)
- HTTP status code + load time (ms)
- Timestamp

## Pages

| Route | Description |
|-------|-------------|
| `/` | Landing page with features + pricing |
| `/auth` | Login / Register |
| `/dashboard` | Job management dashboard (protected) |
| `/subscription` | Plan management + usage meter (protected) |
| `/api-keys` | API key CRUD (protected) |

## API Endpoints

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/register | Create account |
| POST | /api/auth/login | Login |
| POST | /api/auth/logout | Logout |
| GET | /api/auth/me | Get current user + subscription |

### Subscription
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/subscription | Get subscription details |
| POST | /api/subscription/upgrade | Change plan |

### API Keys
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/keys | List API keys (masked) |
| POST | /api/keys | Create API key |
| DELETE | /api/keys/:id | Delete API key |

### Jobs (require auth via session or x-api-key header)
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/job | Submit a new job (quota enforced; auto-triggers processing) |
| GET | /api/job | Worker: fetch next pending job (legacy/external workers) |
| POST | /api/jobs/process | In-server scraper: pick up and process one pending job |
| GET | /api/jobs | List user's jobs |
| GET | /api/jobs/:id | Get a specific job |
| POST | /api/result | External worker: submit result |
| POST | /api/fail | External worker: mark job as failed |
| POST | /api/retry | Retry a failed job |
| DELETE | /api/jobs/:id | Delete a job |

## Project Structure

```
server/
  index.ts       - Express server entry point (session middleware)
  routes.ts      - All API route handlers
  storage.ts     - Redis (jobs) + PostgreSQL (users/subscriptions/keys)
  scraper.ts     - HTTP-based HTML scraper (no Playwright, Vercel-compatible)
  db.ts          - Drizzle PostgreSQL connection
  auth.ts        - Auth middleware (requireAuth, resolveUser)
  redis.ts       - Redis client with in-memory fallback
  vite.ts        - Vite dev server integration
shared/
  schema.ts      - DB schemas, Zod schemas, TypeScript types, plan config
client/
  src/
    App.tsx                       - Root app + route protection
    hooks/use-auth.ts             - Auth state hook
    components/app-layout.tsx     - Sidebar layout for authenticated pages
    pages/landing.tsx             - Marketing/pricing page
    pages/auth.tsx                - Login/register
    pages/dashboard.tsx           - Job queue dashboard
    pages/subscription.tsx        - Subscription management
    pages/api-keys.tsx            - API key management
    index.css                     - Tailwind + CSS variables
```

## Security Notes

- Emails are normalized (lowercased + trimmed) on both registration and login, ensuring consistent lookups
- API key authentication sets a request-scoped `resolvedUserId` without modifying the session, preventing unnecessary session persistence
- Job ownership is verified on all mutating operations (retry, delete) — users can only modify their own jobs
- URL format is validated both client-side (Zod schema) and server-side before job creation
- API key creation is restricted to Pro and Business plans — enforced on both frontend and backend
- `createUser` wraps user + subscription creation in a single PostgreSQL transaction to prevent orphan records
- `incrementJobUsage` uses an atomic SQL increment (`col + 1`) instead of read-modify-write to prevent race conditions under concurrent load

## Running Locally

```bash
npm run dev
```

The app starts on port 5000. Requires `REDIS_URL` and `DATABASE_URL` environment variables.

## Split Deployment: Vercel (frontend) + Railway (backend)

The project is configured for a split deployment where the React frontend runs on Vercel as a static site and the Express backend runs on Railway as a persistent Node.js server.

### Frontend → Vercel

`vercel.json` configures a pure static site deployment:
- Build command: `npx vite build` (builds only the React/Vite frontend)
- Output directory: `dist/public/`
- All routes rewrite to `index.html` for SPA navigation

**Environment variables to set in Vercel:**
| Variable | Value |
|----------|-------|
| `VITE_API_URL` | Your Railway backend URL (e.g. `https://scrapercloud.up.railway.app`) |

### Backend → Railway

`railway.toml` configures the Railway deployment:
- Build command: `npm run build` (builds frontend + backend bundles)
- Start command: `npm start` (`node dist/index.cjs`)
- Health check: `GET /api/auth/me`

**Environment variables to set in Railway:**
| Variable | Value |
|----------|-------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis URL (e.g. `rediss://...@upstash.io:6379`) |
| `SESSION_SECRET` | Long random string for session signing |
| `CORS_ORIGIN` | Your Vercel frontend URL (e.g. `https://scrapercloud.vercel.app`) |
| `NODE_ENV` | `production` |

### How cross-origin auth works

When `CORS_ORIGIN` is set, the backend automatically:
- Enables CORS with `credentials: true` for the specified Vercel origin
- Sets session cookies with `sameSite: "none"` (required for cross-origin cookies)
- Sets `secure: true` (required alongside `sameSite: "none"`)

The frontend automatically prefixes all API calls with `VITE_API_URL` when set, sending them to Railway instead of relative paths.

### Local development

Local dev is unchanged — run `npm run dev`. No env vars needed; API calls use relative paths and CORS uses localhost origins.

## Job Processing Architecture

### In-Server (default, Vercel-compatible)
Jobs are processed in-server without any external worker:
1. User submits a URL via `POST /api/job`
2. Server creates a job record in Redis with status `pending`
3. Server fires a background `POST /api/jobs/process` (fire-and-forget)
4. The process endpoint calls `storage.getNextPendingJob()`, runs `scrapeUrl()`, and calls `storage.completeJob()` or `storage.failJob()`

### External Workers (optional, legacy)
Workers can also integrate via the `x-api-key` header:
1. `GET /api/job` — poll for next pending job (returns 204 if none)
2. Process the job externally (e.g. Playwright)
3. `POST /api/result` with `{ id, data }` on success
4. `POST /api/fail` with `{ id, error }` on failure
