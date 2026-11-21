// Unit-Tests für das Paket Ziel ("Gehört nach …"): Vererbung, Ziel erreicht, Zyklen, Auswahl,
// Vorschläge (gleicher Name / Kategorie), Gruppierung und Vorauswahl im Verschieben-Dialog.
import assert from "node:assert/strict";
import {
  cleanTargetId,
  isTargetReached,
  containerTargetError,
  itemTargetError,
  targetOptions,
  containerTarget,
  itemTarget,
  inMovingBox,
  needsSuggestions,
  similarNames,
  suggestTarget,
  commonTarget,
  shortPath,
  groupByTarget,
  canGroupByTarget,
  TARGET_CATEGORIES,
  nameKey,
} from "../../lib.js";
import { practiceSeed } from "../../uebung-daten.js";
import { ITEM_ICONS, ICON_GROUPS } from "../../item-icons.js";
import { iconForItem } from "../../icon-match.js";

// Alte Wohnung (Keller, Kisten) und neue Wohnung (Küche mit Schublade, Bad, Werkstatt).
function house(extra = {}) {
  return new Map(Object.entries({
    neu: { name: "Neue Wohnung" },
    kueche: { name: "Küche", type: "raum", parent: "neu" },
    schublade: { name: "Schublade oben", type: "fach", parent: "kueche" },
    vorrat: { name: "Vorratsschrank", type: "schrank", parent: "kueche" },
    bad: { name: "Bad", type: "raum", parent: "neu" },
    spiegel: { name: "Spiegelschrank", type: "schrank", parent: "bad" },
    keller: { name: "Keller", type: "raum" },
    werkzeugbox: { name: "Werkzeugbox", type: "box", parent: "keller" },
    "kiste-1": { name: "Kiste 1", type: "box", target: "kueche" },
    "kiste-1-tuete": { name: "Tüte", parent: "kiste-1" },
    "kiste-2": { name: "Kiste 2", type: "box" },
    karton: { name: "Umzugskarton Bad", target: "bad" },
    ...extra,
  }));
}

// Icon und Gruppe wie in app.js (Icon gespeichert oder aus dem Namen).
function sug(name, containerId, containers, allItems = null, icon = undefined) {
  const iconId = iconForItem({ name, icon });
  return suggestTarget({ name, containerId, iconId, group: iconId ? ITEM_ICONS[iconId].group : null }, containers, allItems);
}

describe("Ziel: Feld prüfen (cleanTargetId)", () => {
  it("gültige IDs bleiben, alles andere fällt weg", () => {
    assert.equal(cleanTargetId("kueche"), "kueche");
    assert.equal(cleanTargetId("x".repeat(100)), "x".repeat(100));
    for (const bad of ["", "a/b", "x".repeat(101), 42, null, undefined, {}, ["kueche"], true]) {
      assert.equal(cleanTargetId(bad), undefined, JSON.stringify(bad));
    }
  });
});

describe("Ziel erreicht (isTargetReached)", () => {
  const c = house();
  it("gleicher Behälter oder darin (beliebig tief)", () => {
    assert.equal(isTargetReached("kueche", "kueche", c), true);
    assert.equal(isTargetReached("schublade", "kueche", c), true);
    assert.equal(isTargetReached("schublade", "neu", c), true);
  });
  it("anderswo, darüber oder ohne Angaben → nicht erreicht", () => {
    assert.equal(isTargetReached("kiste-1", "kueche", c), false);
    assert.equal(isTargetReached("kueche", "schublade", c), false, "Küche liegt nicht in der Schublade");
    assert.equal(isTargetReached("bad", "kueche", c), false);
    assert.equal(isTargetReached(undefined, "kueche", c), false);
    assert.equal(isTargetReached("kueche", undefined, c), false);
  });
  it("kaputte Daten mit Kreis führen nicht zu einer Endlosschleife", () => {
    const k = new Map([["a", { name: "A", parent: "b" }], ["b", { name: "B", parent: "a" }]]);
    assert.equal(isTargetReached("a", "x", k), false);
    assert.equal(isTargetReached("a", "b", k), true);
  });
});

