/**
 * Sovereign Chess — Service Worker (v1.1).
 *
 * Hand-rolled, zero dependencies, cost-effective by design:
 *  - everything is cached on the DEVICE, so repeat visits cost the
 *    server (Vercel) almost nothing and the arena works offline;
 *  - navigations are network-first, so users always get the freshest
 *    build when online, with an instant cached/offline fallback when not;
 *  - static assets use stale-while-revalidate — instant from cache and
 *    self-healing in the background (chunk names are content-hashed);
 *  - API routes are NEVER cached — user data lives on-device first.
 */

const VERSION = "v1.3.0";
const STATIC_CACHE = `sovereign-static-${VERSION}`;
const PAGE_CACHE = `sovereign-pages-${VERSION}`;
const OWNED = [STATIC_CACHE, PAGE_CACHE];

const PRECACHE = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !OWNED.includes(key))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

/* ---------------- fetch strategies ---------------- */

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // cross-origin: pass through untouched
  if (url.origin !== self.location.origin) return;
  // never touch API / cloud sync — device data must stay authoritative
  if (url.pathname.startsWith("/api/")) return;
  // never intercept dev tooling / HMR
  if (url.pathname.startsWith("/_next/webpack-hmr")) return;

  // 1) Navigations — network-first, cached page + offline page as fallback
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req, PAGE_CACHE));
    return;
  }

  // 2) Static assets — stale-while-revalidate (instant + self-healing)
  if (isStaticAsset(url.pathname, req.destination)) {
    event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
    return;
  }

  // 3) Everything else (RSC payloads, prefetches) — plain network
});

function isStaticAsset(pathname, destination) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/icons/") ||
    pathname === "/favicon.svg" ||
    pathname === "/logo.svg" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/offline.html" ||
    destination === "image" ||
    destination === "font" ||
    destination === "style" ||
    destination === "script" ||
    destination === "worker"
  );
}

/* ---------------- strategies ---------------- */

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("sw-timeout")), ms)
    ),
  ]);
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await withTimeout(fetch(req), 3500);
    if (fresh && fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
    return fresh;
  } catch {
    const cached =
      (await cache.match(req, { ignoreSearch: true }).catch(() => null)) ||
      (await cache.match("/").catch(() => null));
    if (cached) return cached;
    const fallback = await cache.match("/offline.html").catch(() => null);
    if (fallback) return fallback;
    return new Response("You are offline.", {
      status: 503,
      statusText: "Offline",
      headers: { "Content-Type": "text/plain" },
    });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req).catch(() => null);
  const network = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => null);
  if (cached) {
    network.catch(() => {});
    return cached;
  }
  const fresh = await network;
  return (
    fresh ||
    new Response("Not available offline.", {
      status: 503,
      statusText: "Offline",
    })
  );
}
