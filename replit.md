# Job Queue Manager

A production-ready browser automation job queue system with a full-stack dashboard.

## Architecture

- **Frontend**: React + TypeScript + Vite + TailwindCSS + shadcn/ui
- **Backend**: Express.js (TypeScript) with in-memory job storage
- **Routing**: wouter (client-side)
- **Data Fetching**: TanStack Query v5

## Features

- Submit URLs as browser automation jobs
- In-memory job queue with status tracking: `pending → processing → completed / failed`
- Auto-refreshing dashboard (every 3 seconds)
- Job retry mechanism for failed jobs
- Delete jobs
- View full job results and error details in a detail dialog
- API reference panel built into the UI

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/job | Submit a new job |
| GET | /api/job | Worker: fetch next pending job |
| GET | /api/jobs | List all jobs |
| GET | /api/jobs/:id | Get a specific job |
| POST | /api/result | Worker submits result |
| POST | /api/fail | Mark job as failed |
| POST | /api/retry | Retry a failed job |
| DELETE | /api/jobs/:id | Delete a job |

## Project Structure

```
server/
  index.ts       - Express server entry point
  routes.ts      - All API route handlers
  storage.ts     - In-memory storage (IStorage interface + MemStorage)
  vite.ts        - Vite dev server integration
shared/
  schema.ts      - Zod schemas and TypeScript types
client/
  src/
    App.tsx              - Root app component with routing
    pages/dashboard.tsx  - Main job queue dashboard
    index.css            - Tailwind + CSS variables (light/dark theme)
```

## Running Locally

```bash
npm run dev
```

The app starts on port 5000.

## Worker Integration

Workers (e.g., Playwright scripts on local machines) interact via:

1. `GET /api/job` — poll for the next pending job (returns 204 if none)
2. Process the job
3. `POST /api/result` with `{ id, data }` on success
4. `POST /api/fail` with `{ id, error }` on failure