describe("Ziel setzen: Prüfung (containerTargetError / itemTargetError)", () => {
  const c = house();
  it("Behälter: nicht er selbst, kein eigener Unterbehälter (Zyklus), muss existieren", () => {
    assert.equal(containerTargetError("kiste-1", "kueche", c), null);
    assert.equal(containerTargetError("kiste-1", "kiste-1", c), "self");
    assert.equal(containerTargetError("kiste-1", "kiste-1-tuete", c), "inside");
    assert.equal(containerTargetError("neu", "schublade", c), "inside", "tief darunter");
    assert.equal(containerTargetError("kiste-1", "gibts-nicht", c), "missing");
    assert.equal(containerTargetError("kiste-1", "", c), "missing");
  });
  it("Behälter: liegt schon im Ziel → reached", () => {
    assert.equal(containerTargetError("vorrat", "kueche", c), "reached");
    assert.equal(containerTargetError("schublade", "neu", c), "reached");
    assert.equal(containerTargetError("kiste-1-tuete", "kiste-1", c), "reached");
    assert.equal(containerTargetError("kueche", "bad", c), null, "Geschwister ist ok");
  });
  it("Artikel: nicht der eigene Behälter, nicht wo er schon liegt", () => {
    assert.equal(itemTargetError("kiste-1", "schublade", c), null);
    assert.equal(itemTargetError("kiste-1", "kiste-1", c), "self");
    assert.equal(itemTargetError("schublade", "kueche", c), "reached");
    assert.equal(itemTargetError("kueche", "schublade", c), null, "aus der Küche in die Schublade ist ok");
    assert.equal(itemTargetError("kiste-1", "kiste-1-tuete", c), null, "in eine Tüte der eigenen Kiste ist erlaubt");
    assert.equal(itemTargetError("kiste-1", "nix", c), "missing");
  });
  it("Auswahl (targetOptions) enthält nur erlaubte Ziele, mit Pfad, sortiert", () => {
    const forBox = targetOptions("container", "kiste-1", c).map((o) => o.id);
    assert.ok(forBox.includes("kueche") && forBox.includes("schublade"));
    assert.ok(!forBox.includes("kiste-1") && !forBox.includes("kiste-1-tuete"), "nicht sich selbst/Unterbehälter");
    const forVorrat = targetOptions("container", "vorrat", c).map((o) => o.id);
    assert.ok(!forVorrat.includes("kueche") && !forVorrat.includes("neu"), "nicht, wo er schon liegt");
    const forItem = targetOptions("item", "schublade", c);
    assert.ok(!forItem.some((o) => ["schublade", "kueche", "neu"].includes(o.id)));
    assert.ok(forItem.some((o) => o.id === "bad" && o.label === "Neue Wohnung › Bad"));
    const labels = forItem.map((o) => o.label);
    assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b, "de")));
  });
});

