// Castia service worker — offline shell + static asset cache.
// Strategy:
//   - Navigation requests: network-first, fall back to cached index.html
//     (SPA — every route returns the same HTML).
//   - Same-origin static assets (CSS, JS, images, manifest, icons):
//     stale-while-revalidate so updates land on the next page load.
//   - Cross-origin requests (the Castia worker API, Google Fonts,
//     image hosts): pass through unchanged. The app is useless
//     without network for live prices, so we don't pretend to
//     support offline browsing of dynamic data.
const VERSION = "castia-49d2f8e";
const STATIC_CACHE = `${VERSION}-static`;
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.svg",
  "./icon-maskable.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
  );
  // Don't auto-skipWaiting: the client listens for the new worker
  // reaching 'waiting' state and posts {type:'SKIP_WAITING'} when the
  // user accepts the update. That way, deployed changes only take
  // effect when the user explicitly reloads, instead of mid-session.
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("castia-") && k !== STATIC_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Only handle same-origin requests. Cross-origin (worker API,
  // Google Fonts, image CDNs) goes straight to the network.
  if (url.origin !== self.location.origin) return;

  // Navigation requests: network-first, fall back to cached shell.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.match(request).then((cached) => {
        const networkFetch = fetch(request)
          .then((response) => {
            if (response && response.status === 200) {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    )
  );
});
