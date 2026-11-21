// Unit-Tests für das Paket "Schutz": Grenzen des Übungsmodus (uebung-firebase.js) und die
// Hilfsfunktionen der Anmeldeseite (lib.js: Abkühlzeit/Rate-Limit, Formatprüfung, Rücksprung-Adresse).
// Nur Platzhalter-Adressen (example.com) – das Repo ist öffentlich.
import assert from "node:assert/strict";
import {
  LOGIN_MAIL_LIMITS,
  loginMailCheck,
  recordLoginMail,
  parseLoginHistory,
  waitText,
  isPlausibleEmail,
  signInContinueUrl,
  parseQrPage,
  MAX_QR_ENTRIES,
  MAX_LINK_ID,
} from "../../lib.js";

const KEY = "vorrat-uebung-db";
const MIN = 60_000;
const HOUR = 60 * MIN;

describe("Schutz: Anmelde-Mails pro Gerät (loginMailCheck)", () => {
  const T = Date.UTC(2026, 10, 7, 12, 0, 0);

  it("Standardwerte: 60 s Abstand, 3 pro Stunde, 5 pro Tag", () => {
    assert.deepEqual({ ...LOGIN_MAIL_LIMITS }, { cooldownMs: 60_000, perHour: 3, perDay: 5 });
  });

  it("ohne Verlauf erlaubt", () => {
    assert.deepEqual(loginMailCheck([], T), { ok: true });
  });

  it("Abkühlzeit: innerhalb von 60 s gesperrt, mit Restzeit; danach erlaubt", () => {
    const r = loginMailCheck([T - 15_000], T);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "cooldown");
    assert.equal(r.waitMs, 45_000);
    assert.deepEqual(loginMailCheck([T - 60_000], T), { ok: true });
  });

  it("höchstens 3 pro Stunde; Wartezeit bis die älteste der 3 eine Stunde alt ist", () => {
    const h = [T - 50 * MIN, T - 20 * MIN, T - 5 * MIN];
    const r = loginMailCheck(h, T);
    assert.equal(r.reason, "hour");
    assert.equal(r.waitMs, 10 * MIN);
    assert.deepEqual(loginMailCheck(h, T + 10 * MIN), { ok: true });
  });

  it("höchstens 5 in 24 Stunden", () => {
    const h = [T - 20 * HOUR, T - 15 * HOUR, T - 10 * HOUR, T - 5 * HOUR, T - 2 * HOUR];
    const r = loginMailCheck(h, T);
    assert.equal(r.reason, "day");
    assert.equal(r.waitMs, 4 * HOUR);
    assert.deepEqual(loginMailCheck(h, T + 4 * HOUR), { ok: true });
  });

  it("Zeitpunkte in der Zukunft (Uhr verstellt) zählen als jetzt, nicht als Freibrief", () => {
    assert.equal(loginMailCheck([T + 10 * HOUR], T).reason, "cooldown");
  });

  it("eigene Grenzen", () => {
    assert.deepEqual(loginMailCheck([T - 5000], T, { cooldownMs: 1000, perHour: 10, perDay: 10 }), { ok: true });
  });

  it("recordLoginMail behält nur 24 Stunden und hängt jetzt an", () => {
    assert.deepEqual(recordLoginMail([T - 25 * HOUR, T - HOUR, T + HOUR], T), [T - HOUR, T]);
  });

  it("parseLoginHistory: kaputte oder fremde Werte → leere Liste bzw. nur Zahlen", () => {
    assert.deepEqual(parseLoginHistory(null), []);
    assert.deepEqual(parseLoginHistory("kaputt{"), []);
    assert.deepEqual(parseLoginHistory('{"a":1}'), []);
    assert.deepEqual(parseLoginHistory('[1, "x", null, -5, 2]'), [1, 2]);
    assert.equal(parseLoginHistory(JSON.stringify(Array.from({ length: 200 }, (_, i) => i + 1))).length, 50);
  });

  it("waitText", () => {
    assert.equal(waitText(1), "in 1 Sekunde");
    assert.equal(waitText(45_000), "in 45 Sekunden");
    assert.equal(waitText(61_000), "in 2 Minuten");
    assert.equal(waitText(10 * MIN), "in 10 Minuten");
    assert.equal(waitText(4 * HOUR), "in 4 Stunden");
    assert.equal(waitText(HOUR + 1), "in 2 Stunden");
  });
});