describe("Ziel eines Behälters und Vererbung (containerTarget / itemTarget)", () => {
  const c = house();
  it("eigenes Ziel des Behälters", () => {
    assert.deepEqual(containerTarget("kiste-1", c), { id: "kueche", via: "kiste-1" });
    assert.equal(containerTarget("kueche", c), null);
    assert.equal(containerTarget("kiste-2", c), null);
  });
  it("Unterbehälter erbt vom nächsten Behälter darüber", () => {
    assert.deepEqual(containerTarget("kiste-1-tuete", c), { id: "kueche", via: "kiste-1" });
    const c2 = house({ "kiste-1-tuete": { name: "Tüte", parent: "kiste-1", target: "bad" } });
    assert.deepEqual(containerTarget("kiste-1-tuete", c2), { id: "bad", via: "kiste-1-tuete" }, "eigenes geht vor");
  });
  it("Ziel erreicht (Kiste in die Küche gestellt) → kein Ziel mehr", () => {
    const c2 = house({ "kiste-1": { name: "Kiste 1", type: "box", target: "kueche", parent: "kueche" } });
    assert.equal(containerTarget("kiste-1", c2), null);
    assert.equal(containerTarget("kiste-1-tuete", c2), null);
  });
  it("ungültige Ziele (gelöscht, sich selbst, Unterbehälter) werden übersprungen", () => {
    const c2 = house({
      "kiste-1-tuete": { name: "Tüte", parent: "kiste-1", target: "geloescht" },
      x: { name: "X", target: "x" },
      y: { name: "Y", target: "y-kind" },
      "y-kind": { name: "Y-Kind", parent: "y" },
    });
    assert.deepEqual(containerTarget("kiste-1-tuete", c2), { id: "kueche", via: "kiste-1" });
    assert.equal(containerTarget("x", c2), null);
    assert.equal(containerTarget("y", c2), null);
  });
  it("Artikel: eigenes Ziel, sonst geerbt (über die Kiste)", () => {
    assert.deepEqual(itemTarget({ name: "Messer", target: "schublade" }, "kiste-1", c), { id: "schublade", kind: "own" });
    assert.deepEqual(itemTarget({ name: "Teller" }, "kiste-1", c), { id: "kueche", kind: "inherited", via: "kiste-1" });
    assert.deepEqual(itemTarget({ name: "Teller" }, "kiste-1-tuete", c), { id: "kueche", kind: "inherited", via: "kiste-1" });
    assert.equal(itemTarget({ name: "Fotos" }, "kiste-2", c), null);
  });
  it("Artikel: Ziel erreicht → null (auch wenn der Behälter ein anderes Ziel hätte)", () => {
    assert.equal(itemTarget({ name: "Messer", target: "schublade" }, "schublade", c), null);
    assert.equal(itemTarget({ name: "Messer", target: "kueche" }, "schublade", c), null, "im Unterbehälter des Ziels");
    assert.equal(itemTarget({ name: "Seife", target: "kiste-1" }, "kiste-1", c), null, "eigener Behälter = erreicht");
  });
  it("Artikel: gelöschtes oder kaputtes eigenes Ziel → geerbtes Ziel", () => {
    assert.deepEqual(itemTarget({ name: "Teller", target: "geloescht" }, "kiste-1", c), { id: "kueche", kind: "inherited", via: "kiste-1" });
    assert.deepEqual(itemTarget({ name: "Teller", target: "a/b" }, "kiste-1", c), { id: "kueche", kind: "inherited", via: "kiste-1" });
    assert.equal(itemTarget(null, "kiste-2", c), null);
  });
  it("Artikel in der Küche angekommen: weder eigenes noch geerbtes Ziel", () => {
    assert.equal(itemTarget({ name: "Teller" }, "kueche", c), null);
  });
});

describe("Umzugskiste erkennen und Vorschläge nötig? (inMovingBox / needsSuggestions)", () => {
  const c = house();
  it("Name mit Kiste/Karton/Umzug oder mit Ziel, auch darüber", () => {
    for (const id of ["kiste-1", "kiste-1-tuete", "kiste-2", "karton"]) assert.equal(inMovingBox(id, c), true, id);
    for (const id of ["kueche", "keller", "werkzeugbox", "spiegel"]) assert.equal(inMovingBox(id, c), false, id);
    const c2 = house({ regal: { name: "Regal", target: "keller" } });
    assert.equal(inMovingBox("regal", c2), true, "Ziel macht zur Umzugskiste");
    const c3 = house({ k: { name: "UMZUGSKARTON 7" } });
    assert.equal(inMovingBox("k", c3), true, "Gross-/Kleinschreibung egal");
  });
  it("nur ohne geerbtes Ziel und nur in Kisten bzw. mit Artikel-Zielen", () => {
    assert.equal(needsSuggestions("kiste-2", c), true);
    assert.equal(needsSuggestions("kiste-1", c), false, "Kiste mit Ziel: alle Artikel erben");
    assert.equal(needsSuggestions("kiste-1-tuete", c), false);
    assert.equal(needsSuggestions("kueche", c), false, "normaler Behälter: wie bisher");
    assert.equal(needsSuggestions("keller", c, [{ name: "Säge", target: "kueche" }]), true, "Artikel mit Ziel");
    assert.equal(needsSuggestions("keller", c, [{ name: "Säge", target: "geloescht" }]), false);
    assert.equal(needsSuggestions("unbekannt", c), false);
  });
});

