// Browser-Tests für Icon-Vorschlag, Übungsmodus, Sperre (Owner) und Einführung.
//   npm run test:e2e              (smoke.mjs und diese Datei)
//   node tests/e2e/features.mjs icon   (nur Tests, deren Name "icon" enthält)
// Echte Firebase-Dienste werden nie angesprochen: im normalen Modus ersetzt guardNetwork die
// Firebase-Dateien durch die Fakes, im Übungsmodus lädt die App Firebase gar nicht erst.
import { startServer } from "./server.mjs";
import { launchBrowser, guardNetwork, watchPage, createRunner, assert, assertEqual, waitUntil } from "./harness.mjs";

const PHOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
const MOBILE = { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true };

const server = await startServer();
const browser = await launchBrowser();
const { test, run } = createRunner();

async function open(pathAndQuery, { seed = {}, viewport, isMobile = false, hasTouch = false, init = null, signedOut = false } = {}) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: viewport || { width: 1000, height: 800 }, isMobile, hasTouch, locale: "de-CH" });
  const net = await guardNetwork(context, server.url);
  const log = await watchPage(context);
  const requests = [];
  context.on("request", (r) => requests.push(r.url()));
  await context.addInitScript(([s, out]) => {
    window.__seed = s;
    if (out) window.__fakeSignedOut = true;
  }, [seed, signedOut]);
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const dialogs = [];
  page.on("dialog", (d) => {
    dialogs.push({ type: d.type(), message: d.message() });
    const answer = page.__nextDialog ? page.__nextDialog(d) : "accept";
    if (answer === "dismiss") d.dismiss(); else d.accept();
  });
  await page.goto(server.url + pathAndQuery);
  return {
    page,
    context,
    net,
    log,
    dialogs,
    requests,
    db: () => page.evaluate(() => window.__fakeDb()),
    writes: () => page.evaluate(() => window.__writes),
    practiceDb: () => page.evaluate(() => JSON.parse(localStorage.getItem("vorrat-uebung-db") || "null")),
    async done() {
      const csp = await page.evaluate(() => window.__csp || []).catch(() => []);
      await context.close();
      assertEqual(net.forbidden(), [], "Anfragen an echte Firebase/Google-Dienste");
      assertEqual(log.pageErrors, [], "Unbehandelte Fehler in der Seite");
      assertEqual(csp, [], "CSP-Verletzungen");
      assertEqual(log.cspConsole, [], "CSP-Meldungen in der Konsole");
      const errs = log.consoleErrors.filter((e) => !/ERR_BLOCKED_BY_CLIENT/.test(e));
      assertEqual(errs, [], "Fehler in der Konsole");
    },
  };
}

async function noHorizontalScroll(page, what) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert(sw <= cw, `${what}: horizontales Scrollen (${sw} > ${cw})`);
}

// ---------------------------------------------------------------------------------------------

