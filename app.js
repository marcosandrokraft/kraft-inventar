import * as config from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
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
  writeBatch,
  terminate,
  clearIndexedDbPersistence,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
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
  containerUrl,
  findObjectBounds,
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
      "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check.js"
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

// Kurze Meldung unten. Optional mit Knopf (z.B. "Rückgängig"): toast(text, { ms, action: { label, fn } }).
let toastTimer = null;
function toast(msg, opts = {}) {
  const { ms = 1600, action = null } = typeof opts === "number" ? { ms: opts } : opts;
  toastEl.textContent = msg;
  toastEl.classList.toggle("has-action", !!action);
  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      toastEl.classList.remove("show", "has-action");
      action.fn();
    }, { once: true });
    toastEl.append(" ", btn);
  }
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show", "has-action"), ms);
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
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelectorAll('[data-action="close"]').forEach((b) => b.addEventListener("click", close));
  document.body.appendChild(overlay);
  return { overlay, close };
}

// Detailansicht eines Artikels: Foto gross, Foto ändern, Verschieben, Entfernen.
function showItemDetails(containerId, itemId, item) {
  const hasPhoto = isSafePhoto(item.photo);
  const { overlay, close } = openDialog(`
    ${hasPhoto ? `<img alt="" />` : ""}
    <strong></strong>
    <span class="muted">${escapeHtml(String(item.qty ?? 1))} ${escapeHtml(item.unit || "")}</span>
    <div class="photo-actions">
      <button type="button" data-action="change">📷 ${hasPhoto ? "Foto ändern" : "Foto hinzufügen"}</button>
      <button type="button" data-action="move">↪ Verschieben</button>
    </div>
    <div class="photo-actions">
      <button type="button" data-action="del" class="danger">🗑 Entfernen</button>
      <button type="button" data-action="close" class="secondary">Schliessen</button>
    </div>
  `);
  if (hasPhoto) overlay.querySelector("img").src = item.photo;
  overlay.querySelector("strong").textContent = item.name;
  overlay.querySelector('[data-action="change"]').addEventListener("click", () => {
    close();
    openPhotoPicker(containerId, itemId);
  });
  overlay.querySelector('[data-action="move"]').addEventListener("click", () => {
    close();
    showMoveDialog(containerId, itemId, item);
  });
  overlay.querySelector('[data-action="del"]').addEventListener("click", () => {
    close();
    removeItem(containerId, itemId, item);
  });
}

