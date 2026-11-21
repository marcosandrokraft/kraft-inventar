// Optional/manuell (lädt reCAPTCHA von www.google.com/www.gstatic.com):
// Würde Firebase App Check (reCAPTCHA v3) mit dem selbst gehosteten Firebase unter der CSP aus
// index.html laufen – und welche CSP-Ergänzung braucht es?  `npm run test:e2e:appcheck`
// Läuft zweimal: 1) CSP genau wie index.html, 2) mit der Ergänzung APP_CHECK_SCRIPT_SRC.
// Erwartet: 1) blockiert reCAPTCHA (Verletzung script-src), 2) keine CSP-Verletzung.
// Kein echtes Firebase-Projekt: Projekt-ID "demo-…", ungültiger Platzhalter-Schlüssel, und alle
// Anfragen an *.googleapis.com / *.firebaseapp.com werden blockiert.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { startServer, ROOT } from "./server.mjs";
import { launchBrowser, watchPage } from "./harness.mjs";

// Muss in index.html bei script-src ergänzt werden, bevor appCheckSiteKey gesetzt wird (STAND.md).
export const APP_CHECK_SCRIPT_SRC = "https://www.google.com https://www.gstatic.com";

const html = await readFile(path.join(ROOT, "index.html"), "utf8");
const meta = html.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/);
if (!meta) throw new Error("Keine CSP-Meta-Zeile in index.html gefunden");

const server = await startServer();
const browser = await launchBrowser();
const PAGE = "tests/e2e/__csp-appcheck.html";

async function run(label, metaTag) {
  const testPage = `<!doctype html><html><head><meta charset="utf-8" />${metaTag}<title>CSP-Test App Check</title></head>
<body><p>App Check unter der CSP…</p><script type="module" src="csp-appcheck-page.js"></script></body></html>`;
  const context = await browser.newContext({ serviceWorkers: "block" });
  const log = await watchPage(context);
  const blockedFirebase = [];
  const hosts = new Set();
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url === server.url + PAGE) return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: testPage });
    const u = new URL(url);
    if (/(googleapis\.com|firebaseapp\.com|firebaseio\.com)$/.test(u.hostname)) {
      blockedFirebase.push(url);
      return route.abort("blockedbyclient");
    }
    hosts.add(u.host);
    return route.continue();
  });
  const page = await context.newPage();
  await page.goto(server.url + PAGE);
  let result = null;
  const deadline = Date.now() + 40_000;
  while (!result && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    result = await page.evaluate(() => window.__result).catch(() => null);
  }
  const csp = await page.evaluate(() => window.__csp).catch(() => []);
  await context.close();
  const violations = [...new Set(csp.map((v) => `${v.effectiveDirective || v.violatedDirective} ← ${v.blockedURI}`))];
  console.log(`\n== ${label}`);
  console.log("Ergebnis:", JSON.stringify(result));
  console.log("Hosts:", [...hosts].join(", "));
  console.log("Blockierte Firebase-Anfragen (gewollt):", blockedFirebase.map((u) => new URL(u).host));
  console.log("CSP-Verletzungen:", violations.length ? `\n  ${violations.join("\n  ")}` : "keine");
  console.log("Seitenfehler:", log.pageErrors);
  return { result, violations };
}

const original = await run("CSP genau wie index.html", meta[0]);
const extended = await run(`CSP + script-src ${APP_CHECK_SCRIPT_SRC}`, meta[0].replace("script-src ", `script-src ${APP_CHECK_SCRIPT_SRC} `));

const blockedBefore = original.violations.some((v) => v.startsWith("script-src") && v.includes("google.com"));
const okAfter = !extended.violations.length && extended.result && extended.result.grecaptcha;
console.log(blockedBefore ? "\nOK: Ohne Ergänzung blockiert die CSP reCAPTCHA (wie erwartet)." : "\nHINWEIS: Ohne Ergänzung keine script-src-Verletzung für google.com?");
console.log(okAfter ? "OK: Mit Ergänzung lädt reCAPTCHA ohne CSP-Verletzung." : "FEHLER: Auch mit Ergänzung CSP-Verletzungen oder reCAPTCHA nicht geladen.");

await browser.close();
await server.close();
process.exit(blockedBefore && okAfter ? 0 : 1);
