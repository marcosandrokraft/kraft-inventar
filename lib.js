// Reine Logik ohne Browser-/Firebase-Abhängigkeiten – wird von app.js und qr.html benutzt
// und in tests/unit/ getestet (npm test).

// Reihenfolge = Reihenfolge im Auswahlfeld. "Stk" steht für Stück (bestehende Daten nutzen "Stk").
// Gleiche Liste wie validItem() in firestore.rules.
export const UNITS = ["Stk", "Packung", "Flasche", "Dose", "Glas", "g", "kg", "ml", "l"];
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

// --- Mengen: Schrittweite für +/− ---

// g und ml ändern sich mit ±50, alle anderen Einheiten mit ±1.
export function qtyStep(unit) {
  return unit === "g" || unit === "ml" ? 50 : 1;
}

// Was passiert bei +/−? → { action: "remove" } (Menge würde ≤ 0) | { action: "none" } (Maximum
// erreicht) | { action: "change", delta, newQty }. delta ist so begrenzt, dass MAX_QTY eingehalten wird.
export function planStep(qty, unit, direction) {
  const current = Number.isInteger(qty) && qty > 0 ? qty : 1;
  const step = qtyStep(unit) * (direction < 0 ? -1 : 1);
  const target = current + step;
  if (target <= 0) return { action: "remove" };
  const newQty = Math.min(MAX_QTY, target);
  if (newQty === current) return { action: "none" };
  return { action: "change", delta: newQty - current, newQty };
}

// --- Hierarchie: Raum → Schrank → Fach → Box (alles optional, Ebenen dürfen fehlen) ---

// Gespeicherter Wert → Anzeige. Gleiche Werte wie validContainer() in firestore.rules.
export const CONTAINER_TYPES = { raum: "Raum", schrank: "Schrank", fach: "Fach", box: "Box" };
export const MAX_DEPTH = 20;

// `containers`: Map id → { name, parent?, type? }. Liefert den Pfad von oben bis zum Behälter
// [{ id, name }, …]. Fehlende Eltern (gelöscht) beenden den Pfad; kaputte Daten mit Kreis führen
// nicht zu einer Endlosschleife.
export function containerPath(id, containers) {
  const path = [];
  const seen = new Set();
  let current = id;
  while (current && !seen.has(current) && path.length < MAX_DEPTH) {
    seen.add(current);
    const c = containers.get(current);
    if (!c) {
      if (current === id) path.push({ id, name: id });
      break;
    }
    path.push({ id: current, name: c.name || current });
    current = c.parent;
  }
  return path.reverse();
}

export function formatPath(path) {
  return path.map((p) => p.name).join(" › ");
}

// Oberste Ebene: kein Elternteil, oder der Elternteil existiert nicht (mehr), oder Kreis.
export function isTopLevel(id, containers) {
  const parent = containers.get(id)?.parent;
  if (!parent || !containers.has(parent)) return true;
  return wouldCreateCycle(id, parent, containers);
}

// Direkte Unterbehälter, alphabetisch: [{ id, name, type }].
export function childContainers(id, containers) {
  const out = [];
  for (const [cid, c] of containers) {
    if (cid !== id && c.parent === id && !isTopLevel(cid, containers)) {
      out.push({ id: cid, name: c.name || cid, type: c.type });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "de"));
}

// Würde es einen Kreis geben, wenn `childId` in `newParentId` gelegt wird? (In sich selbst oder in
// einen eigenen Unterbehälter.)
export function wouldCreateCycle(childId, newParentId, containers) {
  if (!newParentId) return false;
  const seen = new Set();
  let current = newParentId;
  while (current && !seen.has(current)) {
    if (current === childId) return true;
    seen.add(current);
    current = containers.get(current)?.parent;
  }
  return false;
}