describe("ähnliche Namen (similarNames)", () => {
  it("gleich, Gross/klein, Umlaute, einfache Mehrzahl", () => {
    for (const [a, b] of [["Teller", "teller"], ["Tasse", "Tassen"], ["Müesli", "Muesli"], ["Glas", "Gläser"], ["Kerze", "Kerzen"], ["Topf", "Topfs"]]) {
      assert.equal(similarNames(a, b), true, `${a} ~ ${b}`);
    }
  });
  it("verschiedene oder zu kurze Namen", () => {
    for (const [a, b] of [["Messer", "Messerset"], ["Ei", "Eis"], ["Tee", "Teller"], ["", "Teller"], ["Teller", null]]) {
      assert.equal(similarNames(a, b), false, `${a} !~ ${b}`);
    }
  });
});

describe("Vorschläge (suggestTarget)", () => {
  const c = house();
  const items = [
    { name: "Pflaster", containerId: "spiegel" },
    { name: "Hammer", containerId: "werkzeugbox" }, // Box → zählt nicht
    { name: "Teller", containerId: "kiste-1" }, // Umzugskiste → zählt nicht
    { name: "Tassen", containerId: "kueche" },
    { name: "Schere", containerId: "schublade" },
    { name: "Schere", containerId: "bad" }, // zwei Orte → nicht eindeutig
    { name: "Kerzen", containerId: "keller" },
    { name: "Kerzen", containerId: "kiste-2" }, // eigener Behälter zählt nie
  ];

  it("(a) gleicher Name an festem Ort → dieser Behälter", () => {
    assert.deepEqual(sug("Pflaster", "kiste-2", c, items), { id: "spiegel", reason: "name" });
    assert.deepEqual(sug("pflaster", "kiste-2", c, items), { id: "spiegel", reason: "name" });
  });
  it("(a) ähnlicher Name (Mehrzahl) → dieser Behälter", () => {
    assert.deepEqual(sug("Tasse", "kiste-2", c, items), { id: "kueche", reason: "name" });
    assert.deepEqual(sug("Kerze", "kiste-2", c, items), { id: "keller", reason: "name" });
  });
  it("(a) nicht aus Boxen und Umzugskisten; dann Kategorie (b)", () => {
    assert.deepEqual(sug("Hammer", "kiste-2", c, items), { id: "keller", reason: "category" }, "Werkzeug → Keller");
    // Teller liegt nur in Kiste 1 (Umzugskiste) → Kategorie Besteck & Geschirr → Küche
    assert.deepEqual(sug("Teller", "kiste-2", c, items), { id: "kueche", reason: "category" });
  });
  it("(a) mehrdeutig → Kategorie oder nichts", () => {
    // Schere: Schublade und Bad → nicht eindeutig; Werkzeug → Keller
    assert.deepEqual(sug("Schere", "kiste-2", c, items), { id: "keller", reason: "category" });
  });
  it("(a) ohne geladene Artikel (null) → nur Kategorie", () => {
    assert.deepEqual(sug("Pflaster", "kiste-2", c, null), { id: "bad", reason: "category" }, "Gesundheit → Bad");
  });
  it("(b) Kategorien: Lebensmittel → Küche (oberster Treffer), Pflege → Bad", () => {
    assert.deepEqual(sug("Milch", "kiste-2", c), { id: "kueche", reason: "category" });
    assert.deepEqual(sug("Spaghetti", "kiste-2", c), { id: "kueche", reason: "category" });
    assert.deepEqual(sug("Zahnbürste", "kiste-2", c), { id: "bad", reason: "category" });
    assert.deepEqual(sug("Shampoo", "kiste-2", c), { id: "bad", reason: "category" });
    assert.deepEqual(sug("Ibuprofen", "kiste-2", c), { id: "bad", reason: "category" });
  });
  it("(b) kein passender Raum oder keine Kategorie → kein Vorschlag", () => {
    assert.equal(sug("Fotoalbum", "kiste-2", c), null, "Sonstiges");
    assert.equal(sug("Xyzzy", "kiste-2", c), null, "kein Icon");
    assert.equal(sug("Batterien", "kiste-2", c), null, "Batterien: bewusst ohne Vorschlag");
    assert.equal(sug("Putzmittel", "kiste-2", c), null, "kein Putzschrank vorhanden");
    assert.equal(sug("T-Shirt", "kiste-2", c), null, "kein Kleiderschrank vorhanden");
  });
  it("(b) zwei gleich passende Räume → nicht eindeutig → kein Vorschlag", () => {
    const c2 = house({ alt: { name: "Alte Wohnung" }, kueche2: { name: "Küche (alt)", type: "raum", parent: "alt" } });
    assert.equal(sug("Milch", "kiste-2", c2), null);
  });
  it("(b) Boxen und Umzugskisten sind keine Ziele, auch wenn der Name passt", () => {
    const c2 = new Map(Object.entries({
      kiste: { name: "Kiste Küche", type: "box" },
      kbox: { name: "Küchenbox", type: "box" },
      kiste2: { name: "Kiste 2" },
    }));
    assert.equal(sug("Milch", "kiste2", c2), null);
  });
  it("(b) kurze Wörter nur am Wortanfang (bad ≠ Sandbad), lange auch im Wort", () => {
    const c2 = new Map(Object.entries({
      sandbad: { name: "Sandbad", type: "raum" },
      kiste: { name: "Kiste" },
    }));
    assert.equal(sug("Zahnbürste", "kiste", c2), null);
    const c3 = new Map(Object.entries({
      ks: { name: "Hauptvorrat", type: "schrank" },
      kiste: { name: "Kiste" },
    }));
    assert.deepEqual(sug("Reis", "kiste", c3), { id: "ks", reason: "category" });
    const c4 = new Map(Object.entries({
      badz: { name: "Badezimmer oben", type: "raum" },
      kiste: { name: "Kiste" },
    }));
    assert.deepEqual(sug("Duschgel", "kiste", c4), { id: "badz", reason: "category" });
  });
  it("nie der eigene Behälter, nie ein Ort, an dem er schon liegt, nie etwas darin", () => {
    // Artikel liegt schon in der Küche → Vorschlag Küche wäre sinnlos
    assert.equal(sug("Milch", "schublade", c), null);
    const c2 = house({ fach: { name: "Fach", parent: "kiste-2" } });
    assert.deepEqual(sug("Pflaster", "kiste-2", c2, [{ name: "Pflaster", containerId: "fach" }]), { id: "bad", reason: "category" }, "Fach in der Kiste zählt nicht");
    assert.equal(sug("Milch", "unbekannt", c), null);
  });
  it("leere/komische Namen und Daten stürzen nicht ab", () => {
    assert.equal(sug("", "kiste-2", c, items), null);
    assert.equal(suggestTarget({ name: null, containerId: "kiste-2" }, c, [null, {}, { name: 3, containerId: "x" }]), null);
  });
  it("Vorschlag ist eine reine Berechnung (ändert keine Daten)", () => {
    const before = JSON.stringify([...c]);
    const list = JSON.stringify(items);
    sug("Pflaster", "kiste-2", c, items);
    assert.equal(JSON.stringify([...c]), before);
    assert.equal(JSON.stringify(items), list);
  });
  it("Kategorientabelle kennt nur echte Icons und Gruppen", () => {
    for (const cat of TARGET_CATEGORIES) {
      for (const id of cat.icons || []) assert.ok(ITEM_ICONS[id], id);
      for (const g of cat.groups || []) assert.ok(ICON_GROUPS.includes(g), g);
    }
  });
});

