// Unit-Tests für die Logik aus Runde 2: Einheiten, Schrittweite, Hierarchie, MHD, OCR-Text, GS1.
import assert from "node:assert/strict";
import {
  UNITS,
  MAX_QTY,
  qtyStep,
  planStep,
  CONTAINER_TYPES,
  containerPath,
  formatPath,
  isTopLevel,
  childContainers,
  wouldCreateCycle,
  parentOptions,
  uniqueContainerId,
  isoDate,
  isValidIsoDate,
  addToDate,
  daysUntil,
  mhdStatus,
  formatDate,
  parseDatesFromText,
  parseGs1Expiry,
} from "../../lib.js";

const TODAY = new Date(2026, 9, 31); // 31.10.2026, lokale Zeit

describe("Einheiten", () => {
  it("behält die bisherigen und hat die neuen", () => {
    for (const u of ["Stk", "Packung", "g", "ml", "kg", "l", "Flasche", "Dose", "Glas"]) assert.ok(UNITS.includes(u), u);
    assert.equal(UNITS[0], "Stk", "Standard bleibt Stk");
    assert.equal(new Set(UNITS).size, UNITS.length, "keine Duplikate");
  });
});

describe("qtyStep / planStep (+/−)", () => {
  it("g und ml in 50er-Schritten, sonst 1", () => {
    assert.equal(qtyStep("g"), 50);
    assert.equal(qtyStep("ml"), 50);
    for (const u of ["Stk", "Packung", "kg", "l", "Flasche", "Dose", "Glas", undefined]) assert.equal(qtyStep(u), 1, String(u));
  });
  it("Plus/Minus normal", () => {
    assert.deepEqual(planStep(500, "g", 1), { action: "change", delta: 50, newQty: 550 });
    assert.deepEqual(planStep(500, "g", -1), { action: "change", delta: -50, newQty: 450 });
    assert.deepEqual(planStep(2, "Stk", -1), { action: "change", delta: -1, newQty: 1 });
    assert.deepEqual(planStep(120, "ml", 1), { action: "change", delta: 50, newQty: 170 });
  });
  it("Minus unter 1 → entfernen (wie bisher bei 1 Stk)", () => {
    assert.deepEqual(planStep(1, "Stk", -1), { action: "remove" });
    assert.deepEqual(planStep(50, "g", -1), { action: "remove" });
    assert.deepEqual(planStep(30, "ml", -1), { action: "remove" });
    assert.deepEqual(planStep(51, "g", -1), { action: "change", delta: -50, newQty: 1 });
  });
  it("begrenzt auf MAX_QTY", () => {
    assert.deepEqual(planStep(MAX_QTY - 10, "g", 1), { action: "change", delta: 10, newQty: MAX_QTY });
    assert.deepEqual(planStep(MAX_QTY, "Stk", 1), { action: "none" });
  });
  it("ungültige Menge zählt als 1", () => {
    assert.deepEqual(planStep(undefined, "Stk", 1), { action: "change", delta: 1, newQty: 2 });
  });
});

function map(obj) {
  return new Map(Object.entries(obj));
}

const HOUSE = map({
  kueche: { name: "Küche", type: "raum" },
  kuehlschrank: { name: "Kühlschrank", type: "schrank", parent: "kueche" },
  gemuesefach: { name: "Gemüsefach", type: "fach", parent: "kuehlschrank" },
  "box-1": { name: "Box 1", type: "box", parent: "kueche" }, // Ebene übersprungen
  lose: { name: "Lose Box", type: "box" }, // ohne übergeordneten Ort
  alt: { name: "Alter Behälter" }, // ohne type/parent (Daten aus Runde 1)
  verwaist: { name: "Verwaist", parent: "geloescht" },
});

