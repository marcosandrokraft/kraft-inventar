import * as config from "./firebase-config.js";
import {
  UNITS,
  MAX_NAME,
  MAX_QTY,
  slugify,
  isValidId,
  escapeHtml,
  isSafePhoto,
  parseQty,
  planAddItem,
  normalizeSearch,
  searchItems,
  containerIdFromScan,
  moveTargetFromScan,
  containerUrl,
  findObjectBounds,
  planStep,
  qtyStep,
  CONTAINER_TYPES,
  containerPath,
  formatPath,
  isTopLevel,
  childContainers,
  wouldCreateCycle,
  parentOptions,
  uniqueContainerId,
  isoDate,
  isValidIsoDate,
  addToDate,
  mhdStatus,
  formatDate,
  parseDatesFromText,
  parseGs1Expiry,
  EXPIRY_WINDOWS,
  expiringItems,
  daysText,
  qrPageQuery,
  practiceParam,
  scanTarget,
  practiceLinkAction,
} from "./lib.js";
import { ITEM_ICONS } from "./item-icons.js";
import { suggestIcon, isKnownIcon, iconForItem, searchIcons, FALLBACK_ICON } from "./icon-match.js";

// --- Übungsmodus ---
// Jede Person übt für sich mit Beispieldaten (uebung-firebase.js, gespeichert in localStorage dieses
// Geräts). Dann wird Firebase gar nicht geladen: nichts geht an die echte Datenbank, und deren
// Offline-Speicher (IndexedDB) bleibt unberührt. Ein-/Ausschalten über ?uebung=1 / ?uebung=0, der
// Schalter gilt für diesen Tab (sessionStorage) – beim nächsten Öffnen der App sind wieder die echten
// Daten da, die Übungsdaten bleiben für das nächste Mal erhalten.
const PRACTICE_KEY = "vorrat-uebung-aktiv";
function detectPractice() {
  const p = practiceParam(location.search);
  try {
    if (p === true) sessionStorage.setItem(PRACTICE_KEY, "1");
    if (p === false) sessionStorage.removeItem(PRACTICE_KEY);
    return p ?? sessionStorage.getItem(PRACTICE_KEY) === "1";
  } catch {
    return p === true;
  }
}
const PRACTICE = detectPractice();

// Firebase bzw. die Übungs-Datenschicht (gleiche Funktionen) laden.
const [appMod, firestoreMod, authMod] = PRACTICE
  ? await import("./uebung-firebase.js").then((m) => [m, m, m])
  : await Promise.all([
    import("./vendor/firebase-10.14.1/firebase-app.js"),
    import("./vendor/firebase-10.14.1/firebase-firestore.js"),
    import("./vendor/firebase-10.14.1/firebase-auth.js"),
  ]);
const { initializeApp } = appMod;
const {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  increment,
  deleteField,
  terminate,
  clearIndexedDbPersistence,
  query,
  orderBy,
} = firestoreMod;
const {
  getAuth,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signOut,
} = authMod;

// --- Sperre (Owner) ---
// settings/lock { locked, lockedBy } – bei Sperre dürfen nur Owner (members/<adresse>.role == "owner")
// schreiben, das prüfen die Regeln. Die App zeigt das vorher an und schreibt dann gar nicht erst.
const lockState = { locked: false, lockedBy: "", owner: false, name: "" };
// Erfüllt, sobald Rolle und Sperre bekannt sind (im Übungsmodus sofort). Automatisches Anlegen per
// QR-Code wartet darauf, damit bei langsamem Netz nicht in eine Sperre hineingeschrieben wird.
let lockKnown;
const lockReady = new Promise((resolve) => { lockKnown = resolve; });
if (PRACTICE) lockKnown();
function readOnly() {
  return !PRACTICE && lockState.locked && !lockState.owner;
}
const LOCKED_TEXT = "Vorübergehend gesperrt – nur Lesen";
function lockedError() {
  const err = new Error(LOCKED_TEXT);
  err.code = "locked";
  return err;
}
// Vor jeder Änderung: gesperrt → freundliche Meldung statt "permission-denied".
function blockedByLock() {
  if (!readOnly()) return false;
  toast(`${LOCKED_TEXT}. Zum Üben: Übungsmodus (Hilfe oben).`, 4000);
  return true;
}
// Schreibfunktionen: bei Sperre gar nicht erst schreiben (Sicherheitsnetz, falls ein Knopf übersehen wurde).
const guard = (fn) => (...args) => (readOnly() ? Promise.reject(lockedError()) : fn(...args));
const setDoc = guard(firestoreMod.setDoc);
const updateDoc = guard(firestoreMod.updateDoc);
const deleteDoc = guard(firestoreMod.deleteDoc);
function writeBatch(database) {
  const batch = firestoreMod.writeBatch(database);
  const commit = batch.commit.bind(batch);
  batch.commit = () => (readOnly() ? Promise.reject(lockedError()) : commit());
  return batch;
}

// Ereignisse für das Tutorial (tutorial.js hört auf "vorrat:action").
function emit(type, detail = {}) {
  document.dispatchEvent(new CustomEvent("vorrat:action", { detail: { type, ...detail } }));
}

// Freistellungs-Bibliothek wird erst beim ersten Foto geladen. Als statischer Import würde ein
// Ladefehler (CDN nicht erreichbar, alter Browser) die ganze App bei "Lade…" stehen lassen.
// "+esm" ist wichtig: dist/index.mjs lädt onnxruntime-web über einen Paketnamen, den der Browser
// nicht auflösen kann – damit schlug das Freistellen immer fehl.
const BACKGROUND_REMOVAL_URL = "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm";

// Einheitlicher Hintergrund für freigestellte Fotos.
const PHOTO_BACKGROUND = "#e8e8e8";

// Ab so vielen Artikeln erscheint im Behälter ein Filterfeld.
const FILTER_THRESHOLD = 8;

const app = initializeApp(config.firebaseConfig);

// Optional: App Check (reCAPTCHA v3) – lässt nur Anfragen von dieser Webseite zu.
// Aktiv, sobald in firebase-config.js `appCheckSiteKey` eingetragen ist.
if (config.appCheckSiteKey && !PRACTICE) {
  try {
    const { initializeAppCheck, ReCaptchaV3Provider } = await import(
      "./vendor/firebase-10.14.1/firebase-app-check.js"
    );
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(config.appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    console.error("App Check konnte nicht gestartet werden:", err);
  }
}

const auth = getAuth(app);

// Offline-Speicher: Daten werden im Browser (IndexedDB) zwischengespeichert. Dadurch erscheint der
// Inhalt nach dem Scannen sofort (aus dem Cache) und Änderungen ohne Netz werden später übertragen.
// Falls beim Anlegen der Firestore-Datenbank eine eigene "Database ID" vergeben wurde,
// in firebase-config.js `export const firestoreDatabaseId = "..."` eintragen.
function createDb() {
  const dbId = config.firestoreDatabaseId || "(default)";
  try {
    return initializeFirestore(
      app,
      { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) },
      dbId
    );
  } catch (err) {
    console.warn("Offline-Speicher nicht verfügbar, arbeite ohne:", err);
    return getFirestore(app, dbId);
  }
}
const db = createDb();

const main = document.getElementById("app");
const toastEl = document.getElementById("toast");

// Zeigt einen Firestore-Fehler sichtbar an statt endlos "Lade…".
function showError(el, err) {
  console.error(err);
  const hint = err.code === "permission-denied" && auth.currentUser
    ? `<br>Angemeldet als ${escapeHtml(auth.currentUser.email || "?")} – diese Adresse ist nicht freigeschaltet.`
    : "";
  el.innerHTML = `<p class="empty-hint">Fehler: <strong>${escapeHtml(err.code || "unbekannt")}</strong>${hint}<br><small>${escapeHtml(err.message || String(err))}</small></p>`;
}

// Kurze Meldung unten. Optional mit Knöpfen (z.B. "Rückgängig"):
// toast(text, { ms, action: { label, fn } }) oder toast(text, { ms, actions: [{ label, fn }, …] }).
let toastTimer = null;
function toast(msg, opts = {}) {
  const { ms = 1600, action = null, actions = action ? [action] : [] } = typeof opts === "number" ? { ms: opts } : opts;
  toastEl.textContent = msg;
  toastEl.classList.toggle("has-action", actions.length > 0);
  for (const a of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = a.label;
    btn.addEventListener("click", () => {
      toastEl.classList.remove("show", "has-action");
      a.fn();
    }, { once: true });
    toastEl.append(" ", btn);
  }
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show", "has-action"), ms);
}

// Löschen in zwei Schritten gegen versehentliches Tippen: erster Tipp → Knopf wird rot ("Löschen?"),
// zweiter Tipp innerhalb von 4 s löscht. Danach gibt es trotzdem noch "Rückgängig".
function confirmFirst(btn, fn, label = "Löschen?") {
  const original = btn.innerHTML;
  const originalLabel = btn.getAttribute("aria-label");
  let timer = null;
  const reset = () => {
    clearTimeout(timer);
    btn.classList.remove("confirm");
    btn.innerHTML = original;
    if (originalLabel) btn.setAttribute("aria-label", originalLabel);
  };
  return (e) => {
    if (!btn.classList.contains("confirm")) {
      btn.classList.add("confirm");
      btn.textContent = label;
      btn.setAttribute("aria-label", "Zum Löschen nochmals tippen");
      timer = setTimeout(reset, 4000);
      return;
    }
    reset();
    fn(e);
  };
}