describe("Beispieldaten der Übung: Kisten mit Zielen und Vorschlägen", () => {
  const seed = practiceSeed(new Date(2026, 10, 7));
  const containers = new Map();
  const items = [];
  for (const [path, data] of Object.entries(seed)) {
    const s = path.split("/");
    if (s.length === 2) containers.set(s[1], data);
    else items.push({ ...data, containerId: s[1], id: s[3] });
  }
  const item = (cid, id) => items.find((i) => i.containerId === cid && i.id === id);
  it("Kiste 1 → Küche, Messerset → Schublade, Teller erben", () => {
    assert.deepEqual(containerTarget("kiste-1", containers), { id: "kueche", via: "kiste-1" });
    assert.deepEqual(itemTarget(item("kiste-1", "messerset"), "kiste-1", containers), { id: "schublade", kind: "own" });
    assert.equal(itemTarget(item("kiste-1", "teller"), "kiste-1", containers).kind, "inherited");
  });
  it("Kiste 2: Vorschläge Pflaster → Spiegelschrank, Zahnbürste → Bad, Hammer → Keller, Fotoalbum keiner", () => {
    assert.equal(needsSuggestions("kiste-2", containers), true);
    const s = (id) => sug(item("kiste-2", id).name, "kiste-2", containers, items, item("kiste-2", id).icon);
    assert.deepEqual(s("pflaster"), { id: "spiegelschrank", reason: "name" });
    assert.deepEqual(s("zahnbürste"), { id: "bad", reason: "category" });
    assert.deepEqual(s("hammer"), { id: "keller", reason: "category" });
    assert.equal(s("fotoalbum"), null);
  });
  it("normale Behälter der Übung brauchen keine Vorschläge (sehen aus wie bisher)", () => {
    for (const id of ["kueche", "kuehlschrank", "gemuesefach", "vorratsschrank", "keller", "werkzeugbox", "bad", "spiegelschrank", "schublade"]) {
      const own = items.filter((i) => i.containerId === id);
      assert.equal(needsSuggestions(id, containers, own), false, id);
      assert.ok(own.every((i) => !itemTarget(i, id, containers)), id);
    }
  });
});

