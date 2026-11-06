const CACHE_NAME = "atajo-shell-v6";
const SHELL = ["./", "./index.html", "./styles.css?v=6", "./app.js?v=6", "./config.js", "./favicon.svg?v=6", "./manifest.webmanifest?v=6"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: "reload" })))));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("atajo-shell-") && key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request, { cache: "no-cache" }).then((response) => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html"))));
});