// Mögliche Ziele für "liegt in …": alle ausser dem Behälter selbst und seinen Unterbehältern,
// mit vollem Pfad, alphabetisch nach Pfad.
export function parentOptions(childId, containers) {
  const out = [];
  for (const id of containers.keys()) {
    if (childId && wouldCreateCycle(childId, id, containers)) continue;
    out.push({ id, label: formatPath(containerPath(id, containers)) });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, "de"));
}

// Freie ID für einen neuen Unterbehälter: zuerst slugify(name); ist die schon vergeben (z.B. "Fach 1"
// in zwei Schränken), dann "<eltern-id>-<name>", danach mit Nummer. `taken(id)` → true = vergeben.
export function uniqueContainerId(name, parentId, taken) {
  const base = slugify(name);
  if (!base) return "";
  const candidates = [base];
  if (parentId) candidates.push(slugify(`${parentId}-${base}`).slice(0, MAX_NAME).replace(/-$/, ""));
  for (const c of candidates) {
    if (isValidId(c) && !taken(c)) return c;
  }
  const stem = candidates[candidates.length - 1].slice(0, MAX_NAME - 4).replace(/-$/, "");
  for (let n = 2; n < 1000; n++) {
    const c = `${stem}-${n}`;
    if (isValidId(c) && !taken(c)) return c;
  }
  return "";
}

// --- Mindesthaltbarkeitsdatum (MHD), gespeichert als "YYYY-MM-DD" (Feld `mhd`) ---

export const SOON_DAYS = 3;

function pad(n) {
  return String(n).padStart(2, "0");
}

function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}

