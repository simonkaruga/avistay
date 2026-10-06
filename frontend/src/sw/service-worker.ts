import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst, NetworkFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

/// <reference lib="webworker" />
export {};
declare const self: ServiceWorkerGlobalScope & typeof globalThis;

// App files (JS/CSS/HTML) from this release; files from older releases are removed.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Pages: always ask the network first so a new release shows up straight away
// (a cached page from an old release points at files that no longer exist).
// Offline: the last copy of that page, else the app itself.
registerRoute(
  ({ request }) => request.mode === "navigate",
  new NetworkFirst({
    cacheName: "pages",
    networkTimeoutSeconds: 5,
    plugins: [
      new ExpirationPlugin({ maxEntries: 30 }),
      { handlerDidError: async () => (await matchPrecache("/index.html")) ?? Response.error() },
    ],
  }),
);

// Homes: fresh when online, last results when offline.
registerRoute(
  ({ url, request }) => request.method === "GET" && url.pathname.startsWith("/api/properties"),
  new NetworkFirst({
    cacheName: "properties-cache",
    networkTimeoutSeconds: 5,
    plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 24 * 3600 })],
  }),
);

// My trips + booking details: so the check-in code still shows at the gate with
// no signal. Cleared on sign-out (see utils/api.ts logout).
registerRoute(
  ({ url, request }) => request.method === "GET" && url.pathname.startsWith("/api/bookings/"),
  new NetworkFirst({
    cacheName: "my-bookings",
    networkTimeoutSeconds: 5,
    plugins: [new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 30 * 24 * 3600 })],
  }),
);

// Photos (listing photos on Cloudinary, our Naivasha photos): once seen, kept a week.
registerRoute(
  ({ url, request }) => request.destination === "image"
    && (url.hostname === "res.cloudinary.com" || /^\/(places|stays)\//.test(url.pathname)),
  new CacheFirst({
    cacheName: "photos",
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 7 * 24 * 3600 })],
  }),
);

// Note: bookings and payments are never queued and re-sent later. A guest who
// is offline must see that the booking didn't go through, not be charged later.

// Push notification handler
self.addEventListener("push", (event: PushEvent) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title ?? "Avistay", {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url ?? "/" },
    })
  );
});

// Notification click: open the relevant page
self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then(clients => {
      const existing = clients.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});
