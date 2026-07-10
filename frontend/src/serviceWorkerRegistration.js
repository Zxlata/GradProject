/**
 * serviceWorkerRegistration.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Registers /sw.js as the application's service worker.
 *
 * Designed for Create React App (react-scripts) without ejecting:
 *   - The SW lives in /public/sw.js so CRA copies it verbatim to the build root.
 *   - Only active in production (CRA dev-server intercepts fetches differently).
 *   - Fires optional callbacks: onSuccess, onUpdate, onOffline, onOnline.
 *
 * Usage (src/index.js):
 *   import { registerSW } from './serviceWorkerRegistration';
 *   registerSW({
 *     onSuccess: (reg) => console.log('SW ready'),
 *     onUpdate:  (reg) => console.log('New version available'),
 *   });
 */

const SW_URL = `${process.env.PUBLIC_URL}/sw.js`;
const IS_LOCALHOST = Boolean(
  window.location.hostname === 'localhost' ||
  window.location.hostname === '[::1]' ||
  window.location.hostname.match(/^127\./)
);

/** Register the service worker. No-ops in unsupported browsers. */
export function registerSW(config = {}) {
  if (!('serviceWorker' in navigator)) return;

  // In development, skip registration unless explicitly opted-in via
  // REACT_APP_SW_DEV=true env var (useful for offline testing).
  if (
    process.env.NODE_ENV !== 'production' &&
    process.env.REACT_APP_SW_DEV !== 'true'
  ) {
    console.log('[SW] Skipped registration in development mode.');
    return;
  }

  window.addEventListener('load', () => {
    if (IS_LOCALHOST) {
      // On localhost, extra validation to catch misconfigured SW URLs.
      checkValidServiceWorker(SW_URL, config);
      navigator.serviceWorker.ready.then(() => {
        console.log('[SW] App is being served by a service worker.');
      });
    } else {
      registerValidSW(SW_URL, config);
    }
  });
}

/** Unregister all service workers (call during logout or reset). */
export async function unregisterSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
    console.log('[SW] All service workers unregistered.');
  } catch (err) {
    console.error('[SW] Unregistration failed:', err);
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function registerValidSW(swUrl, config) {
  try {
    const registration = await navigator.serviceWorker.register(swUrl);

    registration.onupdatefound = () => {
      const installing = registration.installing;
      if (!installing) return;

      installing.onstatechange = () => {
        if (installing.state !== 'installed') return;

        if (navigator.serviceWorker.controller) {
          // New content is available; existing tab will keep the old SW.
          console.log('[SW] New content available; will load on next visit.');
          config.onUpdate?.(registration);
        } else {
          // Content has been cached for offline use.
          console.log('[SW] Content cached for offline use.');
          config.onSuccess?.(registration);
        }
      };
    };

    // Propagate online/offline events to callbacks
    window.addEventListener('online',  () => config.onOnline?.());
    window.addEventListener('offline', () => config.onOffline?.());

  } catch (error) {
    console.error('[SW] Registration failed:', error);
  }
}

async function checkValidServiceWorker(swUrl, config) {
  try {
    const resp = await fetch(swUrl, { headers: { 'Service-Worker': 'script' } });
    const contentType = resp.headers.get('content-type') ?? '';

    if (resp.status === 404 || !contentType.includes('javascript')) {
      // No SW found — app may be running an old one; reload.
      const registration = await navigator.serviceWorker.ready;
      await registration.unregister();
      window.location.reload();
    } else {
      registerValidSW(swUrl, config);
    }
  } catch {
    console.log('[SW] No internet connection. App running in offline mode.');
  }
}