test("F1 Icon-Vorschlag beim Hinzufügen, Wahl im Raster, Anzeige-Reihenfolge", async () => {
  const t = await open("index.html?c=kuehlschrank", {
    seed: {
      "containers/kuehlschrank": { name: "Kühlschrank" },
      "containers/kuehlschrank/items/eier": { name: "Eier", qty: 6, unit: "Stk" },
      "containers/kuehlschrank/items/butter": { name: "Butter", qty: 1, unit: "Packung", photo: PHOTO, icon: "milk" },
      "containers/kuehlschrank/items/kaese": { name: "Gruyère", qty: 200, unit: "g", icon: "<script>" },
      "containers/kuehlschrank/items/xyzzy": { name: "Xyzzy", qty: 1, unit: "Stk" },
    },
  });
  const { page } = t;
  await page.waitForSelector('#items .card[data-id="eier"]');
  // Anzeige: Vorschlag aus dem Namen (ohne zu schreiben), Foto vor Icon, manipuliertes Icon ignoriert, sonst Kamera
  assert(await page.locator('#items .card[data-id="eier"] .thumb-btn.has-icon svg.item-icon').count() === 1, "Eier: Icon-Vorschlag");
  assert(await page.locator('#items .card[data-id="butter"] img.thumb').count() === 1, "Butter: Foto gewinnt");
  assert(await page.locator('#items .card[data-id="kaese"] svg.item-icon').count() === 1, "Gruyère: Vorschlag statt ungültigem Icon");
  assert(await page.locator('#items .card[data-id="xyzzy"] .thumb-btn.no-photo').count() === 1, "Unbekannt: Kamera-Platzhalter");
  assertEqual(await t.writes(), [], "Anzeige schreibt nichts");

  // Formular: Vorschlag erscheint beim Tippen
  const pick = page.locator("#add-item-form .icon-pick");
  assert(!(await pick.isVisible()), "Ohne Namen kein Vorschlag");
  await page.fill('#add-item-form input[name="name"]', "Vollmilch");
  await pick.waitFor({ state: "visible" });
  assert((await pick.getAttribute("aria-label")).includes("Milch"), "Vorschlag Milch");
  await page.click('#add-item-form button[type="submit"]');
  await waitUntil(page, () => !!document.querySelector('#items .card[data-id="vollmilch"]'));
  let w = await t.writes();
  assertEqual(w[0].data.icon, "milk", "Vorgeschlagenes Icon gespeichert");

  // Kein Treffer → neutrales Icon, antippen → Raster mit Suche → Hammer
  await page.fill('#add-item-form input[name="name"]', "Dingsbums");
  await pick.waitFor({ state: "visible" });
  assert(await pick.evaluate((b) => b.classList.contains("is-fallback")), "Neutrales Icon ohne Treffer");
  await pick.click();
  await page.waitForSelector(".icon-grid .icon-choice");
  const total = await page.locator(".icon-grid .icon-choice").count();
  assert(total >= 60, `Raster zeigt alle Icons (${total})`);
  await page.fill(".photo-dialog input[type=search]", "hammer");
  await waitUntil(page, () => document.querySelectorAll(".icon-grid .icon-choice").length < 10);
  await page.click('.icon-grid [data-icon="hammer"]');
  assert(!(await pick.evaluate((b) => b.classList.contains("is-fallback"))), "Gewähltes Icon im Formular");
  await page.click('#add-item-form button[type="submit"]');
  await waitUntil(page, () => !!document.querySelector('#items .card[data-id="dingsbums"]'));
  w = await t.writes();
  assertEqual(w[1].data.icon, "hammer", "Selbst gewähltes Icon gespeichert");

  // Detailansicht: "Icon wählen" ändert nur icon
  await page.click('#items .card[data-id="eier"] [data-action="details"]');
  await page.click('.photo-dialog [data-action="icon"]');
  await page.click('.icon-grid [data-icon="cookie"]');
  await waitUntil(page, async () => true);
  w = await t.writes();
  const last = w[w.length - 1];
  assertEqual({ op: last.op, path: last.path, icon: last.data.icon, keys: last.keys.sort() }, { op: "update", path: "containers/kuehlschrank/items/eier", icon: "cookie", keys: ["icon", "updatedAt"] }, "Icon wählen schreibt nur icon");
  // Automatisch → Feld entfernen
  await page.click('#items .card[data-id="eier"] [data-action="details"]');
  await page.click('.photo-dialog [data-action="icon"]');
  await page.click('.photo-dialog [data-action="auto"]');
  w = await t.writes();
  assertEqual(w[w.length - 1].data.icon, { __op: "deleteField" }, "Automatisch entfernt das Feld");
  await t.done();
});