// Schreibvorgänge nicht abwarten: Mit Offline-Speicher erscheinen Änderungen sofort, die Bestätigung
// vom Server kommt (ohne Netz) evtl. erst viel später. Fehler (z.B. Regeln) werden trotzdem gemeldet.
function background(promise, what = "Speichern") {
  promise.catch((err) => {
    if (err.code === "locked" || (err.code === "permission-denied" && lockState.locked && !lockState.owner)) {
      toast(`${LOCKED_TEXT} – nichts geändert.`, 4000);
      return;
    }
    console.error(err);
    // Übungsspeicher voll: verständliche Meldung der Übungs-Datenschicht zeigen.
    const reason = err.code === "resource-exhausted" ? err.message : (err.code || err.message);
    toast(`${what} fehlgeschlagen (${reason})`, 4000);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function loadBlobImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    return await loadImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Zeichnet ein Bild verkleinert (längste Seite max. maxDim) auf ein Canvas.
function scaledCanvas(img, maxDim) {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Speichert so klein, dass es sicher in ein Firestore-Dokument (max. 1 MB) passt.
function toJpegDataUrl(img) {
  let maxDim = 480;
  let quality = 0.75;
  let result = scaledCanvas(img, maxDim).toDataURL("image/jpeg", quality);
  while (result.length > 300_000 && maxDim > 160) {
    maxDim = Math.round(maxDim * 0.7);
    quality = Math.max(0.5, quality - 0.1);
    result = scaledCanvas(img, maxDim).toDataURL("image/jpeg", quality);
  }
  return result;
}

// Fortschritt beim ersten Laden des KI-Modells (einmalig pro Gerät, danach im Browser-Cache).
function backgroundRemovalProgress(key, current, total) {
  if (key.startsWith("fetch:") && total) {
    toast(`KI-Modell wird geladen… ${Math.round((current / total) * 100)}%`, 5000);
  } else if (key.startsWith("compute:")) {
    toast("Hintergrund wird entfernt…", 5000);
  }
}

// Entfernt fast durchsichtige Reste der Freistellung und liefert das Rechteck um das Objekt
// (Logik in lib.js → findObjectBounds, dort auch getestet).
function cleanupAndFindObject(canvas) {
  const { width: w, height: h } = canvas;
  const ctx = canvas.getContext("2d");
  const image = ctx.getImageData(0, 0, w, h);
  try {
    return findObjectBounds(image.data, w, h);
  } finally {
    ctx.putImageData(image, 0, 0);
  }
}

// Schneidet das Objekt frei (läuft komplett im Browser, kein Server/API-Key nötig), schneidet auf
// das Objekt zu und legt es zentriert auf einen quadratischen, einheitlichen Hintergrund.
async function cutoutWithBackground(img) {
  const { removeBackground } = await import(BACKGROUND_REMOVAL_URL);
  // Handyfotos vorher verkleinern: schneller und braucht weniger Speicher.
  const input = await new Promise((resolve) =>
    scaledCanvas(img, 1024).toBlob(resolve, "image/jpeg", 0.9)
  );
  const cutoutBlob = await removeBackground(input, {
    model: "isnet_quint8",
    output: { format: "image/png" },
    progress: backgroundRemovalProgress,
  });
  const cutout = scaledCanvas(await loadBlobImage(cutoutBlob), 1024);
  const { minX, minY, maxX, maxY } = cleanupAndFindObject(cutout);

  const boxW = maxX - minX + 1;
  const boxH = maxY - minY + 1;
  const side = Math.round(Math.max(boxW, boxH) * 1.15); // etwas Rand rundherum
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = PHOTO_BACKGROUND;
  ctx.fillRect(0, 0, side, side);
  ctx.drawImage(cutout, minX, minY, boxW, boxH, (side - boxW) / 2, (side - boxH) / 2, boxW, boxH);
  return canvas;
}

// Liefert das fertige Foto als JPEG-dataURL: freigestellt, sonst (Fehler/kein Objekt) das normale Foto.
async function processPhoto(file) {
  const img = await loadBlobImage(file);
  try {
    toast("Hintergrund wird entfernt… (beim ersten Mal kann es bis zu einer Minute dauern)", 5000);
    const result = toJpegDataUrl(await cutoutWithBackground(img));
    toast("Hintergrund entfernt");
    return result;
  } catch (err) {
    console.error("Freistellen fehlgeschlagen, speichere normales Foto:", err);
    toast("Freistellen nicht möglich – speichere normales Foto", 3000);
    return toJpegDataUrl(img);
  }
}

function itemRef(containerId, itemId) {
  return doc(db, "containers", containerId, "items", itemId);
}

// Artikel, deren Foto gerade verarbeitet wird ("containerId/itemId") – zeigt die Sanduhr statt der Kamera.
const photosInProgress = new Set();
let rerenderItems = () => {};

// Verarbeitet ein Foto im Hintergrund und speichert es beim Artikel.
async function savePhoto(containerId, itemId, file) {
  const key = `${containerId}/${itemId}`;
  photosInProgress.add(key);
  rerenderItems();
  try {
    const photo = await processPhoto(file);
    background(
      setDoc(itemRef(containerId, itemId), { photo, updatedAt: serverTimestamp() }, { merge: true })
        .then(() => toast("Foto gespeichert")),
      "Foto speichern"
    );
  } catch (err) {
    console.error(err);
    toast(`Foto konnte nicht verarbeitet werden (${err.code || err.message})`, 4000);
  } finally {
    photosInProgress.delete(key);
    rerenderItems();
  }
}

// Ein gemeinsamer, versteckter Datei-Input für "Foto ändern". Ohne `capture`, damit das Handy
// die Wahl zwischen Kamera und Galerie (Upload) anbietet.
const photoInput = document.createElement("input");
photoInput.type = "file";
photoInput.accept = "image/*";
photoInput.style.display = "none";
document.body.appendChild(photoInput);
let pendingPhotoTarget = null;

photoInput.addEventListener("change", () => {
  const file = photoInput.files[0];
  const target = pendingPhotoTarget;
  photoInput.value = "";
  if (file && target) savePhoto(target.containerId, target.itemId, file);
});

function openPhotoPicker(containerId, itemId) {
  if (blockedByLock()) return;
  pendingPhotoTarget = { containerId, itemId };
  photoInput.click();
}

// Einfaches Overlay-Fenster. `html` darf nur feste Texte oder escapete Daten enthalten.
function openDialog(html) {
  const overlay = document.createElement("div");
  overlay.className = "photo-overlay";
  overlay.innerHTML = `<div class="photo-dialog" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => {
    if (!overlay.isConnected) return;
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    emit("dialog-close");
  };
  // Escape schliesst nur das oberste Fenster (z.B. Scanner über dem Verschieben-Dialog).
  const onKey = (e) => {
    if (e.key === "Escape" && [...document.querySelectorAll(".photo-overlay")].pop() === overlay) close();
  };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelectorAll('[data-action="close"]').forEach((b) => b.addEventListener("click", close));
  document.body.appendChild(overlay);
  emit("dialog-open");
  return { overlay, close };
}

// --- Alle Behälter (für Pfad, Unterbehälter, Verschieben) ---
// Ein einziger Listener für die ganze Seite: Map id → { name, type?, parent? }.

const allContainers = new Map();
let containersLoaded = false;
const containerListeners = new Set();
let containersError = null;

function watchContainers() {
  onSnapshot(collection(db, "containers"), (snap) => {
    allContainers.clear();
    snap.forEach((d) => {
      const data = d.data();
      allContainers.set(d.id, {
        name: data.name || d.id,
        type: CONTAINER_TYPES[data.type] ? data.type : undefined,
        parent: typeof data.parent === "string" && data.parent ? data.parent : undefined,
      });
    });
    containersLoaded = true;
    document.querySelectorAll("a[data-qr]").forEach(setQrHref);
    // Für qr.html, falls sie ohne Liste geöffnet wird (Lesezeichen, alte Version des Links).
    storageSet(QR_LIST_KEY, qrPageQuery(allContainers));
    containerListeners.forEach((fn) => fn());
  }, (err) => {
    containersError = err;
    containerListeners.forEach((fn) => fn(err));
  });
}

// fn() wird bei jeder Änderung aufgerufen (fn(err) bei Fehler), sofort einmal, falls schon geladen.
function onContainers(fn) {
  containerListeners.add(fn);
  if (containersLoaded) fn();
  else if (containersError) fn(containersError);
}

function containersReady() {
  return new Promise((resolve, reject) => {
    if (containersLoaded) return resolve();
    const fn = (err) => {
      containerListeners.delete(fn);
      if (err) reject(err); else resolve();
    };
    containerListeners.add(fn);
  });
}

// Links zur QR-Druckseite (a[data-qr]) übergeben immer alle Behälter; data-qr-sel = der Behälter,
// der schon angehakt sein soll (sonst alle). Beim Klick neu berechnet, falls sich etwas geändert hat.
const QR_LIST_KEY = "qrContainers"; // gleicher Schlüssel in qr.js
function setQrHref(a) {
  const sel = a.dataset.qrSel;
  let containers = allContainers;
  if (sel && !containers.has(sel)) {
    containers = new Map(allContainers).set(sel, { name: a.dataset.qrName || sel });
  }
  // Übungsmodus: Druckseite erzeugt Übungs-Codes (?uebung=1 im Link jedes Codes).
  a.href = `qr.html?${PRACTICE ? "uebung=1&" : ""}${qrPageQuery(containers, sel ? [sel] : [])}`;
}
document.addEventListener("click", (e) => {
  const a = e.target.closest?.("a[data-qr]");
  if (a) setQrHref(a);
});

function pathLabel(id) {
  return formatPath(containerPath(id, allContainers));
}

function typeLabel(type) {
  return CONTAINER_TYPES[type] || "";
}

// Kleine Strich-Icons (feste SVGs, keine Nutzerdaten), Farbe über currentColor, rein dekorativ
// (aria-hidden) – Knöpfe nur mit Icon brauchen deshalb ein aria-label. Die Leiste unten steht als
// Inline-SVG in index.html (gleiche Pfade wie hier).
const TYPE_ICON_PATHS = {
  raum: '<path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17"/><path d="M3 21h18"/><circle cx="15" cy="12.5" r="1" fill="currentColor"/>',
  schrank: '<rect x="4" y="2.5" width="16" height="17" rx="1.5"/><path d="M12 2.5v17M10 10v2.5M14 10v2.5M6.5 19.5v2M17.5 19.5v2"/>',
  fach: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 12h18M10 8h4M10 16h4"/>',
  box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="m3 7.5 9 4.5 9-4.5M12 12v9"/>',
};
const ICON_PATHS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>',
  scan: '<path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16"/><path d="M7 12h10"/>',
  camera: '<path d="M4.5 7.5h2.8L9 5h6l1.7 2.5h2.8A1.5 1.5 0 0 1 21 9v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V9a1.5 1.5 0 0 1 1.5-1.5z"/><circle cx="12" cy="13" r="3.5"/>',
  alarm: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 2M3.5 5.5l3-2.5M20.5 5.5l-3-2.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7"/><path d="m6 7 .9 12.6a1.5 1.5 0 0 0 1.5 1.4h7.2a1.5 1.5 0 0 0 1.5-1.4L18 7"/><path d="M10 11v6M14 11v6"/>',
  edit: '<path d="M4 20h4L19.3 8.7a2.1 2.1 0 0 0 0-3l-1-1a2.1 2.1 0 0 0-3 0L4 16z"/><path d="m13.5 6.5 4 4"/>',
  select: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="m8 12.2 2.8 2.8L16.2 9"/>',
  qr: '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1"/><path d="M14 14h2.5v2.5H14zM20.5 14v.01M14 20.5v.01M20.5 20.5h-1.5M18.5 17.5v.01"/>',
  move: '<path d="M14.5 4.5 19 9l-4.5 4.5"/><path d="M19 9h-9a5.5 5.5 0 0 0-5.5 5.5V20"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  print: '<path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14h10v6.5H7z"/>',
  hourglass: '<path d="M6.5 3.5h11M6.5 20.5h11"/><path d="M8 3.5c0 4 4 5.5 4 8.5s-4 4.5-4 8.5M16 3.5c0 4-4 5.5-4 8.5s4 4.5 4 8.5"/>',
  box: TYPE_ICON_PATHS.box,
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2-2.4 3.6"/><path d="M12 17.2v.01"/>',
  practice: '<path d="m2.5 9 9.5-4.5L21.5 9 12 13.5z"/><path d="M6.5 11.2v4.3c1.6 1.4 3.5 2 5.5 2s3.9-.6 5.5-2v-4.3M21.5 9v5"/>',
};
function svgIcon(paths, cls) {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}
// icon("trash") → SVG-Markup; nur feste Namen aus ICON_PATHS.
function icon(name) {
  return svgIcon(ICON_PATHS[name], "icon");
}
// Artikel-Icon (Lucide, item-icons.js) – nur bekannte IDs, Pfade sind feste Daten aus dem Repo.
function itemIconSvg(id, cls = "icon item-icon") {
  return isKnownIcon(id) ? svgIcon(ITEM_ICONS[id].paths, cls) : "";
}
// Inhalt des Vorschaubilds: Foto > gespeichertes Icon > Vorschlag aus dem Namen > `fallback`.
// Ein <img> bekommt sein src danach per JS (nie Nutzerdaten im Markup).
function thumbContent(item, fallback = icon("camera")) {
  if (isSafePhoto(item.photo)) return `<img class="thumb" alt="" decoding="async" />`;
  const id = iconForItem(item);
  return id ? itemIconSvg(id) : fallback;
}
function typeIcon(type) {
  const paths = TYPE_ICON_PATHS[type];
  return paths ? svgIcon(paths, "type-icon") : "";
}

// --- MHD (Mindesthaltbarkeitsdatum) ---

function mhdBadge(mhd) {
  const status = mhdStatus(mhd, new Date());
  if (!status) return "";
  const text = status === "expired" ? `abgelaufen ${formatDate(mhd)}` : `MHD ${formatDate(mhd)}`;
  return `<span class="mhd mhd-${status}">${escapeHtml(text)}</span>`;
}

// MHD hinter Menge/Einheit in einer Zeile: "Packung · MHD 23.11.2026". Bald/abgelaufen stehen als
// Etikett ohne Punkt. Das geschützte Leerzeichen hält Punkt und Datum zusammen, falls die Zeile umbricht.
function mhdSuffix(mhd) {
  const badge = mhdBadge(mhd);
  if (!badge) return "";
  return mhdStatus(mhd, new Date()) === "ok" ? ` ·&nbsp;${badge}` : ` ${badge}`;
}

function saveMhd(containerId, itemId, item, mhd) {
  if (blockedByLock()) return;
  const data = { mhd: mhd ? mhd : deleteField(), updatedAt: serverTimestamp() };
  background(updateDoc(itemRef(containerId, itemId), data), "MHD speichern");
  item.mhd = mhd || undefined;
  toast(mhd ? `"${item.name}": MHD ${formatDate(mhd)}` : `"${item.name}": MHD entfernt`);
  emit("mhd-saved", { containerId, itemId });
}

// Icon speichern (null = entfernen → wieder Vorschlag aus dem Namen).
function saveIcon(containerId, itemId, item, iconId) {
  if (blockedByLock()) return;
  const data = { icon: iconId && isKnownIcon(iconId) ? iconId : deleteField(), updatedAt: serverTimestamp() };
  background(updateDoc(itemRef(containerId, itemId), data), "Icon speichern");
  item.icon = iconId || undefined;
  toast(iconId ? `"${item.name}": Icon „${ITEM_ICONS[iconId].label}“` : `"${item.name}": Icon automatisch`);
  emit("icon-chosen", { containerId, itemId });
}

// Auswahl-Raster für Icons mit Suche. `onPick(id)`; id = null heisst "automatisch (aus dem Namen)".
function showIconPicker({ name = "", current = null, onPick }) {
  const suggestion = suggestIcon(name);
  const { overlay, close } = openDialog(`
    <strong>Icon wählen</strong>
    <p class="muted dialog-note icon-picker-hint"></p>
    <div class="search-field icon-picker-search">${icon("search")}<input type="search" class="search-input" placeholder="Icon suchen (z.B. Käse)"
      autocomplete="off" aria-label="Icons durchsuchen" maxlength="40" /></div>
    <div class="icon-grid"></div>
    <div class="photo-actions">
      <button type="button" data-action="auto" class="secondary">Automatisch</button>
      <button type="button" data-action="close" class="secondary">Abbrechen</button>
    </div>
  `);
  overlay.querySelector(".icon-picker-hint").textContent = suggestion
    ? `Vorschlag für „${name}“: ${ITEM_ICONS[suggestion].label}`
    : name ? `Kein Vorschlag für „${name}“ – bitte wählen.` : "Bitte ein Icon wählen.";
  const grid = overlay.querySelector(".icon-grid");
  const input = overlay.querySelector("input");
  function render() {
    let ids = searchIcons(input.value);
    if (!input.value.trim() && suggestion) ids = [suggestion, ...ids.filter((x) => x !== suggestion)];
    grid.innerHTML = ids.length
      ? ids.map((id) => `<button type="button" class="icon-choice" data-icon="${id}" aria-pressed="${id === current}"${id === suggestion ? ' data-suggested="1"' : ""}>${itemIconSvg(id)}<span>${escapeHtml(ITEM_ICONS[id].label)}</span></button>`).join("")
      : `<p class="empty-hint">Kein Icon gefunden.</p>`;
  }
  render();
  input.addEventListener("input", render);
  grid.addEventListener("click", (e) => {
    const b = e.target.closest("[data-icon]");
    if (!b) return;
    close();
    onPick(b.dataset.icon);
  });
  overlay.querySelector('[data-action="auto"]').addEventListener("click", () => {
    close();
    onPick(null);
  });
}

// Auswahl des MHD: Schnellwahl, Kalender, entfernen, (Experiment) mit Kamera lesen.
function showMhdDialog(containerId, itemId, item) {
  const today = new Date();
  const current = isValidIsoDate(item.mhd) ? item.mhd : "";
  const { overlay, close } = openDialog(`
    <strong></strong>
    <span class="muted">Mindestens haltbar bis: <b>${current ? escapeHtml(formatDate(current)) : "–"}</b></span>
    <div class="photo-actions">
      <button type="button" data-add="3">+3 Tage</button>
      <button type="button" data-add="7">+1 Woche</button>
      <button type="button" data-add="m1">+1 Monat</button>
    </div>
    <label class="muted" for="mhd-date">Datum wählen:</label>
    <div class="photo-actions">
      <input type="date" id="mhd-date" class="big-select" min="2000-01-01" max="2099-12-31" value="${escapeHtml(current || addToDate(today, { days: 7 }))}" />
      <button type="button" data-action="date">OK</button>
    </div>
    <div class="photo-actions">
      <button type="button" data-action="camera" class="secondary">${icon("camera")}Datum mit Kamera lesen (Experiment)</button>
    </div>
    <div class="photo-actions">
      ${current ? `<button type="button" data-action="clear" class="danger">MHD entfernen</button>` : ""}
      <button type="button" data-action="close" class="secondary">Abbrechen</button>
    </div>
  `);
  overlay.querySelector("strong").textContent = item.name;
  overlay.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => {
    const v = b.dataset.add;
    close();
    saveMhd(containerId, itemId, item, addToDate(today, v === "m1" ? { months: 1 } : { days: Number(v) }));
  }));
  overlay.querySelector('[data-action="date"]').addEventListener("click", () => {
    const v = overlay.querySelector("#mhd-date").value;
    if (!isValidIsoDate(v)) {
      toast("Bitte ein gültiges Datum wählen");
      return;
    }
    close();
    saveMhd(containerId, itemId, item, v);
  });
  overlay.querySelector('[data-action="clear"]')?.addEventListener("click", () => {
    close();
    saveMhd(containerId, itemId, item, "");
  });
  overlay.querySelector('[data-action="camera"]').addEventListener("click", () => {
    close();
    readDateWithCamera(containerId, itemId, item);
  });
}

// Experiment: Foto der Packung → zuerst GS1-Code (DataMatrix/QR mit Verfallsdatum, AI 17), sonst
// Texterkennung (tesseract.js, wird erst jetzt geladen). Der Vorschlag muss immer bestätigt werden.
const mhdInput = document.createElement("input");
mhdInput.type = "file";
mhdInput.accept = "image/*";
mhdInput.setAttribute("capture", "environment");
mhdInput.style.display = "none";
document.body.appendChild(mhdInput);
let pendingMhdTarget = null;

mhdInput.addEventListener("change", () => {
  const file = mhdInput.files[0];
  const target = pendingMhdTarget;
  mhdInput.value = "";
  if (file && target) recognizeMhd(target, file);
});

function readDateWithCamera(containerId, itemId, item) {
  pendingMhdTarget = { containerId, itemId, item };
  mhdInput.click();
}

async function gs1DatesFromImage(canvas) {
  if (!("BarcodeDetector" in window)) return [];
  try {
    const supported = await BarcodeDetector.getSupportedFormats();
    const formats = ["data_matrix", "qr_code"].filter((f) => supported.includes(f));
    if (!formats.length) return [];
    const codes = await new BarcodeDetector({ formats }).detect(canvas);
    return [...new Set(codes.map((c) => parseGs1Expiry(c.rawValue)).filter(Boolean))];
  } catch (err) {
    console.warn("Barcode-Erkennung nicht möglich:", err);
    return [];
  }
}

async function recognizeMhd({ containerId, itemId, item }, file) {
  let canvas;
  try {
    canvas = scaledCanvas(await loadBlobImage(file), 1600);
  } catch (err) {
    toast("Foto konnte nicht gelesen werden", 3000);
    return;
  }
  let dates = await gs1DatesFromImage(canvas);
  let source = "Code";
  let rawText = "";
  if (!dates.length) {
    source = "Text";
    try {
      toast("Texterkennung wird geladen… (beim ersten Mal ca. 4 MB)", 8000);
      const { recognizeText } = await import("./ocr.js");
      rawText = await recognizeText(canvas, (p) => toast(`Text wird erkannt… ${Math.round(p * 100)}%`, 8000));
      dates = parseDatesFromText(rawText, new Date());
    } catch (err) {
      console.error("Texterkennung fehlgeschlagen:", err);
      toast(`Texterkennung nicht möglich (${err.message || err})`, 4000);
      return;
    }
  }
  showMhdSuggestions(containerId, itemId, item, dates.slice(0, 4), source, rawText);
}

function showMhdSuggestions(containerId, itemId, item, dates, source, rawText) {
  const { overlay, close } = openDialog(`
    <strong></strong>
    <span class="muted">${dates.length
      ? `Erkannt (${source === "Code" ? "aus dem Code" : "aus dem Text"}) – bitte prüfen:`
      : "Kein Datum erkannt. Bitte im Kalender wählen."}</span>
    ${dates.map((d) => `<div class="photo-actions"><button type="button" data-date="${escapeHtml(d)}">${escapeHtml(formatDate(d))} übernehmen</button></div>`).join("")}
    ${rawText ? `<small class="muted ocr-text"></small>` : ""}
    <div class="photo-actions">
      <button type="button" data-action="manual" class="secondary">Selbst wählen</button>
      <button type="button" data-action="close" class="secondary">Abbrechen</button>
    </div>
  `);
  overlay.querySelector("strong").textContent = item.name;
  const raw = overlay.querySelector(".ocr-text");
  if (raw) raw.textContent = `Gelesen: ${rawText.replace(/\s+/g, " ").trim().slice(0, 120)}`;
  overlay.querySelectorAll("[data-date]").forEach((b) => b.addEventListener("click", () => {
    close();
    saveMhd(containerId, itemId, item, b.dataset.date);
  }));
  overlay.querySelector('[data-action="manual"]').addEventListener("click", () => {
    close();
    showMhdDialog(containerId, itemId, item);
  });
}

// Detailansicht eines Artikels: Foto gross, Foto ändern, MHD, Verschieben, Entfernen.
function showItemDetails(containerId, itemId, item) {
  const hasPhoto = isSafePhoto(item.photo);
  const iconId = iconForItem(item);
  const ro = readOnly();
  const { overlay, close } = openDialog(`
    ${hasPhoto ? `<img alt="" />` : iconId ? `<div class="detail-icon">${itemIconSvg(iconId)}</div>` : ""}
    <strong></strong>
    <span class="muted">${escapeHtml(String(item.qty ?? 1))} ${escapeHtml(item.unit || "")}</span>
    <span class="muted">${isValidIsoDate(item.mhd) ? mhdBadge(item.mhd) : "MHD: –"}</span>
    ${ro ? `<span class="muted">${escapeHtml(LOCKED_TEXT)}.</span>` : `
    <div class="photo-actions">
      <button type="button" data-action="change">${icon("camera")}${hasPhoto ? "Foto ändern" : "Foto"}</button>
      <button type="button" data-action="icon" class="neutral">${itemIconSvg(iconId || FALLBACK_ICON)}Icon wählen</button>
    </div>
    <div class="photo-actions">
      <button type="button" data-action="mhd" class="neutral">${icon("calendar")}MHD</button>
      <button type="button" data-action="move" class="neutral">${icon("move")}Verschieben</button>
    </div>
    <div class="photo-actions">
      <button type="button" data-action="del" class="danger">${icon("trash")}Entfernen</button>
    </div>`}
    <div class="photo-actions">
      <button type="button" data-action="close" class="secondary">Schliessen</button>
    </div>
  `);
  if (hasPhoto) overlay.querySelector("img").src = item.photo;
  overlay.querySelector("strong").textContent = item.name;
  if (ro) return;
  overlay.querySelector('[data-action="change"]').addEventListener("click", () => {
    close();
    openPhotoPicker(containerId, itemId);
  });
  overlay.querySelector('[data-action="icon"]').addEventListener("click", () => {
    close();
    showIconPicker({
      name: item.name,
      current: isKnownIcon(item.icon) ? item.icon : null,
      onPick: (id) => saveIcon(containerId, itemId, item, id),
    });
  });
  overlay.querySelector('[data-action="mhd"]').addEventListener("click", () => {
    close();
    showMhdDialog(containerId, itemId, item);
  });
  overlay.querySelector('[data-action="move"]').addEventListener("click", () => {
    close();
    showMoveDialog(containerId, [{ itemId, item }]);
  });
  const delBtn = overlay.querySelector('[data-action="del"]');
  delBtn.addEventListener("click", confirmFirst(delBtn, () => {
    close();
    removeItem(containerId, itemId, item);
  }, "Entfernen?"));
}

// Ziele zum Verschieben: alle Behälter ausser dem aktuellen, mit Pfad, alphabetisch nach Pfad.
async function moveTargets(fromId) {
  await containersReady();
  return parentOptions(null, allContainers)
    .filter((o) => o.id !== fromId)
    .map((o) => ({ id: o.id, name: allContainers.get(o.id)?.name || o.id, label: o.label }));
}

// Verschieben-Dialog für einen oder mehrere Artikel: entries = [{ itemId, item }].
async function showMoveDialog(fromId, entries, onDone = () => {}) {
  const { overlay, close } = openDialog(`
    <strong></strong>
    <label class="muted" for="move-target">Verschieben nach:</label>
    <select id="move-target" class="big-select"><option value="">Lade…</option></select>
    ${canScan ? `<div class="photo-actions"><button type="button" data-action="scan" class="secondary" disabled>${icon("scan")}Ziel-QR-Code scannen</button></div>` : ""}
    <small class="muted" id="move-hint" role="status"></small>
    <div class="photo-actions">
      <button type="button" data-action="ok" disabled>Verschieben</button>
      <button type="button" data-action="close" class="secondary">Abbrechen</button>
    </div>
  `);
  overlay.querySelector("strong").textContent = entries.length === 1 ? entries[0].item.name : `${entries.length} Artikel`;
  const select = overlay.querySelector("select");
  const ok = overlay.querySelector('[data-action="ok"]');
  try {
    const targets = await moveTargets(fromId);
    select.innerHTML = targets.length
      ? targets.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)}</option>`).join("")
      : `<option value="">Kein anderer Behälter vorhanden</option>`;
    ok.disabled = !targets.length;
    setupMoveScan(overlay, fromId, targets);
    ok.addEventListener("click", () => {
      const target = targets.find((c) => c.id === select.value);
      if (!target) return;
      close();
      moveItems(fromId, entries, target).then(onDone);
    });
  } catch (err) {
    console.error(err);
    select.innerHTML = `<option value="">Fehler: ${escapeHtml(err.code || err.message)}</option>`;
  }
}

// Umzugsziel per QR-Code (nur wo der In-App-Scanner geht). Der Code muss ein Behälter-Link dieser
// App sein (gleiche Prüfung wie beim normalen Scan). Ein unbekannter Behälter wird hier bewusst NICHT
// angelegt – sonst entstünde durch einen Fehlscan ein leerer Behälter, in den Artikel verschwinden.
// Der Scan wählt das Ziel nur aus; verschoben wird erst mit "Verschieben".
function setupMoveScan(overlay, fromId, targets) {
  const btn = overlay.querySelector('[data-action="scan"]');
  if (!btn) return;
  const select = overlay.querySelector("#move-target");
  const hint = overlay.querySelector("#move-hint");
  btn.disabled = false;
  select.addEventListener("change", () => { hint.textContent = ""; hint.classList.remove("move-hint-ok"); });
  btn.addEventListener("click", () => {
    let warned = false;
    openScanner({
      hint: "QR-Code des Ziel-Behälters ins Bild halten",
      onCode: (raw) => {
        // Übungs-Codes nur im Übungsmodus, echte nur ausserhalb.
        const t = scanTarget(raw, location.href);
        const r = t && t.practice === PRACTICE ? moveTargetFromScan(raw, location.href, fromId, allContainers) : { error: "invalid" };
        if (r.error === "invalid") {
          if (!warned) { warned = true; toast("Das ist kein QR-Code dieser App"); }
          return false;
        }
        if (!overlay.isConnected) return true;
        hint.classList.remove("move-hint-ok");
        if (r.error === "same") {
          hint.textContent = "Das ist der Behälter, aus dem verschoben wird. Bitte ein anderes Ziel scannen.";
        } else if (r.error === "unknown" || !targets.some((t) => t.id === r.id)) {
          hint.textContent = `„${r.name || r.id}“ gibt es noch nicht – als Ziel nicht möglich. Behälter zuerst öffnen bzw. anlegen (QR-Code normal scannen), dann erneut verschieben.`;
        } else {
          select.value = r.id;
          hint.textContent = `Ziel: ${pathLabel(r.id)} – mit "Verschieben" bestätigen.`;
          hint.classList.add("move-hint-ok");
        }
        toast(hint.textContent, 4000);
        return true;
      },
    });
  });
}

function itemBackup(item) {
  const data = {
    name: item.name,
    qty: parseQty(item.qty),
    unit: UNITS.includes(item.unit) ? item.unit : "Stk",
    updatedAt: serverTimestamp(),
  };
  if (isSafePhoto(item.photo)) data.photo = item.photo;
  if (isValidIsoDate(item.mhd)) data.mhd = item.mhd;
  if (isKnownIcon(item.icon)) data.icon = item.icon;
  return data;
}

// Verschiebt Artikel in einen anderen Behälter – alle in einem Batch (dort anlegen bzw. Menge
// addieren, hier löschen). Artikel mit gleicher ID, aber anderer Einheit im Ziel werden übersprungen.
// Mit "Rückgängig" (ebenfalls ein Batch).
async function moveItems(fromId, entries, target) {
  if (blockedByLock()) return;
  try {
    const plans = await Promise.all(entries.map(async ({ itemId, item }) => {
      const targetItemId = isValidId(itemId) ? itemId : slugify(item.name);
      const dst = itemRef(target.id, targetItemId);
      const existing = await getDoc(dst);
      return { itemId, item, targetItemId, dst, existing: existing.exists() ? existing.data() : null };
    }));
    const batch = writeBatch(db);
    const undoTarget = [];
    const undoSource = [];
    const skipped = [];
    const movedPlans = [];
    const usedTargets = new Set();
    for (const p of plans) {
      if (usedTargets.has(p.targetItemId)) {
        skipped.push(`"${p.item.name}" (gleicher Name wie ein anderer ausgewählter Artikel)`);
        continue;
      }
      const unit = UNITS.includes(p.item.unit) ? p.item.unit : "Stk";
      const qty = parseQty(p.item.qty);
      const src = itemRef(fromId, p.itemId);
      if (p.existing) {
        const t = p.existing;
        if ((t.unit || "Stk") !== unit) {
          skipped.push(`"${t.name}" (dort in ${t.unit})`);
          continue;
        }
        const delta = Math.max(0, Math.min(qty, MAX_QTY - (t.qty || 0)));
        if (delta < qty) {
          skipped.push(`"${t.name}" (Menge im Ziel zu gross)`);
          continue;
        }
        const upd = { qty: increment(delta), updatedAt: serverTimestamp() };
        const back = { qty: increment(-delta), updatedAt: serverTimestamp() };
        if (!isSafePhoto(t.photo) && isSafePhoto(p.item.photo)) { upd.photo = p.item.photo; back.photo = deleteField(); }
        if (!isValidIsoDate(t.mhd) && isValidIsoDate(p.item.mhd)) { upd.mhd = p.item.mhd; back.mhd = deleteField(); }
        if (!isKnownIcon(t.icon) && isKnownIcon(p.item.icon)) { upd.icon = p.item.icon; back.icon = deleteField(); }
        batch.update(p.dst, upd);
        undoTarget.push((b) => b.update(p.dst, back));
      } else {
        const data = itemBackup(p.item);
        data.unit = unit;
        batch.set(p.dst, data);
        undoTarget.push((b) => b.delete(p.dst));
      }
      batch.delete(src);
      usedTargets.add(p.targetItemId);
      // Ältere IDs (nicht im App-Format) dürfen laut Regeln nicht neu angelegt werden → unter der
      // neuen ID wiederherstellen.
      const backup = itemBackup(p.item);
      const restoreRef = isValidId(p.itemId) ? src : itemRef(fromId, p.targetItemId);
      undoSource.push((b) => b.set(restoreRef, backup));
      movedPlans.push(p);
    }
    const moved = movedPlans.length;
    if (skipped.length) {
      alert(`Nicht verschoben nach "${target.name}" (andere Einheit o.ä.): ${skipped.join(", ")}. Bitte dort zuerst anpassen.`);
    }
    if (!moved) return;
    background(batch.commit().then(() => emit("move-done", { containerId: target.id })), "Verschieben");
    const label = moved === 1 ? `"${movedPlans[0].item.name}"` : `${moved} Artikel`;
    const hash = moved === 1 ? `#i=${encodeURIComponent(movedPlans[0].targetItemId)}` : "";
    toast(`${label} → ${target.name}`, {
      ms: 6000,
      actions: [
        { label: "Öffnen", fn: () => { setTimeout(() => { location.href = `index.html?c=${encodeURIComponent(target.id)}${hash}`; }, 300); } },
        { label: "Rückgängig", fn: () => {
          // Zwei Batches: Die Quelle wird auch dann wiederhergestellt, wenn das Ziel inzwischen
          // geändert wurde (z.B. jemand hat dort etwas entnommen).
          const src = writeBatch(db);
          undoSource.forEach((op) => op(src));
          background(src.commit(), "Rückgängig");
          const dst = writeBatch(db);
          undoTarget.forEach((op) => op(dst));
          background(dst.commit(), "Rückgängig im Ziel");
          toast("Verschieben rückgängig gemacht");
        } },
      ],
    });
  } catch (err) {
    console.error(err);
    toast(`Verschieben fehlgeschlagen (${err.code || err.message})`, 4000);
  }
}

// --- Alle Artikel (für die Suche "Wo ist …?" und die Liste "läuft bald ab") ---
// Werden erst geladen, wenn sie gebraucht werden (erstes Tippen in der Suche bzw. Öffnen der Liste),
// und dann für diese Seite gemerkt: eine Abfrage statt einer pro Tastendruck (spart Lesezugriffe).
// Ergebnis: [{ id, containerId, name, qty, unit, mhd?, photo? }].
let allItemsPromise = null;

function loadAllItems() {
  if (!allItemsPromise) {
    allItemsPromise = fetchAllItems().catch((err) => {
      allItemsPromise = null; // beim nächsten Mal erneut versuchen
      throw err;
    });
  }
  return allItemsPromise;
}

async function fetchAllItems() {
  let docs;
  try {
    docs = (await getDocs(collectionGroup(db, "items"))).docs;
  } catch (err) {
    // Ältere Regeln (ohne Collection-Group-Freigabe): Behälter einzeln abfragen.
    if (err.code !== "permission-denied") throw err;
    await containersReady();
    const snaps = await Promise.all([...allContainers.keys()].map((id) => getDocs(collection(db, "containers", id, "items"))));
    docs = snaps.flatMap((s) => s.docs);
  }
  return docs
    .filter((d) => d.ref.parent.parent?.parent.id === "containers")
    .map((d) => ({ id: d.id, containerId: d.ref.parent.parent.id, ...d.data() }));
}

// --- QR-Scanner in der App (Android/Chrome: BarcodeDetector; sonst normale Kamera-App benutzen) ---

const SCANNED_KEY = "scannedContainer";

// Darf ein fehlender Behälter automatisch angelegt werden? Nur wenn der Link von aussen kommt
// (QR-Code mit der Kamera-App, NFC, Lesezeichen) oder gerade mit dem In-App-Scanner gescannt wurde –
// nicht bei Links innerhalb der App (Zurück-Taste, "Zuletzt", veraltete Übersicht, Suchtreffer).
// Sonst würde ein gerade gelöschter Behälter sofort wieder angelegt.
function mayAutoCreate(id) {
  let scanned = null;
  try {
    scanned = sessionStorage.getItem(SCANNED_KEY);
    sessionStorage.removeItem(SCANNED_KEY);
  } catch {}
  if (scanned === id) {
    forgetDeleted(id);
    return true;
  }
  if (deletedIds().includes(id)) return false;
  try {
    return !document.referrer || new URL(document.referrer).origin !== location.origin;
  } catch {
    return true;
  }
}

// Scannen geht überall mit Kamera: mit dem eingebauten BarcodeDetector (Android/Chrome), sonst mit
// jsQR (iPhone/Safari, Firefox), das erst beim ersten Scan geladen wird.
const canScan = !!navigator.mediaDevices?.getUserMedia;

let jsQrPromise = null;
function loadJsQr() {
  jsQrPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "vendor/jsqr-1.4.0/jsQR.js";
    s.onload = () => (window.jsQR ? resolve(window.jsQR) : reject(new Error("jsQR fehlt")));
    s.onerror = () => { jsQrPromise = null; reject(new Error("QR-Erkennung nicht geladen")); };
    document.head.appendChild(s);
  });
  return jsQrPromise;
}

