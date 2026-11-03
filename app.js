import * as config from "./firebase-config.js";
import { initializeApp } from "./vendor/firebase-10.14.1/firebase-app.js";
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  collectionGroup,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  increment,
  deleteField,
  writeBatch,
  terminate,
  clearIndexedDbPersistence,
  query,
  orderBy,
} from "./vendor/firebase-10.14.1/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signOut,
} from "./vendor/firebase-10.14.1/firebase-auth.js";
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
} from "./lib.js";

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
if (config.appCheckSiteKey) {
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
    console.error(err);
    toast(`${what} fehlgeschlagen (${err.code || err.message})`, 4000);
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

// Artikel, deren Foto gerade verarbeitet wird ("containerId/itemId") – zeigt ⏳ statt 📷.
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
  pendingPhotoTarget = { containerId, itemId };
  photoInput.click();
}

// Einfaches Overlay-Fenster. `html` darf nur feste Texte oder escapete Daten enthalten.
function openDialog(html) {
  const overlay = document.createElement("div");
  overlay.className = "photo-overlay";
  overlay.innerHTML = `<div class="photo-dialog" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  // Escape schliesst nur das oberste Fenster (z.B. Scanner über dem Verschieben-Dialog).
  const onKey = (e) => {
    if (e.key === "Escape" && [...document.querySelectorAll(".photo-overlay")].pop() === overlay) close();
  };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelectorAll('[data-action="close"]').forEach((b) => b.addEventListener("click", close));
  document.body.appendChild(overlay);
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
  a.href = `qr.html?${qrPageQuery(containers, sel ? [sel] : [])}`;
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

// Kleine Strich-Icons pro Typ (feste SVGs, keine Nutzerdaten), Farbe über currentColor.
const TYPE_ICON_PATHS = {
  raum: '<path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17"/><path d="M3 21h18"/><circle cx="15" cy="12.5" r="1" fill="currentColor"/>',
  schrank: '<rect x="4" y="2.5" width="16" height="17" rx="1.5"/><path d="M12 2.5v17M10 10v2.5M14 10v2.5M6.5 19.5v2M17.5 19.5v2"/>',
  fach: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 12h18M10 8h4M10 16h4"/>',
  box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="m3 7.5 9 4.5 9-4.5M12 12v9"/>',
};
function typeIcon(type) {
  const paths = TYPE_ICON_PATHS[type];
  return paths
    ? `<svg class="type-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
    : "";
}

// --- MHD (Mindesthaltbarkeitsdatum) ---

function mhdBadge(mhd) {
  const status = mhdStatus(mhd, new Date());
  if (!status) return "";
  const text = status === "expired" ? `abgelaufen ${formatDate(mhd)}` : `MHD ${formatDate(mhd)}`;
  return `<span class="mhd mhd-${status}">${escapeHtml(text)}</span>`;
}

function withSpace(html) {
  return html ? ` ${html}` : "";
}

function saveMhd(containerId, itemId, item, mhd) {
  const data = { mhd: mhd ? mhd : deleteField(), updatedAt: serverTimestamp() };
  background(updateDoc(itemRef(containerId, itemId), data), "MHD speichern");
  item.mhd = mhd || undefined;
  toast(mhd ? `"${item.name}": MHD ${formatDate(mhd)}` : `"${item.name}": MHD entfernt`);
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
      <button type="button" data-action="camera" class="secondary">📷 Datum mit Kamera lesen (Experiment)</button>
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
  const { overlay, close } = openDialog(`
    ${hasPhoto ? `<img alt="" />` : ""}
    <strong></strong>
    <span class="muted">${escapeHtml(String(item.qty ?? 1))} ${escapeHtml(item.unit || "")}</span>
    <span class="muted">${isValidIsoDate(item.mhd) ? mhdBadge(item.mhd) : "MHD: –"}</span>
    <div class="photo-actions">
      <button type="button" data-action="change">📷 ${hasPhoto ? "Foto ändern" : "Foto hinzufügen"}</button>
      <button type="button" data-action="mhd">📅 MHD</button>
    </div>
    <div class="photo-actions">
      <button type="button" data-action="move">↪ Verschieben</button>
      <button type="button" data-action="del" class="danger">🗑 Entfernen</button>
    </div>
    <div class="photo-actions">
      <button type="button" data-action="close" class="secondary">Schliessen</button>
    </div>
  `);
  if (hasPhoto) overlay.querySelector("img").src = item.photo;
  overlay.querySelector("strong").textContent = item.name;
  overlay.querySelector('[data-action="change"]').addEventListener("click", () => {
    close();
    openPhotoPicker(containerId, itemId);
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
  }, "Wirklich entfernen?"));
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
    ${canScan ? `<div class="photo-actions"><button type="button" data-action="scan" class="secondary" disabled>📷 Ziel-QR-Code scannen</button></div>` : ""}
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
        const r = moveTargetFromScan(raw, location.href, fromId, allContainers);
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
  return data;
}

