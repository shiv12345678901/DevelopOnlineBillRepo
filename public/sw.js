/* SplitMate service worker — offline-first PWA.
 * App shell: cache-first. Supabase API: network-first so sync status and
 * settlement data are fresh, with cached data as an offline fallback. */
const DATA_CACHE = "splitmate-data-v1";
const BUILD_VERSION = "__BUILD_VERSION__";
const SHELL_CACHE = `splitmate-shell-${BUILD_VERSION}`;
const VERSION_PATH = "/version.json";
const SHELL = ["/", "/index.html", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL))
  );
});

self.addEventListener("message", (e) => {
  if (e.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

const isApi = (url) => url.hostname.includes("supabase.co") && url.pathname.startsWith("/rest/");

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Always check the deployed build marker against the network. This lets
  // the app notice a new Netlify build instead of serving a stale marker.
  if (url.origin === self.location.origin && url.pathname === VERSION_PATH) {
    e.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  // Supabase data: use the network first so completed syncs are visible,
  // then fall back to the last response when the device is offline.
  if (isApi(url)) {
    e.respondWith(
      caches.open(DATA_CACHE).then(async (cache) => {
        try {
          const response = await fetch(request, { cache: "no-store" });
          if (response.ok) await cache.put(request, response.clone());
          return response;
        } catch {
          return (await cache.match(request)) || Response.error();
        }
      })
    );
    return;
  }

  // App shell + assets: cache-first, network fallback
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(request, { ignoreSearch: true }).then((hit) => {
        if (hit) return hit;
        return fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
          }
          return res;
        }).catch(() => caches.match("/index.html"));
      })
    );
  }
});
