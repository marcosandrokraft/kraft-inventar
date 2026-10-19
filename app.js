import { firebaseConfig } from "./firebase-config.js";
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
import removeBackground from "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/dist/index.mjs";

// Einheitlicher Hintergrund für freigestellte Fotos.
const PHOTO_BACKGROUND = "#e8e8e8";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const main = document.getElementById("app");
const toastEl = document.getElementById("toast");

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
    toast("Foto konnte nicht gespeichert werden");
  }
});

function openPhotoPicker(containerId, itemId) {
  pendingPhotoTarget = { containerId, itemId };
  photoInput.click();
}

const params = new URLSearchParams(location.search);
const containerId = params.get("c");

if (containerId) {
  renderContainer(containerId);
} else {
  renderOverview();
}

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
  });

  document.getElementById("new-container-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    const id = slugify(name);
    await setDoc(doc(db, "containers", id), { name, createdAt: serverTimestamp() }, { merge: true });
    e.target.reset();
    toast(`"${name}" angelegt`);
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
      setDoc(doc(db, "containers", id), { name: id, createdAt: serverTimestamp() }, { merge: true });
    }
  });

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
  });

  document.getElementById("add-item-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    const qty = Number(e.target.qty.value) || 1;
    const unit = e.target.unit.value;
    if (!name) return;
    const itemId = slugify(name);
    await setDoc(
      doc(db, "containers", id, "items", itemId),
      { name, qty, unit, updatedAt: serverTimestamp() },
      { merge: true }
    );
    e.target.reset();
    e.target.qty.value = 1;
    toast(`"${name}" hinzugefügt`);
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