// → async (video) => [rawValue, …]
async function createQrDetector() {
  if ("BarcodeDetector" in window) {
    try {
      const formats = await BarcodeDetector.getSupportedFormats?.();
      if (!formats || formats.includes("qr_code")) {
        const detector = new BarcodeDetector({ formats: ["qr_code"] });
        return async (video) => (await detector.detect(video)).map((c) => c.rawValue);
      }
    } catch {}
  }
  const jsQR = await loadJsQr();
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return async (video) => {
    // Auf max. 640 px verkleinern – reicht für QR-Codes und hält ältere Handys flüssig.
    const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    if (!w || !h) return [];
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
    return code?.data ? [code.data] : [];
  };
}

// Kamera-Scanner. Ohne Optionen: Behälter-QR-Code → Behälter öffnen (legt ihn ggf. an).
// Mit `onCode(rawValue)`: der Aufrufer prüft den Code selbst (z.B. Umzugsziel); liefert onCode
// true, wird der Scanner geschlossen, sonst wird weitergesucht.
async function openScanner({ hint = "QR-Code eines Behälters ins Bild halten", onCode = null } = {}) {
  const detectorReady = createQrDetector(); // lädt ggf. jsQR, während die Kamera startet
  detectorReady.catch(() => {});
  let stream, detect;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  } catch (err) {
    toast(`Kamera nicht verfügbar (${err.name || err.message})`, 4000);
    return;
  }
  try {
    detect = await detectorReady;
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    toast(`QR-Erkennung nicht verfügbar (${err.message})`, 4000);
    return;
  }
  const { overlay, close } = openDialog(`
    <video class="scanner-video" playsinline muted autoplay></video>
    <span class="muted"></span>
    <div class="photo-actions"><button type="button" data-action="close" class="secondary">Abbrechen</button></div>
  `);
  overlay.querySelector("span.muted").textContent = hint;
  const video = overlay.querySelector("video");
  video.srcObject = stream;
  let active = true;
  const stop = () => {
    active = false;
    stream.getTracks().forEach((t) => t.stop());
  };
  new MutationObserver((_, obs) => {
    if (!overlay.isConnected) { stop(); obs.disconnect(); }
  }).observe(document.body, { childList: true });

  let warned = false;
  let warnedReal = false;
  const tick = async () => {
    if (!active) return;
    try {
      if (video.readyState >= 2) {
        for (const raw of await detect(video)) {
          if (onCode) {
            if (onCode(raw)) {
              stop();
              close();
              return;
            }
            continue;
          }
          const target = scanTarget(raw, location.href);
          if (target && PRACTICE && !target.practice) {
            // Echter Code im Übungsmodus: nichts öffnen, nichts anlegen.
            if (!warnedReal) {
              warnedReal = true;
              toast("Das ist ein echter Behälter-Code. Im Übungsmodus öffnen sich nur Übungs-Codes – zum Öffnen die Übung beenden.", 5000);
            }
            continue;
          }
          if (target) {
            stop();
            close();
            const name = new URL(raw).searchParams.get("n");
            try { sessionStorage.setItem(SCANNED_KEY, target.id); } catch {}
            // Übungs-Code ausserhalb der Übung → öffnet ihn im Übungsmodus.
            location.href = containerUrl(location.href, target.id, name, { practice: target.practice });
            return;
          }
          if (!warned) { warned = true; toast("Das ist kein QR-Code dieser App"); }
        }
      }
    } catch (err) {
      console.error(err);
    }
    setTimeout(tick, 250);
  };
  tick();
}

