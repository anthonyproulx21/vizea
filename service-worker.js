/* Vizéa — service worker
   Enables installation (PWA) and offline use. It caches ONLY the application's
   own static files (code, styles, test bank, and the charting engine, all served
   from this same origin). It never caches, and never has access to, any
   clinical/project data — projects live only in memory and in the files you
   export yourself. POST requests (e.g. the "suggest a test" form) and any
   third-party resources are never intercepted. */
const CACHE = "vizea-v2";
const APP_SHELL = [
  "./", "index.html",
  "style.css", "theme-init.js", "constants.js", "scoring.js",
  "datamodel.js", "chart.js", "app.js", "pwa.js",
  "plotly.min.js",
  "tests_bank.json", "nouveautes.json",
  "manifest.webmanifest",
  "favicon.svg", "favicon.ico", "favicon-192.png", "favicon-512.png", "apple-touch-icon.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting()).catch(() => {})
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                 // never touch POST/PUT (suggestion form, etc.)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // third parties (PayPal, fonts…) handled by the browser

  // Same-origin: network-first (always fresh when online, so updates are
  // automatic), falling back to cache when offline.
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req).then((c) => c || caches.match("index.html")))
  );
});
