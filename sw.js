// Caches the app so it opens instantly and works offline. Only photo estimates
// need a connection; searching foods and logging work without one.
const CACHE = "cookbot-v21";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "barcode.js",
  "day.js",
  "estimate.js",
  "foods.js",
  "foods.json",
  "lookup.js",
  "resolve.js",
  "streak.js",
  "modifiers.js",
  "manifest.webmanifest",
  "icon.svg",
  "vendor/anthropic-sdk-0.131.0.js",
  "vendor/zxing-0.23.0.js",
];

// Cached when present; the app works without it.
const OPTIONAL = ["branded.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // "reload": a new version downloads fresh files, not the browser's cached ones.
      .then((cache) => {
        const fresh = (url) => new Request(url, { cache: "reload" });
        return cache.addAll(SHELL.map(fresh)).then(() => Promise.all(OPTIONAL.map((url) => cache.add(fresh(url)).catch(() => {}))));
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // API calls are POSTs and always go to the network
  if (new URL(request.url).origin === self.location.origin) {
    // Network first for our own files so updates show up; fall back to cache offline.
    // Ask the server every time (unchanged files come back as a quick "not
    // modified"), instead of trusting the browser's 10-minute cache, so
    // updates show up on the next open.
    event.respondWith(
      fetch(request, { cache: "no-cache" })
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request)),
    );
  }
});