// --- Anmeldung per E-Mail-Link (ohne Passwort) ---

const EMAIL_KEY = "emailForSignIn";
let loginError = null;

// Im Übungsmodus eigene Schlüssel ("uebung:…"), damit "Zuletzt", gelöschte Behälter und die
// QR-Liste der Übung nie mit den echten vermischt werden.
function storageKey(key) {
  return PRACTICE ? `uebung:${key}` : key;
}

function storageGet(key) {
  try { return localStorage.getItem(storageKey(key)); } catch { return null; }
}

function storageSet(key, value) {
  try {
    if (value === null) localStorage.removeItem(storageKey(key));
    else localStorage.setItem(storageKey(key), value);
  } catch {}
}

// Entfernt die Login-Parameter aus der Adresszeile, behält aber ?c= / &n= (Behälter vom QR-Code).
function cleanUrl() {
  const url = new URL(location.href);
  const keep = new URLSearchParams();
  for (const key of ["c", "n"]) {
    const v = url.searchParams.get(key);
    if (v) keep.set(key, v);
  }
  url.search = keep.toString();
  history.replaceState(null, "", url.href);
}

// Wird aufgerufen, wenn die Seite über den Link aus der Anmelde-Mail geöffnet wurde.
async function completeEmailLinkSignIn() {
  if (!isSignInWithEmailLink(auth, location.href)) return;
  // Mail auf einem anderen Gerät geöffnet als angefordert → Adresse ist dort nicht gespeichert.
  const email = storageGet(EMAIL_KEY)
    || prompt("Zur Bestätigung bitte nochmals deine E-Mail-Adresse eingeben:");
  if (email) {
    try {
      await signInWithEmailLink(auth, email.trim(), location.href);
      storageSet(EMAIL_KEY, null);
    } catch (err) {
      console.error(err);
      loginError = err.code === "auth/invalid-action-code"
        ? "Der Link ist abgelaufen oder wurde schon benutzt. Bitte neuen Link anfordern."
        : `Anmeldung fehlgeschlagen (${err.code || err.message})`;
    }
  }
  cleanUrl();
}

function renderLogin() {
  main.innerHTML = `
    <h1>Anmelden</h1>
    <p class="muted">Gib deine E-Mail-Adresse ein. Du bekommst einen Link, mit dem du dich ohne Passwort
      anmeldest. Danach bleibst du auf diesem Gerät angemeldet.</p>
    <form class="add-form" id="login-form">
      <input name="email" type="email" autocomplete="email" placeholder="E-Mail-Adresse" required />
      <button type="submit">Link senden</button>
    </form>
    <p class="muted" id="login-status">${loginError ? escapeHtml(loginError) : ""}</p>
    <div class="try-practice">
      <p class="muted">Noch nicht freigeschaltet oder erst einmal ausprobieren? Im Übungsmodus übst du mit
        Beispieldaten – nur auf diesem Gerät, ohne Anmeldung.</p>
      <a class="button-link" href="index.html?uebung=1" id="try-practice">${icon("practice")}Ohne Anmeldung ausprobieren</a>
    </div>
  `;
  loadTutorial().then((m) => m.showFirstRunHint(tutorialCtx("login"))).catch(() => {});
  const status = document.getElementById("login-status");
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = e.target.email.value.trim();
    if (!email) return;
    status.textContent = "Sende Link…";
    try {
      // Nach dem Klick auf den Link landet man wieder genau hier (inkl. ?c= vom QR-Code).
      await sendSignInLinkToEmail(auth, email, { url: location.href, handleCodeInApp: true });
      storageSet(EMAIL_KEY, email);
      status.textContent = `Link an ${email} gesendet. Bitte Mail öffnen (auch im Junk-/Spam-Ordner nachschauen).`;
    } catch (err) {
      console.error(err);
      status.textContent = `Senden fehlgeschlagen (${err.code || err.message})`;
    }
  });
}

function showLogout(user) {
  const btn = document.getElementById("logout-btn");
  if (!btn) return;
  btn.hidden = false;
  btn.title = user.email || "";
  btn.addEventListener("click", async () => {
    await signOut(auth);
    storageSet(QR_LIST_KEY, null);
    clearPracticeStorage();
    // Offline-Kopie der Daten auf diesem Gerät löschen (wichtig auf fremden/geteilten Geräten).
    try {
      await terminate(db);
      await clearIndexedDbPersistence(db);
    } catch (err) {
      console.warn("Offline-Speicher konnte nicht gelöscht werden:", err);
    }
    location.reload();
  });
}

