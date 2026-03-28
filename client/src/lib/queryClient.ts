import { QueryClient, QueryFunction, QueryCache } from "@tanstack/react-query";

// When the frontend (Vercel) and backend (Railway) are on different domains,
// set VITE_API_URL in Vercel to your Railway backend URL (e.g. https://scrapercloud.up.railway.app).
// In local dev and monorepo deployments, leave it unset — relative paths are used.
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    // 405 from Vercel's static host means VITE_API_URL is not set — the browser
    // is POSTing to Vercel itself (which only serves static files) instead of the
    // Railway backend. Serve a clear actionable message instead of the raw "405:".
    if (res.status === 405 && !import.meta.env.VITE_API_URL) {
      console.error(
        "[API] 405 on", res.url,
        "— VITE_API_URL is not set. Add it in Vercel → Settings → Environment Variables, pointing to your Railway backend URL."
      );
      throw new Error(
        "Cannot reach the API server. If this is deployed on Vercel, set the VITE_API_URL environment variable to your Railway backend URL and redeploy."
      );
    }
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
  // Detect when Vercel (or any static host) returns HTML instead of JSON for
  // an API route. This happens when VITE_API_URL is not set and Vercel's SPA
  // catch-all rewrite intercepts /api/* requests, serving index.html (200 OK).
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    console.error(
      "[API] HTML response received for", res.url,
      "— VITE_API_URL is likely not set on Vercel. Set it to your Railway backend URL."
    );
    throw new Error(
      "Cannot reach the API server. If this is deployed on Vercel, set the VITE_API_URL environment variable to your Railway backend URL and redeploy."
    );
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
