// Übungsmodus: Ersatz für firebase-app.js, firebase-firestore.js und firebase-auth.js in EINEM Modul.
// app.js lädt es im Übungsmodus per import("./uebung-firebase.js") und benutzt es anstelle der
// echten Firebase-Module. NICHTS geht ans Netz: Die Daten liegen nur in diesem Browser
// (localStorage "vorrat-uebung-db"), jede Person übt auf ihrem Gerät mit Beispieldaten.
//
// Semantik wie Firestore, so weit app.js sie braucht (Pfade, set/merge/update/delete, Sentinels,
// Batches, Queries mit where/orderBy/limit, collectionGroup, onSnapshot). Timestamps werden intern
// als { __ts: <ms> } gespeichert und beim Lesen zu Timestamp.
// Ohne localStorage (privates Fenster, blockiert) läuft alles im Speicher weiter (nur diese Seite).
// Tests: tests/unit/uebung.test.mjs (npm test).

import { practiceSeed } from "./uebung-daten.js";

export const IS_PRACTICE = true;
export const SDK_VERSION = "uebung";

const STORAGE_KEY = "vorrat-uebung-db";
const FORMAT = 1;

// ---- Fehler ----

class FirestoreError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "FirebaseError";
  }
}

function fail(code, message) {
  return new FirestoreError(code, message);
}

// ---- Timestamp ----

export class Timestamp {
  constructor(seconds, nanoseconds) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }
  static fromMillis(ms) {
    const seconds = Math.floor(ms / 1000);
    return new Timestamp(seconds, Math.round((ms - seconds * 1000) * 1e6));
  }
  static fromDate(date) {
    return Timestamp.fromMillis(date.getTime());
  }
  static now() {
    return Timestamp.fromMillis(Date.now());
  }
  toMillis() {
    return this.seconds * 1000 + this.nanoseconds / 1e6;
  }
  toDate() {
    return new Date(this.toMillis());
  }
  isEqual(other) {
    return other instanceof Timestamp && other.seconds === this.seconds && other.nanoseconds === this.nanoseconds;
  }
  valueOf() {
    return String(this.toMillis()).padStart(20, "0");
  }
  toJSON() {
    return { seconds: this.seconds, nanoseconds: this.nanoseconds };
  }
  toString() {
    return `Timestamp(seconds=${this.seconds}, nanoseconds=${this.nanoseconds})`;
  }
}

// Auch Timestamps anderer Herkunft (gleiche Form) werden akzeptiert.
function isTimestampLike(v) {
  return v instanceof Timestamp
    || (v && typeof v === "object" && typeof v.toMillis === "function" && "seconds" in v && "nanoseconds" in v);
}

function isStoredTs(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    && typeof v.__ts === "number" && Object.keys(v).length === 1;
}

// ---- Sentinels ----

class FieldValue {
  constructor(kind, by) {
    this._kind = kind;
    this._by = by;
  }
  isEqual(other) {
    return other instanceof FieldValue && other._kind === this._kind && other._by === this._by;
  }
}

export function serverTimestamp() { return new FieldValue("serverTimestamp"); }
export function deleteField() { return new FieldValue("deleteField"); }
export function increment(n) {
  if (typeof n !== "number") throw fail("invalid-argument", "increment() braucht eine Zahl");
  return new FieldValue("increment", n);
}

// ---- Speicher ----

let docs = null; // Pfad → gespeicherte Daten (nur JSON-Werte); Objekte werden nie verändert, nur ersetzt
let lastRaw = null; // zuletzt gelesener/geschriebener Inhalt von localStorage
let storageListening = false;

function storage() {
  try {
    const s = globalThis.localStorage;
    return s && typeof s.getItem === "function" ? s : null;
  } catch {
    return null;
  }
}

function readRaw() {
  try {
    const s = storage();
    return s ? s.getItem(STORAGE_KEY) : null;
  } catch {
    return null;
  }
}

function isQuotaError(err) {
  return !!err && (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED"
    || err.code === 22 || err.code === 1014);
}

// Speichert `next`. Wirft nur bei vollem Speicher; ohne localStorage bleibt es im Speicher.
function writeStore(next) {
  const raw = JSON.stringify({ v: FORMAT, docs: next });
  const s = storage();
  if (!s) return;
  try {
    s.setItem(STORAGE_KEY, raw);
    lastRaw = raw;
  } catch (err) {
    if (isQuotaError(err)) throw err;
    console.warn("Übungsdaten können nicht gespeichert werden, arbeite nur im Speicher:", err);
  }
}