// --- Balken oben: Übungsmodus bzw. Sperre ---

function updateModeBar() {
  const bar = document.getElementById("mode-bar");
  document.body.classList.toggle("read-only", readOnly());
  document.body.classList.toggle("practice", PRACTICE);
  if (!bar) return;
  let html = "";
  if (PRACTICE) {
    html = `<span class="mode-text">${icon("practice")}<span><b>Übungsmodus</b> – Beispieldaten nur auf diesem Gerät. Dein echtes Inventar bleibt unberührt.</span></span>
      <button type="button" data-mode="end">Beenden</button>`;
  } else if (lockState.locked && lockState.owner) {
    html = `<span class="mode-text">${icon("lock")}<span><b>Gesperrt für andere</b> – nur du kannst ändern.</span></span>
      <button type="button" data-mode="unlock">Entsperren</button>`;
  } else if (lockState.locked) {
    const by = lockState.lockedBy ? ` (von ${escapeHtml(lockState.lockedBy)})` : "";
    html = `<span class="mode-text">${icon("lock")}<span><b>Vorübergehend gesperrt</b>${by} – nur Lesen.</span></span>
      <button type="button" data-mode="practice">Zum Üben</button>`;
  }
  bar.hidden = !html;
  bar.className = `mode-bar${PRACTICE ? " mode-practice" : " mode-lock"}`;
  bar.innerHTML = html;
  bar.querySelector('[data-mode="end"]')?.addEventListener("click", endPractice);
  bar.querySelector('[data-mode="unlock"]')?.addEventListener("click", toggleLock);
  bar.querySelector('[data-mode="practice"]')?.addEventListener("click", () => { location.href = "index.html?uebung=1"; });
}

// Owner: Sperre setzen/aufheben (mit Bestätigung). Schreibt direkt (nicht über guard – Owner ist nie readOnly).
function toggleLock() {
  if (PRACTICE || !lockState.owner) return;
  const lock = !lockState.locked;
  const ok = confirm(lock
    ? "Echte Daten für alle anderen sperren?\nSie können dann nur noch lesen, bis du wieder entsperrst. Üben geht weiterhin im Übungsmodus."
    : "Echte Daten wieder für alle freigeben?");
  if (!ok) return;
  background(firestoreMod.setDoc(doc(db, "settings", "lock"), {
    locked: lock,
    lockedAt: serverTimestamp(),
    lockedBy: lockState.name || "Owner",
  }), lock ? "Sperren" : "Entsperren");
  toast(lock ? "Gesperrt – andere können nur noch lesen" : "Entsperrt – alle können wieder ändern", 3000);
}

// Rolle (eigenes members-Dokument) und Sperre (settings/lock) beobachten. Mit älteren Regeln sind
// beide nicht lesbar → kein Owner, nicht gesperrt (wie bisher).
// Rolle und Sperre werden parallel geladen. Die Rolle wird nur beim Start gelesen (Änderung in der
// Konsole wirkt nach dem Neuladen).
function watchLock(user) {
  const email = (user.email || "").toLowerCase();
  const role = !email ? Promise.resolve() : getDoc(doc(db, "members", email)).then((m) => {
    const d = m.exists() ? m.data() : {};
    lockState.owner = d.role === "owner";
    lockState.name = typeof d.name === "string" ? d.name.trim().slice(0, 100) : "";
  }).catch(() => { lockState.owner = false; });
  let firstLock;
  const lockLoaded = new Promise((resolve) => { firstLock = resolve; });
  onSnapshot(doc(db, "settings", "lock"), (snap) => {
    const d = snap.exists() ? snap.data() : {};
    lockState.locked = d.locked === true;
    lockState.lockedBy = typeof d.lockedBy === "string" ? d.lockedBy.slice(0, 100) : "";
    firstLock();
    role.then(updateModeBar); // Bedienelemente blendet CSS aus (body.read-only), kein Neuaufbau nötig
  }, () => firstLock());
  Promise.all([role, lockLoaded]).then(() => { updateModeBar(); lockKnown(); });
}

// --- Hilfe: Einführung, Übungsmodus, Sperre (Owner) ---

let tutorialPromise = null;
function loadTutorial() {
  tutorialPromise ||= import("./tutorial.js");
  return tutorialPromise;
}

function currentView() {
  if (containerId) return "container";
  if (listView(listName)) return `list-${listName}`;
  return "overview";
}

function tutorialCtx(view = currentView()) {
  return {
    view,
    containerId: view === "container" ? containerId : null,
    practice: PRACTICE,
    navigate: (url) => { location.href = url; },
    startPracticeTutorial,
    endPractice,
  };
}

function startPracticeTutorial() {
  location.href = "index.html?uebung=1&tutorial=1";
}

function endPractice() {
  loadTutorial().then((m) => m.stopTutorial()).catch(() => {}).finally(() => {
    try { sessionStorage.removeItem(PRACTICE_KEY); } catch {}
    location.href = "index.html?uebung=0";
  });
}

// Übungsdaten dieses Geräts löschen (beim Abmelden – z.B. auf einem fremden Gerät).
function clearPracticeStorage() {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("uebung:") || k === "vorrat-uebung-db") localStorage.removeItem(k);
    }
  } catch {}
}

// Übungsdaten auf die Beispieldaten zurücksetzen (inkl. "Zuletzt" usw. der Übung).
function resetPractice() {
  if (!PRACTICE) return;
  firestoreMod.resetPracticeData();
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("uebung:")) localStorage.removeItem(k);
  } catch {}
  loadTutorial().then((m) => m.stopTutorial()).catch(() => {}).finally(() => {
    location.href = "index.html";
  });
}

function showHelpDialog() {
  const { overlay, close } = openDialog(`
    <strong>Hilfe</strong>
    <p class="muted dialog-note">Die Einführung zeigt dir Schritt für Schritt das Wichtigste – im Übungsmodus mit
      Beispieldaten, dein echtes Inventar bleibt unberührt.</p>
    <div class="photo-actions">
      <button type="button" data-action="tutorial">${icon("help")}Einführung starten</button>
    </div>
    ${PRACTICE ? `
    <div class="photo-actions">
      <button type="button" data-action="reset" class="neutral">Übung zurücksetzen</button>
      <button type="button" data-action="end" class="neutral">Übung beenden</button>
    </div>` : `
    <div class="photo-actions">
      <button type="button" data-action="practice" class="neutral">${icon("practice")}Übungsmodus</button>
    </div>`}
    ${!PRACTICE && lockState.owner ? `
    <p class="muted dialog-note">Nur für dich (Owner): ${lockState.locked ? "Die echten Daten sind für andere gesperrt." : "Sperren, damit andere vorübergehend nur lesen können."}</p>
    <div class="photo-actions">
      <button type="button" data-action="lock" class="neutral">${icon("lock")}${lockState.locked ? "Echte Daten entsperren" : "Echte Daten sperren"}</button>
    </div>` : ""}
    <div class="photo-actions">
      <button type="button" data-action="close" class="secondary">Schliessen</button>
    </div>
  `);
  overlay.querySelector('[data-action="tutorial"]').addEventListener("click", () => {
    close();
    if (!PRACTICE) {
      startPracticeTutorial();
      return;
    }
    loadTutorial().then((m) => m.startTutorial(tutorialCtx())).catch((err) => toast(`Einführung nicht verfügbar (${err.message})`, 4000));
  });
  overlay.querySelector('[data-action="practice"]')?.addEventListener("click", () => { location.href = "index.html?uebung=1"; });
  overlay.querySelector('[data-action="end"]')?.addEventListener("click", () => { close(); endPractice(); });
  const resetBtn = overlay.querySelector('[data-action="reset"]');
  resetBtn?.addEventListener("click", confirmFirst(resetBtn, () => { close(); resetPractice(); }, "Wirklich zurücksetzen?"));
  overlay.querySelector('[data-action="lock"]')?.addEventListener("click", () => { close(); toggleLock(); });
}

function setupHelp() {
  const btn = document.getElementById("help-btn");
  if (!btn) return;
  btn.hidden = false;
  btn.addEventListener("click", showHelpDialog);
}

// Hinweis, wenn kein Netz da ist (Änderungen werden dann später übertragen).
function watchOnline() {
  const badge = document.getElementById("offline-badge");
  if (!badge) return;
  const update = () => { badge.hidden = navigator.onLine; };
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}

// --- Zuletzt geöffnete Behälter (nur auf diesem Gerät, localStorage) ---

const RECENT_KEY = "recentContainers";
const RECENT_MAX = 6;

function loadRecent() {
  try {
    const list = JSON.parse(storageGet(RECENT_KEY) || "[]");
    return Array.isArray(list)
      ? list.filter((r) => r && typeof r.id === "string" && typeof r.name === "string" && !r.id.includes("/")).slice(0, RECENT_MAX)
      : [];
  } catch {
    return [];
  }
}

