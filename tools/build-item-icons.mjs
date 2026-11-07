// Erzeugt item-icons.js aus entpackten Paketen von lucide-static (Hauptquelle, ISC) und
// @tabler/icons (nur einzelne Icons, die Lucide nicht hat – MIT, gleicher Strichstil).
//
//   npm pack lucide-static@<version>; npm pack @tabler/icons@<version>   (in leeren Temp-Ordnern)
//   tar xzf <paket>.tgz                    (ergibt jeweils den Ordner "package")
//   node tools/build-item-icons.mjs <lucide-package> <tabler-package>
//
// Tabler-Icons beginnen mit einem unsichtbaren Rahmen <path stroke="none" d="M0 0h24v24H0z" fill="none"/>;
// genau dieser wird verworfen, danach gilt dieselbe strenge Prüfung wie bei Lucide.
//
// Übernommen wird nur die Geometrie (path/circle/rect/line/polyline/polygon/ellipse mit
// ihren Geometrie-Attributen). Alles andere (Kommentare, class, stroke, <g>, …) wird
// verworfen bzw. führt zum Abbruch, damit nichts Unerwartetes in die App gelangt.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Reihenfolge = Reihenfolge im Auswahl-Raster. [ID, deutsche Bezeichnung, Gruppe, Quelle?]
// Quelle fehlt = Lucide; "tabler" = icons/outline/<id>.svg aus @tabler/icons.
const GROUPS = [
  "Milch & Eier",
  "Fleisch & Fisch",
  "Obst & Gemüse",
  "Brot & Getreide",
  "Vorrat & Kochen",
  "Süsses & Snacks",
  "Getränke",
  "Haushalt & Pflege",
  "Gesundheit",
  "Werkzeug & Technik",
  "Sonstiges",
];

