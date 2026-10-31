import assert from "node:assert/strict";
import {
  slugify,
  isValidId,
  escapeHtml,
  isSafePhoto,
  parseQty,
  planAddItem,
  normalizeSearch,
  searchItems,
  containerIdFromScan,
  parseQrEntries,
  containerUrl,
  findObjectBounds,
  MAX_QTY,
} from "../../lib.js";

const APP = "https://example.github.io/kraft-inventar/index.html";

describe("slugify / isValidId", () => {
  it("erzeugt IDs wie bisher", () => {
    assert.equal(slugify("Kleiderschrank Marco"), "kleiderschrank-marco");
    assert.equal(slugify("  Kühlschrank  "), "kühlschrank");
    assert.equal(slugify("Fach 3 / oben!"), "fach-3-oben");
    assert.equal(slugify("Müsli & Nüsse"), "müsli-nüsse");
    assert.equal(slugify("!!!"), "");
  });

  it("jede Ausgabe von slugify (nicht leer) ist eine gültige ID", () => {
    for (const s of ["A", "Größe", "a--b", "-x-", "Box 12", "ÄÖÜ ß", "x".repeat(100)]) {
      const id = slugify(s);
      if (id) assert.ok(isValidId(id), `${s} → ${id}`);
    }
  });

  it("lehnt ungültige IDs ab", () => {
    for (const id of ["", "Gross", "mit leer", "-start", "ende-", "a--b", "a/b", "x".repeat(101), null, 5]) {
      assert.equal(isValidId(id), false, String(id));
    }
  });
});

