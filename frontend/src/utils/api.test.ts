import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Toggle between website and app behaviour per test.
const platform = { native: false };
vi.mock("../native/platform", () => ({ get isNativeApp() { return platform.native; }, platform: "web" }));

const store = { access: null as string | null, refresh: null as string | null };
vi.mock("../native/tokenStore", () => ({
  getAccessToken: vi.fn(async () => store.access),
  getRefreshToken: vi.fn(async () => store.refresh),
  saveTokens: vi.fn(async (a: string, r: string) => { store.access = a; store.refresh = r; }),
  clearTokens: vi.fn(async () => { store.access = null; store.refresh = null; }),
}));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let calls: { url: string; init: RequestInit }[] = [];
let handler: (url: string, init: RequestInit) => Response;

beforeEach(() => {
  calls = [];
  platform.native = false;
  store.access = null; store.refresh = null;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return handler(url, init); }));
  vi.resetModules();
});
afterEach(() => { vi.unstubAllGlobals(); });

const load = () => import("./api");

describe("api: website", () => {
  it("renews an expired session once and retries, sharing one refresh across parallel calls", async () => {
    let session = "expired";
    handler = url => {
      if (url.endsWith("/auth/refresh")) { session = "fresh"; return json({ user_id: "u1" }); }
      return session === "fresh" ? json({ ok: true }) : json({ detail: "Not authenticated" }, 401);
    };
    const { apiJson } = await load();
    const results = await Promise.all([apiJson("/bookings/mine"), apiJson("/auth/me"), apiJson("/owner/dashboard")]);
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(calls.filter(c => c.url.endsWith("/auth/refresh"))).toHaveLength(1);
    expect(calls[0].url).toBe("/api/bookings/mine");          // same-origin on the web
    expect(calls[0].init.credentials).toBe("include");
  });

  it("gives up cleanly when the session can't be renewed", async () => {
    handler = () => json({ detail: "Not authenticated" }, 401);
    const { apiJson, ApiError } = await load();
    await expect(apiJson("/auth/me")).rejects.toBeInstanceOf(ApiError);
    expect(calls.map(c => c.url)).toEqual(["/api/auth/me", "/api/auth/refresh"]);
  });
});

describe("api: mobile app", () => {
  beforeEach(() => { platform.native = true; });

  it("stores tokens from sign-in and sends them as a Bearer token", async () => {
    handler = url => url.endsWith("/auth/email/login")
      ? json({ user_id: "u1", access_token: "A1", refresh_token: "R1" })
      : json({ user_id: "u1" });
    const { apiJson } = await load();
    await apiJson("/auth/email/login", { method: "POST", json: { email: "a@b.c", password: "x" } });
    expect(store).toEqual({ access: "A1", refresh: "R1" });

    await apiJson("/auth/me");
    const headers = new Headers(calls[1].init.headers);
    expect(headers.get("Authorization")).toBe("Bearer A1");
    expect(headers.get("X-Client")).toBe("native");
  });

  it("refreshes with the stored refresh token and rotates both tokens", async () => {
    store.access = "old"; store.refresh = "R1";
    handler = (url, init) => {
      if (url.endsWith("/auth/refresh")) {
        expect(JSON.parse(String(init.body))).toEqual({ refresh_token: "R1" });
        return json({ user_id: "u1", access_token: "A2", refresh_token: "R2" });
      }
      const auth = new Headers(init.headers).get("Authorization");
      return auth === "Bearer A2" ? json({ ok: true }) : json({ detail: "expired" }, 401);
    };
    const { apiJson } = await load();
    expect(await apiJson("/bookings/mine")).toEqual({ ok: true });
    expect(store).toEqual({ access: "A2", refresh: "R2" });
  });

  it("signs out locally when the refresh token is rejected", async () => {
    store.access = "old"; store.refresh = "revoked";
    handler = () => json({ detail: "Session expired" }, 401);
    const { api } = await load();
    expect((await api("/auth/me")).status).toBe(401);
    expect(store).toEqual({ access: null, refresh: null });
  });

  it("logout ends this device's session and forgets the tokens", async () => {
    store.access = "A1"; store.refresh = "R1";
    handler = () => new Response(null, { status: 204 });
    const { logout } = await load();
    await logout();
    expect(calls[0].url.endsWith("/auth/logout")).toBe(true);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ refresh_token: "R1" });
    expect(store).toEqual({ access: null, refresh: null });
  });
});
