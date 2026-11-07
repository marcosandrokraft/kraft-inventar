import assert from "node:assert/strict";
import { ITEM_ICONS, ICON_GROUPS, LUCIDE_VERSION, TABLER_VERSION, TABLER_ICON_IDS } from "../../item-icons.js";
import {
  suggestIcon,
  isKnownIcon,
  iconForItem,
  searchIcons,
  FALLBACK_ICON,
  KEYWORD_ICON_IDS,
} from "../../icon-match.js";

const EXPECTED = {
  // Milch & Eier
  "Milch": "milk",
  "Vollmilch": "milk",
  "Hafermilch": "milk",
  "Kokosmilch": "milk",
  "Joghurt Nature": "milk",
  "Crème fraîche": "milk",
  "Sauerrahm": "milk",
  "Eier": "egg",
  "Ei": "egg",
  "Freiland-Eier": "egg",
  "Bio Eier 6 Stk": "egg",
  // Tabler-Icons (Käse, Brot, Baguette, Nudeln)
  "Raclettekäse": "cheese",
  "Frischkäse": "cheese",
  "Mozzarella": "cheese",
  "Margarine": "cuboid",
  "Tofu": "cuboid",
  "Weggli": "bread",
  "Toastbrot": "bread",
  "Knäckebrot": "bread",
  "Baguette": "baguette",
  "Laugenbrezel": "baguette",
  "Club Sandwich": "sandwich",
  "Wraps": "sandwich",
  "Hörnli": "bowl-chopsticks",
  "Älplermagronen": "bowl-chopsticks",
  "Ramen": "bowl-chopsticks",
  "Eiernudeln": "bowl-chopsticks",
  "Paniermehl": "wheat",
  "Risotto": "wheat",
  "Fleischkäse": "beef",
  "Gruyère": "cheese",
  "Bergkäse": "cheese",
  "Emmentaler": "cheese",
  "Butter": "cuboid",
  "Anke": "cuboid",
  // Brot & Getreide
  "Vollkornbrot": "bread",
  "Zopf": "bread",
  "Gipfeli": "croissant",
  "Croissant": "croissant",
  "Spaghetti": "bowl-chopsticks",
  "Penne": "bowl-chopsticks",
  "Nudeln": "bowl-chopsticks",
  "Teigwaren": "bowl-chopsticks",
  "Reis": "wheat",
  "Milchreis": "wheat",
  "Mehl": "wheat",
  // Vorrat & Kochen
  "Zucker": "cooking-pot",
  "Olivenöl": "cooking-pot",
  "Tomatensauce": "can",
  "Pizza": "pizza",
  "Pizza Margherita": "pizza",
  "Tiefkühlpizza": "pizza",
  "Backpapier": "utensils",
  // Getränke
  "Kaffee": "coffee",
  "Kaffeebohnen": "coffee",
  "Kaffeekapseln": "coffee",
  "Café Crème": "coffee",
  "Tee": "coffee",
  "Apfelsaft": "carton",
  "Bier": "beer",
  "Wein": "wine",
  "Rotwein": "wine",
  "Mineralwasser": "glass-water",
  "Cola": "cup-soda",
  "Limonade": "cup-soda",
  "Rivella 1.5l": "cup-soda",
  // Obst & Gemüse
  "Apfel": "apple",
  "Äpfel": "apple",
  "Bananen": "banana",
  "Preiselbeeren": "cherry",
  "Rüebli": "carrot",
  "Karotten": "carrot",
  "Kartoffeln": "carrot",
  "Zwiebeln": "carrot",
  "Salat": "salad",
  "Kopfsalat": "salad",
  "Tomaten": "salad",
  "Spinat": "leafy-green",
  "Bohnen": "bean",
  "Linsen": "bean",
  "Nüsse": "nut",
  "Haselnüsse": "nut",
  "Erdnüsse": "nut",
  // Fleisch & Fisch
  "Poulet": "drumstick",
  "Hähnchen": "drumstick",
  "Chicken Wings": "drumstick",
  "Rindfleisch": "beef",
  "Hackfleisch": "beef",
  "Schwein": "beef",
  "Schinken": "ham",
  "Speck": "bacon",
  "Lachs": "fish",
  "Thunfisch": "fish",
  "Crevetten": "shrimp",
  // Süsses
  "Glace": "ice-cream-cone",
  "Eis": "ice-cream-cone",
  "Erdbeereis": "ice-cream-cone",
  "Kekse": "cookie",
  "Guetzli": "cookie",
  "Schokolade": "candy",
  "Milchschokolade": "candy",
  // Haushalt & Pflege
  "Batterien": "battery",
  "AA-Batterie": "battery",
  "Glühbirne": "lightbulb",
  "Glühbirnen": "lightbulb",
  "LED-Lampe": "lightbulb",
  "Putzmittel": "spray-can",
  "Spray": "spray-can",
  "Seife": "soap-dispenser-droplet",
  "Spülmittel": "soap-dispenser-droplet",
  "Toilettenpapier": "toilet",
  "WC-Papier": "toilet",
  "Zahnpasta": "toothbrush",
  "Sonnencreme": "tube-lotion",
  "Kerzen": "flame",
  "Feuerzeug": "flame",
  "T-Shirt": "shirt",
  "Socken": "shirt",
  // Gesundheit
  "Pflaster": "bandage",
  "Aspirin": "pill",
  "Tabletten": "pill",
  "Hustensaft": "pill-bottle",
  // Werkzeug & Technik
  "Hammer": "hammer",
  "Schraubenzieher": "wrench",
  "Akkuschrauber": "drill",
  "Bohrmaschine": "drill",
  "Schere": "scissors",
  // Sonstiges
  "Geschenkpapier": "gift",
  "Buch": "book",
  "Bleistift": "pen",
  "Weihnachtskugeln": "tree-pine",
  // Schreibweise / Leerraum
  "  milch  ": "milk",
  "MILCH": "milk",
};