describe("Verschieben-Dialog: gemeinsames Ziel (commonTarget)", () => {
  it("alle gleich → vorausgewählt; Vorschlag bleibt Vorschlag", () => {
    assert.deepEqual(commonTarget([{ id: "k", kind: "own" }, { id: "k", kind: "inherited" }]), { id: "k", kind: "own" });
    assert.deepEqual(commonTarget([{ id: "k", kind: "inherited" }]), { id: "k", kind: "inherited" });
    assert.deepEqual(commonTarget([{ id: "k", kind: "own" }, { id: "k", kind: "suggest" }]), { id: "k", kind: "suggest" });
  });
  it("verschieden, leer oder einer ohne Ziel → nichts vorausgewählt", () => {
    assert.equal(commonTarget([{ id: "k", kind: "own" }, { id: "b", kind: "own" }]), null);
    assert.equal(commonTarget([{ id: "k", kind: "own" }, null]), null);
    assert.equal(commonTarget([]), null);
  });
});

describe("Anzeige: gekürzter Pfad (shortPath)", () => {
  const c = house();
  it("höchstens die letzten zwei Teile", () => {
    assert.equal(shortPath("kueche", c), "Neue Wohnung › Küche");
    assert.equal(shortPath("schublade", c), "Küche › Schublade oben");
    assert.equal(shortPath("keller", c), "Keller");
    assert.equal(shortPath("schublade", c, 1), "Schublade oben");
    assert.equal(shortPath("weg", c), "weg");
  });
});