const ICONS = [
  ["milk", "Milch", "Milch & Eier"],
  ["cheese", "Käse", "Milch & Eier", "tabler"],
  ["cuboid", "Butter & Tofu", "Milch & Eier"],
  ["egg", "Eier", "Milch & Eier"],

  ["beef", "Fleisch", "Fleisch & Fisch"],
  ["ham", "Wurst & Schinken", "Fleisch & Fisch"],
  ["bacon", "Speck", "Fleisch & Fisch"],
  ["drumstick", "Poulet", "Fleisch & Fisch"],
  ["fish", "Fisch", "Fleisch & Fisch"],
  ["shrimp", "Crevetten", "Fleisch & Fisch"],

  ["apple", "Apfel & Birne", "Obst & Gemüse"],
  ["banana", "Banane", "Obst & Gemüse"],
  ["cherry", "Kirschen & Beeren", "Obst & Gemüse"],
  ["citrus", "Zitrusfrüchte", "Obst & Gemüse"],
  ["grape", "Trauben", "Obst & Gemüse"],
  ["avocado", "Avocado", "Obst & Gemüse"],
  ["carrot", "Rüebli & Knollen", "Obst & Gemüse"],
  ["broccoli", "Brokkoli & Kohl", "Obst & Gemüse"],
  ["salad", "Salat & Tomaten", "Obst & Gemüse"],
  ["leafy-green", "Spinat & Kräuter", "Obst & Gemüse"],
  ["bean", "Bohnen & Linsen", "Obst & Gemüse"],
  ["nut", "Nüsse", "Obst & Gemüse"],

  ["bread", "Brot", "Brot & Getreide", "tabler"],
  ["baguette", "Baguette", "Brot & Getreide", "tabler"],
  ["sandwich", "Sandwich", "Brot & Getreide"],
  ["croissant", "Gipfeli & Gebäck", "Brot & Getreide"],
  ["bowl-chopsticks", "Nudeln & Teigwaren", "Brot & Getreide", "tabler"],
  ["wheat", "Mehl, Reis & Getreide", "Brot & Getreide"],

  ["soup", "Suppe & Bouillon", "Vorrat & Kochen"],
  ["cooking-pot", "Gewürze, Öl & Zutaten", "Vorrat & Kochen"],
  ["can", "Konserven & Saucen", "Vorrat & Kochen"],
  ["pizza", "Pizza", "Vorrat & Kochen"],
  ["snowflake", "Tiefkühl", "Vorrat & Kochen"],
  ["utensils", "Besteck & Geschirr", "Vorrat & Kochen"],

  ["cookie", "Guetzli", "Süsses & Snacks"],
  ["cake", "Kuchen & Torte", "Süsses & Snacks"],
  ["cake-slice", "Dessert", "Süsses & Snacks"],
  ["candy", "Schokolade & Süssigkeiten", "Süsses & Snacks"],
  ["lollipop", "Lutscher", "Süsses & Snacks"],
  ["candy-cane", "Zuckerstange", "Süsses & Snacks"],
  ["ice-cream-cone", "Glace", "Süsses & Snacks"],
  ["popcorn", "Chips & Snacks", "Süsses & Snacks"],

  ["coffee", "Kaffee & Tee", "Getränke"],
  ["cup-soda", "Süssgetränke", "Getränke"],
  ["glass-water", "Mineralwasser", "Getränke"],
  ["carton", "Saft", "Getränke"],
  ["beer", "Bier", "Getränke"],
  ["wine", "Wein & Spirituosen", "Getränke"],

  ["spray-can", "Putzmittel & Spray", "Haushalt & Pflege"],
  ["soap-dispenser-droplet", "Seife & Shampoo", "Haushalt & Pflege"],
  ["washing-machine", "Waschmittel", "Haushalt & Pflege"],
  ["broom", "Besen & Staubsauger", "Haushalt & Pflege"],
  ["toilet", "Toilettenpapier", "Haushalt & Pflege"],
  ["toothbrush", "Zahnpflege", "Haushalt & Pflege"],
  ["tube-lotion", "Creme & Lotion", "Haushalt & Pflege"],
  ["trash", "Abfallsäcke", "Haushalt & Pflege"],
  ["lightbulb", "Glühbirne & Lampe", "Haushalt & Pflege"],
  ["battery", "Batterien", "Haushalt & Pflege"],
  ["flame", "Kerzen & Feuerzeug", "Haushalt & Pflege"],
  ["shirt", "Kleidung", "Haushalt & Pflege"],

  ["pill", "Tabletten", "Gesundheit"],
  ["pill-bottle", "Medizin & Vitamine", "Gesundheit"],
  ["bandage", "Pflaster & Verband", "Gesundheit"],
  ["thermometer", "Thermometer", "Gesundheit"],

  ["hammer", "Hammer", "Werkzeug & Technik"],
  ["wrench", "Werkzeug", "Werkzeug & Technik"],
  ["screw", "Schrauben & Nägel", "Werkzeug & Technik"],
  ["drill", "Bohrmaschine", "Werkzeug & Technik"],
  ["toolbox", "Werkzeugkasten", "Werkzeug & Technik"],
  ["scissors", "Schere", "Werkzeug & Technik"],
  ["ruler", "Massband & Lineal", "Werkzeug & Technik"],
  ["paintbrush", "Pinsel", "Werkzeug & Technik"],
  ["paint-bucket", "Farbe & Lack", "Werkzeug & Technik"],
  ["plug", "Stecker & Kabel", "Werkzeug & Technik"],
  ["flashlight", "Taschenlampe", "Werkzeug & Technik"],
  ["smartphone", "Handy", "Werkzeug & Technik"],
  ["headphones", "Kopfhörer", "Werkzeug & Technik"],

  ["package", "Paket", "Sonstiges"],
  ["box", "Kiste & Schachtel", "Sonstiges"],
  ["gift", "Geschenk", "Sonstiges"],
  ["party-popper", "Party & Deko", "Sonstiges"],
  ["tree-pine", "Weihnachten", "Sonstiges"],
  ["flower", "Blumen & Pflanzen", "Sonstiges"],
  ["book", "Buch", "Sonstiges"],
  ["pen", "Stifte & Büro", "Sonstiges"],
  ["shopping-bag", "Tasche", "Sonstiges"],
  ["bone", "Tierfutter", "Sonstiges"],
  ["baby", "Baby", "Sonstiges"],
  ["gamepad-2", "Spiele", "Sonstiges"],
];

const GEOMETRY = {
  path: ["d"],
  circle: ["cx", "cy", "r"],
  ellipse: ["cx", "cy", "rx", "ry"],
  rect: ["x", "y", "width", "height", "rx", "ry"],
  line: ["x1", "y1", "x2", "y2"],
  polyline: ["points"],
  polygon: ["points"],
};
const SAFE_VALUE = /^[0-9A-Za-z .,\-]*$/;

const TABLER_FRAME = /<path stroke="none" d="M0 0h24v24H0z" fill="none"\s*\/>/;

