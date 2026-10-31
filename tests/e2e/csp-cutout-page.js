// Läuft in der Testseite von csp-cutout.mjs (unter der CSP aus index.html).
// Freistellung eines erzeugten Bildes (roter Kreis auf Weiss) mit der echten Bibliothek.
const URL_LIB = "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm";

window.__progress = [];
window.__result = null;

async function main() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = "#d00";
  ctx.beginPath();
  ctx.arc(128, 128, 70, 0, Math.PI * 2);
  ctx.fill();
  const input = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));

  const { removeBackground } = await import(URL_LIB);
  const out = await removeBackground(input, {
    model: "isnet_quint8",
    output: { format: "image/png" },
    // Achtung: Die Bibliothek prüft (zod), dass der Callback undefined zurückgibt – sonst ZodError.
    progress: (key, cur, total) => { window.__progress.push(`${key} ${cur}/${total}`); },
  });

  const url = URL.createObjectURL(out);
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = url;
  });
  const c2 = document.createElement("canvas");
  c2.width = img.width;
  c2.height = img.height;
  const x = c2.getContext("2d");
  x.drawImage(img, 0, 0);
  const alphaAt = (px, py) => x.getImageData(Math.round(px * img.width), Math.round(py * img.height), 1, 1).data[3];
  return { ok: true, type: out.type, size: out.size, width: img.width, height: img.height, alphaCorner: alphaAt(0.02, 0.02), alphaCenter: alphaAt(0.5, 0.5) };
}

main()
  .then((r) => { window.__result = r; })
  .catch((err) => { window.__result = { ok: false, error: String(err && (err.stack || err.message) || err) }; });
