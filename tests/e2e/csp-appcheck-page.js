// Läuft in der Testseite von csp-appcheck.mjs (unter der CSP aus index.html, ggf. ergänzt).
// Startet App Check mit dem selbst gehosteten Firebase (vendor/) und einem UNGÜLTIGEN Platzhalter-
// Websiteschlüssel: Es geht nur darum, ob die CSP reCAPTCHA laden lässt. Projekt "demo-…", und
// jede Anfrage an *.googleapis.com wird vom Test blockiert – kein echtes Firebase-Projekt beteiligt.
import { initializeApp } from "../../vendor/firebase-10.14.1/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider, getToken } from "../../vendor/firebase-10.14.1/firebase-app-check.js";

window.__result = null;
const app = initializeApp({ apiKey: "demo-api-key", projectId: "demo-kraft-inventar", appId: "1:1:web:1" });
const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider("csp-test-ungueltiger-schluessel"),
  isTokenAutoRefreshEnabled: false,
});
const tokenResult = getToken(appCheck).then(() => "token", (err) => `fehler: ${err && (err.code || err.message)}`);
const start = Date.now();
(async () => {
  // Warten, bis reCAPTCHA geladen ist (oder 15 s vergangen sind).
  while (!window.grecaptcha && Date.now() - start < 15_000) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 3000)); // Nachladen (gstatic, iframe) abwarten
  const token = await Promise.race([tokenResult, new Promise((r) => setTimeout(() => r("kein Ergebnis (Timeout)"), 2000))]);
  window.__result = { grecaptcha: !!window.grecaptcha, token, frames: document.querySelectorAll("iframe").length };
})();