test("F2 Icons in Suche und Liste 'läuft ab', Raster bei 360 px ohne Scrollen", async () => {
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const t = await open("index.html", {
    ...MOBILE,
    seed: {
      "containers/kueche": { name: "Küche" },
      "containers/kueche/items/milch": { name: "Milch", qty: 1, unit: "l", mhd: iso },
    },
  });
  const { page } = t;
  await page.waitForSelector("#container-list a.card");
  await page.fill("#search", "milch");
  await page.waitForSelector("#search-results a.card.result:not([data-cid]) svg.item-icon");
  await page.goto(server.url + "index.html?liste=ablauf");
  await page.waitForSelector("#expiring-list a.card svg.item-icon");
  await page.goto(server.url + "index.html?c=kueche");
  await page.waitForSelector('#items .card[data-id="milch"]');
  await page.click('#items .card[data-id="milch"] [data-action="details"]');
  await page.waitForSelector(".detail-icon svg");
  await page.click('.photo-dialog [data-action="icon"]');
  await page.waitForSelector(".icon-grid .icon-choice");
  await noHorizontalScroll(page, "Icon-Raster 360 px");
  const small = await page.$$eval(".icon-grid .icon-choice", (bs) => bs.filter((b) => b.getBoundingClientRect().height < 44 || b.getBoundingClientRect().width < 44).length);
  assertEqual(small, 0, "Icon-Knöpfe mind. 44 px");
  await t.done();
});

test("F3 Übungsmodus ohne Anmeldung: Beispieldaten, nichts an Firebase, Speichern, Zurücksetzen, Beenden", async () => {
  const t = await open("index.html", { signedOut: true, ...MOBILE });
  const { page } = t;
  await page.waitForSelector("#login-form");
  await noHorizontalScroll(page, "Anmeldeseite");
  await page.click("#try-practice");
  await page.waitForSelector('#container-list a.card[data-cid="kueche"]');
  assert(await page.isVisible("#mode-bar.mode-practice"), "Balken Übungsmodus");
  assert((await page.textContent("#mode-bar")).includes("Übungsmodus"), "Balkentext");
  assert(!(await page.isVisible("#logout-btn")), "Kein Abmelden im Übungsmodus");
  assertEqual(await page.evaluate(() => [typeof window.__writes, typeof window.__authCalls]), ["undefined", "undefined"], "Firebase (Fake) wurde nicht ausgeführt");
  await noHorizontalScroll(page, "Übersicht im Übungsmodus");

  // Innerhalb der App navigieren (Links), wie ein Mensch es tut
  await page.click('#container-list a.card[data-cid="kueche"]');
  await page.click('#children a.card[data-cid="kuehlschrank"]');
  await page.waitForSelector('#items .card[data-id="milch"]');
  assert(await page.isVisible("#mode-bar.mode-practice"), "Übungsmodus bleibt bei Navigation");
  await page.fill('#add-item-form input[name="name"]', "Bergkäse");
  await page.click('#add-item-form button[type="submit"]');
  await page.waitForSelector('#items .card[data-id="bergkäse"] svg.item-icon');
  await page.reload();
  await page.waitForSelector('#items .card[data-id="bergkäse"]');
  const pdb = await t.practiceDb();
  assertEqual(pdb.docs["containers/kuehlschrank/items/bergkäse"].icon, "cuboid", "Übungsdaten in localStorage mit Icon");
  const keys = await page.evaluate(() => Object.keys(localStorage));
  assert(keys.includes("uebung:recentContainers") && !keys.includes("recentContainers"), `Zuletzt getrennt gespeichert: ${keys}`);

  // Zurücksetzen über die Hilfe (zweimal tippen)
  await page.click("#help-btn");
  await page.click('.photo-dialog [data-action="reset"]');
  await page.click('.photo-dialog [data-action="reset"]');
  await page.waitForURL(/index\.html$/);
  await page.waitForSelector('#container-list a.card[data-cid="kueche"]');
  assert(!(await t.practiceDb()).docs["containers/kuehlschrank/items/bergkäse"], "Zurückgesetzt");

  // Beenden → echte App (hier: abgemeldet → Anmeldeseite)
  await page.click('#mode-bar [data-mode="end"]');
  await page.waitForSelector("#login-form");
  assert(!(await page.isVisible("#mode-bar")), "Balken weg nach Beenden");
  const fbRequests = t.requests.filter((u) => /googleapis|firebaseio|firebaseapp|gstatic/.test(u));
  assertEqual(fbRequests, [], "Keine Anfragen an Google/Firebase");
  await t.done();
});

