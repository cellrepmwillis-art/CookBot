// Caches the app so it opens instantly and works offline. Only photo estimates
// need a connection; searching foods and logging work without one.
const CACHE = "cookbot-v10";
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
      .then((cache) => cache.addAll(SHELL).then(() => Promise.all(OPTIONAL.map((url) => cache.add(url).catch(() => {})))))
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
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request)),
    );
  }
});
