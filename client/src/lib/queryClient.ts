import { QueryClient, QueryFunction, QueryCache } from "@tanstack/react-query";

// When the frontend (Vercel) and backend (Railway) are on different domains,
// set VITE_API_URL in Vercel to your Railway backend URL (e.g. https://scrapercloud.up.railway.app).
// In local dev and monorepo deployments, leave it unset — relative paths are used.
// Strip trailing slash to prevent double-slash URLs like https://api.example.com//api/login
const rawApiUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
const API_BASE = rawApiUrl.replace(/\/+$/, "");

async function throwIfResNotOk(res: Response) {
  // Check for HTML response first (before checking res.ok) because the Railway
  // SPA catch-all can return index.html with a 200 OK status, which looks
  // "successful" but is not a valid API response.
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    const apiUrl = import.meta.env.VITE_API_URL;
    console.error(
      "[API] HTML response received for", res.url,
      `— The backend returned an HTML page instead of JSON. This usually means the API route is not registered on the server. ` +
      (apiUrl
        ? `VITE_API_URL is "${apiUrl}". Make sure the latest backend code is deployed on Railway.`
        : "VITE_API_URL is not set — set it in Vercel to your Railway backend URL and redeploy.")
    );
    throw new Error(
      apiUrl
        ? "The API server returned an HTML page instead of JSON. The backend code on Railway may be outdated — redeploy Railway with the latest code and try again."
        : "Cannot reach the API server. Set the VITE_API_URL environment variable in Vercel to your Railway backend URL, then redeploy."
    );
  }

  if (!res.ok) {
    // 405 Method Not Allowed — most common causes:
    //  1. VITE_API_URL is not set → browser POSTs to Vercel's static host (no backend)
    //  2. VITE_API_URL has a trailing slash → double-slash URL doesn't match any route
    //  3. VITE_API_URL points to the wrong Railway URL
    if (res.status === 405) {
      const apiUrl = import.meta.env.VITE_API_URL;
      if (!apiUrl) {
        console.error(
          "[API] 405 on", res.url,
          "— VITE_API_URL is not set. Add it in Vercel → Settings → Environment Variables, pointing to your Railway backend URL, then redeploy."
        );
        throw new Error(
          "Cannot reach the API server. Set the VITE_API_URL environment variable in Vercel to your Railway backend URL, then redeploy."
        );
      } else {
        console.error(
          "[API] 405 on", res.url,
          `— VITE_API_URL is set to "${apiUrl}". Check: (1) no trailing slash, (2) correct Railway domain, (3) CORS_ORIGIN on Railway matches your Vercel domain exactly.`
        );
        throw new Error(
          `API server returned 405. Verify VITE_API_URL ("${apiUrl}") has no trailing slash and matches your Railway backend URL. Also confirm CORS_ORIGIN on Railway is set to your Vercel domain (e.g. https://your-app.vercel.app).`
        );
      }
    }

    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey[0] as string}`, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      // Redirect to auth if any query gets a 401 (session expired)
      if (error instanceof Error && error.message.startsWith("401:")) {
        queryClient.clear();
        window.location.href = "/auth";
      }
    },
  }),
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