function rememberRecent(id, name) {
  const list = loadRecent().filter((r) => r.id !== id);
  list.unshift({ id, name: String(name).slice(0, MAX_NAME) });
  storageSet(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
}

// Auf diesem Gerät gelöschte Behälter: nie automatisch neu anlegen (auch nicht per altem Link).
// Ein bewusst mit dem In-App-Scanner gescannter QR-Code legt ihn trotzdem wieder an.
const DELETED_KEY = "deletedContainers";
function deletedIds() {
  try {
    const list = JSON.parse(storageGet(DELETED_KEY) || "[]");
    return Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function rememberDeleted(id) {
  storageSet(DELETED_KEY, JSON.stringify([id, ...deletedIds().filter((x) => x !== id)].slice(0, 50)));
}
function forgetDeleted(id) {
  storageSet(DELETED_KEY, JSON.stringify(deletedIds().filter((x) => x !== id)));
}

function forgetRecent(id) {
  storageSet(RECENT_KEY, JSON.stringify(loadRecent().filter((r) => r.id !== id)));
}

// Aktuelle Namen/Pfade, gelöschte Behälter weglassen (sobald die Behälterliste geladen ist).
function recentEntries() {
  return loadRecent()
    .filter((r) => !containersLoaded || allContainers.has(r.id))
    .map((r) => ({ id: r.id, label: containersLoaded ? pathLabel(r.id) : r.name }));
}

function showRecentDialog() {
  const entries = recentEntries();
  const { overlay } = openDialog(`
    <strong>Zuletzt geöffnet</strong>
    <div class="recent-list">${entries.length
      ? entries.map((r) => `<a class="card" href="index.html?c=${encodeURIComponent(r.id)}"><div class="name"><strong>${escapeHtml(r.label)}</strong></div><div aria-hidden="true">›</div></a>`).join("")
      : `<p class="empty-hint">Noch nichts geöffnet.</p>`}</div>
    <div class="photo-actions"><button type="button" data-action="close" class="secondary">Schliessen</button></div>
  `);
  void overlay;
}

// --- Navigationsleiste unten (Daumenbereich) ---

function setupBottomNav() {
  const nav = document.getElementById("bottom-nav");
  if (!nav) return;
  nav.hidden = false;
  document.body.classList.add("has-bottom-nav");
  nav.querySelector('[data-nav="search"]').addEventListener("click", () => {
    const input = document.getElementById("search");
    if (input) {
      input.scrollIntoView({ block: "center" });
      input.focus();
    } else {
      location.href = "index.html#suche";
    }
  });
  nav.querySelector('[data-nav="scan"]').addEventListener("click", () => {
    if (canScan) openScanner();
    else toast("Dieser Browser kann keine Kamera öffnen – QR-Code mit der Kamera-App scannen", 4000);
  });
  nav.querySelector('[data-nav="recent"]').addEventListener("click", showRecentDialog);
  const current = containerId ? null : listView(listName) ? listName : "home";
  if (current) nav.querySelector(`[data-nav="${current}"]`)?.setAttribute("aria-current", "page");
}

const params = new URLSearchParams(location.search);
const containerId = params.get("c");
// Listen über alle Behälter: ?liste=ablauf ("läuft bald ab"). Platz für weitere Listen (z.B. später
// ?liste=einkauf für die Einkaufsliste Küche/Kühlschrank) – siehe listView().
const listName = containerId ? null : params.get("liste");

if (!PRACTICE) await completeEmailLinkSignIn();
watchOnline();
setupHelp();
updateModeBar();

let started = false;
onAuthStateChanged(auth, (user) => {
  if (!user) {
    if (started) location.reload(); // in anderem Tab abgemeldet
    else renderLogin();
    return;
  }
  if (started) return;
  started = true;
  if (!PRACTICE) {
    showLogout(user);
    watchLock(user);
  }
  setupBottomNav();
  watchContainers();
  let view = currentView();
  if (containerId) {
    if (!renderContainer(containerId)) view = "other";
  } else if (listView(listName)) {
    listView(listName)();
  } else {
    renderOverview();
  }
  afterStart(view);
});

// Übungsmodus: Einführung fortsetzen bzw. (?tutorial=1) starten. Sonst auf der Übersicht einmalig
// den Hinweis auf die Einführung zeigen.
function afterStart(view) {
  if (PRACTICE) {
    const start = params.get("tutorial") === "1";
    if (start) {
      const url = new URL(location.href);
      url.searchParams.delete("tutorial");
      history.replaceState(null, "", url.href);
    }
    loadTutorial()
      .then((m) => (start ? m.startTutorial(tutorialCtx(view)) : m.resumeTutorial(tutorialCtx(view))))
      .catch((err) => console.error("Einführung nicht geladen:", err));
  } else if (view === "overview") {
    loadTutorial().then((m) => m.showFirstRunHint(tutorialCtx(view))).catch(() => {});
  }
}

function typeOptions(selected = "") {
  return `<option value="">Typ –</option>` + Object.entries(CONTAINER_TYPES)
    .map(([v, label]) => `<option value="${v}"${v === selected ? " selected" : ""}>${label}</option>`).join("");
}

// Karte für einen Behälter (Übersicht, Unterbehälter).
function containerCard(id, extra = "") {
  const c = allContainers.get(id) || { name: id };
  const kids = childContainers(id, allContainers).length;
  const meta = [typeLabel(c.type), kids ? `${kids} darin` : ""].filter(Boolean).join(" · ");
  const a = document.createElement("a");
  a.href = `index.html?c=${encodeURIComponent(id)}`;
  a.className = "card";
  a.dataset.cid = id;
  a.innerHTML = `${typeIcon(c.type) || `<span class="type-icon" aria-hidden="true"></span>`}<div class="name"><strong>${escapeHtml(c.name)}</strong><small>${escapeHtml(meta || extra)}</small></div><div aria-hidden="true">›</div>`;
  return a;
}

// --- Übersicht: Suche "Wo ist …?", Scanner, Behälterliste (oberste Ebene) ---

function renderOverview() {
  main.innerHTML = `
    <div class="hero">
      <div class="search-row">
        <div class="search-field">${icon("search")}<input type="search" id="search" class="search-input" placeholder="Wo ist …?"
          autocomplete="off" enterkeyhint="search" aria-label="Artikel suchen" maxlength="${MAX_NAME}" /></div>
        ${canScan ? `<button type="button" id="scan-btn" class="scan-btn" aria-label="QR-Code scannen">${icon("scan")}Scan</button>` : ""}
      </div>
    </div>
    <div id="search-results" class="search-results" hidden></div>
    <div id="recent" class="recent-chips" hidden></div>
    <div class="list-links"><a class="chip" href="index.html?liste=ablauf">${icon("alarm")}Läuft bald ab</a></div>
    <h1>Deine Behälter</h1>
    <div class="container-list" id="container-list"><p class="empty-hint">Lade…</p></div>
    <p class="muted"><a id="qr-all" href="qr.html" data-qr>${icon("print")}QR-Codes drucken (Auswahl)</a></p>
    <form class="add-form" id="new-container-form">
      <input name="name" placeholder="Neuer Behälter (z.B. Kühlschrank)" maxlength="${MAX_NAME}" required />
      <select name="type" aria-label="Typ">${typeOptions()}</select>
      <button type="submit">Anlegen</button>
    </form>
  `;

  const list = document.getElementById("container-list");
  const searchInput = document.getElementById("search");
  const results = document.getElementById("search-results");
  const recentEl = document.getElementById("recent");

  function renderRecent() {
    const entries = recentEntries().slice(0, 4);
    recentEl.hidden = !entries.length;
    recentEl.innerHTML = entries.length ? `<span class="muted">Zuletzt:</span>` : "";
    for (const r of entries) {
      const a = document.createElement("a");
      a.className = "chip";
      a.href = `index.html?c=${encodeURIComponent(r.id)}`;
      a.textContent = (allContainers.get(r.id)?.name) || r.label;
      recentEl.appendChild(a);
    }
  }
  renderRecent();

  onContainers((err) => {
    if (err) {
      showError(list, err);
      return;
    }
    renderRecent();
    if (!allContainers.size) {
      list.innerHTML = `<p class="empty-hint">Noch keine Behälter angelegt.</p>`;
      return;
    }
    list.innerHTML = "";
    const all = [...allContainers].sort((a, b) => pathLabel(a[0]).localeCompare(pathLabel(b[0]), "de"));
    setQrHref(document.getElementById("qr-all"));
    const top = all.filter(([id]) => isTopLevel(id, allContainers))
      .sort((a, b) => a[1].name.localeCompare(b[1].name, "de"));
    for (const [id] of top) list.appendChild(containerCard(id, id));
    if (searchInput.value) showResults();
  });

  // Suche über alle Behälter. Die Artikel werden erst beim ersten Tippen geladen (spart Lesezugriffe).
  let allItems = null;
  let loading = null;

  function showResults() {
    const q = searchInput.value;
    if (!normalizeSearch(q)) {
      results.hidden = true;
      return;
    }
    results.hidden = false;
    // Behälter selbst (z.B. "Gemüsefach") gleich anzeigen, Artikel sobald geladen.
    const containerHits = searchItems(
      [...allContainers].map(([id, c]) => ({ id, name: c.name, containerName: "" })), q, 5);
    results.innerHTML = "";
    for (const c of containerHits) {
      const a = containerCard(c.id);
      a.classList.add("result");
      a.querySelector("small").textContent = `Behälter · ${pathLabel(c.id)}`;
      results.appendChild(a);
    }
    if (!allItems) {
      results.insertAdjacentHTML("beforeend", `<p class="empty-hint">Suche…</p>`);
      return;
    }
    const withNames = allItems.map((it) => ({ ...it, containerName: pathLabel(it.containerId) }));
    const hits = searchItems(withNames, q);
    if (!hits.length && !containerHits.length) {
      results.innerHTML = `<p class="empty-hint">Nichts gefunden für „${escapeHtml(q)}“.</p>`;
      return;
    }
    for (const it of hits) {
      const a = document.createElement("a");
      a.className = "card result";
      a.href = `index.html?c=${encodeURIComponent(it.containerId)}#i=${encodeURIComponent(it.id)}`;
      a.innerHTML = `
        <span class="thumb-btn small">${thumbContent(it, icon("box"))}</span>
        <div class="name"><strong>${escapeHtml(it.name)}</strong><small>${escapeHtml(String(it.qty ?? 1))} ${escapeHtml(it.unit || "")} · in <b>${escapeHtml(it.containerName)}</b>${mhdSuffix(it.mhd)}</small></div>
        <div aria-hidden="true">›</div>`;
      const img = a.querySelector("img");
      if (img) img.src = it.photo;
      results.appendChild(a);
    }
    emit("search", { query: q });
  }

  searchInput.addEventListener("input", () => {
    showResults();
    if (!allItems && !loading && normalizeSearch(searchInput.value)) {
      loading = loadAllItems()
        .then((items) => { allItems = items; showResults(); })
        .catch((err) => showError(results, err))
        .finally(() => { loading = null; });
    }
  });
  if (location.hash === "#suche") {
    history.replaceState(null, "", "index.html");
    searchInput.focus();
  }

  document.getElementById("scan-btn")?.addEventListener("click", () => openScanner());

  document.getElementById("new-container-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (blockedByLock()) return;
    const name = e.target.name.value.trim().slice(0, MAX_NAME);
    const type = CONTAINER_TYPES[e.target.type.value] ? e.target.type.value : "";
    if (!name) return;
    const id = slugify(name);
    if (!isValidId(id)) {
      toast("Bitte einen Namen mit Buchstaben oder Ziffern eingeben", 3000);
      return;
    }
    if (allContainers.has(id)) {
      location.href = `index.html?c=${encodeURIComponent(id)}`;
      return;
    }
    const data = { name, createdAt: serverTimestamp() };
    if (type) data.type = type;
    background(setDoc(doc(db, "containers", id), data, { merge: true }), "Anlegen");
    e.target.reset();
    toast(`"${name}" angelegt`);
  });
}

// --- Listen über alle Behälter ---

// Name in ?liste= → Ansicht (oder null). Muss zu data-nav in index.html passen.
// (Funktion statt Objekt: wird schon beim Start gebraucht, und ?liste=constructor o.ä. trifft nichts.)
function listView(name) {
  switch (name) {
    case "ablauf": return renderExpiring;
    default: return null;
  }
}

const EXPIRY_WINDOW_KEY = "expiryWindow";

// Liste "läuft bald ab": alle Artikel mit MHD abgelaufen oder in ≤ 3 (bzw. 7) Tagen, das früheste
// zuerst, mit Behälterpfad. Antippen öffnet den Behälter und markiert den Artikel (#i=…).
// Lädt die Artikel einmal (gleiche Ladelogik wie die Suche) – erst wenn die Liste geöffnet wird.
function renderExpiring() {
  let days = Number(storageGet(EXPIRY_WINDOW_KEY));
  if (!EXPIRY_WINDOWS.includes(days)) days = EXPIRY_WINDOWS[0];
  document.title = "Läuft bald ab – Vorrat";
  main.innerHTML = `
    <div class="hero">
      <h1>Läuft bald ab</h1>
      <div class="segmented" role="group" aria-label="Zeitraum">
        ${EXPIRY_WINDOWS.map((d) => `<button type="button" data-days="${d}">≤ ${d} Tage</button>`).join("")}
      </div>
    </div>
    <p class="muted" id="expiring-count"></p>
    <div class="container-list" id="expiring-list"><p class="empty-hint">Lade…</p></div>
  `;
  const list = document.getElementById("expiring-list");
  const count = document.getElementById("expiring-count");
  const buttons = main.querySelectorAll("[data-days]");
  let items = null;

  function render() {
    buttons.forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.days) === days)));
    if (!items) return;
    const hits = expiringItems(items, new Date(), days);
    const expired = hits.filter((it) => it.days < 0).length;
    count.textContent = hits.length
      ? `${hits.length} Artikel${expired ? `, davon ${expired} abgelaufen` : ""}`
      : "";
    if (!hits.length) {
      list.innerHTML = `<p class="empty-hint">Nichts läuft in den nächsten ${days} Tagen ab.</p>`;
      return;
    }
    list.innerHTML = "";
    for (const it of hits) {
      const status = mhdStatus(it.mhd, new Date());
      const when = it.days < 0 ? `abgelaufen ${daysText(it.days)}` : daysText(it.days);
      const a = document.createElement("a");
      a.className = "card result expiring";
      a.dataset.id = it.id;
      a.dataset.cid = it.containerId;
      a.href = `index.html?c=${encodeURIComponent(it.containerId)}#i=${encodeURIComponent(it.id)}`;
      a.innerHTML = `
        <span class="thumb-btn small">${thumbContent(it, icon("box"))}</span>
        <div class="name"><strong>${escapeHtml(it.name)}</strong>
          <small><span class="mhd mhd-${status}">${escapeHtml(when)} · ${escapeHtml(formatDate(it.mhd))}</span></small>
          <small>${escapeHtml(String(it.qty ?? 1))} ${escapeHtml(it.unit || "")} · in <b>${escapeHtml(pathLabel(it.containerId))}</b></small></div>
        <div aria-hidden="true">›</div>`;
      const img = a.querySelector("img");
      if (img) img.src = it.photo;
      list.appendChild(a);
    }
  }

  buttons.forEach((b) => b.addEventListener("click", () => {
    days = Number(b.dataset.days);
    storageSet(EXPIRY_WINDOW_KEY, String(days));
    render();
  }));
  render();
  // Pfade aktualisieren, sobald (bzw. wenn sich) die Behälter geladen/geändert haben.
  onContainers((err) => { if (!err) render(); });
  loadAllItems()
    .then((all) => { items = all; render(); })
    .catch((err) => showError(list, err));
}

// --- Behälter bearbeiten: Name, Typ, "liegt in", löschen ---

function showContainerSettings(id, onDeleted) {
  const canDelete = isValidId(id); // ältere IDs könnten nach dem Löschen nicht wiederhergestellt werden
  const c = allContainers.get(id) || { name: id };
  const options = parentOptions(id, allContainers).filter((o) => o.id !== id);
  const { overlay, close } = openDialog(`
    <strong>Behälter bearbeiten</strong>
    <label class="muted" for="cs-name">Name</label>
    <input id="cs-name" class="big-select" maxlength="${MAX_NAME}" />
    <label class="muted" for="cs-type">Typ</label>
    <select id="cs-type" class="big-select">${typeOptions(c.type || "")}</select>
    <label class="muted" for="cs-parent">Liegt in</label>
    <select id="cs-parent" class="big-select">
      <option value="">– nirgends (oberste Ebene) –</option>
      ${options.map((o) => `<option value="${escapeHtml(o.id)}"${o.id === c.parent ? " selected" : ""}>${escapeHtml(o.label)}</option>`).join("")}
    </select>
    <div class="photo-actions">
      <button type="button" data-action="save">Speichern</button>
      <button type="button" data-action="close" class="secondary">Abbrechen</button>
    </div>
    <div class="photo-actions">
      ${canDelete ? `<button type="button" data-action="delete" class="danger">${icon("trash")}Behälter löschen</button>` : ""}
    </div>
    <small class="muted" id="cs-hint">Der QR-Code bleibt beim Umbenennen und Verschieben gültig.</small>
  `);
  const nameInput = overlay.querySelector("#cs-name");
  nameInput.value = c.name;
  overlay.querySelector('[data-action="save"]').addEventListener("click", () => {
    const name = nameInput.value.trim().slice(0, MAX_NAME);
    const type = overlay.querySelector("#cs-type").value;
    const parent = overlay.querySelector("#cs-parent").value;
    if (!name) {
      toast("Bitte einen Namen eingeben");
      return;
    }
    if (parent && (wouldCreateCycle(id, parent, allContainers) || !allContainers.has(parent))) {
      toast("Ein Behälter kann nicht in sich selbst oder einem eigenen Unterbehälter liegen", 4000);
      return;
    }
    close();
    background(setDoc(doc(db, "containers", id), {
      name,
      type: CONTAINER_TYPES[type] ? type : deleteField(),
      parent: parent || deleteField(),
    }, { merge: true }), "Speichern");
    toast("Gespeichert");
  });
  const deleteBtn = overlay.querySelector('[data-action="delete"]');
  deleteBtn?.addEventListener("click", confirmFirst(deleteBtn, async () => {
    const hint = overlay.querySelector("#cs-hint");
    const kids = childContainers(id, allContainers);
    if (kids.length) {
      hint.textContent = `Nicht möglich: Darin ${kids.length === 1 ? "liegt" : "liegen"} noch ${kids.map((k) => `"${k.name}"`).join(", ")}. Zuerst verschieben oder löschen.`;
      return;
    }
    try {
      const items = await getDocs(collection(db, "containers", id, "items"));
      if (!items.empty) {
        hint.textContent = `Nicht möglich: Im Behälter ${items.size === 1 ? "ist noch 1 Artikel" : `sind noch ${items.size} Artikel`}. Nur leere Behälter können gelöscht werden.`;
        return;
      }
    } catch (err) {
      hint.textContent = `Prüfen fehlgeschlagen (${err.code || err.message})`;
      return;
    }
    close();
    onDeleted();
  }, "Wirklich löschen?"));
}

