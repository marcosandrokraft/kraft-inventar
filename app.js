import * as config from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
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

// Freistellungs-Bibliothek wird erst beim ersten Foto geladen. Als statischer Import würde ein
// Ladefehler (CDN nicht erreichbar, alter Browser) die ganze App bei "Lade…" stehen lassen.
// "+esm" ist wichtig: dist/index.mjs lädt onnxruntime-web über einen Paketnamen, den der Browser
// nicht auflösen kann – damit schlug das Freistellen immer fehl.
const BACKGROUND_REMOVAL_URL = "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm";

// Einheitlicher Hintergrund für freigestellte Fotos.
const PHOTO_BACKGROUND = "#e8e8e8";

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
// Falls beim Anlegen der Firestore-Datenbank eine eigene "Database ID" vergeben wurde,
// in firebase-config.js `export const firestoreDatabaseId = "..."` eintragen.
const db = getFirestore(app, config.firestoreDatabaseId || "(default)");

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

let toastTimer = null;
function toast(msg, ms = 1600) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), ms);
}

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9äöüß]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
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

// Entfernt fast durchsichtige Reste der Freistellung und liefert das Rechteck um das Objekt.
// Dafür wird das Bild in ein grobes Raster geteilt; es zählen nur zusammenhängende Flächen, die
// mindestens 10 % so gross sind wie die grösste – vereinzelte Schlieren fallen so weg.
function cleanupAndFindObject(canvas) {
  const { width: w, height: h } = canvas;
  const ctx = canvas.getContext("2d");
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 96) data[i] = 0;
  }
  ctx.putImageData(image, 0, 0);

  const cell = Math.max(2, Math.ceil(Math.max(w, h) / 128));
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  const solid = new Uint16Array(gw * gh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 160) solid[Math.floor(y / cell) * gw + Math.floor(x / cell)]++;
    }
  }
  const occupied = solid.map((n) => (n > cell * cell * 0.3 ? 1 : 0));

  // Zusammenhängende Flächen im Raster suchen.
  const label = new Int32Array(gw * gh).fill(-1);
  const components = [];
  for (let start = 0; start < occupied.length; start++) {
    if (!occupied[start] || label[start] >= 0) continue;
    const comp = { size: 0, minX: gw, minY: gh, maxX: -1, maxY: -1 };
    const stack = [start];
    label[start] = components.length;
    while (stack.length) {
      const i = stack.pop();
      const gx = i % gw;
      const gy = (i - gx) / gw;
      comp.size++;
      comp.minX = Math.min(comp.minX, gx);
      comp.maxX = Math.max(comp.maxX, gx);
      comp.minY = Math.min(comp.minY, gy);
      comp.maxY = Math.max(comp.maxY, gy);
      for (const n of [gx > 0 && i - 1, gx < gw - 1 && i + 1, gy > 0 && i - gw, gy < gh - 1 && i + gw]) {
        if (n !== false && occupied[n] && label[n] < 0) {
          label[n] = components.length;
          stack.push(n);
        }
      }
    }
    components.push(comp);
  }
  if (!components.length) throw new Error("Kein Objekt im Bild erkannt");

  const largest = Math.max(...components.map((c) => c.size));
  const kept = components.filter((c) => c.size >= largest * 0.1);
  return {
    minX: Math.min(...kept.map((c) => c.minX)) * cell,
    minY: Math.min(...kept.map((c) => c.minY)) * cell,
    maxX: Math.min(w - 1, (Math.max(...kept.map((c) => c.maxX)) + 1) * cell - 1),
    maxY: Math.min(h - 1, (Math.max(...kept.map((c) => c.maxY)) + 1) * cell - 1),
  };
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