function parseRaw(raw) {
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== FORMAT || !parsed.docs || typeof parsed.docs !== "object" || Array.isArray(parsed.docs)) return null;
    for (const [path, data] of Object.entries(parsed.docs)) {
      if (!data || typeof data !== "object" || Array.isArray(data)) return null;
      const segs = path.split("/");
      if (segs.length % 2 !== 0 || segs.some((s) => !s)) return null;
    }
    return parsed.docs;
  } catch {
    return null;
  }
}

function freshSeed() {
  const seed = practiceSeed(new Date());
  try {
    writeStore(seed);
  } catch (err) {
    console.warn("Übungsdaten passen nicht in den Speicher:", err);
  }
  return seed;
}

// Liest den Stand aus localStorage; fehlt er oder ist er kaputt → frische Beispieldaten.
function loadStore() {
  const raw = readRaw();
  const parsed = parseRaw(raw);
  if (parsed) {
    lastRaw = raw;
    return parsed;
  }
  return freshSeed();
}

function ensureLoaded() {
  if (!docs) docs = loadStore();
  if (!storageListening) {
    storageListening = true;
    try {
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        // Änderung in einem anderen Tab → neu laden und Listener benachrichtigen.
        window.addEventListener("storage", (e) => {
          if (e && e.key !== STORAGE_KEY && e.key !== null) return;
          docs = loadStore();
          scheduleNotify();
        });
      }
    } catch {}
  }
  return docs;
}

// Vor dem Schreiben: hat ein anderer Tab inzwischen gespeichert? (Das storage-Ereignis kommt
// asynchron – so wird dessen Änderung nicht überschrieben.)
function refreshFromStorage() {
  const raw = readRaw();
  if (raw === null || raw === lastRaw) return;
  const parsed = parseRaw(raw);
  if (parsed) {
    docs = parsed;
    lastRaw = raw;
    scheduleNotify();
  }
}

// Setzt die Übung auf frische Beispieldaten zurück.
export function resetPracticeData() {
  ensureLoaded();
  const seed = practiceSeed(new Date());
  const s = storage();
  try {
    if (s) s.removeItem(STORAGE_KEY);
  } catch {}
  try {
    writeStore(seed);
  } catch (err) {
    console.warn("Übungsdaten passen nicht in den Speicher:", err);
  }
  docs = seed;
  scheduleNotify();
}

// Kopie aller Dokumente (Pfad → Daten, Timestamps als { __ts }) – für Tests/Fehlersuche.
export function practiceSnapshot() {
  return JSON.parse(JSON.stringify(ensureLoaded()));
}

// Nur für Tests: verwirft den Stand im Speicher und liest localStorage neu (wie Neuladen der Seite).
export function __reloadForTests() {
  docs = null;
  lastRaw = null;
  ensureLoaded();
  scheduleNotify();
}

// ---- App ----

const apps = new Map();

export function initializeApp(options = {}, name = "[DEFAULT]") {
  if (typeof name === "object" && name) name = name.name || "[DEFAULT]";
  const app = { name, options: { ...options }, automaticDataCollectionEnabled: false, isPractice: true };
  apps.set(name, app);
  return app;
}

export function getApp(name = "[DEFAULT]") {
  return apps.get(name) || initializeApp({}, name);
}

// ---- Datenbank ----

const databases = new Map();

function makeDb(app, databaseId = "(default)") {
  const key = databaseId || "(default)";
  if (!databases.has(key)) {
    databases.set(key, { type: "firestore", app: app || null, databaseId: key, isPractice: true, toJSON: () => ({ type: "firestore", databaseId: key }) });
  }
  return databases.get(key);
}

export function initializeFirestore(app, settings, databaseId) { return makeDb(app, databaseId); }
export function getFirestore(app, databaseId) {
  if (typeof app === "string") return makeDb(null, app);
  return makeDb(app, databaseId);
}
export function persistentLocalCache(settings = {}) { return { kind: "persistent", ...settings }; }
export function persistentMultipleTabManager() { return { kind: "PersistentMultipleTab" }; }
export function persistentSingleTabManager() { return { kind: "persistentSingleTab" }; }
export function memoryLocalCache() { return { kind: "memory" }; }

