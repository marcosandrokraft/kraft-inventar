// QR-Code-Druckbogen. Die Codes werden lokal erzeugt (vendor/qrcode-generator, MIT-Lizenz) –
// früher wurde dafür jeder Behälter-Link an api.qrserver.com geschickt.
import { parseQrEntries, containerUrl } from "./lib.js";

const form = document.getElementById("gen-form");
const grid = document.getElementById("grid");
const printBtn = document.getElementById("print-btn");
// Name → vorgegebene ID (aus der App übergeben), sonst wird die ID aus dem Namen erzeugt.
const fixedIds = new Map();

function qrSvg(text) {
  const qr = window.qrcode(0, "M"); // Typ automatisch, mittlere Fehlerkorrektur
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}

function render() {
  const entries = parseQrEntries(form.names.value);
  document.documentElement.style.setProperty("--qr-print", form.size.value);
  grid.innerHTML = "";
  for (const entry of entries) {
    const name = entry.name;
    const id = fixedIds.get(name) || entry.id; // umbenannte Behälter behalten ihre alte ID
    const url = containerUrl(location.href, id, name);
    const card = document.createElement("div");
    card.className = "qr-card";
    card.innerHTML = qrSvg(url); // SVG vom Generator, enthält nur Pfade
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = name;
    const small = document.createElement("div");
    small.className = "url";
    small.textContent = url;
    card.append(label, small);
    grid.appendChild(card);
  }
  printBtn.hidden = !entries.length;
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  render();
});
form.size.addEventListener("change", () => {
  document.documentElement.style.setProperty("--qr-print", form.size.value);
});
printBtn.addEventListener("click", () => window.print());

// Aus der App aufgerufen (qr.html?c=id1&n=Name1&c=id2&n=Name2…) → Liste vorausfüllen.
const params = new URLSearchParams(location.search);
const ids = params.getAll("c");
const names = [];
params.getAll("n").forEach((n, i) => {
  const name = n.trim();
  if (!name) return;
  names.push(name);
  if (ids[i]) fixedIds.set(name, ids[i]);
});
if (names.length) {
  form.names.value = names.join("\n");
  render();
}