describe("Hierarchie", () => {
  it("Typen", () => {
    assert.deepEqual(Object.keys(CONTAINER_TYPES), ["raum", "schrank", "fach", "box"]);
  });
  it("Pfad von oben nach unten", () => {
    const p = containerPath("gemuesefach", HOUSE);
    assert.deepEqual(p.map((x) => x.id), ["kueche", "kuehlschrank", "gemuesefach"]);
    assert.equal(formatPath(p), "Küche › Kühlschrank › Gemüsefach");
    assert.equal(formatPath(containerPath("box-1", HOUSE)), "Küche › Box 1");
    assert.equal(formatPath(containerPath("alt", HOUSE)), "Alter Behälter");
  });
  it("fehlender Elternteil beendet den Pfad, unbekannte ID gibt sich selbst", () => {
    assert.equal(formatPath(containerPath("verwaist", HOUSE)), "Verwaist");
    assert.deepEqual(containerPath("unbekannt", HOUSE), [{ id: "unbekannt", name: "unbekannt" }]);
  });
  it("Zyklus in den Daten → keine Endlosschleife", () => {
    const loop = map({ a: { name: "A", parent: "b" }, b: { name: "B", parent: "a" }, s: { name: "S", parent: "s" } });
    assert.deepEqual(containerPath("a", loop).map((x) => x.id), ["b", "a"]);
    assert.deepEqual(containerPath("s", loop).map((x) => x.id), ["s"]);
    assert.ok(isTopLevel("a", loop) && isTopLevel("b", loop) && isTopLevel("s", loop), "Kreis-Mitglieder bleiben sichtbar");
    assert.deepEqual(childContainers("a", loop), []);
  });
  it("oberste Ebene", () => {
    for (const id of ["kueche", "lose", "alt", "verwaist"]) assert.ok(isTopLevel(id, HOUSE), id);
    for (const id of ["kuehlschrank", "gemuesefach", "box-1"]) assert.ok(!isTopLevel(id, HOUSE), id);
  });
  it("Unterbehälter alphabetisch", () => {
    assert.deepEqual(childContainers("kueche", HOUSE).map((c) => c.id), ["box-1", "kuehlschrank"]);
    assert.deepEqual(childContainers("gemuesefach", HOUSE), []);
  });
  it("Zyklen erkennen", () => {
    assert.ok(wouldCreateCycle("kueche", "kueche", HOUSE), "in sich selbst");
    assert.ok(wouldCreateCycle("kueche", "gemuesefach", HOUSE), "in eigenen Enkel");
    assert.ok(wouldCreateCycle("kuehlschrank", "gemuesefach", HOUSE), "in eigenes Kind");
    assert.ok(!wouldCreateCycle("gemuesefach", "kueche", HOUSE), "nach oben");
    assert.ok(!wouldCreateCycle("lose", "gemuesefach", HOUSE), "fremde Box in Fach");
    assert.ok(!wouldCreateCycle("kueche", "", HOUSE), "oberste Ebene");
  });
  it("Ziele für 'liegt in' ohne sich selbst und Nachkommen", () => {
    const ids = parentOptions("kuehlschrank", HOUSE).map((o) => o.id);
    assert.ok(!ids.includes("kuehlschrank") && !ids.includes("gemuesefach"));
    assert.ok(ids.includes("kueche") && ids.includes("lose") && ids.includes("box-1"));
    const labels = parentOptions(null, HOUSE).map((o) => o.label);
    assert.ok(labels.includes("Küche › Kühlschrank › Gemüsefach"));
    assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b, "de")));
  });
  it("eindeutige ID für Unterbehälter", () => {
    const taken = (id) => ["fach-1", "schrank-fach-1", "schrank-fach-1-2"].includes(id);
    assert.equal(uniqueContainerId("Gemüse", "kuehlschrank", taken), "gemüse");
    assert.equal(uniqueContainerId("Fach 1", "kuehlschrank", taken), "kuehlschrank-fach-1");
    assert.equal(uniqueContainerId("Fach 1", "schrank", taken), "schrank-fach-1-3");
    assert.equal(uniqueContainerId("!!!", "x", taken), "");
    const long = uniqueContainerId("x".repeat(100), "y".repeat(100), (id) => id === "x".repeat(100));
    assert.ok(long.length <= 100 && /^[a-z0-9äöüß]+(-[a-z0-9äöüß]+)*$/.test(long), long);
  });
});

describe("MHD", () => {
  it("isoDate lokal, Validierung", () => {
    assert.equal(isoDate(TODAY), "2026-10-31");
    assert.ok(isValidIsoDate("2027-02-28"));
    for (const d of ["2027-02-29", "2027-13-01", "2027-00-10", "27-03-12", "1999-01-01", "2027-3-1", "", null, 20270312]) {
      assert.equal(isValidIsoDate(d), false, String(d));
    }
    assert.ok(isValidIsoDate("2028-02-29"), "Schaltjahr");
  });
  it("Schnellauswahl", () => {
    assert.equal(addToDate(TODAY, { days: 3 }), "2026-11-03");
    assert.equal(addToDate(TODAY, { days: 7 }), "2026-11-07");
    assert.equal(addToDate(TODAY, { months: 1 }), "2026-11-30", "31.10. + 1 Monat = 30.11.");
    assert.equal(addToDate(new Date(2027, 0, 31), { months: 1 }), "2027-02-28");
    assert.equal(addToDate(new Date(2026, 11, 30), { days: 3 }), "2027-01-02", "Jahreswechsel");
  });
  it("Status: abgelaufen / bald / ok", () => {
    assert.equal(daysUntil("2026-11-03", TODAY), 3);
    assert.equal(mhdStatus("2026-10-30", TODAY), "expired");
    assert.equal(mhdStatus("2026-10-31", TODAY), "soon", "heute = bald");
    assert.equal(mhdStatus("2026-11-03", TODAY), "soon");
    assert.equal(mhdStatus("2026-11-04", TODAY), "ok");
    assert.equal(mhdStatus(undefined, TODAY), null);
    assert.equal(mhdStatus("Quatsch", TODAY), null);
  });
  it("Sommerzeit-Wechsel zählt richtig", () => {
    assert.equal(daysUntil("2027-03-29", new Date(2027, 2, 27)), 2);
    assert.equal(daysUntil("2026-10-26", new Date(2026, 9, 24)), 2);
  });
  it("Anzeige", () => {
    assert.equal(formatDate("2027-03-12"), "12.03.2027");
    assert.equal(formatDate("x"), "");
  });
});