// Behälterliste (für "Verschieben"), alphabetisch.
async function loadContainers() {
  const snap = await getDocs(collection(db, "containers"));
  return snap.docs
    .map((d) => ({ id: d.id, name: d.data().name || d.id }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
}

async function showMoveDialog(fromId, itemId, item) {
  const { overlay, close } = openDialog(`
    <strong></strong>
    <label class="muted" for="move-target">Verschieben nach:</label>
    <select id="move-target" class="big-select"><option value="">Lade…</option></select>
    <div class="photo-actions">
      <button type="button" data-action="ok" disabled>Verschieben</button>
      <button type="button" data-action="close" class="secondary">Abbrechen</button>
    </div>
  `);
  overlay.querySelector("strong").textContent = item.name;
  const select = overlay.querySelector("select");
  const ok = overlay.querySelector('[data-action="ok"]');
  try {
    const containers = (await loadContainers()).filter((c) => c.id !== fromId);
    select.innerHTML = containers.length
      ? containers.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("")
      : `<option value="">Kein anderer Behälter vorhanden</option>`;
    ok.disabled = !containers.length;
    ok.addEventListener("click", () => {
      const target = containers.find((c) => c.id === select.value);
      if (!target) return;
      close();
      moveItem(fromId, itemId, item, target);
    });
  } catch (err) {
    console.error(err);
    select.innerHTML = `<option value="">Fehler: ${escapeHtml(err.code || err.message)}</option>`;
  }
}

// Verschiebt einen Artikel in einen anderen Behälter (in einem Schritt: dort anlegen/addieren, hier löschen).
async function moveItem(fromId, itemId, item, target) {
  const unit = item.unit || "Stk";
  const qty = parseQty(item.qty);
  const targetItemId = isValidId(itemId) ? itemId : slugify(item.name);
  const dst = itemRef(target.id, targetItemId);
  try {
    const existing = await getDoc(dst);
    const batch = writeBatch(db);
    if (existing.exists()) {
      const t = existing.data();
      if ((t.unit || "Stk") !== unit) {
        alert(`In "${target.name}" gibt es "${t.name}" schon mit Einheit ${t.unit}. Bitte dort zuerst anpassen.`);
        return;
      }
      const upd = { qty: increment(Math.max(0, Math.min(qty, MAX_QTY - (t.qty || 0)))), updatedAt: serverTimestamp() };
      if (!isSafePhoto(t.photo) && isSafePhoto(item.photo)) upd.photo = item.photo;
      batch.update(dst, upd);
    } else {
      const data = { name: item.name, qty, unit, updatedAt: serverTimestamp() };
      if (isSafePhoto(item.photo)) data.photo = item.photo;
      batch.set(dst, data);
    }
    batch.delete(itemRef(fromId, itemId));
    background(batch.commit(), "Verschieben");
    toast(`"${item.name}" → ${target.name}`, {
      ms: 5000,
      action: { label: "Öffnen", fn: () => { location.href = `index.html?c=${encodeURIComponent(target.id)}#i=${encodeURIComponent(targetItemId)}`; } },
    });
  } catch (err) {
    console.error(err);
    toast(`Verschieben fehlgeschlagen (${err.code || err.message})`, 4000);
  }
}

// --- QR-Scanner in der App (Android/Chrome: BarcodeDetector; sonst normale Kamera-App benutzen) ---

const canScan = "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia;

async function openScanner() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  } catch (err) {
    toast(`Kamera nicht verfügbar (${err.name || err.message})`, 4000);
    return;
  }
  const { overlay, close } = openDialog(`
    <video class="scanner-video" playsinline muted autoplay></video>
    <span class="muted">QR-Code eines Behälters ins Bild halten</span>
    <div class="photo-actions"><button type="button" data-action="close" class="secondary">Abbrechen</button></div>
  `);
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

  const detector = new BarcodeDetector({ formats: ["qr_code"] });
  let warned = false;
  const tick = async () => {
    if (!active) return;
    try {
      if (video.readyState >= 2) {
        for (const code of await detector.detect(video)) {
          const id = containerIdFromScan(code.rawValue, location.href);
          if (id) {
            stop();
            close();
            const name = new URL(code.rawValue).searchParams.get("n");
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

const params = new URLSearchParams(location.search);
const containerId = params.get("c");

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
  if (containerId) {
    renderContainer(containerId);
  } else {
    renderOverview();
  }
});

// --- Übersicht: Suche "Wo ist …?", Scanner, Behälterliste ---

function renderOverview() {
  main.innerHTML = `
    <div class="search-row">
      <input type="search" id="search" class="search-input" placeholder="🔍 Wo ist …? Artikel suchen"
        autocomplete="off" enterkeyhint="search" aria-label="Artikel suchen" maxlength="${MAX_NAME}" />
      ${canScan ? `<button type="button" id="scan-btn" class="scan-btn" aria-label="QR-Code scannen">📷 Scan</button>` : ""}
    </div>
    <div id="search-results" class="search-results" hidden></div>
    <h1>Deine Behälter</h1>
    <div class="container-list" id="container-list"><p class="empty-hint">Lade…</p></div>
    <p class="muted"><a id="qr-all" href="qr.html">🖨 QR-Codes für alle Behälter drucken</a></p>
    <form class="add-form" id="new-container-form">
      <input name="name" placeholder="Neuer Behälter (z.B. Kühlschrank)" maxlength="${MAX_NAME}" required />
      <button type="submit">Anlegen</button>
    </form>
  `;

  const list = document.getElementById("container-list");
  const searchInput = document.getElementById("search");
  const results = document.getElementById("search-results");
  const containerNames = new Map();
  onSnapshot(collection(db, "containers"), (snap) => {
    containerNames.clear();
    snap.forEach((d) => containerNames.set(d.id, d.data().name || d.id));
    if (snap.empty) {
      list.innerHTML = `<p class="empty-hint">Noch keine Behälter angelegt.</p>`;
      return;
    }
    list.innerHTML = "";
    const sorted = [...containerNames].sort((a, b) => a[1].localeCompare(b[1], "de"));
    const qrParams = new URLSearchParams();
    for (const [cid, cname] of sorted) { qrParams.append("c", cid); qrParams.append("n", cname); }
    document.getElementById("qr-all").href = `qr.html?${qrParams}`;
    for (const [id, name] of sorted) {
      const a = document.createElement("a");
      a.href = `index.html?c=${encodeURIComponent(id)}`;
      a.className = "card";
      a.innerHTML = `<div class="name"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(id)}</small></div><div aria-hidden="true">›</div>`;
      list.appendChild(a);
    }
    if (searchInput.value) showResults();
  }, (err) => showError(list, err));

  // Suche über alle Behälter. Die Artikel werden erst beim ersten Tippen geladen (spart Lesezugriffe).
  let allItems = null;
  let loading = null;

  async function loadAllItems() {
    let docs;
    try {
      docs = (await getDocs(collectionGroup(db, "items"))).docs;
    } catch (err) {
      // Ältere Regeln (ohne Collection-Group-Freigabe): Behälter einzeln abfragen.
      if (err.code !== "permission-denied") throw err;
      const ids = containerNames.size ? [...containerNames.keys()] : (await loadContainers()).map((c) => c.id);
      const snaps = await Promise.all(ids.map((id) => getDocs(collection(db, "containers", id, "items"))));
      docs = snaps.flatMap((s) => s.docs);
    }
    return docs
      .filter((d) => d.ref.parent.parent?.parent.id === "containers")
      .map((d) => ({ id: d.id, containerId: d.ref.parent.parent.id, ...d.data() }));
  }

  function showResults() {
    const q = searchInput.value;
    if (!normalizeSearch(q)) {
      results.hidden = true;
      return;
    }
    results.hidden = false;
    if (!allItems) {
      results.innerHTML = `<p class="empty-hint">Suche…</p>`;
      return;
    }
    const withNames = allItems.map((it) => ({ ...it, containerName: containerNames.get(it.containerId) || it.containerId }));
    const hits = searchItems(withNames, q);
    if (!hits.length) {
      results.innerHTML = `<p class="empty-hint">Nichts gefunden für „${escapeHtml(q)}“.</p>`;
      return;
    }
    results.innerHTML = "";
    for (const it of hits) {
      const a = document.createElement("a");
      a.className = "card result";
      a.href = `index.html?c=${encodeURIComponent(it.containerId)}#i=${encodeURIComponent(it.id)}`;
      a.innerHTML = `
        <span class="thumb-btn small">${isSafePhoto(it.photo) ? `<img class="thumb" alt="" decoding="async" />` : "📦"}</span>
        <div class="name"><strong>${escapeHtml(it.name)}</strong><small>${escapeHtml(String(it.qty ?? 1))} ${escapeHtml(it.unit || "")} · in <b>${escapeHtml(it.containerName)}</b></small></div>
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

  document.getElementById("scan-btn")?.addEventListener("click", openScanner);

  document.getElementById("new-container-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    const id = slugify(name);
    if (!isValidId(id)) {
      toast("Bitte einen Namen mit Buchstaben oder Ziffern eingeben", 3000);
      return;
    }
    if (containerNames.has(id)) {
      location.href = `index.html?c=${encodeURIComponent(id)}`;
      return;
    }
    background(setDoc(doc(db, "containers", id), { name, createdAt: serverTimestamp() }, { merge: true }), "Anlegen");
    e.target.reset();
    toast(`"${name}" angelegt`);
  });
}

// --- Behälter-Ansicht ---

function renderContainer(id) {
  // Ein "/" in ?c= würde einen ungültigen Firestore-Pfad ergeben (Seite bliebe bei "Lade…").
  if (!id || id.includes("/")) {
    main.innerHTML = `<p class="empty-hint">Ungültiger Behälter-Link.<br><a href="index.html">Zur Übersicht</a></p>`;
    return;
  }
  main.innerHTML = `
    <div class="title-row">
      <h1 id="container-title">…</h1>
      <button type="button" class="link-btn" id="rename-btn" aria-label="Behälter umbenennen">✏️</button>
      <a class="link-btn" id="qr-link" href="qr.html" aria-label="QR-Code für diesen Behälter">QR</a>
    </div>
    <input type="search" id="item-filter" class="search-input" placeholder="🔍 In diesem Behälter filtern"
      autocomplete="off" aria-label="Artikel filtern" hidden />
    <div id="items"><p class="empty-hint">Lade…</p></div>
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
  `;

  const itemsEl = document.getElementById("items");
  const titleEl = document.getElementById("container-title");
  const filterInput = document.getElementById("item-filter");
  const form = document.getElementById("add-item-form");
  const addHint = document.getElementById("add-hint");
  const photoPreview = form.querySelector(".photo-pick-preview");
  let containerName = id;
  let previewUrl = null;
  let currentItems = new Map();

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

  onSnapshot(doc(db, "containers", id), (snap) => {
    if (snap.exists()) {
      containerName = snap.data().name || id;
    } else if (!snap.metadata.fromCache && isValidId(id)) {
      // Neuer QR-Code gescannt → Behälter anlegen (Name aus &n=, sonst die ID).
      // Nur nach Antwort vom Server, sonst würde ein leerer Offline-Cache den Namen überschreiben.
      const n = (params.get("n") || "").trim().slice(0, MAX_NAME);
      containerName = n || id;
      background(setDoc(doc(db, "containers", id), { name: containerName, createdAt: serverTimestamp() }, { merge: true }), "Anlegen");
    }
    titleEl.textContent = containerName;
    document.title = `${containerName} – Vorrat`;
    document.getElementById("qr-link").href = `qr.html?c=${encodeURIComponent(id)}&n=${encodeURIComponent(containerName)}`;
  }, (err) => showError(itemsEl, err));

  document.getElementById("rename-btn").addEventListener("click", () => {
    const name = (prompt("Neuer Name für diesen Behälter:", containerName) || "").trim().slice(0, MAX_NAME);
    if (!name || name === containerName) return;
    background(setDoc(doc(db, "containers", id), { name }, { merge: true }), "Umbenennen");
    toast(`Umbenannt in "${name}" (QR-Code bleibt gültig)`, 3000);
  });

  const itemsQuery = query(collection(db, "containers", id, "items"), orderBy("name"));
  let lastSnap = null;
  let highlightPending = decodeURIComponent((location.hash.match(/^#i=(.+)$/) || [])[1] || "");

  function renderItems() {
    const snap = lastSnap;
    if (!snap) return;
    currentItems = new Map(snap.docs.map((d) => [d.id, d.data()]));
    document.getElementById("item-names").innerHTML = [...currentItems.values()]
      .map((it) => `<option value="${escapeHtml(it.name)}"></option>`).join("");
    updateAddHint();
    filterInput.hidden = snap.size < FILTER_THRESHOLD && !filterInput.value;

    if (snap.empty) {
      itemsEl.innerHTML = `<p class="empty-hint">Leer – füge unten etwas hinzu.</p>`;
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
    for (const item of entries) {
      const itemId = item.id;
      const hasPhoto = isSafePhoto(item.photo);
      const busy = photosInProgress.has(`${id}/${itemId}`);
      const card = document.createElement("div");
      card.className = "card";
      card.dataset.id = itemId;
      card.innerHTML = `
        <button type="button" class="thumb-btn" data-action="photo" aria-label="${hasPhoto ? "Foto anzeigen" : "Foto hinzufügen"}">
          ${busy ? `<span class="spinner">⏳</span>` : hasPhoto ? `<img class="thumb" alt="" decoding="async" />` : "📷"}
        </button>
        <button type="button" class="name name-btn" data-action="details" aria-label="Details zu ${escapeHtml(item.name)}">
          <strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.unit || "")}</small>
        </button>
        <div class="qty-controls">
          <button type="button" class="round" data-action="dec" aria-label="Eins weniger">−</button>
          <button type="button" class="qty-value" data-action="set" aria-label="Menge eingeben">${escapeHtml(String(item.qty ?? 1))}</button>
          <button type="button" class="round" data-action="inc" aria-label="Eins mehr">+</button>
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
      card.querySelector('[data-action="del"]').addEventListener("click", () => removeItem(id, itemId, item));
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
// So gehen gleichzeitige Änderungen auf zwei Geräten nicht verloren.
function changeQty(containerId, itemId, item, delta) {
  const newQty = (item.qty ?? 1) + delta;
  if (newQty <= 0) {
    removeItem(containerId, itemId, item);
    return;
  }
  if (newQty > MAX_QTY) return;
  item.qty = newQty; // lokal mitzählen, bis der nächste Snapshot den echten Stand bringt
  background(updateDoc(itemRef(containerId, itemId), { qty: increment(delta), updatedAt: serverTimestamp() }));
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

// Entfernen ohne Rückfrage, dafür mit "Rückgängig" (stellt Name, Menge, Einheit und Foto wieder her).
function removeItem(containerId, itemId, item) {
  const ref = itemRef(containerId, itemId);
  const backup = {
    name: item.name,
    qty: parseQty(item.qty),
    unit: UNITS.includes(item.unit) ? item.unit : "Stk",
    updatedAt: serverTimestamp(),
  };
  if (isSafePhoto(item.photo)) backup.photo = item.photo;
  background(deleteDoc(ref), "Entfernen");
  toast(`"${item.name}" entfernt`, {
    ms: 6000,
    action: {
      label: "Rückgängig",
      fn: () => {
        background(setDoc(ref, backup), "Wiederherstellen");
        toast(`"${item.name}" wiederhergestellt`);
      },
    },
  });
}
