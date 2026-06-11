// Minimal service worker — App Shell + runtime cache for prices.
// Bump the version string on every code change you want clients to pick
// up immediately — old caches are purged in `activate` below.
const CACHE = "snd-shell-v15";
const SHELL = ["/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Caching strategy ──
// HTML pages + Next.js JS chunks  → NETWORK FIRST (so every navigation picks
//   up the latest deploy, falls back to cache only when offline).
// API requests                    → NETWORK FIRST (same).
// Static assets (icons, images,
//   manifest, fonts)              → STALE-WHILE-REVALIDATE (fast load).
//
// The previous behaviour was stale-while-revalidate for everything, which
// caused the user to see the OLD layout intermittently for one render after
// switching tabs and back. Network-first eliminates that.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isApi = url.pathname.startsWith("/api/");
  const isNextJs = url.pathname.startsWith("/_next/");
  const isHtml = request.headers.get("accept")?.includes("text/html") ?? false;
  const isStaticAsset =
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest" ||
    /\.(png|jpe?g|svg|webp|gif|ico|woff2?|ttf|otf)$/i.test(url.pathname);

  // STATIC: stale-while-revalidate (fast, offline-friendly, doesn't change often)
  if (isStaticAsset) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((res) => { if (res && res.ok) cache.put(request, res.clone()); return res; })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // EVERYTHING ELSE (HTML, JS chunks, /api): network-first.
  // On success we update the cache as a safety net for offline use.
  if (isApi || isNextJs || isHtml || true) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(request, clone)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(request).then((r) => r || Response.error()))
    );
  }
});

// Push notifications (used by knock-in / knock-out / coupon alerts)
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = {};
  try { payload = event.data.json(); } catch { payload = { title: "SN Desk", body: event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(payload.title || "Structured Notes Desk", {
      body: payload.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: payload.tag || "snd",
      data: payload.data || {},
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(self.clients.openWindow(target));
});