describe("item-icons.js", () => {
  it("hat Version und Gruppen", () => {
    assert.match(LUCIDE_VERSION, /^\d+\.\d+\.\d+$/);
    assert.ok(ICON_GROUPS.length >= 5);
    assert.equal(new Set(ICON_GROUPS).size, ICON_GROUPS.length);
  });

  it("Tabler-Icons (Käse, Brot, Baguette, Nudeln): Version, vorhanden, ohne unsichtbaren Rahmen", () => {
    assert.equal(TABLER_VERSION, "3.24.0");
    assert.deepEqual([...TABLER_ICON_IDS].sort(), ["baguette", "bowl-chopsticks", "bread", "cheese"]);
    for (const id of TABLER_ICON_IDS) {
      assert.ok(ITEM_ICONS[id], id);
      assert.ok(!ITEM_ICONS[id].paths.includes("M0 0h24v24H0z"), `${id}: Tabler-Rahmen übernommen`);
      assert.ok(!/stroke|fill/.test(ITEM_ICONS[id].paths), `${id}: Stil-Attribute übernommen`);
    }
  });

  it("enthält die Pflicht-IDs", () => {
    for (const id of [
      "milk", "egg", "carrot", "apple", "salad", "leafy-green", "wheat", "coffee", "cookie", "bean", "soup", "wine",
      "hammer", "wrench", "scissors", "battery", "lightbulb", "pill", "spray-can", "package", "beef", "fish",
      "croissant", "cup-soda",
    ]) {
      assert.ok(ITEM_ICONS[id], id);
    }
  });

  it("jedes Icon ist gültig und enthält nur Geometrie", () => {
    const ids = Object.keys(ITEM_ICONS);
    assert.ok(ids.length >= 70 && ids.length <= 90, String(ids.length));
    for (const [id, icon] of Object.entries(ITEM_ICONS)) {
      assert.match(id, /^[a-z0-9-]{1,40}$/);
      assert.equal(typeof icon.label, "string", id);
      assert.ok(icon.label.length > 0, id);
      assert.ok(ICON_GROUPS.includes(icon.group), `${id}: ${icon.group}`);
      assert.equal(typeof icon.paths, "string", id);
      assert.ok(icon.paths.length > 0, id);
      assert.doesNotMatch(icon.paths, /<script/i, id);
      assert.doesNotMatch(icon.paths, /\son\w*\s*=/i, id);
      assert.doesNotMatch(icon.paths, /href/i, id);
      assert.doesNotMatch(icon.paths, /style|class|<!--/i, id);
      // nur erlaubte Elemente, jedes selbstschliessend
      const rest = icon.paths.replace(/<(path|circle|rect|line|polyline|polygon|ellipse)( [a-z0-9]+="[0-9A-Za-z .,-]*")*\/>/g, "");
      assert.equal(rest, "", `${id}: ${rest.slice(0, 40)}`);
    }
  });

  it("jede Gruppe hat mindestens ein Icon", () => {
    const used = new Set(Object.values(ITEM_ICONS).map((i) => i.group));
    for (const g of ICON_GROUPS) assert.ok(used.has(g), g);
  });
});

