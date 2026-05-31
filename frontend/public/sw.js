// PetBill Shield service worker
// Strategy: cache-first for static assets, network-first for navigation,
// skip cache entirely for API calls so data is always fresh.

const CACHE_VERSION   = "petbill-v1";
const STATIC_CACHE    = `${CACHE_VERSION}-static`;

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  // Pre-cache the app shell so the app loads instantly even offline
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.addAll(["/", "/dashboard"]).catch(() => {})
    )
  );
  self.skipWaiting();
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith("petbill-") && k !== STATIC_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests over HTTP(S)
  if (request.method !== "GET" || !url.protocol.startsWith("http")) return;

  // API calls — always network, never cache
  if (url.pathname.startsWith("/api/")) return;

  // Cross-origin requests (fonts, CDN) — passthrough
  if (url.hostname !== self.location.hostname) return;

  // Hashed static assets (JS/CSS bundles) — cache-first
  if (
    url.pathname.startsWith("/static/") ||
    url.pathname.match(/\.(js|css|woff2?|png|jpg|svg|ico|webp)$/)
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // Navigation / HTML — network-first, fallback to cached shell
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(request, clone));
        }
        return res;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || caches.match("/"))
      )
  );
});

// ── Push notifications ────────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch { data = { title: "PetBill Shield", body: event.data.text() }; }

  event.waitUntil(
    self.registration.showNotification(data.title || "PetBill Shield", {
      body:              data.body  || "",
      icon:              "/favicon.svg",
      badge:             "/favicon.svg",
      tag:               data.tag   || "petbill-reminder",
      data:              { url: data.url || "/dashboard/reminders" },
      requireInteraction: false,
    })
  );
});

// ── Notification click ────────────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/dashboard/reminders";
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((all) => {
      const existing = all.find((c) => c.url.includes(url) && "focus" in c);
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});
