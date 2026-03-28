import { QueryClient, QueryFunction, QueryCache } from "@tanstack/react-query";

// When the frontend (Vercel) and backend (Railway) are on different domains,
// set VITE_API_URL in Vercel to your Railway backend URL (e.g. https://scrapercloud.up.railway.app).
// In local dev and monorepo deployments, leave it unset — relative paths are used.
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
  // Detect when Vercel (or any static host) returns HTML for an API route.
  // This happens when VITE_API_URL is not set and the SPA catch-all rewrite
  // intercepts /api/* requests, returning index.html with status 200.
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    throw new Error(
      "500: Server returned HTML instead of JSON — the API base URL is not configured correctly"
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
