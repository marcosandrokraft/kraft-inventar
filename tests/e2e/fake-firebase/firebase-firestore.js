// In-Memory-Ersatz für vendor/firebase-10.14.1/firebase-firestore.js
// (nur für die Browser-Smoke-Tests in tests/e2e/). Wird per page.route() statt der echten Datei
// ausgeliefert – es gibt also KEINE Verbindung zu Firebase.
//
// - Startdaten: window.__seed = { "containers/box-1": {...}, "containers/box-1/items/milch": {...} }
//   (per addInitScript gesetzt). Der Stand wird in sessionStorage gehalten, damit er Navigationen
//   innerhalb eines Tests übersteht.
// - Jeder Schreibzugriff landet in window.__writes: { op, path, data, options } mit Platzhaltern
//   { __op: "increment", by } bzw. { __op: "serverTimestamp" } für Sentinels.
// - window.__fakeDb() liefert den aktuellen Stand (Pfad → Daten) für Prüfungen.
// - window.__queries: einmalige Abfragen (getDocs) dieser Seite.

const STORE_KEY = "__fakeFirestore";
const WRITES_KEY = "__fakeFirestoreWrites";

function load(key, fallback) {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch {}
  return fallback;
}

let store = load(STORE_KEY, null);
if (!store) {
  store = JSON.parse(JSON.stringify(window.__seed || {}));
}
window.__writes = load(WRITES_KEY, []);

function persist() {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(store));
    sessionStorage.setItem(WRITES_KEY, JSON.stringify(window.__writes));
  } catch {}
}
persist();

window.__fakeDb = () => JSON.parse(JSON.stringify(store));

// ---- Sentinels ----
class FieldValue {
  constructor(kind, by) {
    this.__kind = kind;
    this.by = by;
  }
  toJSON() {
    return this.__kind === "increment" ? { __op: "increment", by: this.by } : { __op: this.__kind };
  }
}
export function serverTimestamp() { return new FieldValue("serverTimestamp"); }
export function increment(n) { return new FieldValue("increment", n); }
export function deleteField() { return new FieldValue("deleteField"); }

class Timestamp {
  constructor(ms) {
    this.seconds = Math.floor(ms / 1000);
    this.nanoseconds = (ms % 1000) * 1e6;
  }
  toMillis() { return this.seconds * 1000 + this.nanoseconds / 1e6; }
  toDate() { return new Date(this.toMillis()); }
}
export { Timestamp };

// ---- Datenbank / Referenzen ----
const fakeDb = { type: "firestore", __fake: true };
export function initializeFirestore() { return fakeDb; }
export function getFirestore() { return fakeDb; }
export function persistentLocalCache(opts) { return { kind: "persistent", ...opts }; }
export function persistentMultipleTabManager() { return { kind: "multi-tab" }; }
export function persistentSingleTabManager() { return { kind: "single-tab" }; }
export function memoryLocalCache() { return { kind: "memory" }; }
export async function terminate() {}
export async function clearIndexedDbPersistence() {}
export async function enableNetwork() {}
export async function disableNetwork() {}

function segmentsOf(base, rest) {
  const prefix = base && base.path ? base.path.split("/") : [];
  const more = rest.flatMap((s) => String(s).split("/")).filter(Boolean);
  return [...prefix, ...more];
}

function makeDocRef(segs) {
  if (segs.length % 2 !== 0) throw new Error(`Ungültiger Dokumentpfad: ${segs.join("/")}`);
  return {
    type: "document",
    firestore: fakeDb,
    id: segs[segs.length - 1],
    path: segs.join("/"),
    get parent() { return makeCollRef(segs.slice(0, -1)); },
  };
}

function makeCollRef(segs) {
  if (segs.length % 2 !== 1) throw new Error(`Ungültiger Collection-Pfad: ${segs.join("/")}`);
  return {
    type: "collection",
    firestore: fakeDb,
    id: segs[segs.length - 1],
    path: segs.join("/"),
    get parent() { return segs.length > 1 ? makeDocRef(segs.slice(0, -1)) : null; },
  };
}

export function doc(base, ...rest) {
  let segs = segmentsOf(base, rest);
  if (base && base.type === "collection" && rest.length === 0) {
    segs = [...segs, Math.random().toString(36).slice(2, 12)];
  }
  return makeDocRef(segs);
}

export function collection(base, ...rest) {
  return makeCollRef(segmentsOf(base, rest));
}

