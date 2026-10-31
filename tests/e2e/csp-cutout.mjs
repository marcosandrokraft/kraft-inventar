// Optional/manuell (lädt ~56 MB von cdn.jsdelivr.net und staticimgly.com):
// Funktioniert die Freistellung (@imgly/background-removal) unter GENAU der Content-Security-Policy
// aus index.html?  `node tests/e2e/csp-cutout.mjs`  (bzw. `npm run test:e2e:cutout`)
// Die CSP wird zur Laufzeit aus index.html gelesen. Firebase/Google-Anfragen werden blockiert.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { startServer, ROOT } from "./server.mjs";
import { launchBrowser, watchPage } from "./harness.mjs";

const html = await readFile(path.join(ROOT, "index.html"), "utf8");
const meta = html.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/);
if (!meta) throw new Error("Keine CSP-Meta-Zeile in index.html gefunden");
// Zum Ausprobieren: zusätzliche Quellen für script-src, z.B.
//   node tests/e2e/csp-cutout.mjs "'unsafe-eval'"
const extraScriptSrc = process.argv.slice(2).join(" ");
const metaTag = extraScriptSrc ? meta[0].replace("script-src ", `script-src ${extraScriptSrc} `) : meta[0];

const page404 = "tests/e2e/__csp-cutout.html";
const testPage = `<!doctype html>
<html><head><meta charset="utf-8" />
${metaTag}
<title>CSP-Test Freistellung</title></head>
<body><p>Freistellung unter der CSP von index.html…</p>
<script type="module" src="csp-cutout-page.js"></script>
</body></html>`;

const server = await startServer();
const browser = await launchBrowser();
const context = await browser.newContext({ serviceWorkers: "block" });
const log = await watchPage(context);
const hosts = new Map();
const forbidden = [];
await context.route("**/*", (route) => {
  const url = route.request().url();
  if (url === server.url + page404) {
    return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: testPage });
  }
  const u = new URL(url);
  if (/(googleapis\.com|firebaseapp\.com|firebaseio\.com|google\.com)$/.test(u.hostname)) {
    forbidden.push(url);
    return route.abort("blockedbyclient");
  }
  hosts.set(u.host, (hosts.get(u.host) || 0) + 1);
  return route.continue();
});

const page = await context.newPage();
const failedRequests = [];
page.on("requestfailed", (r) => failedRequests.push(`${r.url()} → ${r.failure() && r.failure().errorText}`));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log(`  [console.${m.type()}] ${m.text().slice(0, 300)}`); });

console.log(extraScriptSrc ? `CSP (GEÄNDERT, script-src + ${extraScriptSrc}):` : "CSP (aus index.html):", metaTag.match(/content="([^"]*)"/)[1], "\n");
const start = Date.now();
await page.goto(server.url + page404);
let result = null;
// Eigene Abfrageschleife: page.waitForFunction mit Intervall nutzt eval, das die CSP (zu Recht) blockiert.
const deadline = Date.now() + 5 * 60_000;
while (!result && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 1000));
  result = await page.evaluate(() => window.__result);
}
if (!result) result = { ok: false, error: "Timeout nach 5 Minuten" };
const csp = await page.evaluate(() => window.__csp).catch(() => []);
const progress = await page.evaluate(() => window.__progress).catch(() => []);

console.log(`\nDauer: ${Math.round((Date.now() - start) / 1000)} s`);
console.log("Ergebnis:", JSON.stringify(result, null, 2));
console.log("Fortschritt (letzte):", progress.slice(-3));
console.log("Hosts:", Object.fromEntries(hosts));
console.log("CSP-Verletzungen (Event):", JSON.stringify(csp, null, 2));
console.log("CSP-Meldungen (Konsole):", log.cspConsole);
console.log("Seitenfehler:", log.pageErrors);
console.log("Fehlgeschlagene Requests:", failedRequests.slice(0, 20));
console.log("Blockierte Firebase/Google-Requests:", forbidden);

const missing = [...new Set(csp.map((v) => `${v.effectiveDirective || v.violatedDirective} ← ${v.blockedURI}`))];
if (missing.length) console.log("\nFEHLENDE CSP-FREIGABEN:\n  " + missing.join("\n  "));

const cutoutWorks = result && result.ok && result.alphaCorner < 16 && result.alphaCenter > 200;
console.log(cutoutWorks ? "\nOK: Freistellung funktioniert unter der CSP." : "\nFEHLER: Freistellung unter der CSP nicht erfolgreich.");

await browser.close();
await server.close();
process.exit(cutoutWorks && !csp.length ? 0 : 1);
