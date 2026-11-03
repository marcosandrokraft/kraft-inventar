// App-Dateien: network-first – immer zuerst die aktuelle Version vom Server holen, Cache nur als
// Offline-Fallback. (Früher cache-first – dadurch kamen neue app.js-Versionen nie an.)
// Firebase-Bibliotheken (selbst gehostet unter vendor/, feste Version im Pfad, ändern sich nie):
// cache-first – schneller Start und die App öffnet sich auch ohne Netz (Daten kommen dann aus dem
// Firestore-Offline-Speicher). Neue Firebase-Version = neuer Ordnername (siehe vendor/…/README.txt).
const CACHE = "vorrat-shell-v9";
const LIB_CACHE = "vorrat-libs-v2";
const FIREBASE_DIR = "vendor/firebase-10.14.1/";
const LIBS = ["firebase-app.js", "firebase-firestore.js", "firebase-auth.js"].map((f) => FIREBASE_DIR + f);
const SHELL = [
  "./", "index.html", "app.js", "lib.js", "ocr.js", "firebase-config.js", "register-sw.js", "style.css",
  "manifest.json", "icon.svg", "qr.html", "qr.js", "vendor/qrcode-generator-1.4.4.js", "vendor/jsqr-1.4.0/jsQR.js",
];
const FIREBASE_PREFIX = new URL(FIREBASE_DIR, self.location.href).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      // cache: "reload" – nicht die (bis 10 Min. alte) Kopie aus dem HTTP-Cache des Browsers nehmen.
      caches.open(CACHE).then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))),
      caches.open(LIB_CACHE).then((cache) => cache.addAll(LIBS)),
    ])
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

  if (url.href.startsWith(FIREBASE_PREFIX) && !url.search) {
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

  if (url.origin !== location.origin) return; // Firestore, Freistellung, Texterkennung usw. nicht anfassen

  const key = shellKey(req.url);
  event.respondWith(
    // no-cache: beim Server nachfragen statt die bis 10 Min. alte HTTP-Cache-Kopie von GitHub Pages
    // zu nehmen (sonst passen z.B. neue qr.js und alte lib.js nicht zusammen). Unverändert = 304, billig.
    fetch(req, { cache: "no-cache" })
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
