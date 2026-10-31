// Läuft in der Testseite von csp-ocr.mjs (unter der CSP aus index.html).
// Zeichnet ein MHD-Etikett auf ein Canvas und liest es mit tesseract.js (dynamisch nachgeladen).
// Alle Pfade exakt versioniert auf cdn.jsdelivr.net – nichts von unversionierten URLs.
// Versionen/URLs stehen in ocr.js (tesseract.js 7.0.0, tesseract.js-core 7.0.0, eng 1.0.0 best_int).

window.__progress = [];
window.__result = null;

function drawLabel() {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 320;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.font = "bold 72px Arial, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText("MHD 12.03.27", 40, 50);
  ctx.fillText("EXP 03/2027", 40, 180);
  document.body.appendChild(canvas);
  return canvas;
}

// Benutzt genau das Modul der App (ocr.js) und die Datumserkennung aus lib.js.
async function main() {
  const canvas = drawLabel();
  const t0 = performance.now();
  const { recognizeText } = await import("../../ocr.js");
  const { parseDatesFromText } = await import("../../lib.js");
  const text = await recognizeText(canvas, (p) => window.__progress.push(`recognizing ${Math.round(p * 100)}%`));
  const t1 = performance.now();
  return { ok: true, text, dates: parseDatesFromText(text, new Date(2026, 9, 31)), ms: { total: Math.round(t1 - t0) } };
}

main()
  .then((r) => { window.__result = r; })
  .catch((err) => { window.__result = { ok: false, error: String(err && (err.stack || err.message) || err) }; });
