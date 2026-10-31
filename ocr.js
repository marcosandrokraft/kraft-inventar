// EXPERIMENT: Texterkennung (OCR) für das MHD-Datum auf Packungen.
// Wird von app.js erst beim Klick auf "Datum mit Kamera lesen" geladen (nie beim Start).
// tesseract.js läuft komplett im Browser (kein Server, kein API-Key). Beim ersten Mal werden
// ca. 4 MB von cdn.jsdelivr.net geladen (Bibliothek, WebAssembly-Kern, englische Sprachdaten für
// Ziffern); die Sprachdaten speichert tesseract danach im Browser (IndexedDB).
// Alle URLs mit exakter Version, damit nichts Unerwartetes nachgeladen wird. Getestet unter der
// Content-Security-Policy aus index.html: tests/e2e/csp-ocr.mjs (npm run test:e2e:ocr).
// Erkennung ist unzuverlässig (Prägedruck, Spiegelungen, gewölbte Dosen) – das Ergebnis ist nur ein
// Vorschlag, den die Person bestätigen muss.

const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js";
const WORKER_PATH = "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js";
const CORE_PATH = "https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0";
const LANG_PATH = "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int";

// Graustufen + Kontrast: hilft bei farbigen Etiketten.
function preprocess(source) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = Math.max(0, Math.min(255, (g - 128) * 1.4 + 128));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// canvas → erkannter Text. onProgress(0…1) optional.
export async function recognizeText(canvas, onProgress = () => {}) {
  const { default: Tesseract } = await import(TESSERACT_URL);
  const worker = await Tesseract.createWorker("eng", Tesseract.OEM.LSTM_ONLY, {
    workerPath: WORKER_PATH,
    corePath: CORE_PATH,
    langPath: LANG_PATH,
    workerBlobURL: true,
    logger: (m) => { if (m.status === "recognizing text" && typeof m.progress === "number") onProgress(m.progress); },
  });
  try {
    await worker.setParameters({
      tessedit_char_whitelist: "0123456789./-: MHDEXPBBSTmhdexpbstLlOoIi",
      tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
    });
    const { data } = await worker.recognize(preprocess(canvas));
    return data.text || "";
  } finally {
    await worker.terminate();
  }
}
