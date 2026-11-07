// Beispieldaten für den Übungsmodus – reine Logik ohne Browser-/Firebase-Abhängigkeiten.
// Wird von uebung-firebase.js benutzt und in tests/unit/uebung.test.mjs geprüft (npm test).
//
// Form wie die Datenschicht sie speichert: Pfad → Daten, Timestamps als { __ts: <ms> }.
// Die Behälter-IDs sind FEST (Tutorial und Tests verlassen sich darauf), Artikel-IDs = slugify(name).
// Alle Daten erfüllen validContainer()/validItem() aus firestore.rules (ausser dem Feld `icon`,
// das nur die Übung bzw. neuere App-Versionen kennen).

import { addToDate } from "./lib.js";

// Reihenfolge: Eltern vor Kindern.
export const PRACTICE_CONTAINER_IDS = [
  "kueche",
  "kuehlschrank",
  "gemuesefach",
  "vorratsschrank",
  "keller",
  "werkzeugbox",
  "bad",
  "spiegelschrank",
];

// Icons, die in den Beispieldaten vorkommen dürfen (gleiche Namen wie in der App).
export const PRACTICE_ICONS = [
  "milk", "egg", "carrot", "apple", "salad", "leafy-green", "wheat", "coffee", "cookie", "bean",
  "soup", "wine", "hammer", "wrench", "scissors", "battery", "lightbulb", "pill", "spray-can",
  "package", "beef", "fish", "croissant", "cup-soda",
];

const CONTAINERS = {
  kueche: { name: "Küche", type: "raum" },
  kuehlschrank: { name: "Kühlschrank", type: "schrank", parent: "kueche" },
  gemuesefach: { name: "Gemüsefach", type: "fach", parent: "kuehlschrank" },
  vorratsschrank: { name: "Vorratsschrank", type: "schrank", parent: "kueche" },
  keller: { name: "Keller", type: "raum" },
  werkzeugbox: { name: "Werkzeugbox", type: "box", parent: "keller" },
  bad: { name: "Bad", type: "raum" },
  spiegelschrank: { name: "Spiegelschrank", type: "schrank", parent: "bad" },
};

// mhd: Tage ab heute ({ days }) bzw. Monate ({ months }); fehlt → ohne MHD.
// Artikel ohne icon: Die App schlägt dann eines aus dem Namen vor.
const ITEMS = {
  kuehlschrank: [
    { id: "milch", name: "Milch", qty: 2, unit: "l", icon: "milk", mhd: { days: 2 } },
    { id: "eier", name: "Eier", qty: 6, unit: "Stk", icon: "egg", mhd: { days: 10 } },
    { id: "butter", name: "Butter", qty: 250, unit: "g" },
    { id: "joghurt", name: "Joghurt", qty: 4, unit: "Stk", mhd: { days: 0 } },
    { id: "greyerzer", name: "Greyerzer", qty: 300, unit: "g" },
    { id: "senf", name: "Senf", qty: 1, unit: "Glas" },
    { id: "hackfleisch", name: "Hackfleisch", qty: 500, unit: "g", icon: "beef", mhd: { days: -2 } },
  ],
  gemuesefach: [
    { id: "rüebli", name: "Rüebli", qty: 1, unit: "kg", icon: "carrot" },
    { id: "salat", name: "Salat", qty: 1, unit: "Stk", icon: "salad" },
    { id: "äpfel", name: "Äpfel", qty: 6, unit: "Stk" },
  ],
  vorratsschrank: [
    { id: "spaghetti", name: "Spaghetti", qty: 2, unit: "Packung" },
    { id: "reis", name: "Reis", qty: 1, unit: "kg", icon: "wheat" },
    { id: "mehl", name: "Mehl", qty: 2, unit: "kg" },
    { id: "kaffee", name: "Kaffee", qty: 500, unit: "g", icon: "coffee", mhd: { months: 2 } },
    { id: "bohnen", name: "Bohnen", qty: 3, unit: "Dose", icon: "bean" },
    { id: "guetzli", name: "Guetzli", qty: 1, unit: "Packung", icon: "cookie" },
  ],
  werkzeugbox: [
    { id: "hammer", name: "Hammer", qty: 1, unit: "Stk", icon: "hammer" },
    { id: "schraubenzieher", name: "Schraubenzieher", qty: 3, unit: "Stk" },
    { id: "schere", name: "Schere", qty: 1, unit: "Stk", icon: "scissors" },
    { id: "batterien-aa", name: "Batterien AA", qty: 8, unit: "Stk", icon: "battery" },
    { id: "glühbirne", name: "Glühbirne", qty: 2, unit: "Stk" },
  ],
  spiegelschrank: [
    { id: "pflaster", name: "Pflaster", qty: 1, unit: "Packung", icon: "package" },
    { id: "kopfwehtabletten", name: "Kopfwehtabletten", qty: 20, unit: "Stk", icon: "pill" },
  ],
};

// Frische Beispieldaten; MHD relativ zu `today` (lokales Datum).
export function practiceSeed(today = new Date()) {
  const base = today.getTime();
  const out = {};
  PRACTICE_CONTAINER_IDS.forEach((id, i) => {
    // Behälter "vor einer Woche" angelegt, in fester Reihenfolge.
    out[`containers/${id}`] = { ...CONTAINERS[id], createdAt: { __ts: base - 7 * 86400000 + i * 1000 } };
  });
  let n = 0;
  for (const [containerId, items] of Object.entries(ITEMS)) {
    for (const { id, mhd, ...item } of items) {
      const data = { ...item };
      if (mhd) data.mhd = addToDate(today, mhd);
      data.updatedAt = { __ts: base - 86400000 + n++ * 1000 };
      out[`containers/${containerId}/items/${id}`] = data;
    }
  }
  return out;
}
