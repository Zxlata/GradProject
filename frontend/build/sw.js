/**
 * AI Interview Simulator — Service Worker
 * ─────────────────────────────────────────────────────────────────────────────
 * Strategy overview
 *   • Navigation requests  → Network-first with offline.html fallback
 *   • API requests (/api)  → Network-only (never serve stale auth/data)
 *   • Static assets        → Cache-first with background network refresh
 *   • Install              → Pre-cache the offline shell
 *
 * Bump CACHE_VERSION to force all clients to pick up a new cache on deploy.
 */

const CACHE_VERSION = 'v1.0.0';
const CACHE_NAME    = `ai-interview-${CACHE_VERSION}`;
const OFFLINE_URL   = '/offline.html';

/**
 * Assets to pre-cache during install.
 * We keep this minimal — runtime caching handles everything else.
 */
const PRECACHE_URLS = [
  OFFLINE_URL,
  '/',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-maskable.svg',
];

// ── Install ──────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())   // activate immediately
  );
});

// ── Activate ─────────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME)   // remove old caches
            .map((k)  => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())         // take control immediately
  );
});

// ── Fetch ────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GET requests and cross-origin CDN assets
  if (request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  // ── 1. API calls — always go to the network; never serve from cache ──────
  if (url.pathname.startsWith('/api/')) {
    // Let the browser handle it (no event.respondWith = pass-through)
    return;
  }

  // ── 2. Navigation (HTML pages) — network-first + offline fallback ────────
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache a fresh copy of the shell for future offline use
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches
            .match(request)                    // try cached version first
            .then((cached) => cached || caches.match(OFFLINE_URL))
        )
    );
    return;
  }

  // ── 3. Static assets — cache-first with background refresh ───────────────
  event.respondWith(cacheFirstWithRefresh(request));
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Cache-first with stale-while-revalidate:
 *   Return cached response immediately (fast), then fetch + update cache.
 */
async function cacheFirstWithRefresh(request) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  // Kick off a background refresh regardless
  const networkFetch = fetch(request)
    .then((response) => {
      if (response.ok || response.type === 'opaque') {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);   // network unavailable — that is fine if we have cache

  // Return cache immediately if we have it, otherwise await network
  return cached || (await networkFetch) || new Response('Resource unavailable', { status: 503 });
}

// ── Push notifications (placeholder) ─────────────────────────────────────────

self.addEventListener('push', (event) => {
  const data = event.data?.json?.() || {};
  self.registration.showNotification(data.title || 'AI Interview Simulator', {
    body:    data.body || 'You have a new notification.',
    icon:    '/icons/icon-192.png',
    badge:   '/icons/icon-72.png',
    vibrate: [100, 50, 100],
    data:    { url: data.url || '/' },
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((windows) => {
      const target = event.notification.data?.url || '/';
      for (const win of windows) {
        if (win.url === target && 'focus' in win) return win.focus();
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});