function extractGeometry(svgText, id, source) {
  let text = svgText.replace(/<!--[\s\S]*?-->/g, "");
  if (source === "tabler") {
    if (!TABLER_FRAME.test(text)) throw new Error(`${id}: Tabler-Rahmen nicht gefunden`);
    text = text.replace(TABLER_FRAME, "");
  }
  const open = text.match(/<svg\b[^>]*>/);
  const close = text.lastIndexOf("</svg>");
  if (!open || close < 0) throw new Error(`${id}: kein <svg> gefunden`);
  const inner = text.slice(open.index + open[0].length, close);
  const out = [];
  const tagRe = /<\s*([a-zA-Z][\w-]*)\b([^>]*?)\/?\s*>/g;
  let m;
  let rest = inner;
  while ((m = tagRe.exec(inner))) {
    const tag = m[1].toLowerCase();
    const allowed = GEOMETRY[tag];
    if (!allowed) throw new Error(`${id}: unerwartetes Element <${tag}>`);
    const attrs = {};
    for (const a of m[2].matchAll(/([a-zA-Z][\w:-]*)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
    let el = `<${tag}`;
    for (const name of allowed) {
      if (!(name in attrs)) continue;
      const v = attrs[name].replace(/\s+/g, " ").trim();
      if (!SAFE_VALUE.test(v)) throw new Error(`${id}: unerwarteter Wert in ${name}`);
      el += ` ${name}="${v}"`;
    }
    out.push(el + "/>");
    rest = rest.replace(m[0], "");
  }
  if (rest.trim()) throw new Error(`${id}: unerwarteter Inhalt im <svg>`);
  if (!out.length) throw new Error(`${id}: keine Geometrie`);
  return out.join("");
}

const [pkgDir, tablerDir] = process.argv.slice(2);
if (!pkgDir || !tablerDir) {
  console.error("Aufruf: node tools/build-item-icons.mjs <lucide-static-package> <tabler-icons-package>");
  process.exit(1);
}
function packageVersion(dir, name) {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  if (pkg.name !== name) throw new Error(`Falsches Paket: ${pkg.name} (erwartet ${name})`);
  const v = String(pkg.version);
  if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error(`Unerwartete Version: ${v}`);
  return v;
}
const version = packageVersion(pkgDir, "lucide-static");
const tablerVersion = packageVersion(tablerDir, "@tabler/icons");

const seen = new Set();
const lines = [];
for (const [id, label, group, source] of ICONS) {
  if (!/^[a-z0-9-]{1,40}$/.test(id)) throw new Error(`Ungültige ID: ${id}`);
  if (seen.has(id)) throw new Error(`Doppelte ID: ${id}`);
  if (!GROUPS.includes(group)) throw new Error(`${id}: unbekannte Gruppe ${group}`);
  seen.add(id);
  if (source && source !== "tabler") throw new Error(`${id}: unbekannte Quelle ${source}`);
  const file = source === "tabler" ? join(tablerDir, "icons", "outline", `${id}.svg`) : join(pkgDir, "icons", `${id}.svg`);
  const paths = extractGeometry(readFileSync(file, "utf8"), id, source);
  lines.push(`  ${JSON.stringify(id)}: { label: ${JSON.stringify(label)}, group: ${JSON.stringify(group)}, paths: '${paths}' },`);
}

const tablerIds = ICONS.filter((i) => i[3] === "tabler").map((i) => i[0]);
const out = `// Erzeugt von tools/build-item-icons.mjs aus lucide-static@${version} (Lucide, ISC-Lizenz, siehe vendor/lucide/LICENSE)
// und für ${tablerIds.join(", ")} aus @tabler/icons@${tablerVersion} (MIT-Lizenz, siehe vendor/tabler/LICENSE). Nicht von Hand ändern.
// Jedes Icon: viewBox 0 0 24 24, Strich (stroke) statt Füllung; paths enthält nur Geometrie-Elemente.

export const LUCIDE_VERSION = ${JSON.stringify(version)};
export const TABLER_VERSION = ${JSON.stringify(tablerVersion)};
export const TABLER_ICON_IDS = ${JSON.stringify(tablerIds)};

export const ICON_GROUPS = ${JSON.stringify(GROUPS)};

export const ITEM_ICONS = {
${lines.join("\n")}
};
`;

const target = resolve(dirname(fileURLToPath(import.meta.url)), "..", "item-icons.js");
writeFileSync(target, out, "utf8");
console.log(`${ICONS.length} Icons (lucide-static@${version}, davon ${tablerIds.length} aus @tabler/icons@${tablerVersion}) nach ${target} geschrieben.`);
