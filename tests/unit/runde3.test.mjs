// Unit-Tests für Runde 3: Liste "läuft bald ab", Umzugsziel per QR-Code.
import assert from "node:assert/strict";
import { SOON_DAYS, EXPIRY_WINDOWS, expiringItems, daysText, moveTargetFromScan } from "../../lib.js";

const TODAY = new Date(2026, 9, 31); // 31.10.2026 (lokal)

describe("expiringItems (läuft bald ab)", () => {
  const items = [
    { id: "a", name: "Joghurt", mhd: "2026-11-03" }, // in 3 Tagen
    { id: "b", name: "Milch", mhd: "2026-10-31" }, // heute
    { id: "c", name: "Käse", mhd: "2026-10-20" }, // abgelaufen
    { id: "d", name: "Butter", mhd: "2026-11-04" }, // in 4 Tagen
    { id: "e", name: "Senf", mhd: "2026-11-07" }, // in 7 Tagen
    { id: "f", name: "Reis", mhd: "2026-11-08" }, // in 8 Tagen
    { id: "g", name: "Salz" }, // ohne MHD
    { id: "h", name: "Kaputt", mhd: "2026-02-30" }, // ungültig
    { id: "i", name: "Apfel", mhd: "2026-10-31" }, // heute, alphabetisch vor Milch
  ];

  it("Standard 3 Tage: abgelaufen + heute bis in 3 Tagen, nach Datum, dann Name", () => {
    assert.deepEqual(expiringItems(items, TODAY).map((i) => i.id), ["c", "i", "b", "a"]);
  });
  it("7 Tage schliesst den 7. Tag ein, den 8. nicht", () => {
    assert.deepEqual(expiringItems(items, TODAY, 7).map((i) => i.id), ["c", "i", "b", "a", "d", "e"]);
  });
  it("liefert Kopien mit Tagen bis zum MHD", () => {
    const out = expiringItems(items, TODAY);
    assert.deepEqual(out.map((i) => i.days), [-11, 0, 0, 3]);
    assert.equal("days" in items[0], false, "Original unverändert");
  });
  it("ohne passende Artikel → leer, robust gegen leere/kaputte Einträge", () => {
    assert.deepEqual(expiringItems([], TODAY), []);
    assert.deepEqual(expiringItems([null, {}, { mhd: 42 }], TODAY), []);
  });
  it("Monats-/Jahreswechsel und Sommerzeit", () => {
    const silvester = new Date(2026, 11, 30);
    assert.deepEqual(expiringItems([{ name: "x", mhd: "2027-01-02" }], silvester).map((i) => i.days), [3]);
    const vorZeitumstellung = new Date(2027, 2, 27); // 28.03.2027 Sommerzeit
    assert.deepEqual(expiringItems([{ name: "y", mhd: "2027-03-30" }], vorZeitumstellung).map((i) => i.days), [3]);
  });
  it("Zeiträume: 3 (wie Markierung) und 7", () => {
    assert.deepEqual(EXPIRY_WINDOWS, [SOON_DAYS, 7]);
  });
});

describe("daysText", () => {
  it("heute/morgen/in n Tagen/seit …", () => {
    assert.equal(daysText(0), "heute");
    assert.equal(daysText(1), "morgen");
    assert.equal(daysText(3), "in 3 Tagen");
    assert.equal(daysText(-1), "seit gestern");
    assert.equal(daysText(-5), "seit 5 Tagen");
  });
});

describe("moveTargetFromScan (Umzugsziel per QR)", () => {
  const APP = "https://example.com/kraft-inventar/index.html?c=keller";
  const containers = new Map([["keller", { name: "Keller" }], ["garage", { name: "Garage" }]]);

  it("gültiger Link auf bekannten Behälter → Ziel", () => {
    assert.deepEqual(moveTargetFromScan("https://example.com/kraft-inventar/index.html?c=garage&n=Garage", APP, "keller", containers), { id: "garage" });
  });
  it("fremde Seite, kein Link, ungültige ID → invalid", () => {
    assert.deepEqual(moveTargetFromScan("https://evil.example.org/index.html?c=garage", APP, "keller", containers), { error: "invalid" });
    assert.deepEqual(moveTargetFromScan("Hallo Welt", APP, "keller", containers), { error: "invalid" });
    assert.deepEqual(moveTargetFromScan("https://example.com/kraft-inventar/index.html?c=a/b", APP, "keller", containers), { error: "invalid" });
    assert.deepEqual(moveTargetFromScan("https://example.com/kraft-inventar/index.html", APP, "keller", containers), { error: "invalid" });
  });
  it("gleicher Behälter → same", () => {
    assert.deepEqual(moveTargetFromScan("https://example.com/kraft-inventar/index.html?c=keller", APP, "keller", containers), { error: "same", id: "keller" });
  });
  it("unbekannter Behälter → unknown (mit Name aus &n=), wird nicht angelegt", () => {
    assert.deepEqual(moveTargetFromScan("https://example.com/kraft-inventar/index.html?c=neue-box&n=Neue%20Box", APP, "keller", containers), { error: "unknown", id: "neue-box", name: "Neue Box" });
    assert.deepEqual(moveTargetFromScan("https://example.com/kraft-inventar/index.html?c=neue-box", APP, "keller", containers), { error: "unknown", id: "neue-box", name: "neue-box" });
    assert.equal(containers.size, 2);
  });
});
