// Reine Logik ohne Browser-/Firebase-Abhängigkeiten – wird von app.js und qr.html benutzt
// und in tests/unit/ getestet (npm test).

export const UNITS = ["Stk", "Packung", "g", "ml"];
export const MAX_QTY = 100000;
export const MAX_NAME = 100;

// Macht aus einem Anzeigenamen eine Dokument-ID ("Kleiderschrank Marco" → "kleiderschrank-marco").
export function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9äöüß]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Gleiche Prüfung wie validId() in firestore.rules (gilt dort nur beim Neuanlegen).
export function isValidId(id) {
  return typeof id === "string" && id.length <= MAX_NAME && /^[a-z0-9äöüß]+(-[a-z0-9äöüß]+)*$/.test(id);
}

export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Nur selbst erzeugte Bilder anzeigen (schützt vor eingeschleustem HTML/JS im Feld "photo").
export function isSafePhoto(photo) {
  return typeof photo === "string" && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(photo);
}

// Eingabe aus dem Mengenfeld → ganze Zahl zwischen 1 und MAX_QTY.
export function parseQty(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(MAX_QTY, n);
}

// Was soll passieren, wenn ein Artikel hinzugefügt wird, den es (gleiche ID) evtl. schon gibt?
// - "create": neu anlegen
// - "add":    gleiche Einheit → Menge addieren (newQty = Summe, gedeckelt)
// - "conflict": andere Einheit → nachfragen, ob ersetzt werden soll
export function planAddItem(existing, { qty, unit }) {
  if (!existing) return { action: "create", newQty: qty };
  const oldQty = Number.isInteger(existing.qty) ? existing.qty : 1;
  if ((existing.unit || "Stk") !== unit) {
    return { action: "conflict", oldQty, oldUnit: existing.unit || "Stk", newQty: qty };
  }
  const sum = oldQty + qty;
  return { action: "add", oldQty, delta: Math.min(qty, MAX_QTY - oldQty), newQty: Math.min(MAX_QTY, sum) };
}

// Für die Suche: Gross/klein, Akzente und Umlaute ignorieren ("Müsli" findet "musli" und "muesli").
export function normalizeSearch(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u")
    .replace(/\s+/g, " ")
    .trim();
}

// Filtert Artikel [{name, containerName, ...}] nach einem Suchbegriff. Alle Wörter müssen
// im Artikelnamen oder im Behälternamen vorkommen. Treffer am Wortanfang zuerst, dann alphabetisch.
export function searchItems(items, queryText, limit = 50) {
  const words = normalizeSearch(queryText).split(" ").filter(Boolean);
  if (!words.length) return [];
  const scored = [];
  for (const item of items) {
    const name = normalizeSearch(item.name);
    const where = normalizeSearch(item.containerName);
    const hay = `${name} ${where}`;
    if (!words.every((w) => hay.includes(w))) continue;
    let score = 0;
    if (name.startsWith(words[0])) score -= 2;
    else if (name.split(" ").some((part) => part.startsWith(words[0]))) score -= 1;
    scored.push({ item, score, name });
  }
  scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, "de"));
  return scored.slice(0, limit).map((s) => s.item);
}

// Behälter-ID aus einem gescannten QR-Code: nur Links auf diese App (gleicher Ursprung) mit ?c=.
export function containerIdFromScan(text, appHref) {
  let url;
  try {
    url = new URL(String(text).trim());
  } catch {
    return null;
  }
  const app = new URL(appHref);
  if (url.origin !== app.origin) return null;
  const c = url.searchParams.get("c");
  return c && isValidId(c) ? c : null;
}

// Zeilen aus dem QR-Formular → [{id, name}]. Zeilen ohne verwertbaren Namen fallen weg,
// doppelte IDs werden zusammengefasst.
export function parseQrEntries(text) {
  const seen = new Set();
  const out = [];
  for (const line of String(text).split("\n")) {
    const name = line.trim().slice(0, MAX_NAME);
    const id = slugify(name);
    if (!name || !id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name });
  }
  return out;
}

// Link, den ein QR-Code öffnet. Der Name wird mitgegeben, damit ein neu angelegter Behälter gleich
// richtig heisst (ältere QR-Codes ohne &n= funktionieren weiterhin).
export function containerUrl(baseHref, id, name) {
  const url = new URL("index.html", baseHref);
  url.search = `?c=${encodeURIComponent(id)}`;
  if (name && name !== id) url.search += `&n=${encodeURIComponent(name)}`;
  return url.href;
}

// Freistellung nachbearbeiten: fast durchsichtige Reste entfernen (verändert `data` direkt) und das
// Rechteck um das Objekt bestimmen. Dafür wird das Bild in ein grobes Raster geteilt; es zählen nur
// zusammenhängende Flächen, die mindestens 10 % so gross sind wie die grösste – vereinzelte
// Schlieren fallen so weg. `data` ist RGBA wie bei ImageData.
export function findObjectBounds(data, w, h) {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 96) data[i] = 0;
  }

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