describe("Auspacken-Ansicht (groupByTarget / canGroupByTarget)", () => {
  const label = (id) => ({ kueche: "Küche", bad: "Bad", schublade: "Küche › Schublade" }[id] || "");
  const rows = [
    { id: "teller", info: { id: "kueche", kind: "inherited" } },
    { id: "messer", info: { id: "schublade", kind: "own" } },
    { id: "seife", info: { id: "bad", kind: "suggest" } },
    { id: "foto", info: null },
    { id: "tassen", info: { id: "kueche", kind: "own" } },
    { id: "salbe", info: { id: "bad", kind: "own" } },
  ];
  it("feste Ziele (alphabetisch), dann Vorschläge, zuletzt ohne Ziel", () => {
    const g = groupByTarget(rows, label);
    assert.deepEqual(g.map((x) => x.key), ["t:bad", "t:kueche", "t:schublade", "s:bad", "none"]);
    assert.deepEqual(g[1].rows.map((r) => r.id), ["teller", "tassen"], "Reihenfolge innerhalb bleibt");
    assert.equal(g[3].suggest, true);
    assert.equal(g[4].targetId, null);
  });
  it("nur anbieten, wenn mind. ein Ziel und mind. zwei Gruppen", () => {
    assert.equal(canGroupByTarget(rows), true);
    assert.equal(canGroupByTarget([{ id: "a", info: null }, { id: "b", info: null }]), false, "ohne Ziele wie bisher");
    assert.equal(canGroupByTarget([{ id: "a", info: { id: "k", kind: "inherited" } }, { id: "b", info: { id: "k", kind: "own" } }]), false, "alle gleich");
    assert.equal(canGroupByTarget([{ id: "a", info: { id: "k", kind: "own" } }, { id: "b", info: null }]), true);
    assert.equal(canGroupByTarget([]), false);
  });
});

describe("Nachbesserungen nach Review", () => {
  it("Werkzeugkiste/Bierkiste sind keine Umzugskisten (nur Wortanfang)", () => {
    const c = new Map(Object.entries({ w: { name: "Werkzeugkiste" }, b: { name: "Bierkiste" }, u: { name: "Umzugskiste 3" }, k: { name: "Karton Bücher" } }));
    assert.equal(inMovingBox("w", c), false);
    assert.equal(inMovingBox("b", c), false);
    assert.equal(inMovingBox("u", c), true);
    assert.equal(inMovingBox("k", c), true);
  });
  it("erreichte Artikel-Ziele lösen keine Vorschläge (und kein Laden) aus", () => {
    const c = house();
    assert.equal(needsSuggestions("schublade", c, [{ name: "Messer", target: "kueche" }]), false);
    assert.equal(needsSuggestions("schublade", c, [{ name: "Messer", target: "schublade" }]), false);
  });
  it("'Küche' passt nicht zu 'Kuchenform', aber zu 'Küchenschrank' und 'Kueche'", () => {
    const base = { kiste: { name: "Kiste" } };
    const c1 = new Map(Object.entries({ ...base, f: { name: "Kuchenform-Regal", type: "schrank" } }));
    assert.equal(sug("Milch", "kiste", c1), null);
    const c2 = new Map(Object.entries({ ...base, f: { name: "Küchenschrank", type: "schrank" } }));
    assert.deepEqual(sug("Milch", "kiste", c2), { id: "f", reason: "category" });
    const c3 = new Map(Object.entries({ ...base, f: { name: "KUECHE", type: "raum" } }));
    assert.deepEqual(sug("Milch", "kiste", c3), { id: "f", reason: "category" });
  });
  it("vorberechneter Schlüssel (key) liefert dasselbe Ergebnis", () => {
    const c = house();
    const items = [{ name: "Pflaster", containerId: "spiegel" }, { name: "Tassen", containerId: "kueche" }];
    const withKeys = items.map((it) => ({ ...it, key: nameKey(it.name) }));
    for (const n of ["Pflaster", "Tasse", "Hammer"]) assert.deepEqual(sug(n, "kiste-2", c, withKeys), sug(n, "kiste-2", c, items), n);
  });
});
