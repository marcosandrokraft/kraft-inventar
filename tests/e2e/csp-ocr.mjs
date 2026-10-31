// Optional/manuell (lädt beim ersten Mal ~7 MB von cdn.jsdelivr.net):
// Läuft die MHD-Erkennung per OCR (tesseract.js) unter GENAU der Content-Security-Policy aus index.html?
//   node tests/e2e/csp-ocr.mjs
// Die Seite csp-ocr-page.html wird ausgeliefert, ihre CSP-Meta-Zeile dabei durch die aktuelle aus
// index.html ersetzt (weicht die Datei ab, wird das gemeldet). Netzwerk: nur der lokale Server und
// cdn.jsdelivr.net, alles andere wird blockiert und gemeldet.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { startServer, ROOT } from "./server.mjs";
import { launchBrowser, watchPage } from "./harness.mjs";

const META_RE = /<meta http-equiv="Content-Security-Policy"[^>]*>/;
const indexHtml = await readFile(path.join(ROOT, "index.html"), "utf8");
const meta = indexHtml.match(META_RE);
if (!meta) throw new Error("Keine CSP-Meta-Zeile in index.html gefunden");
const pageRel = "tests/e2e/csp-ocr-page.html";
const pageHtml = await readFile(path.join(ROOT, pageRel), "utf8");
const pageMeta = pageHtml.match(META_RE);
if (!pageMeta) throw new Error("Keine CSP-Meta-Zeile in csp-ocr-page.html gefunden");
const cspOf = (tag) => tag.match(/content="([^"]*)"/)[1];
if (cspOf(pageMeta[0]) !== cspOf(meta[0])) console.log("Hinweis: CSP in csp-ocr-page.html weicht von index.html ab – verwendet wird die aus index.html.\n");
// Zum Ausprobieren: `node tests/e2e/csp-ocr.mjs --ohne-unsafe-eval` entfernt 'unsafe-eval' aus script-src.
const noUnsafeEval = process.argv.includes("--ohne-unsafe-eval");
const metaTag = noUnsafeEval ? meta[0].replace(" 'unsafe-eval'", "") : meta[0];
const testPage = pageHtml.replace(META_RE, metaTag);

const server = await startServer();
const browser = await launchBrowser();
const context = await browser.newContext({ serviceWorkers: "block" });
const log = await watchPage(context);
const hosts = new Map();
const blocked = [];
await context.route("**/*", (route) => {
  const url = route.request().url();
  if (url === server.url + pageRel) {
    return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: testPage });
  }
  const u = new URL(url);
  if (u.protocol === "blob:" || u.protocol === "data:" || url.startsWith(server.url)) return route.continue();
  if (u.hostname !== "cdn.jsdelivr.net") {
    blocked.push(url);
    return route.abort("blockedbyclient");
  }
  hosts.set(u.host, (hosts.get(u.host) || 0) + 1);
  return route.continue();
});

const page = await context.newPage();
const failedRequests = [];
const downloads = [];
context.on("response", (r) => { if (r.status() >= 400) console.log(`  [HTTP ${r.status()}] ${r.url()}`); });
page.on("requestfailed", (r) => failedRequests.push(`${r.url()} → ${r.failure() && r.failure().errorText}`));
context.on("requestfinished", async (r) => {
  if (!r.url().startsWith("https://")) return;
  const s = await r.sizes().catch(() => null);
  downloads.push({ url: r.url(), bytes: s ? s.responseBodySize : -1 });
});
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log(`  [console.${m.type()}] ${m.text().slice(0, 300)}`); });

console.log(noUnsafeEval ? "CSP (GEÄNDERT, ohne 'unsafe-eval'):" : "CSP (aus index.html):", cspOf(metaTag), "\n");
const start = Date.now();
await page.goto(server.url + pageRel);
let result = null;
// Eigene Abfrageschleife: page.waitForFunction mit Intervall nutzt eval, das die CSP blockieren kann.
const deadline = Date.now() + 3 * 60_000;
while (!result && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 500));
  result = await page.evaluate(() => window.__result);
}
if (!result) result = { ok: false, error: "Timeout nach 3 Minuten" };
const csp = await page.evaluate(() => window.__csp).catch(() => []);
const progress = await page.evaluate(() => window.__progress).catch(() => []);
await new Promise((r) => setTimeout(r, 300)); // letzte requestfinished-Events abwarten

console.log(`Dauer gesamt: ${((Date.now() - start) / 1000).toFixed(1)} s`);
console.log("Ergebnis:", JSON.stringify(result, null, 2));
console.log("Fortschritt (Auszug):", [...new Set(progress)].filter((p) => / (0|100)%$|ERROR/.test(p)));
console.log("Downloads:");
let total = 0;
for (const d of downloads) { total += Math.max(0, d.bytes); console.log(`  ${(d.bytes / 1e6).toFixed(2).padStart(6)} MB  ${d.url}`); }
console.log(`  Summe: ${(total / 1e6).toFixed(2)} MB (übertragen, ggf. komprimiert)`);
console.log("Hosts:", Object.fromEntries(hosts));
console.log("CSP-Verletzungen (Event):", JSON.stringify(csp, null, 2));
console.log("CSP-Meldungen (Konsole):", log.cspConsole);
console.log("Seitenfehler:", log.pageErrors);
console.log("Fehlgeschlagene Requests:", failedRequests.slice(0, 20));
console.log("Blockierte Requests (nicht cdn.jsdelivr.net):", blocked);

const missing = [...new Set(csp.map((v) => `${v.effectiveDirective || v.violatedDirective} ← ${v.blockedURI}`))];
if (missing.length) console.log("\nFEHLENDE CSP-FREIGABEN:\n  " + missing.join("\n  "));

const text = (result && result.text) || "";
const foundMhd = /12[.,]03[.,]27/.test(text);
const foundExp = /03\/2027/.test(text);
console.log(`\n"12.03.27" erkannt: ${foundMhd}, "03/2027" erkannt: ${foundExp}`);
const ok = result && result.ok && foundMhd && !csp.length && !log.cspConsole.length && !blocked.length;
console.log(ok ? "OK: OCR funktioniert unter der CSP." : "FEHLER: OCR unter der CSP nicht erfolgreich.");

await browser.close();
await server.close();
process.exit(ok ? 0 : 1);
