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
const BACKGROUND_REMOVAL_URL = "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/dist/index.mjs";

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

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 1600);
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

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function drawToJpeg(img, maxDim, quality) {
  let { width, height } = img;
  if (width > height && width > maxDim) {
    height = Math.round((height * maxDim) / width);
    width = maxDim;
  } else if (height > maxDim) {
    width = Math.round((width * maxDim) / height);
    height = maxDim;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

// Verkleinert ein Foto (dataURL) so weit, bis es sicher unter die Firestore-Dokumentgrösse (1 MB) passt.
async function compressDataUrl(dataUrl) {
  const img = await loadImage(dataUrl);
  let maxDim = 480;
  let quality = 0.6;
  let result = drawToJpeg(img, maxDim, quality);
  while (result.length > 500_000 && maxDim > 160) {
    maxDim = Math.round(maxDim * 0.7);
    quality = Math.max(0.4, quality - 0.1);
    result = drawToJpeg(img, maxDim, quality);
  }
  return result;
}

async function compressImage(file) {
  return compressDataUrl(await readAsDataUrl(file));
}

// Schneidet das Objekt frei (läuft komplett im Browser, kein Server/API-Key nötig) und
// legt es auf einen einheitlichen Hintergrund. Das Modell (~ein paar MB) wird beim ersten
// Aufruf pro Gerät heruntergeladen und danach vom Browser zwischengespeichert.
async function cutoutWithBackground(file) {
  const { default: removeBackground } = await import(BACKGROUND_REMOVAL_URL);
  const cutoutBlob = await removeBackground(file, {
    model: "isnet_quint8",
    output: { type: "foreground", format: "image/png" },
  });
  const img = await loadImage(URL.createObjectURL(cutoutBlob));
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = PHOTO_BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.9);
}

async function processPhoto(file) {
  try {
    toast("Hintergrund wird entfernt… (erstes Mal kann etwas dauern)");
    const cutoutDataUrl = await cutoutWithBackground(file);
    return await compressDataUrl(cutoutDataUrl);
  } catch (err) {
    console.error("Freistellen fehlgeschlagen, speichere Originalfoto:", err);
    toast("Freistellen nicht möglich – speichere normales Foto");
    return await compressImage(file);
  }
}

// Ein gemeinsamer, versteckter Datei-Input für alle "Foto hinzufügen"-Buttons.
const photoInput = document.createElement("input");
photoInput.type = "file";
photoInput.accept = "image/*";
photoInput.capture = "environment";
photoInput.style.display = "none";
document.body.appendChild(photoInput);
let pendingPhotoTarget = null;

photoInput.addEventListener("change", async () => {
  const file = photoInput.files[0];
  const target = pendingPhotoTarget;
  photoInput.value = "";
  if (!file || !target) return;
  try {
    const photo = await processPhoto(file);
    await setDoc(
      doc(db, "containers", target.containerId, "items", target.itemId),
      { photo, updatedAt: serverTimestamp() },
      { merge: true }
    );
    toast("Foto gespeichert");
  } catch (err) {
    console.error(err);
    toast(`Foto konnte nicht gespeichert werden (${err.code || err.message})`);
  }
});

function openPhotoPicker(containerId, itemId) {
  pendingPhotoTarget = { containerId, itemId };
  photoInput.click();
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
      <input name="name" placeholder="Artikel (z.B. Milch)" required />
      <input name="qty" type="number" min="1" value="1" style="max-width:70px" />
      <select name="unit">
        <option value="Stk">Stk</option>
        <option value="Packung">Packung</option>
        <option value="g">g</option>
        <option value="ml">ml</option>
      </select>
      <button type="submit">+ Hinzufügen</button>
    </form>
  `;

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
  onSnapshot(itemsQuery, (snap) => {
    if (snap.empty) {
      itemsEl.innerHTML = `<p class="empty-hint">Leer – füge unten etwas hinzu.</p>`;
      return;
    }
    itemsEl.innerHTML = "";
    snap.forEach((d) => {
      const item = d.data();
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <button class="thumb-btn" data-action="photo" title="Foto hinzufügen/ändern">
          ${item.photo ? `<img src="${item.photo}" class="thumb" alt="${escapeHtml(item.name)}" />` : "📷"}
        </button>
        <div class="name"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.unit || "")}</small></div>
        <div class="qty-controls">
          <button class="round" data-action="dec">−</button>
          <span class="qty-value">${item.qty ?? 1}</span>
          <button class="round" data-action="inc">+</button>
        </div>
        <button class="delete" data-action="del" title="Entfernen">🗑</button>
      `;
      card.querySelector('[data-action="photo"]').addEventListener("click", () => openPhotoPicker(id, d.id));
      card.querySelector('[data-action="inc"]').addEventListener("click", () => changeQty(id, d.id, item, 1));
      card.querySelector('[data-action="dec"]').addEventListener("click", () => changeQty(id, d.id, item, -1));
      card.querySelector('[data-action="del"]').addEventListener("click", () => removeItem(id, d.id, item.name));
      itemsEl.appendChild(card);
    });
  }, (err) => showError(itemsEl, err));

  document.getElementById("add-item-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    const qty = Number(e.target.qty.value) || 1;
    const unit = e.target.unit.value;
    if (!name) return;
    const itemId = slugify(name);
    try {
      await setDoc(
        doc(db, "containers", id, "items", itemId),
        { name, qty, unit, updatedAt: serverTimestamp() },
        { merge: true }
      );
      e.target.reset();
      e.target.qty.value = 1;
      toast(`"${name}" hinzugefügt`);
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
