// QR-Druckbogen: zeigt für jeden Behälter seinen QR-Code, angehakte werden gedruckt. Die Liste kommt
// aus der App (qr.html?c=…&n=…&p=…&sel=…, siehe qrPageQuery in lib.js) – eigene Namen eintippen geht
// bewusst nicht mehr, Behälter entstehen nur in der App. Die Codes werden lokal erzeugt
// (vendor/qrcode-generator, MIT-Lizenz) – früher ging jeder Behälter-Link an api.qrserver.com.
import { parseQrPage, containerUrl, normalizeSearch } from "./lib.js";

const grid = document.getElementById("grid");
const toolbar = document.getElementById("toolbar");
const filter = document.getElementById("filter");
const size = document.getElementById("size");
const count = document.getElementById("count");
const printBtn = document.getElementById("print-btn");

function qrSvg(text) {
  const qr = window.qrcode(0, "M"); // Typ automatisch, mittlere Fehlerkorrektur
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}

function cards() {
  return [...grid.querySelectorAll(".qr-card")];
}

function updateCount() {
  const n = cards().filter((c) => c.classList.contains("selected")).length;
  count.textContent = n;
  printBtn.disabled = n === 0;
}

function setSelected(card, on) {
  card.classList.toggle("selected", on);
  card.querySelector("input").checked = on;
}

const { entries, selected } = parseQrPage(location.search);
if (!entries.length) {
  document.getElementById("empty").hidden = false;
} else {
  toolbar.hidden = false;
  for (const { id, name, where } of entries) {
    const url = containerUrl(location.href, id, name);
    const card = document.createElement("label");
    card.className = "qr-card";
    card.dataset.id = id;
    card.dataset.search = normalizeSearch(`${name} ${where}`);
    const box = document.createElement("input");
    box.type = "checkbox";
    box.setAttribute("aria-label", `${name} drucken`);
    box.addEventListener("change", () => { setSelected(card, box.checked); updateCount(); });
    const svg = document.createElement("div");
    svg.innerHTML = qrSvg(url); // SVG vom Generator, enthält nur Pfade
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = name;
    card.append(box, svg, label);
    if (where) {
      const w = document.createElement("div");
      w.className = "where";
      w.textContent = where;
      card.append(w);
    }
    const small = document.createElement("div");
    small.className = "url";
    small.textContent = url;
    card.append(small);
    grid.appendChild(card);
    setSelected(card, !selected || selected.has(id));
  }
  updateCount();
  // Aus einem Behälter geöffnet → dorthin scrollen.
  if (selected?.size === 1) grid.querySelector(".qr-card.selected")?.scrollIntoView({ block: "center" });
}

// "Alle"/"Keine" wirken nur auf die sichtbaren (gefilterten) Behälter.
function visibleCards() {
  return cards().filter((c) => !c.hidden);
}
document.getElementById("sel-all").addEventListener("click", () => { visibleCards().forEach((c) => setSelected(c, true)); updateCount(); });
document.getElementById("sel-none").addEventListener("click", () => { visibleCards().forEach((c) => setSelected(c, false)); updateCount(); });
filter.addEventListener("input", () => {
  const q = normalizeSearch(filter.value.trim());
  for (const c of cards()) c.hidden = !!q && !c.dataset.search.includes(q);
});

function applySize() {
  document.documentElement.style.setProperty("--qr-print", size.value);
}
size.addEventListener("change", applySize);
applySize();
printBtn.addEventListener("click", () => window.print());