test("F4 Übungs-QR-Codes; echter Code im Übungsmodus zeigt nur einen Hinweis", async () => {
  const t = await open("index.html?uebung=1", { signedOut: true });
  const { page } = t;
  await page.waitForSelector('#container-list a.card[data-cid="kueche"]');
  const href = await page.evaluate(() => { const a = document.querySelector("#qr-header"); a.click(); return a.getAttribute("href"); });
  assert(href.startsWith("qr.html?uebung=1&"), `QR-Link im Übungsmodus: ${href}`);
  await page.waitForSelector(".qr-card");
  assert(await page.isVisible("#practice-note"), "Hinweis Übungs-Codes");
  const urls = await page.$$eval(".qr-card .url", (els) => els.map((e) => e.textContent));
  assert(urls.length >= 6 && urls.every((u) => u.includes("?uebung=1&c=")), "Alle Codes sind Übungs-Codes");
  assert(await page.locator(".qr-card .practice-tag").count() === urls.length, "Etikett 'Übung' auf jedem Code");

  // Echter Code "von aussen" (ohne Referrer, ohne ?uebung=1), während der Übungsmodus aktiv ist
  await page.goto(server.url + "index.html?c=garage&n=Garage", { referer: "" });
  await page.waitForSelector("#open-real");
  assert((await page.textContent("main")).includes("echten Behälters"), "Hinweis echter Code");
  assert(!(await t.practiceDb()).docs["containers/garage"], "Nichts in der Übung angelegt");
  // Übungs-Code von aussen öffnet den Übungsbehälter
  await page.goto(server.url + "index.html?uebung=1&c=werkzeugbox", { referer: "" });
  await page.waitForSelector('#items .card[data-id="hammer"]');
  await t.done();
});

test("F5 Sperre aus Sicht eines Nicht-Owners: nur Lesen, keine Schreibzugriffe", async () => {
  const t = await open("index.html?c=keller", {
    ...MOBILE,
    seed: {
      "settings/lock": { locked: true, lockedBy: "Marco" },
      "members/tester@example.com": { name: "Tester" },
      "containers/keller": { name: "Keller" },
      "containers/keller/items/reis": { name: "Reis", qty: 2, unit: "Packung" },
    },
  });
  const { page } = t;
  await page.waitForSelector('#items .card[data-id="reis"]');
  await page.waitForSelector("#mode-bar.mode-lock");
  const bar = await page.textContent("#mode-bar");
  assert(bar.includes("Vorübergehend gesperrt") && bar.includes("Marco") && bar.includes("nur Lesen"), `Balken: ${bar}`);
  assert(await page.evaluate(() => document.body.classList.contains("read-only")), "read-only");
  for (const sel of ["#add-item-form", ".sub-form", "#select-btn", "#edit-btn", '#items .card [data-action="del"]', '#items .card [data-action="inc"]']) {
    assert(!(await page.locator(sel).first().isVisible()), `${sel} ausgeblendet`);
  }
  await page.click('#items .card[data-id="reis"] [data-action="set"]');
  await waitUntil(page, () => document.getElementById("toast").textContent.includes("gesperrt"));
  assertEqual(t.dialogs.length, 0, "Keine Mengen-Eingabe bei Sperre");
  await page.click('#items .card[data-id="reis"] [data-action="details"]');
  assert(await page.locator('.photo-dialog [data-action="del"]').count() === 0, "Details ohne Ändern-Knöpfe");
  await page.keyboard.press("Escape");
  await page.click("#help-btn");
  assert(await page.locator('.photo-dialog [data-action="lock"]').count() === 0, "Nicht-Owner sieht keinen Sperr-Knopf");
  await page.keyboard.press("Escape");
  await noHorizontalScroll(page, "Sperr-Balken 360 px");
  assertEqual(await t.writes(), [], "Keine Schreibzugriffe auf echte Daten");
  // "Zum Üben" führt in den Übungsmodus
  await page.click('#mode-bar [data-mode="practice"]');
  await page.waitForSelector("#mode-bar.mode-practice");
  await t.done();
});

