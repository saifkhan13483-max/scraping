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
- Submit URLs for browser automation
- Per-user job isolation — users only see their own jobs
- Job states: `pending → processing → completed / failed`
- Auto-refreshing dashboard (every 3 seconds)
- Job retry, delete, and detail view

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
| POST | /api/job | Submit a new job (quota enforced) |
| GET | /api/job | Worker: fetch next pending job |
| GET | /api/jobs | List user's jobs |
| GET | /api/jobs/:id | Get a specific job |
| POST | /api/result | Worker submits result |
| POST | /api/fail | Mark job as failed |
| POST | /api/retry | Retry a failed job |
| DELETE | /api/jobs/:id | Delete a job |

## Project Structure

```
server/
  index.ts       - Express server entry point (session middleware)
  routes.ts      - All API route handlers
  storage.ts     - Redis (jobs) + PostgreSQL (users/subscriptions/keys)
  db.ts          - Drizzle PostgreSQL connection
  auth.ts        - Auth middleware (requireAuth, resolveUser)
  redis.ts       - Redis client
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

## Running Locally

```bash
npm run dev
```

The app starts on port 5000. Requires `REDIS_URL` and `DATABASE_URL` environment variables.

## Worker Integration

Workers authenticate via the `x-api-key` header:

1. `GET /api/job` — poll for next pending job (returns 204 if none)
2. Process the job with a Playwright browser
3. `POST /api/result` with `{ id, data }` on success
4. `POST /api/fail` with `{ id, error }` on failure