// Beendet alle Listener (wie Firestore). Weitere Zugriffe funktionieren hier trotzdem.
export async function terminate() {
  listeners.forEach((l) => { l.active = false; });
  listeners.clear();
}
// Kein IndexedDB-Cache im Übungsmodus; die Übungsdaten bleiben (Zurücksetzen: resetPracticeData).
export async function clearIndexedDbPersistence() {}
export async function enableNetwork() {}
export async function disableNetwork() {}

// ---- Referenzen ----

function isDb(x) {
  return !!x && x.type === "firestore";
}

// Zerlegt Pfad-Argumente in Segmente und prüft sie wie Firestore.
function pathSegments(fn, prefix, parts) {
  const segs = [...prefix];
  for (const part of parts) {
    if (typeof part !== "string") throw fail("invalid-argument", `${fn}(): Pfad muss Text sein`);
    if (part === "") throw fail("invalid-argument", `${fn}(): leerer Pfad`);
    if (part.includes("//")) throw fail("invalid-argument", `${fn}(): ungültiger Pfad "${part}" (enthält //)`);
    segs.push(...part.split("/").filter((s) => s !== ""));
  }
  if (segs.some((s) => s === "." || s === "..")) throw fail("invalid-argument", `${fn}(): ungültige ID in "${segs.join("/")}"`);
  return segs;
}

class DocumentReference {
  constructor(firestore, segs) {
    this.type = "document";
    this.firestore = firestore;
    this._segs = segs;
  }
  get id() { return this._segs[this._segs.length - 1]; }
  get path() { return this._segs.join("/"); }
  get parent() { return new CollectionReference(this.firestore, this._segs.slice(0, -1)); }
  isEqual(other) { return other instanceof DocumentReference && other.path === this.path; }
  toJSON() { return { type: this.type, path: this.path }; }
}

class Query {
  constructor(firestore, source, constraints = []) {
    this.type = "query";
    this.firestore = firestore;
    this._source = source; // { kind: "collection", path } | { kind: "group", id }
    this._constraints = constraints;
  }
}

class CollectionReference extends Query {
  constructor(firestore, segs) {
    super(firestore, { kind: "collection", path: segs.join("/") });
    this.type = "collection";
    this._segs = segs;
  }
  get id() { return this._segs[this._segs.length - 1]; }
  get path() { return this._segs.join("/"); }
  get parent() { return this._segs.length > 1 ? new DocumentReference(this.firestore, this._segs.slice(0, -1)) : null; }
  isEqual(other) { return other instanceof CollectionReference && other.path === this.path; }
  toJSON() { return { type: this.type, path: this.path }; }
}

function makeDocRef(firestore, segs) {
  if (segs.length === 0 || segs.length % 2 !== 0) {
    throw fail("invalid-argument", `Ungültige Dokument-Referenz: "${segs.join("/")}" hat ${segs.length} Segmente (gerade Zahl nötig)`);
  }
  return new DocumentReference(firestore, segs);
}

function makeCollRef(firestore, segs) {
  if (segs.length % 2 !== 1) {
    throw fail("invalid-argument", `Ungültige Collection-Referenz: "${segs.join("/")}" hat ${segs.length} Segmente (ungerade Zahl nötig)`);
  }
  return new CollectionReference(firestore, segs);
}

