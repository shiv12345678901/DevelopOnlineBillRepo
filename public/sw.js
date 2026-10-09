/* SplitMate service worker — offline-first PWA.
 * App shell: cache-first. Supabase API: stale-while-revalidate so the
 * app opens instantly offline with last-known data, then refreshes. */
const SHELL_CACHE = "splitmate-shell-v1";
const DATA_CACHE = "splitmate-data-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
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

  // Supabase data: serve cache immediately, refresh in background
  if (isApi(url)) {
    e.respondWith(
      caches.open(DATA_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const refresh = fetch(request).then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        }).catch(() => null);
        return cached || refresh || Response.error();
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