// Verschiebt Artikel in einen anderen Behälter – alle in einem Batch (dort anlegen bzw. Menge
// addieren, hier löschen). Artikel mit gleicher ID, aber anderer Einheit im Ziel werden übersprungen.
// Mit "Rückgängig" (ebenfalls ein Batch).
async function moveItems(fromId, entries, target) {
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
    background(batch.commit(), "Verschieben");
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
          const id = containerIdFromScan(raw, location.href);
          if (id) {
            stop();
            close();
            const name = new URL(raw).searchParams.get("n");
            try { sessionStorage.setItem(SCANNED_KEY, id); } catch {}
            location.href = containerUrl(location.href, id, name);
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

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function storageSet(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
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
  `;
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

await completeEmailLinkSignIn();
watchOnline();

let started = false;
onAuthStateChanged(auth, (user) => {
  if (!user) {
    if (started) location.reload(); // in anderem Tab abgemeldet
    else renderLogin();
    return;
  }
  if (started) return;
  started = true;
  showLogout(user);
  setupBottomNav();
  watchContainers();
  if (containerId) {
    renderContainer(containerId);
  } else if (listView(listName)) {
    listView(listName)();
  } else {
    renderOverview();
  }
});

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
    <div class="search-row">
      <input type="search" id="search" class="search-input" placeholder="🔍 Wo ist …? Artikel suchen"
        autocomplete="off" enterkeyhint="search" aria-label="Artikel suchen" maxlength="${MAX_NAME}" />
      ${canScan ? `<button type="button" id="scan-btn" class="scan-btn" aria-label="QR-Code scannen">📷 Scan</button>` : ""}
    </div>
    <div id="search-results" class="search-results" hidden></div>
    <div id="recent" class="recent-chips" hidden></div>
    <div class="list-links"><a class="chip" href="index.html?liste=ablauf">⏰ Läuft bald ab</a></div>
    <h1>Deine Behälter</h1>
    <div class="container-list" id="container-list"><p class="empty-hint">Lade…</p></div>
    <p class="muted"><a id="qr-all" href="qr.html" data-qr>🖨 QR-Codes drucken (Auswahl)</a></p>
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
        <span class="thumb-btn small">${isSafePhoto(it.photo) ? `<img class="thumb" alt="" decoding="async" />` : "📦"}</span>
        <div class="name"><strong>${escapeHtml(it.name)}</strong><small>${escapeHtml(String(it.qty ?? 1))} ${escapeHtml(it.unit || "")} · in <b>${escapeHtml(it.containerName)}</b>${withSpace(mhdBadge(it.mhd))}</small></div>
        <div aria-hidden="true">›</div>`;
      const img = a.querySelector("img");
      if (img) img.src = it.photo;
      results.appendChild(a);
    }
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
    <h1>Läuft bald ab</h1>
    <div class="segmented" role="group" aria-label="Zeitraum">
      ${EXPIRY_WINDOWS.map((d) => `<button type="button" data-days="${d}">≤ ${d} Tage</button>`).join("")}
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
        <span class="thumb-btn small">${isSafePhoto(it.photo) ? `<img class="thumb" alt="" decoding="async" />` : "📦"}</span>
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
      ${canDelete ? `<button type="button" data-action="delete" class="danger">🗑 Behälter löschen</button>` : ""}
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

function renderContainer(id) {
  // Ein "/" in ?c= würde einen ungültigen Firestore-Pfad ergeben (Seite bliebe bei "Lade…").
  if (!id || id.includes("/")) {
    main.innerHTML = `<p class="empty-hint">Ungültiger Behälter-Link.<br><a href="index.html">Zur Übersicht</a></p>`;
    return;
  }
  main.innerHTML = `
    <nav class="breadcrumb" id="breadcrumb" aria-label="Pfad" hidden></nav>
    <div class="title-row">
      <h1 id="container-title">…</h1>
      <button type="button" class="link-btn" id="select-btn" aria-label="Mehrere Artikel auswählen" title="Auswählen und verschieben">☑</button>
      <button type="button" class="link-btn" id="edit-btn" aria-label="Behälter bearbeiten" title="Umbenennen, Typ, liegt in, löschen">✏️</button>
      <a class="link-btn" id="qr-link" href="qr.html" data-qr aria-label="QR-Code für diesen Behälter">QR</a>
    </div>
    <small class="muted" id="container-type"></small>
    <div id="children" class="container-list children" hidden></div>
    <input type="search" id="item-filter" class="search-input" placeholder="🔍 In diesem Behälter filtern"
      autocomplete="off" aria-label="Artikel filtern" hidden />
    <div id="items"><p class="empty-hint">Lade…</p></div>
    <div class="select-bar" id="select-bar" hidden>
      <span id="select-count">0 ausgewählt</span>
      <button type="button" id="select-all" class="secondary">Alle</button>
      <button type="button" id="select-move" disabled>↪ Verschieben</button>
      <button type="button" id="select-cancel" class="secondary" aria-label="Auswahl beenden">✕</button>
    </div>
    <form class="add-form" id="add-item-form">
      <label class="photo-pick" title="Foto aufnehmen oder hochladen">
        <input name="photo" type="file" accept="image/*" hidden />
        <span class="photo-pick-preview">📷</span>
      </label>
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
  const breadcrumbEl = document.getElementById("breadcrumb");
  const childrenEl = document.getElementById("children");
  const typeEl = document.getElementById("container-type");
  const selectBar = document.getElementById("select-bar");
  let containerName = id;
  let previewUrl = null;
  let currentItems = new Map();
  let deleted = false;
  let selecting = false;
  const selected = new Set();

  function resetPhotoPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    photoPreview.textContent = "📷";
  }
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
  form.name.addEventListener("input", updateAddHint);

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
    } else if (mayCreate && !snap.metadata.fromCache && isValidId(id)) {
      // Neuer QR-Code gescannt → Behälter anlegen (Name aus &n=, sonst die ID).
      // Nur nach Antwort vom Server, sonst würde ein leerer Offline-Cache den Namen überschreiben.
      // Nur beim Öffnen: Löscht jemand anderes den Behälter, während er hier offen ist, wird er
      // nicht sofort wieder angelegt.
      mayCreate = false;
      const n = (params.get("n") || "").trim().slice(0, MAX_NAME);
      containerName = n || id;
      background(setDoc(doc(db, "containers", id), { name: containerName, createdAt: serverTimestamp() }, { merge: true }), "Anlegen");
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
    childrenEl.innerHTML = kids.length ? `<h2>Darin</h2>` : "";
    for (const k of kids) childrenEl.appendChild(containerCard(k.id));
  });

  document.getElementById("edit-btn").addEventListener("click", async () => {
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
    document.getElementById("select-count").textContent = `${selected.size} ausgewählt`;
    document.getElementById("select-move").disabled = !selected.size;
    document.getElementById("select-btn").setAttribute("aria-pressed", String(selecting));
  }
  function setSelecting(on) {
    selecting = on;
    if (!on) selected.clear();
    renderItems();
  }
  document.getElementById("select-btn").addEventListener("click", () => setSelecting(!selecting));
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
  let lastSnap = null;
  let visibleIds = [];
  let highlightPending = decodeURIComponent((location.hash.match(/^#i=(.+)$/) || [])[1] || "");

  function renderItems() {
    const snap = lastSnap;
    if (!snap || deleted) return;
    currentItems = new Map(snap.docs.map((d) => [d.id, d.data()]));
    document.getElementById("item-names").innerHTML = [...currentItems.values()]
      .map((it) => `<option value="${escapeHtml(it.name)}"></option>`).join("");
    updateAddHint();
    updateSelectBar();
    filterInput.hidden = snap.size < FILTER_THRESHOLD && !filterInput.value;

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
          <div class="name"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(String(item.qty ?? 1))} ${escapeHtml(item.unit || "")}${withSpace(mhdBadge(item.mhd))}</small></div>`;
        row.querySelector("input").addEventListener("change", (e) => {
          if (e.target.checked) selected.add(itemId); else selected.delete(itemId);
          updateSelectBar();
        });
        itemsEl.appendChild(row);
        continue;
      }
      const hasPhoto = isSafePhoto(item.photo);
      const busy = photosInProgress.has(`${id}/${itemId}`);
      const step = qtyStep(item.unit);
      const card = document.createElement("div");
      card.className = "card";
      card.dataset.id = itemId;
      card.innerHTML = `
        <button type="button" class="thumb-btn" data-action="photo" aria-label="${hasPhoto ? "Foto anzeigen" : "Foto hinzufügen"}">
          ${busy ? `<span class="spinner">⏳</span>` : hasPhoto ? `<img class="thumb" alt="" decoding="async" />` : "📷"}
        </button>
        <button type="button" class="name name-btn" data-action="details" aria-label="Details zu ${escapeHtml(item.name)}">
          <strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.unit || "")}${withSpace(mhdBadge(item.mhd))}</small>
        </button>
        <div class="qty-controls">
          <button type="button" class="round" data-action="dec" aria-label="${step === 1 ? "Eins weniger" : `${step} weniger`}">−</button>
          <button type="button" class="qty-value" data-action="set" aria-label="Menge eingeben">${escapeHtml(String(item.qty ?? 1))}</button>
          <button type="button" class="round" data-action="inc" aria-label="${step === 1 ? "Eins mehr" : `${step} mehr`}">+</button>
        </div>
        <button type="button" class="delete" data-action="del" aria-label="Entfernen">🗑</button>
      `;
      const thumb = card.querySelector("img.thumb");
      if (thumb) thumb.src = item.photo;
      card.querySelector('[data-action="photo"]').addEventListener("click", () => {
        if (busy) return;
        if (hasPhoto) showItemDetails(id, itemId, item);
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
    let write;
    let message;
    if (plan.action === "conflict") {
      const ok = confirm(`"${existing.name}" ist schon vorhanden (${plan.oldQty} ${plan.oldUnit}).\nDurch ${qty} ${unit} ersetzen?`);
      if (!ok) return;
      write = setDoc(itemRef(id, itemId), { name: existing.name, qty, unit, updatedAt: serverTimestamp() }, { merge: true });
      message = `"${existing.name}": jetzt ${qty} ${unit}`;
    } else {
      // increment() addiert auf dem Server – auch wenn gleichzeitig jemand anderes etwas ändert.
      // Gibt es den Artikel noch nicht, wird die Menge einfach gesetzt.
      write = setDoc(
        itemRef(id, itemId),
        { name: existing ? existing.name : name, unit, qty: increment(plan.action === "add" ? plan.delta : qty), updatedAt: serverTimestamp() },
        { merge: true }
      );
      message = plan.action === "add" ? `"${existing.name}": jetzt ${plan.newQty} ${unit}` : `"${name}" hinzugefügt`;
    }
    background(write);
    form.reset();
    form.qty.value = 1;
    form.unit.value = unit;
    addHint.hidden = true;
    resetPhotoPreview();
    toast(message);
    if (photoFile) savePhoto(id, itemId, photoFile);
  });
}

// +/−: nur die Menge ändern (increment), nicht den ganzen Artikel inkl. Foto neu schreiben.
// So gehen gleichzeitige Änderungen auf zwei Geräten nicht verloren. g/ml in 50er-Schritten.
function changeQty(containerId, itemId, item, direction) {
  const plan = planStep(item.qty ?? 1, item.unit, direction);
  if (plan.action === "remove") {
    removeItem(containerId, itemId, item);
    return;
  }
  if (plan.action === "none") return;
  item.qty = plan.newQty; // lokal mitzählen, bis der nächste Snapshot den echten Stand bringt
  background(updateDoc(itemRef(containerId, itemId), { qty: increment(plan.delta), updatedAt: serverTimestamp() }));
}

// Antippen der Zahl: Menge direkt eingeben (praktisch bei g/ml).
function setQty(containerId, itemId, item) {
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
}

// Entfernen (Papierkorb fragt vorher per zweitem Tipp nach), danach noch "Rückgängig" (stellt Name, Menge, Einheit, Foto und MHD wieder her).
function removeItem(containerId, itemId, item) {
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
      },
    },
  });
}