function randomId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(20);
  try {
    globalThis.crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = "";
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

export function doc(base, ...parts) {
  if (base instanceof CollectionReference) {
    const extra = parts.length ? parts : [randomId()];
    return makeDocRef(base.firestore, pathSegments("doc", base._segs, extra));
  }
  if (base instanceof DocumentReference) return makeDocRef(base.firestore, pathSegments("doc", base._segs, parts));
  if (isDb(base)) {
    if (!parts.length) throw fail("invalid-argument", "doc(): Pfad fehlt");
    return makeDocRef(base, pathSegments("doc", [], parts));
  }
  throw fail("invalid-argument", "doc(): erstes Argument muss Firestore, eine Collection- oder Dokument-Referenz sein");
}

export function collection(base, ...parts) {
  if (!parts.length) throw fail("invalid-argument", "collection(): Pfad fehlt");
  if (base instanceof CollectionReference || base instanceof DocumentReference) {
    return makeCollRef(base.firestore, pathSegments("collection", base._segs, parts));
  }
  if (isDb(base)) return makeCollRef(base, pathSegments("collection", [], parts));
  throw fail("invalid-argument", "collection(): erstes Argument muss Firestore oder eine Referenz sein");
}

export function collectionGroup(db, collectionId) {
  if (typeof collectionId !== "string" || !collectionId || collectionId.includes("/")) {
    throw fail("invalid-argument", "collectionGroup(): ungültige Collection-ID");
  }
  return new Query(db, { kind: "group", id: collectionId });
}

const WHERE_OPS = ["==", "!=", "<", "<=", ">", ">=", "in", "not-in", "array-contains", "array-contains-any"];

export function where(field, op, value) {
  if (!WHERE_OPS.includes(op)) throw fail("invalid-argument", `where(): Operator "${op}" wird nicht unterstützt`);
  if (value === undefined) throw fail("invalid-argument", "where(): Wert undefined ist nicht erlaubt");
  if (["in", "not-in", "array-contains-any"].includes(op) && !Array.isArray(value)) {
    throw fail("invalid-argument", `where(): "${op}" braucht eine Liste`);
  }
  return { kind: "where", field: String(field), op, value: toStored(value, "where") };
}
export function orderBy(field, dir = "asc") {
  if (dir !== "asc" && dir !== "desc") throw fail("invalid-argument", 'orderBy(): Richtung "asc" oder "desc"');
  return { kind: "orderBy", field: String(field), dir };
}
export function limit(n) {
  if (!Number.isInteger(n) || n <= 0) throw fail("invalid-argument", "limit(): positive ganze Zahl nötig");
  return { kind: "limit", n };
}

export function query(base, ...constraints) {
  if (!(base instanceof Query)) throw fail("invalid-argument", "query(): erstes Argument muss eine Collection oder Query sein");
  for (const c of constraints) {
    if (!c || !["where", "orderBy", "limit"].includes(c.kind)) throw fail("invalid-argument", "query(): ungültige Bedingung");
  }
  return new Query(base.firestore, base._source, [...base._constraints, ...constraints]);
}

// ---- Werte ----

function isPlainObject(v) {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

// Wandelt einen Wert der App in die gespeicherte Form (Kopie). Sentinels sind hier nicht erlaubt.
function toStored(value, where) {
  if (value === undefined) {
    throw fail("invalid-argument", `Ungültige Daten (${where}): undefined ist kein erlaubter Wert`);
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw fail("invalid-argument", `Ungültige Daten (${where}): ${value} wird hier nicht gespeichert`);
    return value;
  }
  if (value instanceof FieldValue) throw fail("invalid-argument", `Ungültige Daten (${where}): ${value._kind}() ist hier nicht erlaubt`);
  if (value instanceof Date) return { __ts: value.getTime() };
  if (isTimestampLike(value)) return { __ts: value.toMillis() };
  if (Array.isArray(value)) {
    return value.map((v) => {
      if (Array.isArray(v)) throw fail("invalid-argument", `Ungültige Daten (${where}): verschachtelte Listen sind nicht erlaubt`);
      return toStored(v, where);
    });
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "") throw fail("invalid-argument", `Ungültige Daten (${where}): leerer Feldname`);
      out[k] = toStored(v, where);
    }
    return out;
  }
  throw fail("invalid-argument", `Ungültige Daten (${where}): Wert vom Typ ${typeof value} wird nicht unterstützt`);
}

// Prüft Daten für set/update, ohne sie anzuwenden (Sentinels erlaubt).
function validateData(data, fn, { allowDelete }) {
  if (!isPlainObject(data)) throw fail("invalid-argument", `${fn}(): Daten müssen ein Objekt sein`);
  const walk = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj)) {
      const field = prefix ? `${prefix}.${k}` : k;
      if (v instanceof FieldValue) {
        if (v._kind === "deleteField" && !allowDelete) {
          throw fail("invalid-argument", `${fn}(): deleteField() nur mit update() oder set(..., { merge: true }) (Feld ${field})`);
        }
        continue;
      }
      if (isPlainObject(v)) walk(v, field);
      else toStored(v, `${fn}, Feld ${field}`);
    }
  };
  walk(data, "");
}