test("F6 Sperre aus Sicht des Owners: schreibt weiter, sperrt und entsperrt mit Bestätigung", async () => {
  const t = await open("index.html?c=keller", {
    seed: {
      "members/tester@example.com": { name: "Marco", role: "owner" },
      "containers/keller": { name: "Keller" },
      "containers/keller/items/reis": { name: "Reis", qty: 2, unit: "Packung" },
    },
  });
  const { page } = t;
  await page.waitForSelector('#items .card[data-id="reis"]');
  assert(!(await page.isVisible("#mode-bar")), "Ohne Sperre kein Balken");
  await page.click("#help-btn");
  page.__nextDialog = () => "dismiss";
  await page.click('.photo-dialog [data-action="lock"]');
  assertEqual((await t.writes()).length, 0, "Abbrechen sperrt nicht");
  page.__nextDialog = () => "accept";
  await page.click("#help-btn");
  await page.click('.photo-dialog [data-action="lock"]');
  await page.waitForSelector("#mode-bar.mode-lock");
  assert((await page.textContent("#mode-bar")).includes("Gesperrt für andere"), "Owner-Balken");
  let w = await t.writes();
  assertEqual({ path: w[0].path, locked: w[0].data.locked, by: w[0].data.lockedBy }, { path: "settings/lock", locked: true, by: "Marco" }, "Sperre geschrieben (Name, keine Adresse)");
  assert(!JSON.stringify(w[0].data).includes("@"), "Keine E-Mail im Sperr-Dokument");
  // Owner darf weiter ändern
  assert(!(await page.evaluate(() => document.body.classList.contains("read-only"))), "Owner nicht read-only");
  await page.click('#items .card[data-id="reis"] [data-action="inc"]');
  await waitUntil(page, () => document.querySelector('#items .card[data-id="reis"] .qty-value').textContent === "3");
  // Entsperren über den Balken
  await page.click('#mode-bar [data-mode="unlock"]');
  await waitUntil(page, () => document.getElementById("mode-bar").hidden);
  w = await t.writes();
  assertEqual(w[w.length - 1].data.locked, false, "Entsperrt");
  assert(t.dialogs.every((d) => d.type === "confirm"), "Mit Bestätigung");
  await t.done();
});

