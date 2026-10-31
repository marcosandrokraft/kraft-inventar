// Gemeinsame Helfer für die Browser-Tests (Playwright ohne Test-Runner, nur playwright-core).
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// playwright-core: normal aus node_modules des Projekts. Alternativ PLAYWRIGHT_CORE_PATH auf einen
// Ordner zeigen lassen, der node_modules/playwright-core enthält (z.B. wenn es nicht im Projekt
// installiert ist).
export async function loadPlaywright() {
  try {
    return await import("playwright-core");
  } catch (err) {
    const base = process.env.PLAYWRIGHT_CORE_PATH;
    if (!base) {
      throw new Error("playwright-core nicht gefunden: `npm install` ausführen oder PLAYWRIGHT_CORE_PATH setzen.");
    }
    const require = createRequire(pathToFileURL(path.join(path.resolve(base), "package.json")));
    return import(pathToFileURL(require.resolve("playwright-core")).href);
  }
}

// Startet Edge/Chrome, das schon installiert ist (kein Browser-Download nötig).
// E2E_BROWSER_PATH=/pfad/zu/msedge.exe oder chrome.exe setzt den Browser fest,
// E2E_HEADED=1 zeigt das Fenster.
export async function launchBrowser() {
  const pw = await loadPlaywright();
  const chromium = pw.chromium || (pw.default && pw.default.chromium);
  const headless = !process.env.E2E_HEADED;
  if (process.env.E2E_BROWSER_PATH) {
    return chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH, headless });
  }
  const errors = [];
  for (const channel of ["msedge", "chrome", undefined]) {
    try {
      return await chromium.launch({ channel, headless });
    } catch (err) {
      errors.push(`${channel || "chromium"}: ${err.message.split("\n")[0]}`);
    }
  }
  throw new Error(`Kein Browser gefunden (E2E_BROWSER_PATH setzen):\n${errors.join("\n")}`);
}

// Firebase ist selbst gehostet (vendor/firebase-10.14.1/); die Tests ersetzen genau diese Dateien.
const FIREBASE_DIR = "/vendor/firebase-10.14.1/";
const FAKES = ["firebase-app.js", "firebase-firestore.js", "firebase-auth.js"];

// Alle Netzwerkanfragen eines Kontexts kontrollieren:
// - Firebase-SDK unter vendor/ → Fake-Module aus tests/e2e/fake-firebase/
// - eigener Server → durchlassen
// - alles andere → blockieren und in `blocked` protokollieren (Google/Firebase gilt als Fehler)
export async function guardNetwork(context, baseUrl) {
  const fakeSource = {};
  for (const f of FAKES) fakeSource[f] = await readFile(path.join(HERE, "fake-firebase", f), "utf8");
  const blocked = [];
  const external = [];
  const origin = new URL(baseUrl).origin;
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith(origin + FIREBASE_DIR)) {
      const name = url.slice((origin + FIREBASE_DIR).length).split("?")[0];
      if (fakeSource[name]) {
        return route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: fakeSource[name] });
      }
      blocked.push(url); // z.B. app-check: in den Tests nie erwartet
      return route.abort("blockedbyclient");
    }
    if (url.startsWith(origin + "/") || url === origin || url.startsWith("data:") || url.startsWith("blob:")) {
      return route.continue();
    }
    external.push(url);
    blocked.push(url);
    return route.abort("blockedbyclient");
  });
  // Echte Firebase-/Google-Backends: dürfen nie angefragt werden.
  // gstatic.com: Firebase kommt nicht mehr von dort (selbst gehostet) – jede Anfrage dorthin ist ein Fehler.
  const forbidden = () => blocked.filter((u) => /(^https?:\/\/[^/]*\.(googleapis\.com|firebaseapp\.com|firebaseio\.com|gstatic\.com)\b)|google\.com\/|vendor\/firebase/.test(u));
  return { blocked, external, forbidden };
}

// Sammelt CSP-Verletzungen (Event + Konsole), Seitenfehler und Konsolenfehler.
export async function watchPage(context) {
  await context.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__csp.push({ blockedURI: e.blockedURI, violatedDirective: e.violatedDirective, effectiveDirective: e.effectiveDirective, source: e.sourceFile, line: e.lineNumber });
    });
  });
  const log = { pageErrors: [], consoleErrors: [], cspConsole: [] };
  context.on("page", (page) => attach(page, log));
  return log;
}

function attach(page, log) {
  page.on("pageerror", (err) => log.pageErrors.push(`${page.url()}: ${err.message}`));
  page.on("console", (msg) => {
    const text = msg.text();
    if (/Content Security Policy|Refused to/i.test(text)) log.cspConsole.push(text);
    if (msg.type() === "error") log.consoleErrors.push(text);
  });
}

// ---- winziger Test-Runner ----
export function createRunner() {
  const tests = [];
  return {
    test(name, fn) { tests.push({ name, fn }); },
    async run(filter) {
      const results = [];
      for (const t of tests) {
        if (filter && !t.name.toLowerCase().includes(filter.toLowerCase())) continue;
        const start = Date.now();
        try {
          await t.fn();
          results.push({ name: t.name, ok: true, ms: Date.now() - start });
          console.log(`  ✔ ${t.name} (${Date.now() - start} ms)`);
        } catch (err) {
          results.push({ name: t.name, ok: false, err });
          console.log(`  ✘ ${t.name}\n      ${String(err && err.stack || err).split("\n").slice(0, 6).join("\n      ")}`);
        }
      }
      const failed = results.filter((r) => !r.ok).length;
      console.log(`\n${results.length - failed} bestanden, ${failed} fehlgeschlagen`);
      return failed;
    },
  };
}

export function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

export function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n        erwartet: ${e}\n        erhalten: ${a}`);
}

// Wartet, bis fn() im Browser true liefert. Ersetzt page.waitForFunction: Das wertet die Funktion
// per eval aus, was die CSP der App (kein 'unsafe-eval') blockiert. page.evaluate läuft über das
// DevTools-Protokoll und ist davon nicht betroffen.
export async function waitUntil(page, fn, { timeout = 5000, interval = 50 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    if (await page.evaluate(fn).catch(() => false)) return;
    if (Date.now() > end) throw new Error(`Timeout (${timeout} ms): ${fn.toString().slice(0, 160)}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}