// Wert für das Feld berechnen (Sentinels auflösen). undefined = Feld entfernen.
function resolve(value, oldValue, now, merge) {
  if (value instanceof FieldValue) {
    if (value._kind === "serverTimestamp") return { __ts: now };
    if (value._kind === "deleteField") return undefined;
    if (value._kind === "increment") return (typeof oldValue === "number" ? oldValue : 0) + value._by;
  }
  if (isPlainObject(value)) {
    const base = merge && isPlainObject(oldValue) && !isStoredTs(oldValue) ? { ...oldValue } : {};
    for (const [k, v] of Object.entries(value)) {
      const r = resolve(v, base[k], now, merge);
      if (r === undefined) delete base[k];
      else base[k] = r;
    }
    return base;
  }
  return toStored(value, "Schreiben");
}

// Setzt ein Feld über einen Pfad mit Punkten ("a.b") – nur für update().
function setPath(obj, path, value, now) {
  const keys = path.split(".");
  if (keys.some((k) => !k)) throw fail("invalid-argument", `update(): ungültiger Feldpfad "${path}"`);
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const next = cur[keys[i]];
    cur[keys[i]] = isPlainObject(next) && !isStoredTs(next) ? { ...next } : {};
    cur = cur[keys[i]];
  }
  const last = keys[keys.length - 1];
  const r = resolve(value, cur[last], now, false);
  if (r === undefined) delete cur[last];
  else cur[last] = r;
}