describe("Schutz: Formatprüfung der Adresse (isPlausibleEmail)", () => {
  it("übliche Adressen", () => {
    for (const ok of ["anna@example.com", "a.b-c+d@sub.example.com", "x_y@mail.example.com", "Gross@Example.COM"]) {
      assert.equal(isPlausibleEmail(ok), true, ok);
    }
  });
  it("Unsinn und Tricks abgelehnt", () => {
    const long = `${"a".repeat(250)}@example.com`;
    for (const bad of ["", "a@b", "anna", "anna@", "@example.com", "an na@example.com", "a@@example.com",
      "a@b@example.com", "anna@example", "anna@.example.com", "anna@sub..example.com", "anna@-example.com",
      "<script>@example.com", "anna@example.com\n", long, `${"a".repeat(65)}@example.com`, null, 42]) {
      assert.equal(isPlausibleEmail(bad), false, String(bad));
    }
  });
});

describe("Schutz: Rücksprung-Adresse der Anmelde-Mail (signInContinueUrl)", () => {
  const BASE = "https://example.com/kraft-inventar/index.html";
  it("ohne Parameter: nur die Seite", () => {
    assert.equal(signInContinueUrl(BASE), BASE);
    assert.equal(signInContinueUrl(`${BASE}#x`), BASE);
  });
  it("behält gültiges ?c= und gekürztes &n=", () => {
    assert.equal(signInContinueUrl(`${BASE}?c=keller&n=Keller`), `${BASE}?c=keller&n=Keller`);
    const long = signInContinueUrl(`${BASE}?c=keller&n=${"x".repeat(500)}`);
    assert.equal(new URL(long).searchParams.get("n").length, 100);
  });
  it("wirft fremde Parameter, IDs mit / oder > 200 Zeichen und n ohne c weg", () => {
    assert.equal(signInContinueUrl(`${BASE}?c=keller&uebung=1&tutorial=1&liste=ablauf&foo=bar`), `${BASE}?c=keller`);
    assert.equal(signInContinueUrl(`${BASE}?c=../evil&n=Spam`), BASE);
    assert.equal(signInContinueUrl(`${BASE}?c=${"a".repeat(201)}`), BASE);
    // ältere ID (nicht im App-Format): Behälter bleibt erreichbar, aber ohne Namen (kein Anlegen)
    assert.equal(signInContinueUrl(`${BASE}?c=Alter_Schrank&n=Spam`), `${BASE}?c=Alter_Schrank`);
    assert.equal(signInContinueUrl(`${BASE}?n=Hier+klicken+fuer+Gewinn`), BASE);
  });
  it("Pfad bleibt auf derselben Seite", () => {
    const u = new URL(signInContinueUrl("https://example.com/kraft-inventar/?c=keller"));
    assert.equal(u.origin + u.pathname, "https://example.com/kraft-inventar/");
  });
});

describe("Schutz: QR-Druckbogen mit Riesen-Link (parseQrPage)", () => {
  it(`höchstens ${MAX_QR_ENTRIES} Behälter, IDs bis ${MAX_LINK_ID} Zeichen`, () => {
    const p = new URLSearchParams();
    for (let i = 0; i < 2000; i++) { p.append("c", `b${i}`); p.append("n", `B ${i}`); }
    const { entries } = parseQrPage(p.toString());
    assert.equal(entries.length, MAX_QR_ENTRIES);
    assert.equal(entries[0].id, "b0");
    const q = parseQrPage(`c=${"a".repeat(MAX_LINK_ID + 1)}&c=ok`);
    assert.deepEqual(q.entries.map((e) => e.id), ["ok"]);
  });
});

