# Browser Automation Worker

Runs on your **local machine**. Polls the job queue API and processes each URL using Playwright (Chromium).

---

## Setup

### 1. Install dependencies

```bash
cd worker
npm install
```

### 2. Install the Chromium browser

```bash
npm run install-browsers
```

### 3. Configure the API URL

By default the worker points to `http://localhost:5000`.

To point it at your deployed server, set the `API_URL` environment variable:

```bash
# macOS / Linux
export API_URL=https://your-deployed-app.replit.app

# Windows (PowerShell)
$env:API_URL="https://your-deployed-app.replit.app"
```

Or just edit the `BASE_URL` line at the top of `worker.js` directly.

---

## Run

```bash
npm start
```

The worker will:
- Connect to the API and confirm it's reachable
- Poll every 4 seconds when the queue is empty
- Open a visible browser window for each job
- Report the title + all links back to the API on success
- Report the error message back to the API on failure
- Close the browser after every job

Press **Ctrl+C** to stop.

---

## Options (in worker.js)

| Constant | Default | Description |
|---|---|---|
| `BASE_URL` | `http://localhost:5000` | Your backend API URL |
| `IDLE_WAIT_SEC` | `4` | Seconds to wait when queue is empty |
| `BETWEEN_JOBS_SEC` | `1` | Seconds to pause between jobs |
| `headless` | `false` | Set `true` to run browser invisibly |

---

## Example Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Browser Automation Worker
  API: http://localhost:5000
  Press Ctrl+C to stop
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

11:30:01 [DONE]  Connected to API at http://localhost:5000
11:30:04 [WAIT]  Queue is empty — waiting 4s…
11:30:08 [INFO]  Job received  id=3f2a1c9b…  url=https://example.com
11:30:08 [INFO]  Launching browser…
11:30:09 [INFO]  Navigating to https://example.com
11:30:10 [INFO]  Title: "Example Domain"
11:30:10 [INFO]  Found 1 links
11:30:10 [DONE]  Completed  id=3f2a1c9b…  "Example Domain"
11:30:10 [INFO]  Browser closed
```