test("F7 Einführung: Hinweis einmalig, kompletter Durchlauf im Übungsmodus (360 px)", async () => {
  const t = await open("index.html", { ...MOBILE, seed: { "containers/keller": { name: "Keller" } } });
  const { page } = t;
  await page.waitForSelector("#tutorial-hint .tut-primary");
  await page.click("#tutorial-hint .tut-primary"); // "Einführung starten"
  await page.waitForSelector("#mode-bar.mode-practice");
  const progress = () => page.textContent(".tut-bubble .tut-progress");
  const waitStep = (label) => waitUntil(page, new Function(`return document.querySelector(".tut-bubble .tut-progress")?.textContent === ${JSON.stringify(label)}`), { timeout: 6000 })
    .catch(async () => { throw new Error(`Schritt ${label} nicht erreicht (ist: ${await progress().catch(() => "?")})`); });
  const next = () => page.click(".tut-bubble [data-main]");

  await waitStep("1/13");
  await noHorizontalScroll(page, "Einführung Schritt 1");
  await next();
  await waitStep("2/13");
  await next();
  await waitStep("3/13");
  await page.click('#container-list a.card[data-cid="kueche"]');
  await waitStep("4/13");
  await page.click('#children a.card[data-cid="kuehlschrank"]');
  await waitStep("5/13");
  await page.fill('#add-item-form input[name="name"]', "Käse");
  await page.click('#add-item-form button[type="submit"]');
  await waitStep("6/13");
  await page.click('#items .card [data-action="inc"] >> nth=0');
  await waitStep("7/13");
  await page.click('#items .card [data-action="details"] >> nth=0');
  await page.click('.photo-dialog [data-action="mhd"]');
  await page.click('.photo-dialog [data-add="7"]');
  await waitStep("8/13");
  const del = page.locator('#items .card [data-action="del"]').first();
  await del.click();
  await del.click();
  await waitStep("9/13");
  await next();
  await waitStep("10/13");
  await page.click('.bottom-nav [data-nav="search"]');
  await page.waitForSelector("#search");
  await page.fill("#search", "Hammer");
  await waitStep("11/13");
  await page.click('.bottom-nav [data-nav="ablauf"]');
  await waitStep("12/13");
  await next();
  await waitStep("13/13");
  await page.keyboard.press("Tab"); // Fokus bleibt bedienbar
  await next(); // Fertig
  await page.waitForSelector(".tut-bubble .tut-primary");
  assert((await page.textContent(".tut-bubble")).includes("Geschafft"), "Abschluss");
  await page.click(".tut-bubble .tut-primary"); // Übung beenden
  await page.waitForSelector('#container-list a.card[data-cid="keller"]');
  assert(!(await page.isVisible("#mode-bar")), "Zurück bei den echten Daten");
  assertEqual(await t.writes(), [], "Einführung schreibt nichts in echte Daten");
  // Hinweis kommt nicht wieder
  await page.reload();
  await page.waitForSelector("#container-list a.card");
  await page.waitForTimeout(400);
  assertEqual(await page.locator("#tutorial-hint").count(), 0, "Hinweis nur einmal");
  await t.done();
});

test("F8 Einführung: Escape beendet, Hinweis 'Nein danke' bleibt weg", async () => {
  const t = await open("index.html", { seed: {} });
  const { page } = t;
  await page.waitForSelector("#tutorial-hint");
  await page.click("#tutorial-hint .tut-link");
  await page.reload();
  await page.waitForSelector("#container-list");
  await page.waitForTimeout(400);
  assertEqual(await page.locator("#tutorial-hint").count(), 0, "Nein danke: nie wieder");
  await page.click("#help-btn");
  await page.click('.photo-dialog [data-action="tutorial"]');
  await page.waitForSelector(".tut-bubble");
  await page.keyboard.press("Escape");
  await waitUntil(page, () => !document.querySelector(".tut-bubble"));
  await page.reload();
  await page.waitForSelector('#container-list a.card[data-cid="kueche"]');
  await page.waitForTimeout(400);
  assertEqual(await page.locator(".tut-bubble").count(), 0, "Nach Escape kein Tutorial mehr");
  await t.done();
});

test("F9 Abmelden löscht auch die Übungsdaten; Kopfzeile passt bei 360 px", async () => {
  const t = await open("index.html", { ...MOBILE, seed: { "containers/keller": { name: "Keller" } }, init: () => {
    try { if (!sessionStorage.getItem("__f9")) { sessionStorage.setItem("__f9", "1"); localStorage.setItem("vorrat-uebung-db", "{}"); localStorage.setItem("uebung:recentContainers", "[]"); } } catch {}
  } });
  const { page } = t;
  await page.waitForSelector("#container-list a.card");
  const right = await page.evaluate(() => Math.max(...[...document.querySelectorAll("header.app-header > :not([hidden])")].map((e) => e.getBoundingClientRect().right)));
  assert(right <= 360 - 12, `Kopfzeile reicht bis ${right} px (Rand fehlt)`);
  await noHorizontalScroll(page, "Kopfzeile 360 px");
  // Der Fake meldet nach dem Neuladen wieder an – hier zählt nur, was vorher gelöscht wurde.
  await Promise.all([page.waitForEvent("load"), page.click("#logout-btn")]);
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("uebung:") || k === "vorrat-uebung-db"));
  assertEqual(keys, [], "Übungsdaten nach Abmelden gelöscht");
  await t.done();
});

const failed = await run(process.argv[2]);
await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