describe("escapeHtml", () => {
  it("entschärft HTML-Sonderzeichen", () => {
    assert.equal(escapeHtml(`<img src=x onerror="alert(1)">'&`), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;&amp;");
  });
  it("kommt mit null/Zahlen klar", () => {
    assert.equal(escapeHtml(null), "");
    assert.equal(escapeHtml(5), "5");
  });
});

describe("isSafePhoto", () => {
  it("akzeptiert JPEG-data-URLs", () => {
    assert.ok(isSafePhoto("data:image/jpeg;base64,/9j/4AAQSkZJRg=="));
  });
  it("lehnt alles andere ab", () => {
    for (const p of [
      "",
      null,
      "javascript:alert(1)",
      "data:image/svg+xml;base64,PHN2Zz4=",
      'data:image/jpeg;base64,AAAA" onerror="alert(1)',
      "https://evil.example.com/x.jpg",
    ]) {
      assert.equal(isSafePhoto(p), false, String(p));
    }
  });
});

describe("parseQty", () => {
  it("rundet und begrenzt", () => {
    assert.equal(parseQty("3"), 3);
    assert.equal(parseQty("2.6"), 3);
    assert.equal(parseQty("0"), 1);
    assert.equal(parseQty("-4"), 1);
    assert.equal(parseQty("abc"), 1);
    assert.equal(parseQty(""), 1);
    assert.equal(parseQty("1e9"), MAX_QTY);
  });
});

describe("planAddItem (gleichen Artikel nochmals hinzufügen)", () => {
  it("neuer Artikel → anlegen", () => {
    assert.deepEqual(planAddItem(undefined, { qty: 2, unit: "Stk" }), { action: "create", newQty: 2 });
  });
  it("gleiche Einheit → Menge addieren", () => {
    assert.deepEqual(planAddItem({ qty: 3, unit: "Stk" }, { qty: 2, unit: "Stk" }), {
      action: "add", oldQty: 3, delta: 2, newQty: 5,
    });
  });
  it("fehlende Einheit gilt als Stk", () => {
    assert.equal(planAddItem({ qty: 1 }, { qty: 1, unit: "Stk" }).action, "add");
  });
  it("andere Einheit → nachfragen", () => {
    assert.deepEqual(planAddItem({ qty: 500, unit: "g" }, { qty: 1, unit: "Packung" }), {
      action: "conflict", oldQty: 500, oldUnit: "g", newQty: 1,
    });
  });
  it("deckelt bei der Höchstmenge", () => {
    const plan = planAddItem({ qty: MAX_QTY - 1, unit: "g" }, { qty: 10, unit: "g" });
    assert.equal(plan.newQty, MAX_QTY);
    assert.equal(plan.delta, 1);
  });
});

describe("Suche", () => {
  it("normalisiert Umlaute und Gross/klein", () => {
    assert.equal(normalizeSearch("Müsli"), normalizeSearch("muesli"));
    assert.equal(normalizeSearch("MÜSLI"), normalizeSearch("musli"));
    assert.equal(normalizeSearch("Straße"), normalizeSearch("strasse"));
    assert.equal(normalizeSearch("Crème  brûlée "), "creme brulee");
  });

  const items = [
    { name: "Milch", containerName: "Kühlschrank" },
    { name: "Hafermilch", containerName: "Vorratsschrank" },
    { name: "Bohrmaschine", containerName: "Keller Box 3" },
    { name: "Müsli", containerName: "Vorratsschrank" },
  ];

  it("findet Teilwörter, Treffer am Anfang zuerst", () => {
    assert.deepEqual(searchItems(items, "milch").map((i) => i.name), ["Milch", "Hafermilch"]);
  });
  it("findet über den Behälternamen", () => {
    assert.deepEqual(searchItems(items, "keller").map((i) => i.name), ["Bohrmaschine"]);
  });
  it("mehrere Wörter müssen alle passen", () => {
    assert.deepEqual(searchItems(items, "milch vorrat").map((i) => i.name), ["Hafermilch"]);
  });
  it("Umlaut-tolerant", () => {
    assert.deepEqual(searchItems(items, "muesli").map((i) => i.name), ["Müsli"]);
  });
  it("leere Suche → nichts", () => {
    assert.deepEqual(searchItems(items, "   "), []);
  });
  it("respektiert das Limit", () => {
    assert.equal(searchItems(items, "a", 1).length, 1);
  });
});

describe("containerIdFromScan", () => {
  it("liest ?c= aus App-Links", () => {
    assert.equal(containerIdFromScan(`${APP}?c=k%C3%BChlschrank`, APP), "kühlschrank");
    assert.equal(containerIdFromScan(`${APP}?c=box-3&n=Box%203`, APP), "box-3");
  });
  it("ignoriert fremde Links und Unsinn", () => {
    assert.equal(containerIdFromScan("https://evil.example.com/index.html?c=box", APP), null);
    assert.equal(containerIdFromScan("kein link", APP), null);
    assert.equal(containerIdFromScan(`${APP}`, APP), null);
    assert.equal(containerIdFromScan(`${APP}?c=Box%2F..`, APP), null);
  });
});

describe("QR-Druckbogen", () => {
  it("parseQrEntries: Leerzeilen weg, Duplikate zusammengefasst", () => {
    assert.deepEqual(parseQrEntries("Kühlschrank\n\n  Gefrierfach \nkühlschrank\n!!!"), [
      { id: "kühlschrank", name: "Kühlschrank" },
      { id: "gefrierfach", name: "Gefrierfach" },
    ]);
  });
  it("containerUrl: mit Name, ohne Name, gleiche Seite", () => {
    assert.equal(
      containerUrl("https://example.github.io/kraft-inventar/qr.html", "box-3", "Box 3"),
      "https://example.github.io/kraft-inventar/index.html?c=box-3&n=Box%203"
    );
    assert.equal(
      containerUrl("https://example.github.io/kraft-inventar/qr.html", "box", "box"),
      "https://example.github.io/kraft-inventar/index.html?c=box"
    );
  });
  it("QR-Link wird vom Scanner wieder erkannt (Rundlauf)", () => {
    const url = containerUrl(APP, "kühlschrank", "Kühlschrank");
    assert.equal(containerIdFromScan(url, APP), "kühlschrank");
  });
});

describe("findObjectBounds (Zuschnitt nach Freistellung)", () => {
  function image(w, h, rects) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (const [x0, y0, x1, y1, a = 255] of rects) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) data[(y * w + x) * 4 + 3] = a;
    }
    return data;
  }

  it("findet ein einzelnes Objekt", () => {
    const b = findObjectBounds(image(100, 100, [[20, 30, 59, 79]]), 100, 100);
    assert.ok(b.minX <= 20 && b.minY <= 30 && b.maxX >= 59 && b.maxY >= 79, JSON.stringify(b));
    assert.ok(b.minX >= 18 && b.minY >= 28 && b.maxX <= 61 && b.maxY <= 81, JSON.stringify(b));
  });

  it("ignoriert kleine Schlieren", () => {
    const b = findObjectBounds(image(100, 100, [[40, 40, 79, 79], [2, 2, 3, 3]]), 100, 100);
    assert.ok(b.minX >= 38, JSON.stringify(b));
  });

  it("entfernt fast durchsichtige Pixel", () => {
    const data = image(50, 50, [[10, 10, 30, 30], [0, 0, 49, 0, 50]]);
    findObjectBounds(data, 50, 50);
    assert.equal(data[3], 0);
  });

  it("wirft, wenn nichts da ist", () => {
    assert.throws(() => findObjectBounds(image(20, 20, []), 20, 20), /Kein Objekt/);
  });
});