// --- Behälter-Ansicht ---

// Kam dieser Aufruf von einer Seite der App (Link, Zurück, Tutorial) statt von aussen (QR-Code mit
// der Kamera-App, Lesezeichen)?
function cameFromApp() {
  try {
    return !!document.referrer && new URL(document.referrer).origin === location.origin;
  } catch {
    return false;
  }
}

// Übungsmodus, aber ein echter Behälter-Code von aussen: nichts öffnen, nichts anlegen – Hinweis.
function renderRealCodeHint(id) {
  const n = (params.get("n") || "").trim().slice(0, MAX_NAME);
  main.innerHTML = `
    <p class="empty-hint">Das ist der QR-Code eines echten Behälters („<span id="real-name"></span>“).<br>
      Du bist gerade im Übungsmodus – hier öffnen sich nur Übungs-Codes.</p>
    <div class="photo-actions">
      <a class="button-link" id="open-real" href="#">Übung beenden und öffnen</a>
      <a class="button-link" href="index.html">Weiter üben</a>
    </div>`;
  document.getElementById("real-name").textContent = n || id;
  document.title = "Übungsmodus – Vorrat";
  document.getElementById("open-real").addEventListener("click", (e) => {
    e.preventDefault();
    try {
      sessionStorage.removeItem(PRACTICE_KEY);
      sessionStorage.setItem(SCANNED_KEY, id); // wie ein Scan: darf den Behälter anlegen
    } catch {}
    location.href = `index.html?uebung=0&c=${encodeURIComponent(id)}${n ? `&n=${encodeURIComponent(n)}` : ""}`;
  });
}

// → false, wenn statt des Behälters ein Hinweis gezeigt wird.
function renderContainer(id) {
  // Ein "/" in ?c= würde einen ungültigen Firestore-Pfad ergeben (Seite bliebe bei "Lade…").
  if (!id || id.includes("/")) {
    main.innerHTML = `<p class="empty-hint">Ungültiger Behälter-Link.<br><a href="index.html">Zur Übersicht</a></p>`;
    return false;
  }
  // Gibt es den Behälter in der Übung (Lesezeichen, Referrer fehlt), einfach öffnen – auch wenn die
  // ID zufällig wie ein echter Behälter heisst, ändert das nur Übungsdaten.
  const inPractice = PRACTICE && !!firestoreMod.practiceSnapshot()[`containers/${id}`];
  if (PRACTICE && !inPractice && practiceLinkAction({ hasPracticeParam: practiceParam(location.search) === true, internal: cameFromApp() }) === "real") {
    renderRealCodeHint(id);
    return false;
  }
  main.innerHTML = `
    <div class="hero">
      <nav class="breadcrumb" id="breadcrumb" aria-label="Pfad" hidden></nav>
      <div class="title-row">
        <h1 id="container-title">…</h1>
        <button type="button" class="link-btn" id="select-btn" aria-label="Mehrere Artikel auswählen" title="Auswählen und verschieben">${icon("select")}</button>
        <button type="button" class="link-btn" id="edit-btn" aria-label="Behälter bearbeiten" title="Umbenennen, Typ, liegt in, löschen">${icon("edit")}</button>
        <a class="link-btn" id="qr-link" href="qr.html" data-qr aria-label="QR-Code für diesen Behälter">${icon("qr")}</a>
      </div>
      <div class="container-meta">
        <small class="muted" id="container-type"></small>
        <p class="item-count" id="item-count" hidden></p>
      </div>
    </div>
    <div id="children" class="container-list children" hidden></div>
    <h2 class="section-label" id="items-heading" hidden>Artikel</h2>
    <div class="search-field" hidden>${icon("search")}<input type="search" id="item-filter" class="search-input"
      placeholder="In diesem Behälter filtern" autocomplete="off" aria-label="Artikel filtern" /></div>
    <div id="items"><p class="empty-hint">Lade…</p></div>
    <div class="select-bar" id="select-bar" hidden>
      <span id="select-count">0 gewählt</span>
      <button type="button" id="select-all" class="secondary">Alle</button>
      <button type="button" id="select-move" disabled>Verschieben</button>
      <button type="button" id="select-cancel" class="secondary" aria-label="Auswahl beenden">${icon("close")}</button>
    </div>
    <form class="add-form" id="add-item-form">
      <label class="photo-pick" title="Foto aufnehmen oder hochladen">
        <input name="photo" type="file" accept="image/*" aria-label="Foto aufnehmen oder hochladen" hidden />
        <span class="photo-pick-preview">${icon("camera")}</span>
      </label>
      <button type="button" class="icon-pick" aria-label="Icon wählen" title="Vorgeschlagenes Icon – antippen zum Ändern" hidden></button>
      <input name="name" placeholder="Artikel (z.B. Milch)" list="item-names" maxlength="${MAX_NAME}"
        autocomplete="off" enterkeyhint="done" required />
      <datalist id="item-names"></datalist>
      <input name="qty" type="number" min="1" max="${MAX_QTY}" value="1" inputmode="numeric" aria-label="Anzahl" style="max-width:80px" />
      <select name="unit" aria-label="Einheit">
        ${UNITS.map((u) => `<option value="${u}">${u}</option>`).join("")}
      </select>
      <button type="submit">+ Hinzufügen</button>
      <small class="muted add-hint" id="add-hint" hidden></small>
    </form>
    <details class="sub-form">
      <summary>+ Behälter hier hineinlegen (z.B. Fach, Box)</summary>
      <form class="add-form" id="new-child-form">
        <input name="name" placeholder="Name (z.B. Gemüsefach)" maxlength="${MAX_NAME}" required />
        <select name="type" aria-label="Typ">${typeOptions()}</select>
        <button type="submit">Anlegen</button>
      </form>
    </details>
  `;

  const itemsEl = document.getElementById("items");
  const titleEl = document.getElementById("container-title");
  const filterInput = document.getElementById("item-filter");
  const form = document.getElementById("add-item-form");
  const addHint = document.getElementById("add-hint");
  const photoPreview = form.querySelector(".photo-pick-preview");
  const iconPick = form.querySelector(".icon-pick");
  let chosenIcon = null; // selbst gewählt; null = Vorschlag aus dem Namen
  const breadcrumbEl = document.getElementById("breadcrumb");
  const childrenEl = document.getElementById("children");
  const typeEl = document.getElementById("container-type");
  const countEl = document.getElementById("item-count");
  const itemsHeading = document.getElementById("items-heading");
  const selectBar = document.getElementById("select-bar");
  let containerName = id;
  let previewUrl = null;
  let currentItems = new Map();
  let lastSnap = null; // letzter Artikel-Snapshot (auch für die Anzahl im Kopf)
  let deleted = false;
  let selecting = false;
  const selected = new Set();

  function resetPhotoPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    photoPreview.innerHTML = icon("camera");
    updateIconPick();
  }

  // Icon-Vorschlag neben dem Namen (nur ohne Foto): gewähltes Icon, sonst Vorschlag, sonst neutral.
  function formIcon() {
    return chosenIcon || suggestIcon(form.name.value);
  }
  function updateIconPick() {
    const name = form.name.value.trim();
    const hasPhoto = !!form.photo.files[0];
    iconPick.hidden = !name || hasPhoto;
    if (iconPick.hidden) return;
    const id = formIcon();
    iconPick.classList.toggle("is-fallback", !id);
    iconPick.innerHTML = itemIconSvg(id || FALLBACK_ICON);
    iconPick.setAttribute("aria-label", id ? `Icon: ${ITEM_ICONS[id].label} – antippen zum Ändern` : "Icon wählen");
  }
  iconPick.addEventListener("click", () => {
    showIconPicker({
      name: form.name.value.trim(),
      current: chosenIcon,
      onPick: (picked) => {
        chosenIcon = picked;
        updateIconPick();
        form.name.focus();
      },
    });
  });
  form.photo.addEventListener("change", () => {
    resetPhotoPreview();
    const file = form.photo.files[0];
    if (!file) return;
    previewUrl = URL.createObjectURL(file);
    const img = document.createElement("img");
    img.src = previewUrl;
    img.alt = "";
    photoPreview.textContent = "";
    photoPreview.appendChild(img);
  });

  // Gibt es den Artikel schon? Dann Einheit übernehmen und anzeigen, dass die Menge addiert wird.
  function updateAddHint() {
    const existing = currentItems.get(slugify(form.name.value.trim()));
    if (existing) {
      form.unit.value = UNITS.includes(existing.unit) ? existing.unit : "Stk";
      addHint.textContent = `Schon vorhanden: ${existing.qty ?? 1} ${existing.unit || ""} – die Menge wird addiert.`;
    }
    addHint.hidden = !existing;
  }
  form.name.addEventListener("input", () => {
    updateAddHint();
    updateIconPick();
  });

  if (!isValidId(id)) {
    // z.B. von Hand verändertes ?c= – nichts automatisch anlegen.
    titleEl.textContent = id;
  }

  let mayCreate = mayAutoCreate(id);
  let existed = false;
  onSnapshot(doc(db, "containers", id), (snap) => {
    if (deleted) return;
    if (!snap.exists() && existed && !snap.metadata.fromCache && !snap.metadata.hasPendingWrites) {
      // Auf einem anderen Gerät/Tab gelöscht → hier nicht weiter hineinschreiben.
      showDeleted(null);
      return;
    }
    if (snap.exists()) {
      existed = true;
      mayCreate = false;
      containerName = snap.data().name || id;
      rememberRecent(id, containerName);
    } else if (mayCreate && !snap.metadata.fromCache && isValidId(id) && !readOnly()) {
      // Neuer QR-Code gescannt → Behälter anlegen (Name aus &n=, sonst die ID).
      // Nur nach Antwort vom Server, sonst würde ein leerer Offline-Cache den Namen überschreiben.
      // Nur beim Öffnen: Löscht jemand anderes den Behälter, während er hier offen ist, wird er
      // nicht sofort wieder angelegt.
      mayCreate = false;
      const n = (params.get("n") || "").trim().slice(0, MAX_NAME);
      containerName = n || id;
      const name = containerName;
      // Erst wenn klar ist, ob gesperrt ist (sonst bei langsamem Netz Schreibversuch in die Sperre).
      lockReady.then(() => {
        if (readOnly() || deleted) return;
        background(setDoc(doc(db, "containers", id), { name, createdAt: serverTimestamp() }, { merge: true }), "Anlegen");
      });
    }
    titleEl.textContent = containerName;
    document.title = `${containerName} – Vorrat`;
    const qrLink = document.getElementById("qr-link");
    qrLink.dataset.qrSel = id;
    qrLink.dataset.qrName = containerName;
    setQrHref(qrLink);
  }, (err) => showError(itemsEl, err));

  // Pfad oben, Typ, Unterbehälter.
  onContainers((err) => {
    if (err || deleted) return;
    const path = containerPath(id, allContainers);
    breadcrumbEl.innerHTML = "";
    breadcrumbEl.hidden = path.length < 2;
    path.slice(0, -1).forEach((p, i) => {
      if (i) breadcrumbEl.append(" › ");
      const a = document.createElement("a");
      a.href = `index.html?c=${encodeURIComponent(p.id)}`;
      a.textContent = p.name;
      breadcrumbEl.appendChild(a);
    });
    const type = allContainers.get(id)?.type;
    typeEl.innerHTML = type ? `${typeIcon(type)}<span>${escapeHtml(typeLabel(type))}</span>` : "";
    const kids = childContainers(id, allContainers);
    childrenEl.hidden = !kids.length;
    childrenEl.innerHTML = kids.length ? `<h2 class="section-label">Darin</h2>` : "";
    for (const k of kids) childrenEl.appendChild(containerCard(k.id));
    updateItemCount();
  });

  document.getElementById("edit-btn").addEventListener("click", async () => {
    if (blockedByLock()) return;
    try {
      await containersReady();
    } catch (err) {
      toast(`Fehler (${err.code || err.message})`, 4000);
      return;
    }
    showContainerSettings(id, deleteThisContainer);
  });

  // Löschen (nur wenn leer, geprüft in showContainerSettings) mit Rückgängig.
  function deleteThisContainer() {
    const c = allContainers.get(id) || { name: containerName };
    const backup = { name: c.name || containerName, createdAt: serverTimestamp() };
    if (c.type) backup.type = c.type;
    if (c.parent) backup.parent = c.parent;
    background(deleteDoc(doc(db, "containers", id)), "Löschen");
    showDeleted(backup);
  }

  // Ansicht "wurde gelöscht" – mit Rückgängig, wenn hier gelöscht (backup), sonst nur Hinweis.
  function showDeleted(backup) {
    deleted = true;
    forgetRecent(id);
    rememberDeleted(id);
    const c = allContainers.get(id) || {};
    const parent = c.parent && c.parent !== id && allContainers.has(c.parent) ? c.parent : null;
    const back = parent ? `index.html?c=${encodeURIComponent(parent)}` : "index.html";
    main.innerHTML = `
      <p class="empty-hint">„<span id="deleted-name"></span>“ wurde ${backup ? "" : "inzwischen (auf einem anderen Gerät) "}gelöscht.</p>
      <div class="photo-actions">
        ${backup ? `<button type="button" id="undo-delete">Rückgängig</button>` : ""}
        <a class="button-link" href="${escapeHtml(back)}">${parent ? "Zurück" : "Zur Übersicht"}</a>
      </div>`;
    document.getElementById("deleted-name").textContent = backup ? backup.name : containerName;
    document.title = "Gelöscht – Vorrat";
    if (!backup) return;
    document.getElementById("undo-delete").addEventListener("click", () => {
      background(setDoc(doc(db, "containers", id), backup), "Wiederherstellen");
      forgetDeleted(id);
      // Kurz warten, damit der Schreibvorgang sicher im Offline-Speicher liegt, bevor die Seite neu lädt.
      setTimeout(() => { location.href = `index.html?c=${encodeURIComponent(id)}`; }, 400);
    });
    toast(`"${backup.name}" gelöscht`, {
      ms: 8000,
      action: { label: "Rückgängig", fn: () => document.getElementById("undo-delete")?.click() },
    });
  }

  document.getElementById("new-child-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const name = f.name.value.trim().slice(0, MAX_NAME);
    const type = CONTAINER_TYPES[f.type.value] ? f.type.value : "";
    if (!name) return;
    if (blockedByLock()) return;
    try {
      await containersReady();
    } catch (err) {
      toast(`Fehler (${err.code || err.message})`, 4000);
      return;
    }
    // Die lokale Liste kann veraltet sein (anderes Gerät, offline) → ID zusätzlich einzeln prüfen,
    // damit nie ein fremder Behälter überschrieben wird.
    const seenTaken = new Set();
    let newId = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      newId = uniqueContainerId(name, isValidId(id) ? id : "", (cid) => allContainers.has(cid) || seenTaken.has(cid));
      if (!newId) break;
      let exists = false;
      try {
        exists = (await getDoc(doc(db, "containers", newId))).exists();
      } catch {
        exists = false; // offline ohne Cache: lokale Prüfung muss reichen
      }
      if (!exists) break;
      seenTaken.add(newId);
      newId = "";
    }
    if (!newId) {
      toast("Bitte einen Namen mit Buchstaben oder Ziffern eingeben", 3000);
      return;
    }
    const data = { name, parent: id, createdAt: serverTimestamp() };
    if (type) data.type = type;
    background(setDoc(doc(db, "containers", newId), data), "Anlegen");
    f.reset();
    toast(`"${name}" in "${containerName}" angelegt`);
  });

  // --- Mehrfachauswahl ("Umzugsmodus") ---
  function updateSelectBar() {
    for (const sid of [...selected]) if (!currentItems.has(sid)) selected.delete(sid);
    selectBar.hidden = !selecting;
    document.body.classList.toggle("selecting", selecting);
    document.getElementById("select-count").textContent = `${selected.size} gewählt`;
    document.getElementById("select-move").disabled = !selected.size;
    document.getElementById("select-btn").setAttribute("aria-pressed", String(selecting));
  }
  function setSelecting(on) {
    selecting = on;
    if (!on) selected.clear();
    renderItems();
  }
  document.getElementById("select-btn").addEventListener("click", () => {
    if (!selecting && blockedByLock()) return;
    setSelecting(!selecting);
  });
  document.getElementById("select-cancel").addEventListener("click", () => setSelecting(false));
  document.getElementById("select-all").addEventListener("click", () => {
    const all = visibleIds; // nur sichtbare (Filter beachten)
    if (all.every((k) => selected.has(k))) all.forEach((k) => selected.delete(k));
    else all.forEach((k) => selected.add(k));
    renderItems();
  });
  document.getElementById("select-move").addEventListener("click", () => {
    const entries = [...selected].filter((k) => currentItems.has(k)).map((k) => ({ itemId: k, item: currentItems.get(k) }));
    if (!entries.length) return;
    showMoveDialog(id, entries, () => setSelecting(false));
  });

  const itemsQuery = query(collection(db, "containers", id, "items"), orderBy("name"));
  let visibleIds = [];
  let highlightPending = decodeURIComponent((location.hash.match(/^#i=(.+)$/) || [])[1] || "");

  // Anzahl im Kopf ("6 Artikel", alle Artikel des Behälters, unabhängig vom Filter; "Artikel" ist
  // Singular und Plural). Die Überschrift "Artikel" erscheint nur, wenn es auch "Darin" gibt.
  function updateItemCount() {
    const n = lastSnap && !deleted ? lastSnap.size : 0;
    countEl.hidden = !n;
    countEl.innerHTML = n ? `<strong>${n}</strong> <span>Artikel</span>` : "";
    itemsHeading.hidden = !n || childrenEl.hidden;
  }

  function renderItems() {
    const snap = lastSnap;
    if (!snap || deleted) return;
    updateItemCount();
    currentItems = new Map(snap.docs.map((d) => [d.id, d.data()]));
    document.getElementById("item-names").innerHTML = [...currentItems.values()]
      .map((it) => `<option value="${escapeHtml(it.name)}"></option>`).join("");
    updateAddHint();
    updateSelectBar();
    filterInput.parentElement.hidden = snap.size < FILTER_THRESHOLD && !filterInput.value; // .search-field mit Lupe

    visibleIds = [];
    if (snap.empty) {
      itemsEl.innerHTML = `<p class="empty-hint">${childrenEl.hidden ? "Leer – füge unten etwas hinzu." : "Keine Artikel direkt hier."}</p>`;
      return;
    }
    let entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (normalizeSearch(filterInput.value)) {
      entries = searchItems(entries.map((e) => ({ ...e, containerName: "" })), filterInput.value, Infinity);
      if (!entries.length) {
        itemsEl.innerHTML = `<p class="empty-hint">Kein Artikel passt zu „${escapeHtml(filterInput.value)}“.</p>`;
        return;
      }
    }
    itemsEl.innerHTML = "";
    visibleIds = entries.map((e) => e.id);
    for (const item of entries) {
      const itemId = item.id;
      if (selecting) {
        const row = document.createElement("label");
        row.className = "card select-card";
        row.dataset.id = itemId;
        row.innerHTML = `
          <input type="checkbox" class="select-box" ${selected.has(itemId) ? "checked" : ""} />
          <div class="name"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(String(item.qty ?? 1))} ${escapeHtml(item.unit || "")}${mhdSuffix(item.mhd)}</small></div>`;
        row.querySelector("input").addEventListener("change", (e) => {
          if (e.target.checked) selected.add(itemId); else selected.delete(itemId);
          updateSelectBar();
        });
        itemsEl.appendChild(row);
        continue;
      }
      const hasPhoto = isSafePhoto(item.photo);
      const shownIcon = hasPhoto ? null : iconForItem(item);
      const busy = photosInProgress.has(`${id}/${itemId}`);
      const step = qtyStep(item.unit);
      const card = document.createElement("div");
      card.className = "card";
      card.dataset.id = itemId;
      card.innerHTML = `
        <button type="button" class="thumb-btn${hasPhoto || busy ? "" : shownIcon ? " has-icon" : " no-photo"}" data-action="photo" aria-label="${hasPhoto ? "Foto anzeigen" : shownIcon ? "Details, Icon und Foto" : "Foto hinzufügen"}">
          ${busy ? `<span class="spinner">${icon("hourglass")}</span>` : thumbContent(item)}
        </button>
        <button type="button" class="name name-btn" data-action="details" aria-label="Details zu ${escapeHtml(item.name)}">
          <strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.unit || "")}${mhdSuffix(item.mhd)}</small>
        </button>
        <div class="qty-controls">
          <button type="button" class="round" data-action="dec" aria-label="${step === 1 ? "Eins weniger" : `${step} weniger`}">−</button>
          <button type="button" class="qty-value" data-action="set" aria-label="Menge eingeben">${escapeHtml(String(item.qty ?? 1))}</button>
          <button type="button" class="round" data-action="inc" aria-label="${step === 1 ? "Eins mehr" : `${step} mehr`}">+</button>
        </div>
        <button type="button" class="delete" data-action="del" aria-label="Entfernen">${icon("trash")}</button>
      `;
      const thumb = card.querySelector("img.thumb");
      if (thumb) thumb.src = item.photo;
      card.querySelector('[data-action="photo"]').addEventListener("click", () => {
        if (busy) return;
        if (hasPhoto || shownIcon || readOnly()) showItemDetails(id, itemId, item);
        else openPhotoPicker(id, itemId);
      });
      card.querySelector('[data-action="details"]').addEventListener("click", () => showItemDetails(id, itemId, item));
      // Immer den neuesten Stand nehmen (schnelles Doppeltippen vor dem nächsten Snapshot).
      card.querySelector('[data-action="inc"]').addEventListener("click", () => changeQty(id, itemId, currentItems.get(itemId) || item, 1));
      card.querySelector('[data-action="dec"]').addEventListener("click", () => changeQty(id, itemId, currentItems.get(itemId) || item, -1));
      card.querySelector('[data-action="set"]').addEventListener("click", () => setQty(id, itemId, item));
      const delBtn = card.querySelector('[data-action="del"]');
      delBtn.addEventListener("click", confirmFirst(delBtn, () => removeItem(id, itemId, item)));
      itemsEl.appendChild(card);
    }

    // Aus der Suche gekommen → Artikel hervorheben.
    if (highlightPending) {
      const card = itemsEl.querySelector(`[data-id="${CSS.escape(highlightPending)}"]`);
      if (card) {
        card.scrollIntoView({ block: "center", behavior: "smooth" });
        card.classList.add("highlight");
        setTimeout(() => card.classList.remove("highlight"), 2500);
      }
      highlightPending = "";
    }
  }
  rerenderItems = renderItems;
  filterInput.addEventListener("input", renderItems);

  onSnapshot(itemsQuery, (snap) => {
    lastSnap = snap;
    renderItems();
  }, (err) => showError(itemsEl, err));

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (blockedByLock()) return;
    const name = form.name.value.trim().slice(0, MAX_NAME);
    const qty = parseQty(form.qty.value);
    const unit = UNITS.includes(form.unit.value) ? form.unit.value : "Stk";
    const photoFile = form.photo.files[0];
    if (!name) return;
    const itemId = slugify(name);
    if (!isValidId(itemId)) {
      toast("Bitte einen Namen mit Buchstaben oder Ziffern eingeben", 3000);
      return;
    }
    const existing = currentItems.get(itemId);
    const plan = planAddItem(existing, { qty, unit });
    // Icon nur ohne Foto: selbst gewählt immer, Vorschlag nur bei neuen Artikeln bzw. wenn noch keins da ist.
    const iconId = photoFile ? null : chosenIcon || (existing && isKnownIcon(existing.icon) ? null : suggestIcon(name));
    let write;
    let message;
    if (plan.action === "conflict") {
      const ok = confirm(`"${existing.name}" ist schon vorhanden (${plan.oldQty} ${plan.oldUnit}).\nDurch ${qty} ${unit} ersetzen?`);
      if (!ok) return;
      const data = { name: existing.name, qty, unit, updatedAt: serverTimestamp() };
      if (iconId) data.icon = iconId;
      write = setDoc(itemRef(id, itemId), data, { merge: true });
      message = `"${existing.name}": jetzt ${qty} ${unit}`;
    } else {
      // increment() addiert auf dem Server – auch wenn gleichzeitig jemand anderes etwas ändert.
      // Gibt es den Artikel noch nicht, wird die Menge einfach gesetzt.
      const data = { name: existing ? existing.name : name, unit, qty: increment(plan.action === "add" ? plan.delta : qty), updatedAt: serverTimestamp() };
      if (iconId) data.icon = iconId;
      write = setDoc(itemRef(id, itemId), data, { merge: true });
      message = plan.action === "add" ? `"${existing.name}": jetzt ${plan.newQty} ${unit}` : `"${name}" hinzugefügt`;
    }
    background(write);
    form.reset();
    form.qty.value = 1;
    form.unit.value = unit;
    addHint.hidden = true;
    chosenIcon = null;
    resetPhotoPreview();
    toast(message);
    if (photoFile) savePhoto(id, itemId, photoFile);
    emit("item-added", { containerId: id, itemId });
  });
  return true;
}

