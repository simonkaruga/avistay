/**
 * The one way to call the NaivaStay API — website and mobile app.
 *
 * - Website: same-origin `/api/...` with httpOnly cookies.
 * - App: `${VITE_API_URL}/api/...` with a Bearer token from secure storage.
 * - Both: an expired session (401) is refreshed once and the request retried,
 *   so people aren't logged out every 15 minutes. Parallel 401s share one refresh.
 */
import { isNativeApp } from "../native/platform";
import { clearTokens, getAccessToken, getRefreshToken, saveTokens } from "../native/tokenStore";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Absolute server origin for the app build; empty on the website (same origin). */
export const API_ORIGIN = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

/** Full URL for an API path — also for links like iCal exports. */
export const apiUrl = (path: string) => `${API_ORIGIN}/api${path}`;

// Responses that start a session: the app must keep the tokens they carry.
const SESSION_PATHS = ["/auth/otp/verify", "/auth/email/login", "/auth/email/register", "/auth/refresh"];
const NO_RETRY_PATHS = ["/auth/refresh", "/auth/logout", ...SESSION_PATHS];

async function send(path: string, opts: RequestInit): Promise<Response> {
  const headers = new Headers(opts.headers);
  if (isNativeApp) {
    headers.set("X-Client", "native");
    const token = await getAccessToken();
    if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(apiUrl(path), { credentials: "include", ...opts, headers });
  if (isNativeApp && res.ok && SESSION_PATHS.some(p => path.startsWith(p))) {
    const body = await res.clone().json().catch(() => null);
    if (body?.access_token && body?.refresh_token) await saveTokens(body.access_token, body.refresh_token);
  }
  return res;
}

let refreshing: Promise<boolean> | null = null;

/** One refresh at a time; resolves true if the session was renewed. */
function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      let body: string | undefined;
      if (isNativeApp) {
        const refresh = await getRefreshToken();
        if (!refresh) return false;
        body = JSON.stringify({ refresh_token: refresh });
      }
      const res = await send("/auth/refresh", {
        method: "POST", body, headers: body ? { "Content-Type": "application/json" } : undefined,
      });
      if (!res.ok && isNativeApp) await clearTokens();
      return res.ok;
    } catch {
      return false;
    } finally {
      setTimeout(() => { refreshing = null; }, 0);
    }
  })();
  return refreshing;
}

export async function api(path: string, opts: RequestInit = {}): Promise<Response> {
  const res = await send(path, opts);
  if (res.status !== 401 || NO_RETRY_PATHS.some(p => path.startsWith(p))) return res;
  // Bodies like FormData/strings can be resent; streams can't (we never send those).
  return (await refreshSession()) ? send(path, opts) : res;
}

/** JSON request that throws ApiError with the server's `detail` message. */
export async function apiJson<T>(path: string, opts: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = opts;
  let res: Response;
  try {
    res = await api(path, {
      ...rest,
      headers: json !== undefined ? { "Content-Type": "application/json", ...(headers as Record<string, string>) } : headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError(0, "Network error. Check your connection and try again");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = typeof body.detail === "string" ? body.detail
      : Array.isArray(body.detail) ? "Please check the form and try again"
      : "Something went wrong. Please try again";
    throw new ApiError(res.status, detail);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

/** Sign out this device (and only this device). */
export async function logout(): Promise<void> {
  const refresh = isNativeApp ? await getRefreshToken() : null;
  await send("/auth/logout", {
    method: "POST",
    body: refresh ? JSON.stringify({ refresh_token: refresh }) : undefined,
    headers: refresh ? { "Content-Type": "application/json" } : undefined,
  }).catch(() => {});
  if (isNativeApp) await clearTokens();
  // Trips and check-in codes saved for offline use belong to this person only.
  if (typeof caches !== "undefined") await caches.delete("my-bookings").catch(() => false);
}
