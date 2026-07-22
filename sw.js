// ====== Between Us — service worker ======
// Purpose: makes the app installable (Add to Home Screen) and gives it a
// basic offline fallback for the app shell itself.
//
// Deliberately NETWORK-FIRST, not cache-first: given how much trouble
// stale cached files caused during development, this always tries the
// live network copy first when online, and only falls back to the cached
// copy if the network request fails (i.e. genuinely offline). That means
// deploying a new app.js shows up immediately on next load — the service
// worker will never be the reason an update doesn't appear.

const CACHE_NAME = "between-us-shell-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./questions.js",
  "./config.js",
  "./firebase-config.js",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch((err) => console.warn("SW: some app-shell files failed to precache", err))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept cross-origin requests — Firestore, the Vercel backend,
  // Gemini, Google Fonts, cdnjs. Real-time gameplay must never go through
  // this cache logic.
  if (url.origin !== location.origin) return;

  // Only handle simple GETs for the app shell itself.
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
