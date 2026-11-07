// Unit-Tests für den Übungsmodus: Beispieldaten (uebung-daten.js) und die lokale Datenschicht
// (uebung-firebase.js) mit einem Fake-localStorage – Node hat weder window noch localStorage.
import assert from "node:assert/strict";
import { UNITS, MAX_QTY, slugify, isValidId, isValidIsoDate, CONTAINER_TYPES, wouldCreateCycle } from "../../lib.js";
import { practiceSeed, PRACTICE_CONTAINER_IDS, PRACTICE_ICONS } from "../../uebung-daten.js";

const KEY = "vorrat-uebung-db";

// Map-basierter localStorage; quota = true → setItem wirft QuotaExceededError.
class FakeStorage {
  constructor() {
    this.map = new Map();
    this.quota = false;
    this.sets = 0;
  }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) {
    if (this.quota) {
      const err = new Error("The quota has been exceeded.");
      err.name = "QuotaExceededError";
      err.code = 22;
      throw err;
    }
    this.sets++;
    this.map.set(k, String(v));
  }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

async function rejectsWith(promiseOrFn, code) {
  await assert.rejects(typeof promiseOrFn === "function" ? promiseOrFn() : promiseOrFn, (err) => {
    assert.equal(err.code, code);
    return true;
  });
}

describe("Übung: Beispieldaten (practiceSeed)", () => {
  const TODAY = new Date(2026, 10, 7); // 07.11.2026 (lokal)
  const seed = practiceSeed(TODAY);
  const containers = new Map();
  const items = [];
  for (const [path, data] of Object.entries(seed)) {
    const s = path.split("/");
    if (s.length === 2) containers.set(s[1], data);
    else items.push({ containerId: s[1], id: s[3], path, segs: s, data });
  }

  it("feste Behälter-IDs mit Name, Typ und Eltern", () => {
    const expect = {
      kueche: ["Küche", "raum", undefined],
      kuehlschrank: ["Kühlschrank", "schrank", "kueche"],
      gemuesefach: ["Gemüsefach", "fach", "kuehlschrank"],
      vorratsschrank: ["Vorratsschrank", "schrank", "kueche"],
      keller: ["Keller", "raum", undefined],
      werkzeugbox: ["Werkzeugbox", "box", "keller"],
    };
    for (const [id, [name, type, parent]] of Object.entries(expect)) {
      const c = containers.get(id);
      assert.ok(c, id);
      assert.deepEqual([c.name, c.type, c.parent], [name, type, parent], id);
    }
    assert.deepEqual([...containers.keys()].sort(), [...PRACTICE_CONTAINER_IDS].sort());
  });

  it("Behälter erfüllen validContainer (IDs, Felder, Typen, Eltern existieren, keine Kreise)", () => {
    const all = new Map([...containers].map(([id, c]) => [id, { name: c.name, type: c.type, parent: c.parent }]));
    for (const [id, c] of containers) {
      assert.ok(isValidId(id), id);
      assert.ok(Object.keys(c).every((k) => ["name", "createdAt", "type", "parent"].includes(k)), id);
      assert.ok(typeof c.name === "string" && c.name.length > 0 && c.name.length <= 100);
      assert.ok(c.type in CONTAINER_TYPES, id);
      assert.equal(typeof c.createdAt.__ts, "number");
      if (c.parent !== undefined) {
        assert.ok(containers.has(c.parent), `${id}: Eltern ${c.parent} fehlt`);
        assert.notEqual(c.parent, id);
        // Eltern dürfen nicht unterhalb des Behälters liegen.
        assert.equal(wouldCreateCycle(id, c.parent, all), false, id);
      }
      // Kette nach oben endet (kein Kreis)
      const seen = new Set([id]);
      let p = c.parent;
      while (p) {
        assert.ok(!seen.has(p), `Kreis bei ${id}`);
        seen.add(p);
        p = containers.get(p).parent;
      }
    }
  });

  it("Artikel erfüllen validItem (ID = slugify(name), Einheit, Menge, Felder)", () => {
    assert.ok(items.length >= 20, `${items.length} Artikel`);
    for (const { id, containerId, data, segs } of items) {
      assert.equal(segs.length, 4);
      assert.equal(segs[2], "items");
      assert.ok(containers.has(containerId), containerId);
      assert.equal(id, slugify(data.name), data.name);
      assert.ok(isValidId(id), id);
      assert.ok(UNITS.includes(data.unit), `${id}: ${data.unit}`);
      assert.ok(Number.isInteger(data.qty) && data.qty >= 1 && data.qty <= MAX_QTY, id);
      assert.ok(Object.keys(data).every((k) => ["name", "qty", "unit", "mhd", "updatedAt", "icon"].includes(k)), id);
      assert.equal(typeof data.updatedAt.__ts, "number");
      if ("mhd" in data) assert.ok(isValidIsoDate(data.mhd), `${id}: ${data.mhd}`);
      if ("icon" in data) assert.ok(PRACTICE_ICONS.includes(data.icon), `${id}: ${data.icon}`);
      assert.equal("photo" in data, false);
    }
  });

  it("Artikelzahl pro Behälter, einige mit und einige ohne icon", () => {
    const count = (c) => items.filter((i) => i.containerId === c).length;
    assert.ok(count("kuehlschrank") >= 5);
    assert.equal(count("gemuesefach"), 3);
    assert.ok(count("vorratsschrank") >= 5);
    assert.ok(count("werkzeugbox") >= 5);
    assert.ok(items.filter((i) => i.data.icon).length >= 5);
    assert.ok(items.filter((i) => !i.data.icon).length >= 3);
  });

  it("MHD-Fälle relativ zu heute: −2, 0, +2, +10 Tage, ~2 Monate", () => {
    const mhds = items.filter((i) => i.data.mhd).map((i) => i.data.mhd).sort();
    assert.deepEqual(mhds, ["2026-11-05", "2026-11-07", "2026-11-09", "2026-11-17", "2027-01-07"]);
  });

  it("MHD über Monats- und Jahreswechsel", () => {
    const mhds = (d) => Object.values(practiceSeed(d)).filter((x) => x.mhd).map((x) => x.mhd).sort();
    assert.deepEqual(mhds(new Date(2026, 2, 1)), ["2026-02-27", "2026-03-01", "2026-03-03", "2026-03-11", "2026-05-01"]);
    assert.deepEqual(mhds(new Date(2026, 11, 30)), ["2026-12-28", "2026-12-30", "2027-01-01", "2027-01-09", "2027-02-28"]);
  });

  it("liefert jedes Mal neue Objekte", () => {
    const a = practiceSeed(TODAY);
    a["containers/kueche"].name = "X";
    assert.equal(practiceSeed(TODAY)["containers/kueche"].name, "Küche");
  });
});