describe("parseDatesFromText (OCR)", () => {
  const p = (t) => parseDatesFromText(t, TODAY);
  it("übliche Formate", () => {
    assert.deepEqual(p("Mindestens haltbar bis 12.03.27"), ["2027-03-12"]);
    assert.deepEqual(p("12/03/2027"), ["2027-03-12"]);
    assert.deepEqual(p("12-03-2027"), ["2027-03-12"]);
    assert.deepEqual(p("1.3.2027"), ["2027-03-01"]);
    assert.deepEqual(p("2027-03-12"), ["2027-03-12"]);
    assert.deepEqual(p("EXP 03.2027"), ["2027-03-31"], "Monat/Jahr → Monatsende");
    assert.deepEqual(p("03/2027"), ["2027-03-31"]);
  });
  it("OCR-Fehler und Leerzeichen", () => {
    assert.deepEqual(p("l2.O3.2O27"), ["2027-03-12"]);
    assert.deepEqual(p("12. 03. 27"), ["2027-03-12"]);
    assert.deepEqual(p("MHD:12.03.27L4711"), ["2027-03-12"]);
  });
  it("ungültige oder unplausible Daten fallen weg", () => {
    assert.deepEqual(p("31.02.27"), []);
    assert.deepEqual(p("12.13.27"), []);
    assert.deepEqual(p("01.01.1999"), []);
    assert.deepEqual(p("01.01.2060"), [], "mehr als 15 Jahre voraus");
    assert.deepEqual(p("Los 4711 Preis 3.50 Gewicht 500g"), []);
    assert.deepEqual(p(""), []);
    assert.deepEqual(p(null), []);
  });
  it("mehrere Daten: eindeutig, frühestes zuerst", () => {
    assert.deepEqual(p("hergestellt 01.09.26 mhd 12.03.27 / 12.03.2027"), ["2026-09-01", "2027-03-12"]);
  });
});

describe("parseGs1Expiry (AI 17)", () => {
  it("roher Element-String (DataMatrix) mit FNC1/GS", () => {
    assert.equal(parseGs1Expiry("]d2010401234567890317270312\u001d10ABC"), "2027-03-12");
    assert.equal(parseGs1Expiry("010401234567890310LOT42\u001d17270312"), "2027-03-12");
    assert.equal(parseGs1Expiry("17270312"), "2027-03-12");
  });
  it("Tag 00 = Monatsende", () => {
    assert.equal(parseGs1Expiry("010401234567890317270200"), "2027-02-28");
  });
  it("AI 15 (Mindesthaltbarkeit) wenn kein AI 17, sonst AI 17 bevorzugt", () => {
    assert.equal(parseGs1Expiry("]d201040123456789031527031210ABC"), "2027-03-12");
    assert.equal(parseGs1Expiry("010401234567890315270101172703122"), "2027-03-12");
    assert.equal(parseGs1Expiry("(01)04012345678903(15)270312"), "2027-03-12");
    assert.equal(parseGs1Expiry("(01)04012345678903(15)270101(17)270312"), "2027-03-12");
    assert.equal(parseGs1Expiry("https://id.example.com/01/04012345678903?15=270312"), "2027-03-12");
  });
  it("Klartext mit Klammern", () => {
    assert.equal(parseGs1Expiry("(01)04012345678903(17)270312(10)ABC"), "2027-03-12");
  });
  it("GS1 Digital Link", () => {
    assert.equal(parseGs1Expiry("https://id.example.com/01/04012345678903/10/AB12?17=270312"), "2027-03-12");
    assert.equal(parseGs1Expiry("https://id.example.com/01/04012345678903?17=271231&3103=000500"), "2027-12-31");
    assert.equal(parseGs1Expiry("https://id.example.com/01/04012345678903/17/270312"), "2027-03-12");
  });
  it("ohne AI 17 oder kein GS1 → null", () => {
    assert.equal(parseGs1Expiry("0104012345678903"), null);
    assert.equal(parseGs1Expiry("010401234567890310ABC"), null);
    assert.equal(parseGs1Expiry("https://example.com/index.html?c=keller"), null);
    assert.equal(parseGs1Expiry("https://example.com/?17=270312"), null, "kein Digital Link ohne GTIN");
    assert.equal(parseGs1Expiry("Hallo Welt"), null);
    assert.equal(parseGs1Expiry("17271332"), null, "Monat 13");
    assert.equal(parseGs1Expiry(""), null);
  });
});