// Lokales Datum (nicht UTC) als "YYYY-MM-DD".
export function isoDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Gleiche Form wie validMhd() in firestore.rules (dort ohne Prüfung der Monatslänge).
export function isValidIsoDate(text) {
  if (typeof text !== "string" || !/^20\d\d-\d\d-\d\d$/.test(text)) return false;
  const [y, m, d] = text.split("-").map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

// Schnellauswahl ab `today` (Date): { days: 3 }, { days: 7 }, { months: 1 }.
// 31.01. + 1 Monat → Ende Februar (kein Überlauf in den März).
export function addToDate(today, { days = 0, months = 0 }) {
  const y = today.getFullYear();
  const m = today.getMonth() + months;
  const d = new Date(y, m, Math.min(today.getDate(), new Date(y, m + 1, 0).getDate()));
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

// Tage von heute bis zum MHD (negativ = abgelaufen).
export function daysUntil(mhd, today) {
  const [y, m, d] = mhd.split("-").map(Number);
  const a = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((Date.UTC(y, m - 1, d) - a) / 86400000);
}

// null (kein/ungültiges Datum) | "expired" | "soon" (heute bis in 3 Tagen) | "ok"
export function mhdStatus(mhd, today) {
  if (!isValidIsoDate(mhd)) return null;
  const days = daysUntil(mhd, today);
  if (days < 0) return "expired";
  if (days <= SOON_DAYS) return "soon";
  return "ok";
}

// "2027-03-12" → "12.03.2027"
export function formatDate(mhd) {
  if (!isValidIsoDate(mhd)) return "";
  const [y, m, d] = mhd.split("-");
  return `${d}.${m}.${y}`;
}

function toIso(y, m, d) {
  if (y < 100) y += 2000;
  if (y < 2000 || y > 2099 || m < 1 || m > 12) return null;
  if (d === null) d = daysInMonth(y, m); // nur Monat/Jahr → Monatsende
  if (d < 1 || d > daysInMonth(y, m)) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

// Datumsvorschläge aus erkanntem Text (OCR). Erkennt z.B. 12.03.27, 12.03.2027, 12/03/2027,
// 12-03-2027, 2027-03-12, 03.2027, 03/2027 (nur Monat/Jahr → Monatsende). Typische OCR-Fehler
// (O→0, l/I/|→1, Leerzeichen um Trennzeichen) werden korrigiert. Ergebnis: eindeutige ISO-Daten,
// nur plausible (höchstens 1 Jahr zurück, höchstens 15 Jahre voraus), das früheste zuerst.
export function parseDatesFromText(text, today = new Date()) {
  let t = String(text ?? "");
  const digitish = "[0-9OoIl|]";
  t = t.replace(new RegExp(`(${digitish})\\s*([./-])\\s*(?=${digitish})`, "g"), "$1$2");
  // In "Wörtern", die wie Datumsangaben aussehen (mind. 2 echte Ziffern), Buchstaben ersetzen.
  t = t.replace(/[0-9OoIl|][0-9OoIl|./-]*[0-9OoIl|]/g, (w) =>
    (w.match(/\d/g) || []).length >= 2 ? w.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1") : w);

  const found = [];
  const add = (iso, index) => { if (iso && !found.some((f) => f.iso === iso)) found.push({ iso, index }); };
  let m;
  const ymd = /(?<![\d./-])(20\d\d)([./-])(\d{1,2})\2(\d{1,2})(?![\d./-]*\d)/g;
  while ((m = ymd.exec(t))) add(toIso(+m[1], +m[3], +m[4]), m.index);
  const dmy = /(?<![\d./-])(\d{1,2})([./-])(\d{1,2})\2(\d{4}|\d{2})(?![\d])/g;
  while ((m = dmy.exec(t))) add(toIso(+m[4], +m[3], +m[1]), m.index);
  const my = /(?<![\d./-])(\d{1,2})[./-](20\d\d)(?![\d./-]*\d)/g;
  while ((m = my.exec(t))) add(toIso(+m[2], +m[1], null), m.index);

  return found
    .filter((f) => {
      const d = daysUntil(f.iso, today);
      return d >= -366 && d <= 15 * 366;
    })
    .sort((a, b) => a.iso.localeCompare(b.iso) || a.index - b.index)
    .map((f) => f.iso);
}

// --- GS1: Verfallsdatum (Application Identifier 17, YYMMDD) aus DataMatrix/QR/Digital Link ---

// Feste Längen (ohne AI) der häufigsten zweistelligen AIs; variable AIs enden am Gruppentrenner.
const GS1_FIXED = { "00": 18, "01": 14, "02": 14, "11": 6, "12": 6, "13": 6, "15": 6, "16": 6, "17": 6, "20": 2 };
const GS1_VARIABLE = new Set(["10", "21", "22"]);
const GS = "\u001d";

function gs1DateToIso(yymmdd) {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const d = Number(yymmdd.slice(4, 6));
  return toIso(2000 + Number(yymmdd.slice(0, 2)), Number(yymmdd.slice(2, 4)), d === 0 ? null : d); // Tag 00 = Monatsende
}

// Verfallsdatum (AI 17) bzw., falls nicht vorhanden, Mindesthaltbarkeitsdatum (AI 15 "best before",
// auf Lebensmitteln häufiger) als "YYYY-MM-DD", sonst null. Unterstützt: GS1 Digital Link
// (https://…/01/<GTIN>…?17=YYMMDD, auch …/17/YYMMDD im Pfad), Klartext mit Klammern
// "(01)…(17)270312" und rohe Element-Strings mit Gruppentrenner (FNC1 = \x1d) und
// Symbologie-Präfix (]d2, ]Q3, ]C1). Unbekannte Strukturen → null (lieber nichts als Falsches).
export function parseGs1Expiry(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const pick = (found) => gs1DateToIso(found["17"] ?? found["15"] ?? "");

  if (/^https?:\/\//i.test(text)) {
    let url;
    try { url = new URL(text); } catch { return null; }
    const segs = url.pathname.split("/").filter(Boolean);
    const gtinAt = segs.indexOf("01");
    if (gtinAt < 0 || !/^\d{8,14}$/.test(segs[gtinAt + 1] || "")) return null;
    const found = {};
    for (let i = gtinAt + 2; i + 1 < segs.length; i += 2) found[segs[i]] = segs[i + 1];
    for (const ai of ["15", "17"]) if (url.searchParams.has(ai)) found[ai] = url.searchParams.get(ai);
    return pick(found);
  }

  if (/^\(\d{2,4}\)/.test(text)) {
    const found = {};
    for (const m of text.matchAll(/\((1[57])\)(\d{6})/g)) found[m[1]] ??= m[2];
    return pick(found);
  }

  let s = text.replace(/^\][A-Za-z]\d/, "");
  if (!/^(00|01|02|10|11|15|17)\d/.test(s)) return null;
  const found = {};
  while (s.length) {
    if (s[0] === GS) { s = s.slice(1); continue; }
    const ai = s.slice(0, 2);
    if (ai in GS1_FIXED) {
      const value = s.slice(2, 2 + GS1_FIXED[ai]);
      if (value.length !== GS1_FIXED[ai] || !/^\d+$/.test(value)) break;
      if (ai === "17" || ai === "15") found[ai] ??= value;
      s = s.slice(2 + GS1_FIXED[ai]);
    } else if (GS1_VARIABLE.has(ai)) {
      const end = s.indexOf(GS, 2);
      if (end < 0) break; // letztes Feld
      s = s.slice(end + 1);
    } else {
      break; // unbekannter AI: Rest nicht deuten
    }
  }
  return pick(found);
}

// --- Liste "läuft bald ab" (Runde 3) ---

// Wählbare Zeiträume der Liste (Tage ab heute). 3 = wie die orange Markierung (SOON_DAYS).
export const EXPIRY_WINDOWS = [SOON_DAYS, 7];

// Artikel, deren MHD abgelaufen ist oder in höchstens `days` Tagen abläuft – das früheste Datum
// zuerst, bei gleichem Datum alphabetisch. Artikel ohne/mit ungültigem MHD fallen weg.
// Ergebnis: Kopien der Artikel mit zusätzlich `days` (Tage bis zum MHD, negativ = abgelaufen).
export function expiringItems(items, today, days = SOON_DAYS) {
  const out = [];
  for (const item of items) {
    if (!isValidIsoDate(item?.mhd)) continue;
    const d = daysUntil(item.mhd, today);
    if (d <= days) out.push({ ...item, days: d });
  }
  return out.sort((a, b) => a.mhd.localeCompare(b.mhd)
    || String(a.name ?? "").localeCompare(String(b.name ?? ""), "de"));
}

// Tage bis zum MHD als Text: "heute", "morgen", "in 3 Tagen", "seit gestern", "seit 4 Tagen".
export function daysText(days) {
  if (days === 0) return "heute";
  if (days === 1) return "morgen";
  if (days > 1) return `in ${days} Tagen`;
  if (days === -1) return "seit gestern";
  return `seit ${-days} Tagen`;
}

// --- Umzugsmodus: Ziel per QR-Code (Runde 3) ---

// Gescannter Text → Ziel für den Umzug. Gleiche Prüfung wie beim normalen Scan
// (containerIdFromScan), aber ein unbekannter Behälter wird NICHT angelegt, sondern abgelehnt.
// → { id } | { error: "invalid" } (kein Behälter-Link dieser App) | { error: "same", id }
//   (der Behälter, aus dem verschoben wird) | { error: "unknown", id, name } (gibt es nicht).
// `containers`: Map id → { name, … } aller bekannten Behälter.
export function moveTargetFromScan(text, appHref, fromId, containers) {
  const id = containerIdFromScan(text, appHref);
  if (!id) return { error: "invalid" };
  if (id === fromId) return { error: "same", id };
  if (!containers.has(id)) {
    let name = "";
    try { name = (new URL(String(text).trim()).searchParams.get("n") || "").trim().slice(0, MAX_NAME); } catch {}
    return { error: "unknown", id, name: name || id };
  }
  return { id };
}