describe("Übung: Datenschicht (uebung-firebase.js)", () => {
  let fb;
  let db;
  let store;
  const windowListeners = [];
  const created = [];

  before(async () => {
    store = new FakeStorage();
    for (const [k, v] of [["localStorage", store], ["window", globalThis]]) {
      if (!(k in globalThis)) created.push(k);
      globalThis[k] = v;
    }
    if (typeof globalThis.addEventListener !== "function") {
      created.push("addEventListener");
      globalThis.addEventListener = (type, fn) => windowListeners.push({ type, fn });
    }
    fb = await import("../../uebung-firebase.js");
    const app = fb.initializeApp({});
    db = fb.initializeFirestore(app, { localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }) }, "(default)");
  });

  after(() => {
    for (const k of created) delete globalThis[k];
  });

  beforeEach(() => {
    store.quota = false;
    fb.resetPracticeData();
  });

  const ref = (...p) => fb.doc(db, ...p);
  const item = (c, i) => fb.doc(db, "containers", c, "items", i);

  it("IS_PRACTICE und alle von app.js benutzten Funktionen", () => {
    assert.equal(fb.IS_PRACTICE, true);
    for (const name of ["initializeApp", "getApp", "initializeFirestore", "getFirestore", "persistentLocalCache",
      "persistentMultipleTabManager", "persistentSingleTabManager", "memoryLocalCache", "collection", "collectionGroup",
      "doc", "setDoc", "updateDoc", "deleteDoc", "addDoc", "getDoc", "getDocs", "getDocFromCache", "getDocsFromCache",
      "getDocFromServer", "getDocsFromServer", "onSnapshot", "serverTimestamp", "increment", "deleteField", "writeBatch",
      "terminate", "clearIndexedDbPersistence", "enableNetwork", "disableNetwork", "query", "orderBy", "where", "limit",
      "Timestamp", "getAuth", "onAuthStateChanged", "sendSignInLinkToEmail", "isSignInWithEmailLink",
      "signInWithEmailLink", "signOut", "resetPracticeData", "practiceSnapshot"]) {
      assert.equal(typeof fb[name], "function", name);
    }
  });

  it("Initialisierung aus leerem localStorage → Beispieldaten, gespeichert", async () => {
    store.clear();
    fb.__reloadForTests();
    const snap = await fb.getDoc(ref("containers", "kuehlschrank"));
    assert.equal(snap.exists(), true);
    assert.equal(snap.data().name, "Kühlschrank");
    const saved = JSON.parse(store.getItem(KEY));
    assert.equal(saved.v, 1);
    assert.ok(saved.docs["containers/kueche"]);
  });

  it("kaputter localStorage → Beispieldaten", async () => {
    for (const bad of ["{kaputt", JSON.stringify({ v: 99, docs: {} }), JSON.stringify({ v: 1, docs: { "a/b/c": {} } }), "null"]) {
      store.setItem(KEY, bad);
      fb.__reloadForTests();
      assert.equal((await fb.getDoc(ref("containers", "keller"))).exists(), true, bad);
      assert.equal(JSON.parse(store.getItem(KEY)).v, 1);
    }
  });

  it("Persistenz: Neuladen (und neuer Import) liest localStorage", async () => {
    await fb.setDoc(ref("containers", "estrich"), { name: "Estrich", type: "raum" });
    fb.__reloadForTests();
    assert.equal((await fb.getDoc(ref("containers", "estrich"))).data().name, "Estrich");
    const fb2 = await import("../../uebung-firebase.js?neu=1");
    const snap = await fb2.getDoc(fb2.doc(fb2.getFirestore(), "containers", "estrich"));
    assert.equal(snap.data().name, "Estrich");
  });

  it("ohne localStorage läuft alles im Speicher", async () => {
    const saved = globalThis.localStorage;
    try {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
      fb.__reloadForTests();
      await fb.setDoc(ref("containers", "garage"), { name: "Garage" });
      assert.equal((await fb.getDoc(ref("containers", "garage"))).data().name, "Garage");
      assert.equal((await fb.getDoc(ref("containers", "kueche"))).exists(), true);
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: saved });
    }
  });

  it("Pfade: gerade/ungerade Segmente, leere Segmente, Ref-Kette", () => {
    const r = item("kuehlschrank", "milch");
    assert.equal(r.type, "document");
    assert.equal(r.id, "milch");
    assert.equal(r.path, "containers/kuehlschrank/items/milch");
    assert.equal(r.parent.type, "collection");
    assert.equal(r.parent.id, "items");
    assert.equal(r.parent.parent.id, "kuehlschrank");
    assert.equal(r.parent.parent.parent.id, "containers");
    assert.equal(r.parent.parent.parent.parent, null);
    assert.equal(r.firestore, db);
    assert.equal(fb.doc(db, "containers/kueche").id, "kueche");
    assert.equal(fb.collection(fb.doc(db, "containers", "kueche"), "items").path, "containers/kueche/items");
    for (const bad of [() => fb.doc(db, "containers"), () => fb.doc(db, "containers", ""), () => fb.doc(db, "containers", "a/b"),
      () => fb.doc(db, "containers//x"), () => fb.collection(db, "containers", "x"), () => fb.doc(fb.collection(db, "containers"), "a/b")]) {
      assert.throws(bad, (err) => err.code === "invalid-argument");
    }
  });

  it("doc(collection) ohne ID → zufällige ID; addDoc", async () => {
    const a = fb.doc(fb.collection(db, "containers"));
    const b = fb.doc(fb.collection(db, "containers"));
    assert.equal(a.id.length, 20);
    assert.notEqual(a.id, b.id);
    const added = await fb.addDoc(fb.collection(db, "containers"), { name: "Neu" });
    assert.equal((await fb.getDoc(added)).data().name, "Neu");
  });

  it("setDoc ersetzt, merge mischt, updateDoc ändert Felder, deleteDoc löscht", async () => {
    const r = item("kuehlschrank", "milch");
    await fb.setDoc(r, { name: "Milch", qty: 1, unit: "l" });
    assert.deepEqual((await fb.getDoc(r)).data(), { name: "Milch", qty: 1, unit: "l" });
    await fb.setDoc(r, { qty: 3, mhd: "2026-12-01" }, { merge: true });
    assert.deepEqual((await fb.getDoc(r)).data(), { name: "Milch", qty: 3, unit: "l", mhd: "2026-12-01" });
    await fb.updateDoc(r, { unit: "ml", qty: 500 });
    assert.deepEqual((await fb.getDoc(r)).data(), { name: "Milch", qty: 500, unit: "ml", mhd: "2026-12-01" });
    await fb.deleteDoc(r);
    assert.equal((await fb.getDoc(r)).exists(), false);
    assert.equal((await fb.getDoc(r)).data(), undefined);
  });

  it("increment, serverTimestamp → Timestamp, deleteField", async () => {
    const r = item("kuehlschrank", "eier");
    const before = Date.now();
    await fb.updateDoc(r, { qty: fb.increment(4), updatedAt: fb.serverTimestamp(), mhd: fb.deleteField() });
    const d = (await fb.getDoc(r)).data();
    assert.equal(d.qty, 10);
    assert.ok(d.updatedAt instanceof fb.Timestamp);
    assert.ok(d.updatedAt.toMillis() >= before && d.updatedAt.toMillis() <= Date.now());
    assert.ok(d.updatedAt.toDate() instanceof Date);
    assert.equal("mhd" in d, false);
    await fb.setDoc(r, { zahl: fb.increment(2) }, { merge: true });
    assert.equal((await fb.getDoc(r)).get("zahl"), 2, "increment auf fehlendes Feld beginnt bei 0");
    await fb.updateDoc(r, { name: fb.increment(1) });
    assert.equal((await fb.getDoc(r)).get("name"), 1, "increment auf Nicht-Zahl beginnt bei 0");
    // Gespeichert als { __ts }
    assert.equal(typeof fb.practiceSnapshot()["containers/kuehlschrank/items/eier"].updatedAt.__ts, "number");
  });

  it("Timestamp-Klasse und Timestamp/Date als Wert", async () => {
    const t = fb.Timestamp.fromDate(new Date(1700000000123));
    assert.equal(t.seconds, 1700000000);
    assert.equal(t.nanoseconds, 123000000);
    assert.equal(t.toMillis(), 1700000000123);
    assert.ok(fb.Timestamp.now().toMillis() <= Date.now());
    const r = ref("containers", "zeit");
    await fb.setDoc(r, { name: "Zeit", createdAt: t, d: new Date(5000) });
    const d = (await fb.getDoc(r)).data();
    assert.equal(d.createdAt.toMillis(), 1700000000123);
    assert.equal(d.d.toMillis(), 5000);
  });

  it("undefined, ungültige Werte und deleteField ohne merge → invalid-argument", async () => {
    const r = item("kuehlschrank", "milch");
    await rejectsWith(fb.setDoc(r, { name: "X", qty: undefined }), "invalid-argument");
    await rejectsWith(fb.updateDoc(r, { qty: undefined }), "invalid-argument");
    await rejectsWith(fb.setDoc(r, { name: fb.deleteField() }), "invalid-argument");
    await rejectsWith(fb.setDoc(r, { f: () => 1 }), "invalid-argument");
    assert.throws(() => fb.writeBatch(db).set(r, { a: undefined }), (err) => err.code === "invalid-argument");
    assert.equal((await fb.getDoc(r)).data().name, "Milch", "nichts geändert");
  });

  it("updateDoc auf fehlendes Dokument → not-found", async () => {
    await rejectsWith(fb.updateDoc(item("kuehlschrank", "gibtsnicht"), { qty: 1 }), "not-found");
    assert.equal((await fb.getDoc(item("kuehlschrank", "gibtsnicht"))).exists(), false);
  });

  it("writeBatch ist atomar", async () => {
    const before = fb.practiceSnapshot();
    const b = fb.writeBatch(db);
    b.set(item("keller", "wein"), { name: "Wein", qty: 6, unit: "Flasche" });
    b.delete(item("kuehlschrank", "milch"));
    b.update(item("kuehlschrank", "gibtsnicht"), { qty: 2 });
    await rejectsWith(b.commit(), "not-found");
    assert.deepEqual(fb.practiceSnapshot(), before);
    assert.deepEqual(JSON.parse(store.getItem(KEY)).docs, before);

    const ok = fb.writeBatch(db);
    ok.set(item("keller", "wein"), { name: "Wein", qty: 6, unit: "Flasche" });
    ok.update(item("kuehlschrank", "eier"), { qty: fb.increment(-1) });
    ok.delete(item("kuehlschrank", "milch"));
    await ok.commit();
    assert.equal((await fb.getDoc(item("keller", "wein"))).data().qty, 6);
    assert.equal((await fb.getDoc(item("kuehlschrank", "eier"))).data().qty, 5);
    assert.equal((await fb.getDoc(item("kuehlschrank", "milch"))).exists(), false);
    await rejectsWith(() => ok.commit(), "failed-precondition");
  });

  it("query mit orderBy('name'): sortiert, Dokumente ohne Feld fallen weg", async () => {
    await fb.setDoc(item("gemuesefach", "ohne-name"), { qty: 1 });
    const snap = await fb.getDocs(fb.query(fb.collection(db, "containers", "gemuesefach", "items"), fb.orderBy("name")));
    assert.deepEqual(snap.docs.map((d) => d.data().name), ["Rüebli", "Salat", "Äpfel"]);
    const all = await fb.getDocs(fb.collection(db, "containers", "gemuesefach", "items"));
    assert.equal(all.size, 4);
    const desc = await fb.getDocs(fb.query(fb.collection(db, "containers", "gemuesefach", "items"), fb.orderBy("name", "desc"), fb.limit(2)));
    assert.deepEqual(desc.docs.map((d) => d.id), ["äpfel", "salat"]);
  });

  it("where: ==, !=, <, <=, >, >=, in", async () => {
    const col = fb.collection(db, "containers", "werkzeugbox", "items");
    const ids = async (...c) => (await fb.getDocs(fb.query(col, ...c))).docs.map((d) => d.id).sort();
    assert.deepEqual(await ids(fb.where("qty", "==", 1)), ["hammer", "schere"]);
    assert.deepEqual(await ids(fb.where("qty", "!=", 1)), ["batterien-aa", "glühbirne", "schraubenzieher"]);
    assert.deepEqual(await ids(fb.where("qty", "<", 3)), ["glühbirne", "hammer", "schere"]);
    assert.deepEqual(await ids(fb.where("qty", "<=", 3)), ["glühbirne", "hammer", "schere", "schraubenzieher"]);
    assert.deepEqual(await ids(fb.where("qty", ">", 3)), ["batterien-aa"]);
    assert.deepEqual(await ids(fb.where("qty", ">=", 3)), ["batterien-aa", "schraubenzieher"]);
    assert.deepEqual(await ids(fb.where("name", "in", ["Hammer", "Schere"])), ["hammer", "schere"]);
    assert.deepEqual(await ids(fb.where("icon", "==", "hammer")), ["hammer"]);
  });

  it("collectionGroup('items'): alle Artikel mit Ref-Kette wie in app.js", async () => {
    const snap = await fb.getDocs(fb.collectionGroup(db, "items"));
    const seed = fb.practiceSnapshot();
    assert.equal(snap.size, Object.keys(seed).filter((p) => p.split("/").length === 4).length);
    const rows = snap.docs
      .filter((d) => d.ref.parent.parent?.parent.id === "containers")
      .map((d) => ({ id: d.id, containerId: d.ref.parent.parent.id, ...d.data() }));
    assert.equal(rows.length, snap.size);
    const milch = rows.find((r) => r.id === "milch");
    assert.equal(milch.containerId, "kuehlschrank");
    assert.equal(milch.name, "Milch");
    assert.ok(milch.updatedAt instanceof fb.Timestamp);
    assert.equal(snap.empty, false);
    let n = 0;
    snap.forEach(() => n++);
    assert.equal(n, snap.size);
    assert.equal(snap.docChanges().length, snap.size);
    assert.equal(snap.metadata.fromCache, false);
  });

  it("onSnapshot (Query): initial asynchron, nach Änderung, nicht bei No-op, unsubscribe stoppt", async () => {
    const calls = [];
    const q = fb.query(fb.collection(db, "containers", "gemuesefach", "items"), fb.orderBy("name"));
    const unsub = fb.onSnapshot(q, (snap) => calls.push(snap));
    assert.equal(calls.length, 0, "erst asynchron");
    await tick();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].size, 3);

    await fb.updateDoc(item("gemuesefach", "salat"), { qty: 2 });
    await tick();
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].docChanges().map((c) => [c.type, c.doc.id]), [["modified", "salat"]]);

    await fb.updateDoc(item("gemuesefach", "salat"), { qty: 2 }); // keine echte Änderung
    await fb.updateDoc(item("kuehlschrank", "milch"), { qty: 9 }); // andere Collection
    await tick();
    assert.equal(calls.length, 2);

    unsub();
    await fb.deleteDoc(item("gemuesefach", "salat"));
    await tick();
    assert.equal(calls.length, 2);
  });

  it("onSnapshot (Dokument) mit Fehler-Callback und Observer", async () => {
    const snaps = [];
    const unsub = fb.onSnapshot(ref("containers", "keller"), (s) => snaps.push(s), () => assert.fail("kein Fehler erwartet"));
    const obs = [];
    const unsub2 = fb.onSnapshot(ref("containers", "keller"), { includeMetadataChanges: false }, { next: (s) => obs.push(s) });
    await tick();
    assert.equal(snaps.length, 1);
    assert.equal(obs.length, 1);
    assert.equal(snaps[0].exists(), true);
    assert.equal(snaps[0].metadata.fromCache, false);
    assert.equal(snaps[0].metadata.hasPendingWrites, false);
    assert.equal(snaps[0].id, "keller");
    assert.equal(snaps[0].ref.path, "containers/keller");
    await fb.deleteDoc(ref("containers", "keller"));
    await tick();
    assert.equal(snaps.length, 2);
    assert.equal(snaps[1].exists(), false);
    unsub();
    unsub2();
  });

  it("Speicher voll → rollback und resource-exhausted", async () => {
    const r = item("kuehlschrank", "milch");
    const calls = [];
    const unsub = fb.onSnapshot(r, (s) => calls.push(s));
    await tick();
    store.quota = true;
    await assert.rejects(fb.updateDoc(r, { qty: 99 }), (err) => {
      assert.equal(err.code, "resource-exhausted");
      assert.match(err.message, /Übungsspeicher voll/);
      return true;
    });
    assert.equal((await fb.getDoc(r)).data().qty, 2);
    assert.equal(JSON.parse(store.getItem(KEY)).docs["containers/kuehlschrank/items/milch"].qty, 2);
    await tick();
    assert.equal(calls.length, 1, "kein Listener-Aufruf");
    store.quota = false;
    await fb.updateDoc(r, { qty: 99 });
    assert.equal((await fb.getDoc(r)).data().qty, 99);
    unsub();
  });

  it("resetPracticeData setzt zurück und benachrichtigt Listener", async () => {
    const calls = [];
    const unsub = fb.onSnapshot(fb.collection(db, "containers"), (s) => calls.push(s));
    await tick();
    await fb.deleteDoc(ref("containers", "kueche"));
    await tick();
    assert.equal(calls.length, 2);
    fb.resetPracticeData();
    await tick();
    assert.equal(calls.length, 3);
    assert.ok(calls[2].docs.some((d) => d.id === "kueche"));
    assert.ok(JSON.parse(store.getItem(KEY)).docs["containers/kueche"]);
    unsub();
  });

  it("anderer Tab (storage-Ereignis) → neu laden und Listener benachrichtigen", async () => {
    if (!windowListeners.length) return; // window.addEventListener stammt nicht vom Test
    const calls = [];
    const unsub = fb.onSnapshot(ref("containers", "keller"), (s) => calls.push(s));
    await tick();
    const other = JSON.parse(store.getItem(KEY));
    other.docs["containers/keller"].name = "Keller (anderer Tab)";
    store.map.set(KEY, JSON.stringify(other));
    windowListeners.filter((l) => l.type === "storage").forEach((l) => l.fn({ key: KEY }));
    await tick();
    assert.equal(calls.length, 2);
    assert.equal(calls[1].data().name, "Keller (anderer Tab)");
    unsub();
  });

  it("Schreiben übernimmt vorher Änderungen eines anderen Tabs", async () => {
    const other = JSON.parse(store.getItem(KEY));
    other.docs["containers/estrich"] = { name: "Estrich" };
    store.map.set(KEY, JSON.stringify(other));
    await fb.updateDoc(ref("containers", "keller"), { name: "Keller 2" });
    const saved = JSON.parse(store.getItem(KEY)).docs;
    assert.equal(saved["containers/estrich"].name, "Estrich");
    assert.equal(saved["containers/keller"].name, "Keller 2");
  });

  it("Daten sind Kopien: Ändern des Ergebnisses ändert den Speicher nicht", async () => {
    const r = item("kuehlschrank", "milch");
    const d = (await fb.getDoc(r)).data();
    d.qty = 1234;
    d.updatedAt.seconds = 0;
    const input = { name: "Liste", tags: ["a"], nested: { x: 1 } };
    await fb.setDoc(ref("containers", "kopie"), input);
    input.tags.push("b");
    input.nested.x = 2;
    const snapAll = fb.practiceSnapshot();
    snapAll["containers/kueche"].name = "kaputt";
    assert.equal((await fb.getDoc(r)).data().qty, 2);
    assert.ok((await fb.getDoc(r)).data().updatedAt.seconds > 0);
    assert.deepEqual((await fb.getDoc(ref("containers", "kopie"))).data(), { name: "Liste", tags: ["a"], nested: { x: 1 } });
    assert.equal((await fb.getDoc(ref("containers", "kueche"))).data().name, "Küche");
  });

  it("settings/lock und members/* existieren nicht", async () => {
    assert.equal((await fb.getDoc(ref("settings", "lock"))).exists(), false);
    assert.equal((await fb.getDoc(ref("members", "jemand@example.com"))).exists(), false);
    const calls = [];
    const unsub = fb.onSnapshot(ref("settings", "lock"), (s) => calls.push(s));
    await tick();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].exists(), false);
    unsub();
  });

  it("terminate/clearIndexedDbPersistence/getFirestore sind harmlos", async () => {
    assert.equal(fb.getFirestore(fb.getApp(), "(default)"), db);
    await fb.clearIndexedDbPersistence(db);
    await fb.enableNetwork(db);
    await fb.disableNetwork(db);
    assert.equal((await fb.getDoc(ref("containers", "kueche"))).exists(), true);
  });

  it("Auth: Übungsbenutzer immer angemeldet, keine Anmeldung per Link", async () => {
    const auth = fb.getAuth(fb.getApp());
    assert.equal(auth.currentUser.uid, "uebung");
    assert.equal(auth.currentUser.email, null);
    assert.equal(auth.currentUser.isPractice, true);
    const users = [];
    const unsub = fb.onAuthStateChanged(auth, (u) => users.push(u));
    assert.equal(users.length, 0, "asynchron");
    await tick();
    assert.equal(users.length, 1);
    assert.equal(users[0].displayName, "Übung");
    assert.equal(typeof unsub, "function");
    const stopped = [];
    fb.onAuthStateChanged(auth, (u) => stopped.push(u))();
    await tick();
    assert.equal(stopped.length, 0);
    assert.equal(fb.isSignInWithEmailLink(auth, "https://x.example.com/?apiKey=1"), false);
    await rejectsWith(fb.sendSignInLinkToEmail(auth, "a@example.com", {}), "auth/operation-not-allowed");
    await rejectsWith(fb.signInWithEmailLink(auth, "a@example.com", "x"), "auth/operation-not-allowed");
    await fb.signOut(auth);
    assert.equal(auth.currentUser.uid, "uebung");
  });
});