function getPath(obj, path) {
  if (path === "__name__") return undefined;
  let cur = obj;
  for (const k of String(path).split(".")) {
    if (!isPlainObject(cur) || isStoredTs(cur) || !(k in cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

// Gespeicherte Form → Werte für die App (Kopie, Timestamps als Timestamp).
function toPublic(value) {
  if (Array.isArray(value)) return value.map(toPublic);
  if (value && typeof value === "object") {
    if (isStoredTs(value)) return Timestamp.fromMillis(value.__ts);
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = toPublic(v);
    return out;
  }
  return value;
}

// JSON mit sortierten Schlüsseln (für Fingerprints).
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// ---- Vergleiche (Reihenfolge der Typen wie Firestore) ----

function typeRank(v) {
  if (v === null) return 0;
  if (typeof v === "boolean") return 1;
  if (typeof v === "number") return 2;
  if (isStoredTs(v)) return 3;
  if (typeof v === "string") return 4;
  if (Array.isArray(v)) return 8;
  return 9;
}

function compareValues(a, b) {
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  switch (ra) {
    case 0: return 0;
    case 1: return a === b ? 0 : a ? 1 : -1;
    case 2: return a < b ? -1 : a > b ? 1 : 0;
    case 3: return a.__ts - b.__ts;
    case 4: return a < b ? -1 : a > b ? 1 : 0;
    case 8: {
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        const c = compareValues(a[i], b[i]);
        if (c) return c;
      }
      return a.length - b.length;
    }
    default: {
      const ka = Object.keys(a).sort();
      const kb = Object.keys(b).sort();
      for (let i = 0; i < Math.min(ka.length, kb.length); i++) {
        if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
        const c = compareValues(a[ka[i]], b[kb[i]]);
        if (c) return c;
      }
      return ka.length - kb.length;
    }
  }
}

function valuesEqual(a, b) {
  return typeRank(a) === typeRank(b) && compareValues(a, b) === 0;
}

function comparePaths(a, b) {
  const sa = a.split("/");
  const sb = b.split("/");
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
    if (sa[i] !== sb[i]) return sa[i] < sb[i] ? -1 : 1;
  }
  return sa.length - sb.length;
}

function matchesWhere(data, c) {
  const v = getPath(data, c.field);
  if (v === undefined) return false;
  switch (c.op) {
    case "==": return valuesEqual(v, c.value);
    case "!=": return v !== null && !valuesEqual(v, c.value);
    case "<": return typeRank(v) === typeRank(c.value) && compareValues(v, c.value) < 0;
    case "<=": return typeRank(v) === typeRank(c.value) && compareValues(v, c.value) <= 0;
    case ">": return typeRank(v) === typeRank(c.value) && compareValues(v, c.value) > 0;
    case ">=": return typeRank(v) === typeRank(c.value) && compareValues(v, c.value) >= 0;
    case "in": return c.value.some((x) => valuesEqual(v, x));
    case "not-in": return v !== null && !c.value.some((x) => valuesEqual(v, x));
    case "array-contains": return Array.isArray(v) && v.some((x) => valuesEqual(x, c.value));
    case "array-contains-any": return Array.isArray(v) && v.some((x) => c.value.some((y) => valuesEqual(x, y)));
    default: return false;
  }
}

// Pfade der Dokumente, die zur Query passen, in Firestore-Reihenfolge.
function runQuery(q) {
  const store = ensureLoaded();
  const src = q._source;
  let paths;
  if (src.kind === "group") {
    paths = Object.keys(store).filter((p) => {
      const s = p.split("/");
      return s[s.length - 2] === src.id;
    });
  } else {
    const depth = src.path.split("/").length + 1;
    paths = Object.keys(store).filter((p) => p.startsWith(`${src.path}/`) && p.split("/").length === depth);
  }
  const constraints = q._constraints;
  for (const c of constraints) {
    if (c.kind === "where") paths = paths.filter((p) => matchesWhere(store[p], c));
  }
  const orders = constraints.filter((c) => c.kind === "orderBy");
  // Firestore lässt Dokumente ohne das Sortierfeld weg.
  if (orders.length) paths = paths.filter((p) => orders.every((o) => getPath(store[p], o.field) !== undefined));
  paths.sort((a, b) => {
    for (const o of orders) {
      const c = compareValues(getPath(store[a], o.field), getPath(store[b], o.field));
      if (c) return o.dir === "desc" ? -c : c;
    }
    const c = comparePaths(a, b);
    // Gleichstand: Richtung der letzten Sortierung (wie Firestore)
    return orders.length && orders[orders.length - 1].dir === "desc" ? -c : c;
  });
  const lim = constraints.filter((c) => c.kind === "limit").pop();
  return lim ? paths.slice(0, lim.n) : paths;
}

// ---- Snapshots ----

const METADATA = Object.freeze({ fromCache: false, hasPendingWrites: false, isEqual: (o) => !!o && !o.fromCache && !o.hasPendingWrites });

class DocumentSnapshot {
  constructor(ref, raw) {
    this.ref = ref;
    this.id = ref.id;
    this._raw = raw; // gespeicherte Form oder undefined; wird nie verändert
    this.metadata = METADATA;
  }
  exists() { return this._raw !== undefined; }
  data() { return this._raw === undefined ? undefined : toPublic(this._raw); }
  get(field) {
    if (this._raw === undefined) return undefined;
    const v = getPath(this._raw, field);
    return v === undefined ? undefined : toPublic(v);
  }
}

class QuerySnapshot {
  constructor(q, docsList, changes) {
    this.query = q;
    this.docs = docsList;
    this.metadata = METADATA;
    this._changes = changes;
  }
  get size() { return this.docs.length; }
  get empty() { return this.docs.length === 0; }
  forEach(fn, thisArg) { this.docs.forEach((d) => fn.call(thisArg, d)); }
  docChanges() { return this._changes.slice(); }
}

function docSnapshot(ref) {
  return new DocumentSnapshot(ref, ensureLoaded()[ref.path]);
}

// prev: Map Pfad → stabiler JSON-Text des vorherigen Ergebnisses (null = erstes Ergebnis).
function querySnapshot(q, paths, prev) {
  const store = ensureLoaded();
  const db = q.firestore;
  const list = paths.map((p) => new DocumentSnapshot(makeDocRef(db, p.split("/")), store[p]));
  const changes = [];
  if (!prev) {
    list.forEach((d, i) => changes.push({ type: "added", doc: d, oldIndex: -1, newIndex: i }));
  } else {
    const oldOrder = [...prev.keys()];
    const now = new Set(paths);
    oldOrder.forEach((p, i) => {
      if (!now.has(p)) {
        changes.push({ type: "removed", doc: new DocumentSnapshot(makeDocRef(db, p.split("/")), undefined), oldIndex: i, newIndex: -1 });
      }
    });
    list.forEach((d, i) => {
      const p = d.ref.path;
      if (!prev.has(p)) changes.push({ type: "added", doc: d, oldIndex: -1, newIndex: i });
      else if (prev.get(p) !== stable(store[p])) changes.push({ type: "modified", doc: d, oldIndex: oldOrder.indexOf(p), newIndex: i });
    });
  }
  return new QuerySnapshot(q, list, changes);
}

function checkDocRef(ref, fn) {
  if (!(ref instanceof DocumentReference)) throw fail("invalid-argument", `${fn}(): Dokument-Referenz erwartet`);
}

function checkQuery(q, fn) {
  if (!(q instanceof Query)) throw fail("invalid-argument", `${fn}(): Collection oder Query erwartet`);
}

export async function getDoc(ref) {
  checkDocRef(ref, "getDoc");
  return docSnapshot(ref);
}

export async function getDocs(q) {
  checkQuery(q, "getDocs");
  return querySnapshot(q, runQuery(q), null);
}

export const getDocFromCache = getDoc;
export const getDocsFromCache = getDocs;
export const getDocFromServer = getDoc;
export const getDocsFromServer = getDocs;

// ---- Listener ----

const listeners = new Set();
let notifyPending = false;

function scheduleNotify() {
  if (notifyPending || !listeners.size) return;
  notifyPending = true;
  setTimeout(() => {
    notifyPending = false;
    [...listeners].forEach(fire);
  }, 0);
}

function fire(l) {
  if (!l.active) return;
  let snap;
  let fp;
  let current = null;
  try {
    if (l.target instanceof DocumentReference) {
      const raw = ensureLoaded()[l.target.path];
      fp = raw === undefined ? "-" : stable(raw);
      if (fp === l.last) return;
      snap = new DocumentSnapshot(l.target, raw);
    } else {
      const store = ensureLoaded();
      const paths = runQuery(l.target);
      current = new Map(paths.map((p) => [p, stable(store[p])]));
      fp = stable([...current.entries()]);
      if (fp === l.last) return;
      snap = querySnapshot(l.target, paths, l.prev);
    }
  } catch (err) {
    l.active = false;
    listeners.delete(l);
    if (l.error) l.error(err);
    else console.error("onSnapshot:", err);
    return;
  }
  l.last = fp;
  l.prev = current;
  try {
    l.next(snap);
  } catch (err) {
    console.error("Fehler im onSnapshot-Callback:", err);
  }
}

// onSnapshot(target, [options], next | observer, [error]) – target: Dokument-Ref, Collection oder Query.
export function onSnapshot(target, ...args) {
  if (args[0] && typeof args[0] === "object" && typeof args[0].next !== "function"
    && typeof args[0].error !== "function") args.shift(); // SnapshotListenOptions
  let next = args[0];
  let error = args[1];
  if (next && typeof next === "object") {
    error = typeof next.error === "function" ? next.error.bind(next) : undefined;
    next = typeof next.next === "function" ? next.next.bind(next) : () => {};
  }
  if (typeof next !== "function") throw fail("invalid-argument", "onSnapshot(): Callback fehlt");
  if (!(target instanceof DocumentReference) && !(target instanceof Query)) {
    throw fail("invalid-argument", "onSnapshot(): Dokument-Referenz, Collection oder Query erwartet");
  }
  const l = { target, next, error, last: null, prev: null, active: true };
  listeners.add(l);
  setTimeout(() => fire(l), 0);
  return () => {
    l.active = false;
    listeners.delete(l);
  };
}

// ---- Schreiben ----

// Wendet eine Operation auf `next` (Kopie von docs, flach) an.
function applyOp(next, op, now) {
  const path = op.ref.path;
  if (op.kind === "set") {
    if (op.options && (op.options.merge || op.options.mergeFields)) {
      const fields = op.options.mergeFields;
      if (fields) {
        const out = { ...(next[path] || {}) };
        for (const f of fields) {
          const v = getPath(op.data, String(f));
          if (v === undefined) throw fail("invalid-argument", `set(): Feld "${f}" aus mergeFields fehlt in den Daten`);
          setPath(out, String(f), v, now);
        }
        next[path] = out;
      } else {
        next[path] = resolve(op.data, next[path], now, true);
      }
    } else {
      next[path] = resolve(op.data, undefined, now, false);
    }
  } else if (op.kind === "update") {
    if (next[path] === undefined) throw fail("not-found", `Kein Dokument zum Aktualisieren: ${path}`);
    const out = { ...next[path] };
    for (const [k, v] of Object.entries(op.data)) setPath(out, k, v, now);
    next[path] = out;
  } else if (op.kind === "delete") {
    delete next[path];
  }
}

// Alles oder nichts: erst auf einer Kopie anwenden, dann speichern, dann übernehmen.
function commitOps(ops) {
  ensureLoaded();
  refreshFromStorage();
  const now = Date.now();
  const next = { ...docs };
  for (const op of ops) applyOp(next, op, now);
  try {
    writeStore(next);
  } catch (err) {
    // Speicher voll → nichts übernehmen (docs bleibt unverändert).
    const e = fail("resource-exhausted", "Übungsspeicher voll – Übung zurücksetzen");
    e.cause = err;
    throw e;
  }
  docs = next;
  scheduleNotify();
}

function prepare(kind, ref, data, options) {
  checkDocRef(ref, kind === "set" ? "setDoc" : kind === "update" ? "updateDoc" : "deleteDoc");
  if (kind === "set") {
    if (options !== undefined && (options === null || typeof options !== "object")) {
      throw fail("invalid-argument", "setDoc(): Optionen müssen ein Objekt sein");
    }
    const merge = !!(options && (options.merge || options.mergeFields));
    validateData(data, "setDoc", { allowDelete: merge });
  } else if (kind === "update") {
    validateData(data, "updateDoc", { allowDelete: true });
    if (!Object.keys(data).length) throw fail("invalid-argument", "updateDoc(): keine Felder");
  }
  return { kind, ref, data, options };
}

export async function setDoc(ref, data, options) {
  commitOps([prepare("set", ref, data, options)]);
}

export async function updateDoc(ref, data, ...more) {
  if (typeof data === "string") {
    // updateDoc(ref, "feld", wert, "feld2", wert2, …)
    const obj = {};
    const pairs = [data, ...more];
    for (let i = 0; i < pairs.length; i += 2) obj[pairs[i]] = pairs[i + 1];
    data = obj;
  }
  commitOps([prepare("update", ref, data)]);
}

export async function deleteDoc(ref) {
  commitOps([prepare("delete", ref)]);
}

export async function addDoc(collRef, data) {
  if (!(collRef instanceof CollectionReference)) throw fail("invalid-argument", "addDoc(): Collection-Referenz erwartet");
  const ref = doc(collRef);
  commitOps([prepare("set", ref, data)]);
  return ref;
}

export function writeBatch() {
  const ops = [];
  let committed = false;
  const check = () => {
    if (committed) throw fail("failed-precondition", "Ein Batch kann nach commit() nicht mehr benutzt werden");
  };
  const batch = {
    set(ref, data, options) { check(); ops.push(prepare("set", ref, data, options)); return batch; },
    update(ref, data) { check(); ops.push(prepare("update", ref, data)); return batch; },
    delete(ref) { check(); ops.push(prepare("delete", ref)); return batch; },
    async commit() {
      check();
      committed = true;
      commitOps(ops);
    },
  };
  return batch;
}

// ---- Auth ----

const PRACTICE_USER = Object.freeze({
  uid: "uebung",
  email: null,
  displayName: "Übung",
  emailVerified: true,
  isAnonymous: true,
  isPractice: true,
  providerData: Object.freeze([]),
  getIdToken: async () => "",
});

const auth = { currentUser: PRACTICE_USER, isPractice: true, languageCode: "de" };

export function getAuth(app) {
  if (app) auth.app = app;
  return auth;
}

// Übungsbenutzer ist immer angemeldet: cb wird einmal (asynchron) mit ihm aufgerufen.
export function onAuthStateChanged(a, nextOrObserver) {
  const cb = typeof nextOrObserver === "function" ? nextOrObserver : nextOrObserver && nextOrObserver.next;
  let active = true;
  setTimeout(() => {
    if (active && typeof cb === "function") cb.call(nextOrObserver, auth.currentUser);
  }, 0);
  return () => { active = false; };
}

export function isSignInWithEmailLink() { return false; }

function noLogin() {
  const err = new Error("Im Übungsmodus gibt es keine Anmeldung");
  err.code = "auth/operation-not-allowed";
  err.name = "FirebaseError";
  return err;
}

export async function sendSignInLinkToEmail() { throw noLogin(); }
export async function signInWithEmailLink() { throw noLogin(); }
export async function signOut() {}
