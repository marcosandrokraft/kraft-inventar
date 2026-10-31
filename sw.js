// App-Dateien: network-first – immer zuerst die aktuelle Version vom Server holen, Cache nur als
// Offline-Fallback. (Früher cache-first – dadurch kamen neue app.js-Versionen nie an.)
// Firebase-Bibliotheken (feste Version in der URL, ändern sich nie): cache-first – schneller Start
// und die App öffnet sich auch ohne Netz (Daten kommen dann aus dem Firestore-Offline-Speicher).
const CACHE = "vorrat-shell-v3";
const LIB_CACHE = "vorrat-libs-v1";
const SHELL = [
  "./", "index.html", "app.js", "lib.js", "firebase-config.js", "register-sw.js", "style.css",
  "manifest.json", "icon.svg", "qr.html", "qr.js", "vendor/qrcode-generator-1.4.4.js",
];
const FIREBASE_PREFIX = "https://www.gstatic.com/firebasejs/10.14.1/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {}) // Vorab-Cache ist nur ein Bonus; Installation nicht daran scheitern lassen
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== LIB_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-Schlüssel ohne Query (?c=…, Anmelde-Link mit oobCode=…): so landen keine Anmelde-Codes im
// Cache, und jede Behälter-Seite teilt sich denselben Eintrag für index.html.
function shellKey(url) {
  const key = new URL(url);
  key.search = "";
  key.hash = "";
  return key.href;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.href.startsWith(FIREBASE_PREFIX)) {
    event.respondWith(
      caches.open(LIB_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const response = await fetch(req);
        if (response.ok) cache.put(req, response.clone());
        return response;
      })
    );
    return;
  }

  if (url.origin !== location.origin) return; // Firestore, Freistellungs-Modell usw. nicht anfassen

  const key = shellKey(req.url);
  event.respondWith(
    fetch(req)
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(key, copy));
        }
        return response;
      })
      .catch(async () => (await caches.match(key))
        || (req.mode === "navigate" && (await caches.match(shellKey(new URL("index.html", location.href)))))
        || Response.error())
  );
});