describe("suggestIcon", () => {
  it(`ordnet mindestens 80 Namen richtig zu (${Object.keys(EXPECTED).length})`, () => {
    assert.ok(Object.keys(EXPECTED).length >= 80);
    for (const [name, id] of Object.entries(EXPECTED)) {
      assert.equal(suggestIcon(name), id, name);
    }
  });

  it("Kompositum: der Kopf am Ende zählt", () => {
    assert.notEqual(suggestIcon("Milchschokolade"), "milk");
    assert.notEqual(suggestIcon("Apfelsaft"), "apple");
    assert.notEqual(suggestIcon("Kaffeebohnen"), "bean");
    assert.notEqual(suggestIcon("Tiefkühlpizza"), "snowflake");
  });

  it("kurzes 'Ei' trifft nicht in fremden Wörtern", () => {
    for (const name of ["Bleistift", "Reis", "Seife", "Eisen", "Weihnachtskugeln", "Leim"]) {
      assert.notEqual(suggestIcon(name), "egg", name);
    }
  });

  it("Eis ist nicht Ei", () => {
    assert.equal(suggestIcon("Eis"), "ice-cream-cone");
    assert.equal(suggestIcon("Ei"), "egg");
  });

  it("ohne Treffer null", () => {
    for (const name of ["", "   ", null, undefined, "Xyzzy", "123", "500 g"]) {
      assert.equal(suggestIcon(name), null, String(name));
    }
  });

  it("liefert nur bekannte IDs", () => {
    for (const name of Object.keys(EXPECTED)) {
      assert.ok(isKnownIcon(suggestIcon(name)), name);
    }
  });
});

describe("isKnownIcon / iconForItem / FALLBACK_ICON", () => {
  it("isKnownIcon kennt nur IDs aus ITEM_ICONS", () => {
    assert.equal(isKnownIcon("milk"), true);
    assert.equal(isKnownIcon("package"), true);
    for (const id of ["", "Milk", "toString", "__proto__", "constructor", "<script>", null, undefined, 5, {}]) {
      assert.equal(isKnownIcon(id), false, String(id));
    }
  });

  it("FALLBACK_ICON ist bekannt", () => {
    assert.equal(FALLBACK_ICON, "package");
    assert.ok(isKnownIcon(FALLBACK_ICON));
  });

  it("gespeichertes bekanntes Icon gewinnt", () => {
    assert.equal(iconForItem({ name: "Milch", icon: "gift" }), "gift");
  });

  it("unbekanntes oder manipuliertes Icon wird ignoriert", () => {
    assert.equal(iconForItem({ name: "Milch", icon: "<script>" }), "milk");
    assert.equal(iconForItem({ name: "Milch", icon: "gibtsnicht" }), "milk");
    assert.equal(iconForItem({ name: "Xyzzy", icon: "__proto__" }), null);
  });

  it("ohne Icon: Vorschlag aus dem Namen, sonst null", () => {
    assert.equal(iconForItem({ name: "Bergkäse" }), "cheese");
    assert.equal(iconForItem({ name: "Xyzzy" }), null);
    assert.equal(iconForItem({}), null);
    assert.equal(iconForItem(null), null);
  });
});

describe("searchIcons", () => {
  it("leere Anfrage liefert alle in Reihenfolge", () => {
    assert.deepEqual(searchIcons(""), Object.keys(ITEM_ICONS));
    assert.deepEqual(searchIcons("  "), Object.keys(ITEM_ICONS));
    assert.deepEqual(searchIcons(null), Object.keys(ITEM_ICONS));
  });

  it("'kä' findet das Käse-Icon", () => {
    assert.ok(searchIcons("kä").includes("cheese"));
  });

  it("'werkzeug' findet Werkzeug-Icons, Vorschlag zuerst", () => {
    const r = searchIcons("werkzeug");
    assert.equal(r[0], "wrench");
    for (const id of ["toolbox", "hammer", "drill"]) assert.ok(r.includes(id), id);
  });

  it("Vorschlag für den Text steht vorne", () => {
    assert.equal(searchIcons("Bergkäse")[0], "cheese");
    assert.equal(searchIcons("Spaghetti")[0], "bowl-chopsticks");
    assert.equal(searchIcons("Milch")[0], "milk");
  });

  it("findet über die ID und liefert keine Duplikate", () => {
    assert.ok(searchIcons("spray-can").includes("spray-can"));
    const r = searchIcons("e");
    assert.equal(new Set(r).size, r.length);
  });

  it("kein Treffer: leeres Array", () => {
    assert.deepEqual(searchIcons("xyzzyq"), []);
  });
});

describe("Schlagwort-Tabelle", () => {
  it("alle Schlagwort-IDs existieren in ITEM_ICONS", () => {
    for (const id of KEYWORD_ICON_IDS) assert.ok(isKnownIcon(id), id);
  });
});