// Nur selbst erzeugte Bilder anzeigen (schützt vor eingeschleustem HTML/JS im Feld "photo").
function isSafePhoto(photo) {
  return typeof photo === "string" && photo.startsWith("data:image/jpeg;base64,");
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
    await setDoc(
      doc(db, "containers", containerId, "items", itemId),
      { photo, updatedAt: serverTimestamp() },
      { merge: true }
    );
    toast("Foto gespeichert");
  } catch (err) {
    console.error(err);
    toast(`Foto konnte nicht gespeichert werden (${err.code || err.message})`, 4000);
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

// Grossansicht eines Fotos mit "Foto ändern".
function showPhoto(item, onChange) {
  const overlay = document.createElement("div");
  overlay.className = "photo-overlay";
  overlay.innerHTML = `
    <div class="photo-dialog">
      <img alt="" />
      <strong></strong>
      <div class="photo-actions">
        <button type="button" data-action="change">📷 Foto ändern</button>
        <button type="button" data-action="close" class="secondary">Schliessen</button>
      </div>
    </div>
  `;
  overlay.querySelector("img").src = item.photo;
  overlay.querySelector("strong").textContent = item.name;
  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-action="close"]').addEventListener("click", close);
  overlay.querySelector('[data-action="change"]').addEventListener("click", () => { close(); onChange(); });
  document.body.appendChild(overlay);
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

// Entfernt die Login-Parameter aus der Adresszeile, behält aber ?c= (Behälter vom QR-Code).
function cleanUrl() {
  const url = new URL(location.href);
  const c = url.searchParams.get("c");
  url.search = c ? `?c=${encodeURIComponent(c)}` : "";
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
    location.reload();
  });
}

const params = new URLSearchParams(location.search);
const containerId = params.get("c");

await completeEmailLinkSignIn();

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

function renderOverview() {
  main.innerHTML = `
    <h1>Deine Behälter</h1>
    <div class="container-list" id="container-list"><p class="empty-hint">Lade…</p></div>
    <form class="add-form" id="new-container-form">
      <input name="name" placeholder="Neuer Behälter (z.B. Kühlschrank)" required />
      <button type="submit">Anlegen</button>
    </form>
  `;

  const list = document.getElementById("container-list");
  onSnapshot(collection(db, "containers"), (snap) => {
    if (snap.empty) {
      list.innerHTML = `<p class="empty-hint">Noch keine Behälter angelegt.</p>`;
      return;
    }
    list.innerHTML = "";
    snap.forEach((d) => {
      const data = d.data();
      const a = document.createElement("a");
      a.href = `index.html?c=${encodeURIComponent(d.id)}`;
      a.className = "card";
      a.innerHTML = `<div class="name"><strong>${escapeHtml(data.name || d.id)}</strong><small>${escapeHtml(d.id)}</small></div><div>›</div>`;
      list.appendChild(a);
    });
  }, (err) => showError(list, err));

  document.getElementById("new-container-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    const id = slugify(name);
    try {
      await setDoc(doc(db, "containers", id), { name, createdAt: serverTimestamp() }, { merge: true });
      e.target.reset();
      toast(`"${name}" angelegt`);
    } catch (err) {
      showError(list, err);
    }
  });
}