export function collectionGroup(db, collectionId) {
  return { type: "collectionGroup", collectionId };
}

export function orderBy(field, dir = "asc") { return { kind: "orderBy", field, dir }; }
export function where(field, op, value) { return { kind: "where", field, op, value }; }
export function limit(n) { return { kind: "limit", n }; }

export function query(base, ...constraints) {
  return {
    type: "query",
    base: base.type === "query" ? base.base : base,
    constraints: [...(base.type === "query" ? base.constraints : []), ...constraints],
  };
}

// ---- Lesen ----
function clone(value) {
  if (value && typeof value === "object") {
    if (value.__ts !== undefined && Object.keys(value).length === 1) return new Timestamp(value.__ts);
    if (Array.isArray(value)) return value.map(clone);
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = clone(v);
    return out;
  }
  return value;
}

function docSnapshot(ref) {
  const raw = store[ref.path];
  return {
    id: ref.id,
    ref,
    exists: () => raw !== undefined,
    data: () => (raw === undefined ? undefined : clone(raw)),
    get: (field) => (raw === undefined ? undefined : clone(raw[field])),
    metadata: { fromCache: false, hasPendingWrites: false },
  };
}

function matchingPaths(q) {
  const base = q.type === "query" ? q.base : q;
  const constraints = q.type === "query" ? q.constraints : [];
  let paths;
  if (base.type === "collectionGroup") {
    paths = Object.keys(store).filter((p) => {
      const s = p.split("/");
      return s.length % 2 === 0 && s[s.length - 2] === base.collectionId;
    });
  } else {
    const depth = base.path.split("/").length + 1;
    paths = Object.keys(store).filter((p) => p.startsWith(base.path + "/") && p.split("/").length === depth);
  }
  for (const c of constraints) {
    if (c.kind === "where") {
      paths = paths.filter((p) => {
        const v = store[p][c.field];
        switch (c.op) {
          case "==": return v === c.value;
          case "!=": return v !== c.value;
          case "<": return v < c.value;
          case "<=": return v <= c.value;
          case ">": return v > c.value;
          case ">=": return v >= c.value;
          default: throw new Error(`where-Operator ${c.op} nicht im Fake`);
        }
      });
    }
  }
  const orders = constraints.filter((c) => c.kind === "orderBy");
  paths.sort((a, b) => {
    for (const o of orders) {
      const va = store[a][o.field];
      const vb = store[b][o.field];
      if (va === vb) continue;
      const r = va === undefined ? -1 : vb === undefined ? 1 : va < vb ? -1 : 1;
      return o.dir === "desc" ? -r : r;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  });
  if (orders.length) {
    // Firestore lässt Dokumente ohne das Sortierfeld weg.
    paths = paths.filter((p) => orders.every((o) => store[p][o.field] !== undefined));
  }
  const lim = constraints.find((c) => c.kind === "limit");
  return lim ? paths.slice(0, lim.n) : paths;
}

function querySnapshot(q) {
  const docs = matchingPaths(q).map((p) => docSnapshot(makeDocRef(p.split("/"))));
  return {
    docs,
    size: docs.length,
    empty: docs.length === 0,
    forEach: (fn) => docs.forEach(fn),
    docChanges: () => docs.map((d) => ({ type: "added", doc: d })),
    metadata: { fromCache: false, hasPendingWrites: false },
    query: q,
  };
}

export async function getDoc(ref) { return docSnapshot(ref); }
// Einmalige Abfragen (getDocs) werden in window.__queries mitgezählt (pro Seite, nicht gespeichert):
// "collectionGroup:items" bzw. der Pfad der Sammlung – damit Tests Lesezugriffe prüfen können.
window.__queries = [];
export async function getDocs(q) {
  const base = q.type === "query" ? q.base : q;
  window.__queries.push(base.type === "collectionGroup" ? `collectionGroup:${base.collectionId}` : base.path);
  return querySnapshot(q);
}
export const getDocFromCache = getDoc;
export const getDocsFromCache = getDocs;
export const getDocFromServer = getDoc;
export const getDocsFromServer = getDocs;

// ---- Listener ----
const listeners = new Set();

function snapshotFor(target) {
  return target.type === "document" ? docSnapshot(target) : querySnapshot(target);
}

function fingerprint(target) {
  if (target.type === "document") return JSON.stringify(store[target.path] ?? null);
  return JSON.stringify(matchingPaths(target).map((p) => [p, store[p]]));
}

export function onSnapshot(target, ...args) {
  let opts = {};
  if (args[0] && typeof args[0] === "object" && typeof args[0].next !== "function") opts = args.shift();
  let next = args[0];
  let error = args[1];
  if (next && typeof next === "object") ({ next, error } = next);
  void opts;
  const l = { target, next, error, last: null, active: true };
  listeners.add(l);
  setTimeout(() => fire(l), 0);
  return () => { l.active = false; listeners.delete(l); };
}

function fire(l) {
  if (!l.active) return;
  const fp = fingerprint(l.target);
  if (fp === l.last) return;
  l.last = fp;
  try {
    l.next(snapshotFor(l.target));
  } catch (err) {
    console.error("Fehler im onSnapshot-Callback:", err);
  }
}

function notifyAll() {
  setTimeout(() => listeners.forEach(fire), 0);
}

// ---- Schreiben ----
function fakeError(code, message) {
  const err = new Error(message);
  err.code = code;
  err.name = "FirebaseError";
  return err;
}

function resolveValue(value, oldValue) {
  if (value instanceof FieldValue) {
    if (value.__kind === "serverTimestamp") return { __ts: Date.now() };
    if (value.__kind === "increment") return (typeof oldValue === "number" ? oldValue : 0) + value.by;
    if (value.__kind === "deleteField") return undefined;
  }
  if (value instanceof Timestamp) return { __ts: value.toMillis() };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const r = resolveValue(v, oldValue && typeof oldValue === "object" ? oldValue[k] : undefined);
      if (r !== undefined) out[k] = r;
    }
    return out;
  }
  if (value === undefined) throw fakeError("invalid-argument", "Function setDoc() called with invalid data. Unsupported field value: undefined");
  return value;
}

