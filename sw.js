const CACHE = "vorrat-shell-v1";
const SHELL = ["index.html", "qr.html", "style.css", "app.js", "firebase-config.js", "manifest.json", "icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return; // Firestore/QR-Requests nicht cachen
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