// ---- Übungsmodus: Grenzen ----

class FakeStorage {
  constructor() { this.map = new Map(); this.quota = false; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) {
    if (this.quota) {
      const err = new Error("The quota has been exceeded.");
      err.name = "QuotaExceededError";
      throw err;
    }
    this.map.set(k, String(v));
  }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

const JPEG = "data:image/jpeg;base64,/9j/" + "A".repeat(2000);

describe("Schutz: Grenzen im Übungsmodus (uebung-firebase.js)", () => {
  let fb;
  let db;
  let store;
  let hadStorage;
  let oldStorage;

  before(async () => {
    hadStorage = "localStorage" in globalThis;
    oldStorage = globalThis.localStorage;
    store = new FakeStorage();
    globalThis.localStorage = store;
    fb = await import("../../uebung-firebase.js");
    db = fb.getFirestore(fb.initializeApp({}));
  });

  after(() => {
    if (hadStorage) globalThis.localStorage = oldStorage;
    else delete globalThis.localStorage;
  });

  beforeEach(() => {
    globalThis.localStorage = store; // andere Testdateien setzen ihren eigenen Speicher
    store.quota = false;
    store.clear();
    fb.__reloadForTests();
  });

  const limitErr = (pattern) => (err) => {
    assert.equal(err.code, "resource-exhausted");
    assert.match(err.message, pattern);
    assert.match(err.message, /zurücksetzen/);
    return true;
  };

  it("Standardwerte und Belegung der Beispieldaten weit darunter", () => {
    assert.deepEqual({ ...fb.PRACTICE_LIMITS }, { maxContainers: 60, maxItems: 400, maxPhotos: 20, maxChars: 2_000_000 });
    const u = fb.practiceUsage();
    assert.ok(u.containers > 0 && u.containers < 15, `Behälter ${u.containers}`);
    assert.ok(u.items > 0 && u.items < 60, `Artikel ${u.items}`);
    assert.ok(u.chars > 0 && u.chars < 50_000, `Zeichen ${u.chars}`);
  });

  it("höchstens 60 Behälter: der nächste wird abgelehnt, nichts gespeichert; Ändern/Löschen geht weiter", async () => {
    const start = fb.practiceUsage().containers;
    const b = fb.writeBatch(db);
    for (let i = start; i < 60; i++) b.set(fb.doc(db, "containers", `c${i}`), { name: `C ${i}` });
    await b.commit();
    assert.equal(fb.practiceUsage().containers, 60);
    const before = store.getItem(KEY);
    await assert.rejects(fb.setDoc(fb.doc(db, "containers", "zuviel"), { name: "Zu viel" }), limitErr(/höchstens 60 Behälter/));
    assert.equal(store.getItem(KEY), before, "localStorage unverändert");
    assert.equal((await fb.getDoc(fb.doc(db, "containers", "zuviel"))).exists(), false);
    await fb.updateDoc(fb.doc(db, "containers", `c${start}`), { name: "Umbenannt" });
    await fb.deleteDoc(fb.doc(db, "containers", `c${start}`));
    await fb.setDoc(fb.doc(db, "containers", "jetzt-ok"), { name: "Wieder Platz" });
  });

  it("höchstens 400 Artikel (auch per Batch: alles oder nichts)", async () => {
    const start = fb.practiceUsage().items;
    const b = fb.writeBatch(db);
    for (let i = start; i < 400; i++) b.set(fb.doc(db, "containers", "keller", "items", `a${i}`), { name: `A ${i}`, qty: 1, unit: "Stk" });
    await b.commit();
    const b2 = fb.writeBatch(db);
    b2.update(fb.doc(db, "containers", "keller", "items", `a${start}`), { qty: 5 });
    b2.set(fb.doc(db, "containers", "keller", "items", "zuviel"), { name: "Zu viel", qty: 1, unit: "Stk" });
    await assert.rejects(b2.commit(), limitErr(/höchstens 400 Artikel/));
    assert.equal((await fb.getDoc(fb.doc(db, "containers", "keller", "items", `a${start}`))).data().qty, 1, "Batch komplett verworfen");
    // Verschieben (gleich viele Artikel) bleibt möglich
    const mv = fb.writeBatch(db);
    mv.set(fb.doc(db, "containers", "bad", "items", "verschoben"), { name: "Verschoben", qty: 1, unit: "Stk" });
    mv.delete(fb.doc(db, "containers", "keller", "items", `a${start}`));
    await mv.commit();
    assert.equal(fb.practiceUsage().items, 400);
  });

  it("höchstens 20 Fotos; Foto ersetzen und entfernen geht weiter", async () => {
    const ref = (i) => fb.doc(db, "containers", "keller", "items", `f${i}`);
    for (let i = 0; i < 25; i++) await fb.setDoc(ref(i), { name: `F ${i}`, qty: 1, unit: "Stk" });
    const already = fb.practiceUsage().photos;
    for (let i = 0; i < 20 - already; i++) await fb.setDoc(ref(i), { photo: JPEG }, { merge: true });
    assert.equal(fb.practiceUsage().photos, 20);
    await assert.rejects(fb.setDoc(ref(24), { photo: JPEG }, { merge: true }), limitErr(/höchstens 20 Fotos/));
    await fb.setDoc(ref(0), { photo: JPEG + "B" }, { merge: true }); // ersetzen
    await fb.updateDoc(ref(0), { photo: fb.deleteField() });
    await fb.setDoc(ref(24), { photo: JPEG }, { merge: true }); // jetzt wieder Platz
  });

  it("höchstens ~2 Mio. Zeichen insgesamt", async () => {
    const big = "x".repeat(fb.PRACTICE_LIMITS.maxChars);
    await assert.rejects(fb.setDoc(fb.doc(db, "containers", "keller", "items", "riese"), { name: big, qty: 1, unit: "Stk" }), limitErr(/Übungsspeicher voll/));
    assert.ok(fb.practiceUsage().chars < 50_000);
    await fb.setDoc(fb.doc(db, "containers", "keller", "items", "mittel"), { name: "y".repeat(500_000), qty: 1, unit: "Stk" });
  });

  it("Stand über der Grenze (z.B. ältere Version): bleibt lesbar, Verkleinern erlaubt, Wachsen nicht", async () => {
    const docs = {};
    for (let i = 0; i < 70; i++) docs[`containers/x${i}`] = { name: `X ${i}` };
    store.setItem(KEY, JSON.stringify({ v: 1, docs }));
    fb.__reloadForTests();
    assert.equal(fb.practiceUsage().containers, 70);
    await fb.deleteDoc(fb.doc(db, "containers", "x0"));
    await fb.updateDoc(fb.doc(db, "containers", "x1"), { name: "Neu" });
    await assert.rejects(fb.setDoc(fb.doc(db, "containers", "y"), { name: "Y" }), limitErr(/Behälter/));
  });

  it("Browser-Speicher voll (QuotaExceededError): freundlicher Fehler, Stand bleibt", async () => {
    store.quota = true;
    await assert.rejects(fb.setDoc(fb.doc(db, "containers", "neu"), { name: "Neu" }), limitErr(/Übungsspeicher voll/));
    assert.equal((await fb.getDoc(fb.doc(db, "containers", "neu"))).exists(), false);
    store.quota = false;
    fb.resetPracticeData();
    assert.ok(fb.practiceUsage().containers > 0, "Zurücksetzen hilft");
  });
});