function applyFields(base, data) {
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(data)) {
    const r = resolveValue(v, out[k]);
    if (r === undefined) delete out[k];
    else out[k] = r;
  }
  return out;
}

function log(op, ref, data, options) {
  window.__writes.push({
    op,
    path: ref.path,
    data: data === undefined ? undefined : JSON.parse(JSON.stringify(data)),
    options: options || undefined,
    keys: data ? Object.keys(data) : undefined,
    at: Date.now(),
  });
}

function checkPathSegments(ref) {
  if (!ref || ref.type !== "document") throw fakeError("invalid-argument", "Keine Dokument-Referenz");
}

// Prüft eine Operation (ohne auszuführen) und liefert eine Funktion, die sie anwendet.
function prepare(op, ref, data, options) {
  checkPathSegments(ref);
  if (window.__fakeFailWrites) throw fakeError("permission-denied", "Missing or insufficient permissions. (Fake)");
  if (op === "set") {
    const merge = options && options.merge;
    return () => {
      store[ref.path] = merge ? applyFields(store[ref.path], data) : applyFields({}, data);
    };
  }
  if (op === "update") {
    return () => {
      if (store[ref.path] === undefined) throw fakeError("not-found", `No document to update: ${ref.path}`);
      store[ref.path] = applyFields(store[ref.path], data);
    };
  }
  if (op === "delete") {
    return () => { delete store[ref.path]; };
  }
  throw new Error(op);
}

function commit(ops) {
  const snapshot = JSON.stringify(store);
  try {
    for (const apply of ops) apply();
  } catch (err) {
    store = JSON.parse(snapshot);
    throw err;
  }
  persist();
  notifyAll();
}

export async function setDoc(ref, data, options) {
  log("set", ref, data, options);
  commit([prepare("set", ref, data, options)]);
}

export async function updateDoc(ref, data) {
  log("update", ref, data);
  commit([prepare("update", ref, data)]);
}

export async function deleteDoc(ref) {
  log("delete", ref);
  commit([prepare("delete", ref)]);
}

export async function addDoc(collRef, data) {
  const ref = doc(collRef);
  await setDoc(ref, data);
  return ref;
}

export function writeBatch() {
  const ops = [];
  const entries = [];
  const batch = {
    set(ref, data, options) { ops.push(["set", ref, data, options]); return batch; },
    update(ref, data) { ops.push(["update", ref, data]); return batch; },
    delete(ref) { ops.push(["delete", ref]); return batch; },
    async commit() {
      for (const [op, ref, data, options] of ops) {
        log(`batch.${op}`, ref, data, options);
        entries.push(prepare(op, ref, data, options));
      }
      commit(entries);
    },
  };
  return batch;
}