// +/−: nur die Menge ändern (increment), nicht den ganzen Artikel inkl. Foto neu schreiben.
// So gehen gleichzeitige Änderungen auf zwei Geräten nicht verloren. g/ml in 50er-Schritten.
function changeQty(containerId, itemId, item, direction) {
  if (blockedByLock()) return;
  const plan = planStep(item.qty ?? 1, item.unit, direction);
  if (plan.action === "remove") {
    removeItem(containerId, itemId, item);
    return;
  }
  if (plan.action === "none") return;
  item.qty = plan.newQty; // lokal mitzählen, bis der nächste Snapshot den echten Stand bringt
  background(updateDoc(itemRef(containerId, itemId), { qty: increment(plan.delta), updatedAt: serverTimestamp() }));
  emit("qty-changed", { containerId, itemId });
}

// Antippen der Zahl: Menge direkt eingeben (praktisch bei g/ml).
function setQty(containerId, itemId, item) {
  if (blockedByLock()) return;
  const input = prompt(`Neue Menge für "${item.name}" (${item.unit || ""}). 0 = entfernen`, String(item.qty ?? 1));
  if (input === null || input.trim() === "") return;
  const n = Math.round(Number(input));
  if (!Number.isFinite(n) || n < 0) {
    toast("Bitte eine Zahl eingeben");
    return;
  }
  if (n === 0) {
    removeItem(containerId, itemId, item);
    return;
  }
  background(updateDoc(itemRef(containerId, itemId), { qty: Math.min(MAX_QTY, n), updatedAt: serverTimestamp() }));
  emit("qty-changed", { containerId, itemId });
}

// Entfernen (Papierkorb fragt vorher per zweitem Tipp nach), danach noch "Rückgängig" (stellt Name, Menge, Einheit, Foto und MHD wieder her).
function removeItem(containerId, itemId, item) {
  if (blockedByLock()) return;
  const ref = itemRef(containerId, itemId);
  // Ältere IDs (nicht im App-Format) dürfen laut Regeln nicht neu angelegt werden.
  const slug = slugify(item.name || "");
  const restoreRef = isValidId(itemId) || !isValidId(slug) ? ref : itemRef(containerId, slug);
  const backup = itemBackup(item);
  background(deleteDoc(ref), "Entfernen");
  toast(`"${item.name}" entfernt`, {
    ms: 8000,
    action: {
      label: "Rückgängig",
      fn: () => {
        background(setDoc(restoreRef, backup), "Wiederherstellen");
        toast(`"${item.name}" wiederhergestellt`);
        emit("item-restored", { containerId, itemId });
      },
    },
  });
  emit("item-removed", { containerId, itemId });
}
