// AgentHub Mobile — PWA Offline Shell Service Worker
//
// Caches the app shell (HTML, JS, CSS, manifest, icons) on install so the
// app loads even when the device is completely offline. This provides the
// "offline shell" required for a PWA install prompt.
//
// API data is NOT cached here — that is handled by:
//   1. React Query persist (localStorage) for query cache
//   2. IndexedDB offline message queue (offlineQueue.ts) for pending sends
//
// Strategy: Cache-first for the shell, network-first for navigation.

const CACHE_NAME = "agenthub-mobile-v1";
const SHELL_ASSETS = ["/", "/index.html", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS).catch((err) => {
        console.warn("[SW] Shell cache warm failed (some assets may be missing):", err);
      });
    }),
  );
  // Activate immediately so cached shell is available without reload.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      );
    }),
  );
  // Take control of all clients immediately.
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Only handle GET navigation and static asset requests.
  // API calls (POST/PUT/DELETE) and WebSocket upgrade requests pass through.
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Skip non-http(s) requests.
  if (!url.protocol.startsWith("http")) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      // Return cached response immediately for a fast offline shell.
      // In the background, fetch the network response and update the cache.
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Network failed — cached response (if any) is already being returned.
        });

      // If we have a cached response, return it immediately (stale-while-revalidate).
      // The network fetch runs in the background to update the cache.
      if (cached) {
        return cached;
      }

      // No cached response — wait for the network.
      return fetchPromise;
    }),
  );
});