function renderContainer(id) {
  main.innerHTML = `
    <h1 id="container-title">…</h1>
    <div id="items"><p class="empty-hint">Lade…</p></div>
    <form class="add-form" id="add-item-form">
      <label class="photo-pick" title="Foto aufnehmen oder hochladen">
        <input name="photo" type="file" accept="image/*" hidden />
        <span class="photo-pick-preview">📷</span>
      </label>
      <input name="name" placeholder="Artikel (z.B. Milch)" required />
      <input name="qty" type="number" min="1" value="1" inputmode="numeric" aria-label="Anzahl" style="max-width:70px" />
      <select name="unit" aria-label="Einheit">
        <option value="Stk">Stk</option>
        <option value="Packung">Packung</option>
        <option value="g">g</option>
        <option value="ml">ml</option>
      </select>
      <button type="submit">+ Hinzufügen</button>
    </form>
  `;

  const form = document.getElementById("add-item-form");
  const photoPreview = form.querySelector(".photo-pick-preview");
  let previewUrl = null;
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

  onSnapshot(doc(db, "containers", id), (snap) => {
    const title = document.getElementById("container-title");
    title.textContent = snap.exists() ? (snap.data().name || id) : `Neuer Behälter: ${id}`;
    if (!snap.exists()) {
      setDoc(doc(db, "containers", id), { name: id, createdAt: serverTimestamp() }, { merge: true })
        .catch((err) => showError(itemsEl, err));
    }
  }, (err) => showError(itemsEl, err));

  const itemsEl = document.getElementById("items");
  const itemsQuery = query(collection(db, "containers", id, "items"), orderBy("name"));
  let lastSnap = null;
  function renderItems() {
    const snap = lastSnap;
    if (!snap) return;
    if (snap.empty) {
      itemsEl.innerHTML = `<p class="empty-hint">Leer – füge unten etwas hinzu.</p>`;
      return;
    }
    itemsEl.innerHTML = "";
    snap.forEach((d) => {
      const item = d.data();
      const hasPhoto = isSafePhoto(item.photo);
      const busy = photosInProgress.has(`${id}/${d.id}`);
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <button class="thumb-btn" data-action="photo" title="${hasPhoto ? "Foto anzeigen" : "Foto hinzufügen"}">
          ${busy ? `<span class="spinner">⏳</span>` : hasPhoto ? `<img class="thumb" alt="" />` : "📷"}
        </button>
        <div class="name"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.unit || "")}</small></div>
        <div class="qty-controls">
          <button class="round" data-action="dec">−</button>
          <span class="qty-value">${item.qty ?? 1}</span>
          <button class="round" data-action="inc">+</button>
        </div>
        <button class="delete" data-action="del" title="Entfernen">🗑</button>
      `;
      const thumb = card.querySelector("img.thumb");
      if (thumb) thumb.src = item.photo;
      const pick = () => openPhotoPicker(id, d.id);
      card.querySelector('[data-action="photo"]').addEventListener("click", () => {
        if (busy) return;
        if (hasPhoto) showPhoto(item, pick);
        else pick();
      });
      card.querySelector('[data-action="inc"]').addEventListener("click", () => changeQty(id, d.id, item, 1));
      card.querySelector('[data-action="dec"]').addEventListener("click", () => changeQty(id, d.id, item, -1));
      card.querySelector('[data-action="del"]').addEventListener("click", () => removeItem(id, d.id, item.name));
      itemsEl.appendChild(card);
    });
  }
  rerenderItems = renderItems;

  onSnapshot(itemsQuery, (snap) => {
    lastSnap = snap;
    renderItems();
  }, (err) => showError(itemsEl, err));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = form.name.value.trim();
    const qty = Math.max(1, Math.round(Number(form.qty.value) || 1));
    const unit = form.unit.value;
    const photoFile = form.photo.files[0];
    if (!name) return;
    const itemId = slugify(name);
    try {
      // Artikel sofort speichern, das Foto wird danach im Hintergrund freigestellt und ergänzt.
      await setDoc(
        doc(db, "containers", id, "items", itemId),
        { name, qty, unit, updatedAt: serverTimestamp() },
        { merge: true }
      );
      form.reset();
      form.qty.value = 1;
      resetPhotoPreview();
      toast(`"${name}" hinzugefügt`);
      if (photoFile) savePhoto(id, itemId, photoFile);
    } catch (err) {
      console.error(err);
      toast(`Speichern fehlgeschlagen (${err.code || err.message})`);
    }
  });
}

async function changeQty(containerId, itemId, item, delta) {
  const newQty = (item.qty ?? 1) + delta;
  if (newQty <= 0) {
    await removeItem(containerId, itemId, item.name);
    return;
  }
  await setDoc(
    doc(db, "containers", containerId, "items", itemId),
    { ...item, qty: newQty, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

async function removeItem(containerId, itemId, name) {
  await deleteDoc(doc(db, "containers", containerId, "items", itemId));
  toast(`"${name}" entfernt`);
}
