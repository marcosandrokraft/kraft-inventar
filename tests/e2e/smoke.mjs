// Browser-Smoke-Tests der Vorrat-App mit Fake-Firebase (keine Verbindung zu echten Diensten).
//   npm run test:e2e              (alle)
//   node tests/e2e/smoke.mjs xss  (nur Tests, deren Name "xss" enthält)
// Umgebungsvariablen: E2E_BROWSER_PATH, E2E_HEADED=1, PLAYWRIGHT_CORE_PATH (siehe harness.mjs).
import { startServer } from "./server.mjs";
import { launchBrowser, guardNetwork, watchPage, createRunner, assert, assertEqual, waitUntil } from "./harness.mjs";

// Kleines, gültiges JPEG (1×1 px) – erfüllt isSafePhoto().
const PHOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
const XSS = "<img src=x onerror=window.__xss=1>";

const server = await startServer();
const browser = await launchBrowser();
const { test, run } = createRunner();

// Öffnet eine Seite in einem frischen Kontext mit Startdaten. Gibt Helfer zurück; `done()` prüft
// am Ende, dass keine verbotenen Anfragen, Seitenfehler oder CSP-Verletzungen auftraten.
async function open(pathAndQuery, { seed = {}, viewport, isMobile = false, hasTouch = false, routes = [], init = null } = {}) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: viewport || { width: 1000, height: 800 }, isMobile, hasTouch, locale: "de-CH" });
  const net = await guardNetwork(context, server.url);
  const log = await watchPage(context);
  for (const [pattern, handler] of routes) await context.route(pattern, handler); // nach guardNetwork = Vorrang
  await context.addInitScript((s) => { window.__seed = s; }, seed);
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const dialogs = [];
  page.on("dialog", (d) => {
    dialogs.push({ type: d.type(), message: d.message() });
    const answer = page.__nextDialog ? page.__nextDialog(d) : "accept";
    if (answer === "dismiss") d.dismiss(); else d.accept(typeof answer === "string" && answer !== "accept" ? answer : undefined);
  });
  await page.goto(server.url + pathAndQuery);
  return {
    page,
    context,
    net,
    log,
    dialogs,
    db: () => page.evaluate(() => window.__fakeDb()),
    writes: () => page.evaluate(() => window.__writes),
    async done({ allowConsoleErrors = false } = {}) {
      const csp = await page.evaluate(() => window.__csp || []).catch(() => []);
      await context.close();
      assertEqual(net.forbidden(), [], "Anfragen an echte Firebase/Google-Dienste");
      assertEqual(log.pageErrors, [], "Unbehandelte Fehler in der Seite");
      assertEqual(csp, [], "CSP-Verletzungen (securitypolicyviolation)");
      assertEqual(log.cspConsole, [], "CSP-Meldungen in der Konsole");
      if (!allowConsoleErrors) {
        // Blockierte Fremdanfragen (z.B. preconnect) erzeugen "net::ERR_BLOCKED_BY_CLIENT" – das ist gewollt.
        const errs = log.consoleErrors.filter((e) => !/ERR_BLOCKED_BY_CLIENT/.test(e));
        assertEqual(errs, [], "Fehler in der Konsole");
      }
    },
  };
}

function card(page, itemId) {
  return page.locator(`#items .card[data-id="${itemId}"]`);
}

// ---------------------------------------------------------------------------------------------

test("1 Übersicht: Behälter alphabetisch, Suche 'milch', Link + Hervorhebung", async () => {
  const t = await open("index.html", {
    seed: {
      "containers/zebra-kiste": { name: "Zebra-Kiste" },
      "containers/kühlschrank": { name: "Kühlschrank" },
      "containers/apfelregal": { name: "apfelregal" },
      "containers/öl-schrank": { name: "Ölschrank" },
      "containers/kühlschrank/items/milch": { name: "Milch", qty: 2, unit: "Stk" },
      "containers/apfelregal/items/hafermilch": { name: "Hafermilch", qty: 1, unit: "Packung" },
      "containers/zebra-kiste/items/brot": { name: "Brot", qty: 1, unit: "Stk" },
    },
  });
  const { page } = t;
  await page.waitForSelector("#container-list a.card");
  const names = await page.locator("#container-list a.card strong").allTextContents();
  assertEqual(names, ["apfelregal", "Kühlschrank", "Ölschrank", "Zebra-Kiste"], "Behälter-Reihenfolge");

  await page.fill("#search", "milch");
  await page.waitForSelector("#search-results a.card.result:not([data-cid])");
  const results = await page.locator("#search-results a.card.result:not([data-cid])").evaluateAll((as) =>
    as.map((a) => ({ name: a.querySelector("strong").textContent, where: a.querySelector("small b").textContent, href: a.getAttribute("href") })));
  assertEqual(results.map((r) => r.name), ["Milch", "Hafermilch"], "Suchtreffer (Wortanfang zuerst)");
  assertEqual(results[0].where, "Kühlschrank", "Behältername im Treffer");
  assertEqual(results[0].href, "index.html?c=k%C3%BChlschrank#i=milch", "Link des Treffers");

  // Umlaut-/Grossschreibung-tolerant und über den Behälternamen
  // (Runde 2: zusätzlich der Behälter selbst als Treffer)
  await page.fill("#search", "KUEHLSCHRANK");
  await waitUntil(page, () => document.querySelectorAll("#search-results a.card.result:not([data-cid])").length === 1
    && document.querySelectorAll("#search-results a.card.result[data-cid]").length === 1);

  await page.fill("#search", "milch");
  await page.waitForSelector("#search-results a.card.result:not([data-cid])");
  await page.click("#search-results a.card.result:not([data-cid]) >> nth=0");
  await page.waitForURL(/index\.html\?c=k%C3%BChlschrank#i=milch$/);
  await page.waitForSelector('#items .card[data-id="milch"].highlight', { timeout: 3000 });
  assertEqual(await page.textContent("#container-title"), "Kühlschrank", "Titel der Behälter-Ansicht");
  await t.done();
});

test("2 Behälter: +/− per increment ohne Foto, − bei 1 löscht, Rückgängig stellt Foto wieder her", async () => {
  const t = await open("index.html?c=box-1", {
    seed: {
      "containers/box-1": { name: "Box 1" },
      "containers/box-1/items/milch": { name: "Milch", qty: 2, unit: "Stk", photo: PHOTO },
      "containers/box-1/items/butter": { name: "Butter", qty: 1, unit: "Packung", photo: PHOTO },
    },
  });
  const { page } = t;
  await page.waitForSelector('#items .card[data-id="milch"]');
  assertEqual(await t.writes(), [], "Beim Öffnen eines bestehenden Behälters wird nichts geschrieben");

  await card(page, "milch").locator('[data-action="inc"]').click();
  await waitUntil(page, () => document.querySelector('#items .card[data-id="milch"] .qty-value').textContent === "3");
  let w = await t.writes();
  assertEqual(w.length, 1, "Anzahl Schreibzugriffe nach +");
  assertEqual({ op: w[0].op, path: w[0].path, keys: w[0].keys.sort(), qty: w[0].data.qty }, { op: "update", path: "containers/box-1/items/milch", keys: ["qty", "updatedAt"], qty: { __op: "increment", by: 1 } }, "+ schreibt nur increment(1)");

  await card(page, "milch").locator('[data-action="dec"]').click();
  await waitUntil(page, () => document.querySelector('#items .card[data-id="milch"] .qty-value').textContent === "2");
  w = await t.writes();
  assertEqual({ op: w[1].op, keys: w[1].keys.sort(), qty: w[1].data.qty }, { op: "update", keys: ["qty", "updatedAt"], qty: { __op: "increment", by: -1 } }, "− schreibt nur increment(-1)");
  assert(w.every((x) => !x.data || !("photo" in x.data)), "Kein Foto in +/− Schreibzugriffen");
  assertEqual((await t.db())["containers/box-1/items/milch"].photo, PHOTO, "Foto bleibt erhalten");

  // − bei Menge 1 → löschen mit Rückgängig
  await card(page, "butter").locator('[data-action="dec"]').click();
  await card(page, "butter").waitFor({ state: "detached" });
  w = await t.writes();
  assertEqual({ op: w[2].op, path: w[2].path }, { op: "delete", path: "containers/box-1/items/butter" }, "− bei 1 löscht");
  const undo = page.locator("#toast.show button", { hasText: "Rückgängig" });
  await undo.waitFor({ state: "visible" });
  assert((await page.textContent("#toast")).includes('"Butter" entfernt'), "Toast-Text beim Entfernen");
  await undo.click();
  await card(page, "butter").waitFor();
  const restored = (await t.db())["containers/box-1/items/butter"];
  assertEqual({ name: restored.name, qty: restored.qty, unit: restored.unit, photo: restored.photo }, { name: "Butter", qty: 1, unit: "Packung", photo: PHOTO }, "Wiederhergestellter Artikel");
  assert(await card(page, "butter").locator("img.thumb").count() === 1, "Foto wird nach Rückgängig wieder angezeigt");
  await t.done();
});

test("3 Hinzufügen: gleiche Einheit addiert, andere Einheit fragt nach", async () => {
  const t = await open("index.html?c=kuehlschrank", {
    seed: {
      "containers/kuehlschrank": { name: "Kühlschrank" },
      "containers/kuehlschrank/items/milch": { name: "Milch", qty: 2, unit: "Stk", photo: PHOTO },
    },
  });
  const { page } = t;
  await page.waitForSelector('#items .card[data-id="milch"]');
  await page.selectOption('#add-item-form select[name="unit"]', "g");
  await page.fill('#add-item-form input[name="name"]', "milch");
  assertEqual(await page.inputValue('#add-item-form select[name="unit"]'), "Stk", "Einheit des bestehenden Artikels wird übernommen");
  assert(await page.isVisible("#add-hint"), "Hinweis 'Schon vorhanden' sichtbar");
  await page.fill('#add-item-form input[name="qty"]', "3");
  await page.click('#add-item-form button[type="submit"]');
  await waitUntil(page, () => document.querySelector('#items .card[data-id="milch"] .qty-value').textContent === "5");
  let w = await t.writes();
  assertEqual(w.length, 1, "ein Schreibzugriff");
  assertEqual({ op: w[0].op, merge: w[0].options && w[0].options.merge, qty: w[0].data.qty, name: w[0].data.name, photo: "photo" in w[0].data }, { op: "set", merge: true, qty: { __op: "increment", by: 3 }, name: "Milch", photo: false }, "Addieren per increment, Name bleibt");
  assert((await page.textContent("#toast")).includes('"Milch": jetzt 5 Stk'), "Toast nach Addieren");

  // andere Einheit → confirm; zuerst abbrechen
  page.__nextDialog = () => "dismiss";
  await page.fill('#add-item-form input[name="name"]', "Milch");
  await page.selectOption('#add-item-form select[name="unit"]', "ml");
  await page.fill('#add-item-form input[name="qty"]', "500");
  await page.click('#add-item-form button[type="submit"]');
  await page.waitForTimeout(200);
  assertEqual(t.dialogs.length, 1, "confirm-Dialog erscheint");
  assertEqual(t.dialogs[0].type, "confirm", "Dialogtyp");
  assert(t.dialogs[0].message.includes("(5 Stk)") && t.dialogs[0].message.includes("500 ml"), `Dialogtext: ${t.dialogs[0].message}`);
  assertEqual((await t.writes()).length, 1, "Abbrechen schreibt nichts");

  // jetzt bestätigen (Formular wurde nach Abbrechen nicht geleert)
  page.__nextDialog = () => "accept";
  assertEqual(await page.inputValue('#add-item-form input[name="name"]'), "Milch", "Eingabe bleibt nach Abbrechen stehen");
  await page.click('#add-item-form button[type="submit"]');
  await waitUntil(page, () => document.querySelector('#items .card[data-id="milch"] .qty-value').textContent === "500");
  const item = (await t.db())["containers/kuehlschrank/items/milch"];
  assertEqual({ qty: item.qty, unit: item.unit, photo: item.photo === PHOTO }, { qty: 500, unit: "ml", photo: true }, "Ersetzt mit neuer Einheit, Foto bleibt");
  await t.done();
});

test("4 Verschieben über Detaildialog (neu im Ziel und Addieren im Ziel)", async () => {
  const t = await open("index.html?c=keller", {
    seed: {
      "containers/keller": { name: "Keller" },
      "containers/garage": { name: "Garage" },
      "containers/dachboden": { name: "Dachboden" },
      "containers/keller/items/nudeln": { name: "Nudeln", qty: 3, unit: "Packung", photo: PHOTO },
      "containers/keller/items/reis": { name: "Reis", qty: 2, unit: "Stk", photo: PHOTO },
      "containers/garage/items/reis": { name: "Reis", qty: 4, unit: "Stk" },
    },
  });
  const { page } = t;
  await page.waitForSelector('#items .card[data-id="nudeln"]');

  // Nudeln → Dachboden (gibt es dort noch nicht)
  await card(page, "nudeln").locator('[data-action="details"]').click();
  await page.click('.photo-dialog [data-action="move"]');
  await page.waitForSelector('.photo-dialog [data-action="ok"]:not([disabled])');
  const options = await page.locator("#move-target option").allTextContents();
  assertEqual(options, ["Dachboden", "Garage"], "Ziel-Behälter (ohne aktuellen, alphabetisch)");
  await page.selectOption("#move-target", "dachboden");
  await page.click('.photo-dialog [data-action="ok"]');
  await card(page, "nudeln").waitFor({ state: "detached" });
  let db = await t.db();
  assertEqual(db["containers/dachboden/items/nudeln"] && { ...db["containers/dachboden/items/nudeln"], updatedAt: undefined }, { name: "Nudeln", qty: 3, unit: "Packung", photo: PHOTO }, "Artikel im Ziel");
  assert(!db["containers/keller/items/nudeln"], "Artikel im Quell-Behälter gelöscht");
  await page.locator("#toast.show button", { hasText: "Öffnen" }).waitFor();
  let w = await t.writes();
  assertEqual(w.map((x) => `${x.op} ${x.path}`), ["batch.set containers/dachboden/items/nudeln", "batch.delete containers/keller/items/nudeln"], "Verschieben als ein Batch");

  // Reis → Garage (gibt es dort schon, gleiche Einheit, ohne Foto)
  await card(page, "reis").locator('[data-action="details"]').click();
  await page.click('.photo-dialog [data-action="move"]');
  await page.waitForSelector('.photo-dialog [data-action="ok"]:not([disabled])');
  await page.selectOption("#move-target", "garage");
  await page.click('.photo-dialog [data-action="ok"]');
  await card(page, "reis").waitFor({ state: "detached" });
  db = await t.db();
  assertEqual({ qty: db["containers/garage/items/reis"].qty, photo: db["containers/garage/items/reis"].photo === PHOTO }, { qty: 6, photo: true }, "Menge im Ziel addiert, Foto übernommen");
  w = (await t.writes()).slice(2);
  assertEqual(w.map((x) => `${x.op} ${x.path}`), ["batch.update containers/garage/items/reis", "batch.delete containers/keller/items/reis"], "Batch beim Addieren");
  assertEqual(w[0].data.qty, { __op: "increment", by: 2 }, "increment beim Verschieben");

  // "Öffnen" im Toast führt zum Ziel
  await page.click("#toast.show button");
  await page.waitForURL(/\?c=garage#i=reis$/);
  await page.waitForSelector('#items .card[data-id="reis"]');
  await t.done();
});

test("5 XSS: Namen werden als Text angezeigt", async () => {
  const t = await open("index.html", {
    seed: {
      "containers/xss-box": { name: XSS },
      "containers/normal": { name: "Normal" },
      "containers/xss-box/items/img-src-x": { name: XSS, qty: 1, unit: "Stk", photo: "javascript:alert(1)" },
      "containers/normal/items/salz": { name: "Salz", qty: 1, unit: XSS },
    },
  });
  const { page } = t;
  await page.waitForSelector("#container-list a.card");
  assert((await page.locator("#container-list a.card strong").allTextContents()).includes(XSS), "Behältername als Text in Übersicht");
  await page.fill("#search", "img src");
  await page.waitForSelector("#search-results a.card.result");
  assertEqual(await page.locator("#search-results a.card.result strong").first().textContent(), XSS, "Artikelname als Text in Suche");
  assertEqual(await page.locator("#search-results a.card.result small b").first().textContent(), XSS, "Behältername als Text in Suche");
  await page.fill("#search", "<script>");
  await page.waitForSelector("#search-results .empty-hint");

  await page.goto(server.url + "index.html?c=xss-box");
  await page.waitForSelector('#items .card[data-id="img-src-x"]');
  assertEqual(await page.textContent("#container-title"), XSS, "Titel als Text");
  assertEqual(await card(page, "img-src-x").locator("strong").textContent(), XSS, "Artikelname als Text");
  assertEqual(await card(page, "img-src-x").locator("img").count(), 0, "unsicheres Foto wird nicht angezeigt");
  await page.fill('#add-item-form input[name="name"]', XSS); // Hinweis "Schon vorhanden"
  await card(page, "img-src-x").locator('[data-action="details"]').click();
  assertEqual(await page.textContent(".photo-dialog strong"), XSS, "Name im Detaildialog");
  await page.click('.photo-dialog [data-action="close"]');

  await page.goto(server.url + "index.html?c=normal");
  await page.waitForSelector('#items .card[data-id="salz"]');
  assertEqual(await card(page, "salz").locator("small").textContent(), XSS, "Einheit als Text");
  await card(page, "salz").locator('[data-action="details"]').click();
  await page.click('.photo-dialog [data-action="move"]');
  await page.waitForSelector('.photo-dialog [data-action="ok"]:not([disabled])');
  assertEqual(await page.locator("#move-target option").allTextContents(), [XSS], "Behältername im Verschieben-Dialog");

  await page.goto(server.url + "qr.html?c=xss-box&n=" + encodeURIComponent(XSS) + "&p=" + encodeURIComponent(XSS));
  await page.waitForSelector(".qr-card svg");
  assertEqual(await page.textContent(".qr-card .label"), XSS, "Name auf QR-Bogen");
  assertEqual(await page.textContent(".qr-card .where"), XSS, "Ort auf QR-Bogen");

  await page.waitForTimeout(300);
  assertEqual(await page.evaluate(() => window.__xss), undefined, "window.__xss");
  assert(!t.net.external.some((u) => /\/x$/.test(u)) , "kein Bild-Request für src=x");
  await t.done();
});

test("6 CSP: keine Verletzungen in index.html und qr.html, QR lokal als SVG", async () => {
  const t = await open("index.html", {
    seed: {
      "containers/box-3": { name: "Box 3" },
      "containers/box-3/items/tee": { name: "Tee", qty: 2, unit: "Packung", photo: PHOTO },
    },
  });
  const { page } = t;
  await page.waitForSelector("#container-list a.card");
  await page.fill("#search", "tee");
  await page.waitForSelector("#search-results a.card.result img.thumb");
  await page.click("#container-list a.card");
  await page.waitForSelector('#items .card[data-id="tee"] img.thumb');
  await card(page, "tee").locator('[data-action="details"]').click();
  await page.waitForSelector(".photo-dialog img");
  const external = t.net.external.length;

  await page.goto(server.url + "qr.html?c=box-3&n=Box%203");
  await page.waitForSelector(".qr-card svg");
  const qr = await page.evaluate(() => ({
    cards: document.querySelectorAll(".qr-card").length,
    svgChildren: document.querySelector(".qr-card svg").querySelectorAll("path, rect").length,
    label: document.querySelector(".qr-card .label").textContent,
    url: document.querySelector(".qr-card .url").textContent,
    printEnabled: !document.getElementById("print-btn").disabled,
  }));
  assertEqual(qr.cards, 1, "ein QR-Code");
  assert(qr.svgChildren > 0, "SVG enthält Pfade");
  assertEqual(qr.label, "Box 3", "Beschriftung");
  assertEqual(qr.url, server.url + "index.html?c=box-3", "Link im QR-Code (nur die ID)");
  assert(qr.printEnabled, "Drucken-Knopf aktiv");

  // Ohne Behälterliste (weder im Link noch von der App auf diesem Gerät): nur Hinweis auf die App.
  await page.evaluate(() => localStorage.clear());
  await page.goto(server.url + "qr.html");
  await page.waitForSelector("#empty:not([hidden])");
  assertEqual(await page.locator("textarea, .qr-card").count(), 0, "kein Formular, keine Codes");
  assertEqual(await page.locator("#toolbar").isVisible(), false, "keine Filterleiste ohne Behälter");
  assertEqual(t.net.external.slice(external), [], "qr.html: keine externen Anfragen");
  await t.done();
});

test("8 Doppeltipp auf − rechnet mit aktuellem Stand (kein qty 0)", async () => {
  const t = await open("index.html?c=box-1", {
    seed: {
      "containers/box-1": { name: "Box 1" },
      "containers/box-1/items/milch": { name: "Milch", qty: 2, unit: "Stk" },
    },
  });
  const { page } = t;
  await page.waitForSelector('#items .card[data-id="milch"]');
  // Zwei Klicks im selben Task – dazwischen kann kein Snapshot ankommen.
  await page.evaluate(() => {
    const b = document.querySelector('#items .card[data-id="milch"] [data-action="dec"]');
    b.click();
    b.click();
  });
  await card(page, "milch").waitFor({ state: "detached" });
  const w = await t.writes();
  assertEqual(w.map((x) => x.op), ["update", "delete"], "Erst −1, dann Löschen");
  assert(!("containers/box-1/items/milch" in (await t.db())), "Artikel ist gelöscht statt qty 0");
  await t.done();
});

test("9 Ungültiger Link ?c=a/b bleibt nicht bei 'Lade…' hängen", async () => {
  const t = await open("index.html?c=a%2Fb", { seed: {} });
  const { page } = t;
  await page.waitForSelector("text=Ungültiger Behälter-Link");
  assertEqual(await t.writes(), [], "Nichts geschrieben");
  await t.done();
});

test("7 Mobil 360×740: keine horizontale Scrollbar, +/− mind. 44px", async () => {
  const long = "Bio-Vollmilch-Hochpasteurisiert-Laktosefrei-Extra-Langer-Artikelname-ohne-Leerzeichen-1234567890";
  const t = await open("index.html?c=box-1", {
    viewport: { width: 360, height: 740 },
    isMobile: true,
    hasTouch: true,
    seed: {
      "containers/box-1": { name: "Ein sehr langer Behältername für den Vorratsschrank im Keller links" },
      "containers/box-1/items/a": { name: long, qty: 12345, unit: "Packung", photo: PHOTO },
      "containers/box-1/items/b": { name: "Milch mit einem ziemlich langen Namen aus mehreren Wörtern", qty: 1, unit: "ml" },
    },
  });
  const { page } = t;
  await page.waitForSelector('#items .card[data-id="a"]');
  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const btns = [...document.querySelectorAll("#items button.round")].map((b) => b.getBoundingClientRect()).map((r) => ({ w: r.width, h: r.height }));
    const overflowing = [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > de.clientWidth + 0.5).map((el) => el.tagName + "." + el.className);
    return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, bodyScroll: document.body.scrollWidth, btns, overflowing };
  });
  assert(m.scrollWidth <= m.clientWidth, `horizontale Scrollbar: scrollWidth ${m.scrollWidth} > ${m.clientWidth}; zu breit: ${m.overflowing.join(", ")}`);
  assert(m.btns.length === 4, "4 Runde Knöpfe");
  for (const b of m.btns) assert(b.w >= 44 && b.h >= 44, `+/− Knopf zu klein: ${b.w}×${b.h}`);
  await page.locator('[data-action="inc"]').first().tap();
  await waitUntil(page, () => document.querySelector('#items .card[data-id="a"] .qty-value').textContent === "12346");
  await t.done();
});

// ---------------------------------- Runde 2 ----------------------------------

function strip(doc) {
  if (!doc) return doc;
  const { updatedAt, createdAt, ...rest } = doc;
  void updatedAt; void createdAt;
  return rest;
}

const HOUSE = {
  "containers/kueche": { name: "Küche", type: "raum" },
  "containers/kuehlschrank": { name: "Kühlschrank", type: "schrank", parent: "kueche" },
  "containers/gemuesefach": { name: "Gemüsefach", type: "fach", parent: "kuehlschrank" },
  "containers/fach-1": { name: "Fach 1", type: "fach", parent: "keller" },
  "containers/keller": { name: "Keller" },
  "containers/lose-box": { name: "Lose Box", type: "box" },
  "containers/gemuesefach/items/karotten": { name: "Karotten", qty: 3, unit: "Stk" },
  "containers/kueche/items/salz": { name: "Salz", qty: 1, unit: "Packung" },
};

test("10 Einheiten und Schrittweite ±50 bei g/ml", async () => {
  const t = await open("index.html?c=vorrat", {
    seed: {
      "containers/vorrat": { name: "Vorrat" },
      "containers/vorrat/items/mehl": { name: "Mehl", qty: 500, unit: "g" },
      "containers/vorrat/items/rest": { name: "Rest", qty: 30, unit: "ml" },
      "containers/vorrat/items/wasser": { name: "Wasser", qty: 2, unit: "l" },
    },
  });
  const { page } = t;
  await page.waitForSelector('#items .card[data-id="mehl"]');
  const units = await page.locator('#add-item-form select[name="unit"] option').allTextContents();
  assertEqual(units, ["Stk", "Packung", "Flasche", "Dose", "Glas", "g", "kg", "ml", "l"], "Einheiten im Formular");
  assertEqual(await card(page, "mehl").locator('[data-action="inc"]').getAttribute("aria-label"), "50 mehr", "aria-label");

  await card(page, "mehl").locator('[data-action="inc"]').click();
  await waitUntil(page, () => document.querySelector('#items .card[data-id="mehl"] .qty-value').textContent === "550");
  await card(page, "wasser").locator('[data-action="dec"]').click();
  await waitUntil(page, () => document.querySelector('#items .card[data-id="wasser"] .qty-value').textContent === "1");
  let w = await t.writes();
  assertEqual(w.map((x) => x.data && x.data.qty), [{ __op: "increment", by: 50 }, { __op: "increment", by: -1 }], "increment 50 bzw. 1");

  // 30 ml − 50 → entfernen (mit Rückgängig)
  await card(page, "rest").locator('[data-action="dec"]').click();
  await card(page, "rest").waitFor({ state: "detached" });
  await page.locator("#toast.show button", { hasText: "Rückgängig" }).click();
  await card(page, "rest").waitFor();
  assertEqual(strip((await t.db())["containers/vorrat/items/rest"]), { name: "Rest", qty: 30, unit: "ml" }, "wiederhergestellt");

  // neue Einheit anlegen
  await page.fill('#add-item-form input[name="name"]', "Olivenöl");
  await page.selectOption('#add-item-form select[name="unit"]', "Flasche");
  await page.click('#add-item-form button[type="submit"]');
  await card(page, "olivenöl").waitFor();
  assertEqual((await t.db())["containers/vorrat/items/olivenöl"].unit, "Flasche", "Flasche gespeichert");
  await t.done();
});

test("11 Hierarchie: oberste Ebene, Pfad, Unterbehälter, Suche mit Pfad, liegt-in ändern", async () => {
  const t = await open("index.html", { seed: HOUSE });
  const { page } = t;
  await page.waitForSelector("#container-list a.card");
  assertEqual(await page.locator("#container-list a.card strong").allTextContents(), ["Keller", "Küche", "Lose Box"], "nur oberste Ebene");
  assert((await page.locator('#container-list a.card[data-cid="kueche"] small').textContent()).includes("Raum · 1 darin"), "Typ und Anzahl darin");

  await page.fill("#search", "karotten");
  await page.waitForSelector("#search-results a.card.result:not([data-cid])");
  assertEqual(await page.locator("#search-results a.card.result:not([data-cid]) small b").first().textContent(), "Küche › Kühlschrank › Gemüsefach", "voller Pfad im Treffer");
  await page.fill("#search", "küche salz");
  await waitUntil(page, () => document.querySelectorAll("#search-results a.card.result:not([data-cid])").length === 1);
  await page.fill("#search", "gemüsefach");
  await page.waitForSelector('#search-results a.card.result[data-cid="gemuesefach"]');

  // Kühlschrank: Pfad oben, Unterbehälter
  await page.goto(server.url + "index.html?c=kuehlschrank");
  await page.waitForSelector('#children a.card[data-cid="gemuesefach"]');
  assertEqual((await page.textContent("#breadcrumb")).trim(), "Küche", "Breadcrumb");
  assertEqual(await page.textContent("#container-type"), "Schrank", "Typ");
  assertEqual(await page.locator("#container-type svg.type-icon").count(), 1, "Typ-Icon unter dem Titel");
  assertEqual(await page.locator('#children a.card[data-cid="gemuesefach"] svg.type-icon').count(), 1, "Typ-Icon bei Unterbehälter");
  assertEqual(await page.getAttribute("#breadcrumb a", "href"), "index.html?c=kueche", "Breadcrumb-Link");

  // Unterbehälter anlegen: "Fach 1" gibt es schon im Keller → eigene ID
  await page.click(".sub-form summary");
  await page.fill('#new-child-form input[name="name"]', "Fach 1");
  await page.selectOption('#new-child-form select[name="type"]', "fach");
  await page.click('#new-child-form button[type="submit"]');
  await page.waitForSelector('#children a.card[data-cid="kuehlschrank-fach-1"]');
  assertEqual(strip((await t.db())["containers/kuehlschrank-fach-1"]), { name: "Fach 1", parent: "kuehlschrank", type: "fach" }, "neuer Unterbehälter");
  assertEqual(strip((await t.db())["containers/fach-1"]), { name: "Fach 1", type: "fach", parent: "keller" }, "bestehender unverändert");

  // Einstellungen: Ziele ohne sich selbst und eigene Unterbehälter (kein Kreis)
  await page.click("#edit-btn");
  const opts = await page.locator("#cs-parent option").evaluateAll((os) => os.map((o) => o.value));
  assert(!opts.includes("kuehlschrank") && !opts.includes("gemuesefach") && !opts.includes("kuehlschrank-fach-1"), `Kreis-Ziele angeboten: ${opts}`);
  assert(opts.includes("") && opts.includes("lose-box") && opts.includes("kueche"), `Ziele: ${opts}`);
  assertEqual(await page.inputValue("#cs-parent"), "kueche", "aktueller Elternteil vorausgewählt");
  // In die lose Box legen und umbenennen
  await page.fill("#cs-name", "Kühlschrank gross");
  await page.selectOption("#cs-parent", "lose-box");
  await page.click('.photo-dialog [data-action="save"]');
  await waitUntil(page, () => document.querySelector("#breadcrumb").textContent.trim() === "Lose Box");
  assertEqual(strip((await t.db())["containers/kuehlschrank"]), { name: "Kühlschrank gross", type: "schrank", parent: "lose-box" }, "gespeichert");
  // Oberste Ebene, Typ entfernen → Felder gelöscht
  await page.click("#edit-btn");
  await page.selectOption("#cs-parent", "");
  await page.selectOption("#cs-type", "");
  await page.click('.photo-dialog [data-action="save"]');
  await waitUntil(page, () => document.querySelector("#breadcrumb").hidden);
  assertEqual(strip((await t.db())["containers/kuehlschrank"]), { name: "Kühlschrank gross" }, "parent/type entfernt");
  await t.done();
});

test("12 Behälter löschen nur wenn leer, mit Rückgängig", async () => {
  const t = await open("index.html?c=kuehlschrank", { seed: HOUSE });
  const { page } = t;
  await page.waitForSelector('#children a.card[data-cid="gemuesefach"]');
  await page.click("#edit-btn");
  await page.click('.photo-dialog [data-action="delete"]');
  await page.click('.photo-dialog [data-action="delete"].confirm'); // zweiter Tipp
  await waitUntil(page, () => document.querySelector("#cs-hint").textContent.includes("Gemüsefach"));
  await page.click('.photo-dialog [data-action="close"]');

  await page.goto(server.url + "index.html?c=gemuesefach");
  await page.waitForSelector('#items .card[data-id="karotten"]');
  await page.click("#edit-btn");
  await page.click('.photo-dialog [data-action="delete"]');
  await page.click('.photo-dialog [data-action="delete"].confirm'); // zweiter Tipp
  await waitUntil(page, () => document.querySelector("#cs-hint").textContent.includes("1 Artikel"));
  await page.click('.photo-dialog [data-action="close"]');
  assert(!(await t.writes()).some((x) => x.op === "delete"), "nichts gelöscht");

  // leeren und löschen
  await card(page, "karotten").locator('[data-action="del"]').click();
  await card(page, "karotten").locator('[data-action="del"].confirm').click(); // zweiter Tipp
  await card(page, "karotten").waitFor({ state: "detached" });
  await page.click("#edit-btn");
  await page.click('.photo-dialog [data-action="delete"]');
  await page.click('.photo-dialog [data-action="delete"].confirm'); // zweiter Tipp
  await page.waitForSelector("#undo-delete");
  assert(!("containers/gemuesefach" in (await t.db())), "Behälter gelöscht");
  await page.waitForTimeout(200);
  assert(!("containers/gemuesefach" in (await t.db())), "nicht automatisch wieder angelegt");
  await page.click("#undo-delete");
  await page.waitForURL(/\?c=gemuesefach$/);
  await page.waitForSelector("#breadcrumb a");
  assertEqual(strip((await t.db())["containers/gemuesefach"]), { name: "Gemüsefach", type: "fach", parent: "kuehlschrank" }, "wiederhergestellt mit Typ und Ort");
  await t.done();
});

test("13 Navigation unten und 'zuletzt geöffnet' (Handy 360 px)", async () => {
  const t = await open("index.html?c=keller", { seed: HOUSE, viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  const { page } = t;
  await page.waitForSelector("#bottom-nav:not([hidden])");
  await waitUntil(page, () => document.getElementById("container-title").textContent === "Keller");
  await page.goto(server.url + "index.html?c=gemuesefach");
  await page.waitForSelector('#items .card[data-id="karotten"]');
  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const nav = [...document.querySelectorAll("#bottom-nav a, #bottom-nav button")].map((b) => b.getBoundingClientRect()).map((r) => ({ w: r.width, h: r.height }));
    return { scroll: de.scrollWidth, client: de.clientWidth, nav };
  });
  assert(m.scroll <= m.client, `horizontale Scrollbar ${m.scroll} > ${m.client}`);
  assertEqual(m.nav.length, 5, "5 Einträge (Runde 3: + Läuft ab)");
  for (const b of m.nav) assert(b.w >= 44 && b.h >= 44, `Nav-Knopf zu klein: ${b.w}×${b.h}`);

  await page.locator('#bottom-nav [data-nav="recent"]').tap();
  await page.waitForSelector(".recent-list a.card");
  assertEqual(await page.locator(".recent-list a.card strong").allTextContents(), ["Küche › Kühlschrank › Gemüsefach", "Keller"], "zuletzt geöffnet, neuestes zuerst, mit Pfad");
  await page.click('.photo-dialog [data-action="close"]');

  await page.locator('#bottom-nav [data-nav="search"]').tap();
  await page.waitForURL(/index\.html$/);
  await waitUntil(page, () => document.activeElement && document.activeElement.id === "search");
  assertEqual(await page.locator("#recent .chip").allTextContents(), ["Gemüsefach", "Keller"], "Chips in der Übersicht");
  await page.locator('#bottom-nav [data-nav="scan"]').tap();
  await waitUntil(page, () => document.getElementById("toast").classList.contains("show"));
  await t.done();
});

test("14 Umzugsmodus: mehrere Artikel auf einmal verschieben, Rückgängig", async () => {
  const t = await open("index.html?c=keller", {
    seed: {
      "containers/keller": { name: "Keller" },
      "containers/garage": { name: "Garage" },
      "containers/keller/items/nudeln": { name: "Nudeln", qty: 3, unit: "Packung", mhd: "2027-01-01" },
      "containers/keller/items/reis": { name: "Reis", qty: 2, unit: "Packung", photo: PHOTO },
      "containers/keller/items/mehl": { name: "Mehl", qty: 1, unit: "g" },
      "containers/keller/items/zucker": { name: "Zucker", qty: 1, unit: "Packung" },
      "containers/garage/items/reis": { name: "Reis", qty: 4, unit: "Packung" },
      "containers/garage/items/mehl": { name: "Mehl", qty: 1, unit: "kg" },
    },
  });
  const { page } = t;
  await page.waitForSelector('#items .card[data-id="nudeln"]');
  await page.click("#select-btn");
  await page.waitForSelector("#select-bar:not([hidden])");
  for (const id of ["nudeln", "reis", "mehl"]) await page.click(`#items .select-card[data-id="${id}"]`);
  assertEqual(await page.textContent("#select-count"), "3 ausgewählt", "Zähler");
  page.__nextDialog = () => "accept"; // alert wegen Mehl (andere Einheit im Ziel)
  await page.click("#select-move");
  await page.waitForSelector('.photo-dialog [data-action="ok"]:not([disabled])');
  assertEqual(await page.textContent(".photo-dialog strong"), "3 Artikel", "Dialogtitel");
  const hasCamera = await page.evaluate(() => !!navigator.mediaDevices?.getUserMedia);
  assertEqual(await page.locator('.photo-dialog [data-action="scan"]').count(), hasCamera ? 1 : 0, "Scan-Knopf nur mit Kamera-API");
  await page.selectOption("#move-target", "garage");
  await page.click('.photo-dialog [data-action="ok"]');
  await card(page, "nudeln").waitFor({ state: "detached" });
  assert(t.dialogs.some((d) => d.type === "alert" && d.message.includes("Mehl")), "Hinweis zu Mehl");
  const w = await t.writes();
  assertEqual(w.map((x) => `${x.op} ${x.path}`), [
    "batch.set containers/garage/items/nudeln", "batch.delete containers/keller/items/nudeln",
    "batch.update containers/garage/items/reis", "batch.delete containers/keller/items/reis",
  ], "ein Batch, Mehl übersprungen");
  let db = await t.db();
  assertEqual(strip(db["containers/garage/items/nudeln"]), { name: "Nudeln", qty: 3, unit: "Packung", mhd: "2027-01-01" }, "MHD mitgenommen");
  assertEqual({ qty: db["containers/garage/items/reis"].qty, photo: db["containers/garage/items/reis"].photo === PHOTO }, { qty: 6, photo: true }, "addiert, Foto übernommen");
  assert(db["containers/keller/items/mehl"], "Mehl bleibt");
  assert(await page.isHidden("#select-bar"), "Auswahlmodus beendet");

  await page.locator("#toast.show button", { hasText: "Rückgängig" }).click();
  await card(page, "nudeln").waitFor();
  await card(page, "reis").waitFor();
  db = await t.db();
  assert(!db["containers/garage/items/nudeln"], "im Ziel wieder weg");
  assertEqual({ qty: db["containers/garage/items/reis"].qty, photo: "photo" in db["containers/garage/items/reis"] }, { qty: 4, photo: false }, "Ziel wie vorher");
  assertEqual(strip(db["containers/keller/items/reis"]), { name: "Reis", qty: 2, unit: "Packung", photo: PHOTO }, "Quelle wie vorher");
  assertEqual(strip(db["containers/keller/items/nudeln"]), { name: "Nudeln", qty: 3, unit: "Packung", mhd: "2027-01-01" }, "Quelle mit MHD");
  await t.done();
});

const FAKE_OCR = `export async function recognizeText(canvas, onProgress) { onProgress(1); return "MHD l2.O3.27  L4711"; }`;

test("15 MHD: Schnellwahl, Markierung, entfernen, Kamera (OCR-Fake und GS1-Fake) mit Bestätigung", async () => {
  const ocrRequests = [];
  const t = await open("index.html?c=kuehlschrank", {
    seed: {
      "containers/kuehlschrank": { name: "Kühlschrank" },
      "containers/kuehlschrank/items/milch": { name: "Milch", qty: 1, unit: "l" },
      "containers/kuehlschrank/items/joghurt": { name: "Joghurt", qty: 2, unit: "Stk", mhd: "2020-01-01" },
      "containers/kuehlschrank/items/kaese": { name: "Käse", qty: 1, unit: "Stk" },
    },
    routes: [["**/ocr.js", (route) => { ocrRequests.push(route.request().url()); return route.fulfill({ status: 200, contentType: "text/javascript", body: FAKE_OCR }); }]],
  });
  const { page } = t;
  await page.waitForSelector('#items .card[data-id="milch"]');
  assertEqual(ocrRequests, [], "Texterkennung wird beim Start nicht geladen");
  assert(await card(page, "joghurt").locator(".mhd-expired").count() === 1, "abgelaufen markiert");
  assertEqual(await card(page, "milch").locator(".mhd").count(), 0, "ohne MHD keine Markierung");

  const expected = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 3); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  await card(page, "milch").locator('[data-action="details"]').click();
  await page.click('.photo-dialog [data-action="mhd"]');
  await page.click('.photo-dialog [data-add="3"]');
  await card(page, "milch").locator(".mhd-soon").waitFor();
  let w = await t.writes();
  assertEqual({ op: w[0].op, keys: w[0].keys.sort(), mhd: w[0].data.mhd }, { op: "update", keys: ["mhd", "updatedAt"], mhd: expected }, "nur mhd geschrieben");

  // Kalender
  await card(page, "milch").locator('[data-action="details"]').click();
  await page.click('.photo-dialog [data-action="mhd"]');
  await page.fill("#mhd-date", "2030-05-17");
  await page.click('.photo-dialog [data-action="date"]');
  await waitUntil(page, () => document.querySelector('#items .card[data-id="milch"] .mhd-ok')?.textContent === "MHD 17.05.2030");

  // Entfernen
  await card(page, "joghurt").locator('[data-action="details"]').click();
  await page.click('.photo-dialog [data-action="mhd"]');
  await page.click('.photo-dialog [data-action="clear"]');
  await waitUntil(page, () => !document.querySelector('#items .card[data-id="joghurt"] .mhd'));
  assert(!("mhd" in (await t.db())["containers/kuehlschrank/items/joghurt"]), "Feld entfernt");

  // Kamera → OCR (Fake) → Vorschlag muss bestätigt werden
  const jpeg = Buffer.from(PHOTO.split(",")[1], "base64");
  await card(page, "kaese").locator('[data-action="details"]').click();
  await page.click('.photo-dialog [data-action="mhd"]');
  const chooser = page.waitForEvent("filechooser");
  await page.click('.photo-dialog [data-action="camera"]');
  await (await chooser).setFiles({ name: "etikett.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await page.waitForSelector('.photo-dialog [data-date="2027-03-12"]');
  assertEqual(ocrRequests.length, 1, "ocr.js erst jetzt geladen");
  assert(!("mhd" in (await t.db())["containers/kuehlschrank/items/kaese"]), "ohne Bestätigung nichts gespeichert");
  assert((await page.textContent(".photo-dialog .ocr-text")).includes("MHD"), "gelesener Text angezeigt");
  await page.click('.photo-dialog [data-date="2027-03-12"]');
  await waitUntil(page, () => document.querySelector('#items .card[data-id="kaese"] .mhd')?.textContent === "MHD 12.03.2027");
  await t.done();
});

test("16 MHD aus GS1-DataMatrix (BarcodeDetector-Fake, AI 17)", async () => {
  const t = await open("index.html?c=kuehlschrank", {
    seed: {
      "containers/kuehlschrank": { name: "Kühlschrank" },
      "containers/kuehlschrank/items/kaese": { name: "Käse", qty: 1, unit: "Stk" },
    },
    routes: [["**/ocr.js", (route) => route.abort()]],
    init: () => {
      window.BarcodeDetector = class {
        static async getSupportedFormats() { return ["qr_code", "data_matrix"]; }
        constructor(opts) { this.formats = opts.formats; }
        async detect() { return [{ rawValue: "]d2010401234567890317281130\u001d10LOT7" }]; }
      };
    },
  });
  const { page } = t;
  await page.waitForSelector('#items .card[data-id="kaese"]');
  await card(page, "kaese").locator('[data-action="details"]').click();
  await page.click('.photo-dialog [data-action="mhd"]');
  const chooser = page.waitForEvent("filechooser");
  await page.click('.photo-dialog [data-action="camera"]');
  await (await chooser).setFiles({ name: "code.jpg", mimeType: "image/jpeg", buffer: Buffer.from(PHOTO.split(",")[1], "base64") });
  await page.waitForSelector('.photo-dialog [data-date="2028-11-30"]');
  assert((await page.textContent(".photo-dialog")).includes("aus dem Code"), "Quelle Code");
  await page.click('.photo-dialog [data-date="2028-11-30"]');
  await waitUntil(page, () => document.querySelector('#items .card[data-id="kaese"] .mhd')?.textContent === "MHD 30.11.2028");
  await t.done();
});

test("17 Auto-Anlegen nur von aussen (QR), nicht über App-Links; Löschen auf anderem Gerät", async () => {
  const t = await open("index.html?c=neue-box&n=Neue%20Box", { seed: { "containers/keller": { name: "Keller" } } });
  const { page } = t;
  await waitUntil(page, () => document.getElementById("container-title").textContent === "Neue Box");
  assertEqual(strip((await t.db())["containers/neue-box"]), { name: "Neue Box" }, "von aussen (QR) angelegt");

  // Ein anderes Gerät löscht den Behälter, während er hier offen ist.
  await page.evaluate(async () => {
    const fs = await import("/vendor/firebase-10.14.1/firebase-firestore.js");
    await fs.deleteDoc(fs.doc(fs.getFirestore(), "containers", "neue-box"));
  });
  await page.waitForSelector("text=inzwischen");
  await page.waitForTimeout(200);
  assert(!("containers/neue-box" in (await t.db())), "nicht wieder angelegt");
  assertEqual(await page.locator("#add-item-form").count(), 0, "kein Formular mehr zum Hineinschreiben");

  // Link innerhalb der App (z.B. Zurück, Zuletzt) → nicht anlegen
  await page.click("text=Zur Übersicht");
  await page.waitForSelector("#container-list a.card");
  await page.evaluate(() => { location.href = "index.html?c=keller-2"; });
  await page.waitForSelector("#items .empty-hint");
  await page.waitForTimeout(300);
  assert(!("containers/keller-2" in (await t.db())), "über App-Link nicht angelegt");
  assert(!(await t.writes()).some((w) => w.path === "containers/keller-2"), "keine Schreibzugriffe");
  await t.done();
});

test("18 Umzug: 'Alle' wählt nur gefilterte Artikel; Dialog über der Leiste", async () => {
  const seed = { "containers/keller": { name: "Keller" }, "containers/garage": { name: "Garage" } };
  for (let i = 1; i <= 9; i++) seed[`containers/keller/items/dose-${i}`] = { name: `Dose ${i}`, qty: 1, unit: "Dose" };
  seed["containers/keller/items/milch"] = { name: "Milch", qty: 1, unit: "l" };
  const t = await open("index.html?c=keller", { seed, viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
  const { page } = t;
  await page.waitForSelector('#items .card[data-id="milch"]');
  await page.fill("#item-filter", "milch");
  await page.click("#select-btn");
  await page.click("#select-all");
  assertEqual(await page.textContent("#select-count"), "1 ausgewählt", "nur der sichtbare Artikel");
  await page.click("#select-move");
  await page.waitForSelector('.photo-dialog [data-action="ok"]:not([disabled])');
  const onTop = await page.evaluate(() => {
    const btn = document.querySelector('.photo-dialog [data-action="close"]');
    const r = btn.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return btn.contains(el) || el === btn;
  });
  assert(onTop, "Abbrechen-Knopf wird nicht von der Leiste verdeckt");
  await page.click('.photo-dialog [data-action="ok"]');
  await card(page, "milch").waitFor({ state: "detached" });
  const db = await t.db();
  assert(db["containers/garage/items/milch"] && db["containers/keller/items/dose-1"], "nur Milch verschoben");
  await t.done();
});

// Lokales Datum in `days` Tagen als "YYYY-MM-DD" (Testrechner und Browser haben dieselbe Zeitzone).
function isoIn(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

test("19 Liste 'läuft bald ab': Filter 3/7 Tage, Sortierung, Pfad, Öffnen markiert (360 px)", async () => {
  const t = await open("index.html", {
    viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true,
    seed: {
      ...HOUSE,
      "containers/kuehlschrank/items/milch": { name: "Milch", qty: 1, unit: "l", mhd: isoIn(0) },
      "containers/kuehlschrank/items/joghurt": { name: "Joghurt", qty: 2, unit: "Stk", mhd: isoIn(3), photo: PHOTO },
      "containers/gemuesefach/items/salat": { name: "Salat mit einem sehr langen Namen, der umbrechen muss", qty: 1, unit: "Stk", mhd: isoIn(-2) },
      "containers/keller/items/butter": { name: "Butter", qty: 1, unit: "Packung", mhd: isoIn(5) },
      "containers/keller/items/senf": { name: "Senf", qty: 1, unit: "Glas", mhd: isoIn(8) },
      "containers/lose-box/items/xss": { name: XSS, qty: 1, unit: "Stk", mhd: isoIn(1) },
    },
  });
  const { page } = t;
  await page.waitForSelector("#container-list a.card");
  assertEqual(await page.evaluate(() => window.__queries), [], "Übersicht lädt keine Artikel");
  assert(await page.locator('.list-links a[href="index.html?liste=ablauf"]').count() === 1, "Link in der Übersicht");

  await page.locator('#bottom-nav [data-nav="ablauf"]').tap();
  await page.waitForURL(/\?liste=ablauf$/);
  await page.waitForSelector("#expiring-list a.card");
  assertEqual(await page.getAttribute('#bottom-nav [data-nav="ablauf"]', "aria-current"), "page", "Leiste markiert");
  const rows = () => page.locator("#expiring-list a.card").evaluateAll((as) => as.map((a) => ({
    name: a.querySelector("strong").textContent,
    when: a.querySelector(".mhd").textContent,
    cls: a.querySelector(".mhd").className,
    where: a.querySelector("small b").textContent,
    href: a.getAttribute("href"),
  })));
  let r = await rows();
  assertEqual(r.map((x) => x.name), ["Salat mit einem sehr langen Namen, der umbrechen muss", "Milch", XSS, "Joghurt"], "≤ 3 Tage, nach Datum");
  assert(r[0].when.startsWith("abgelaufen seit 2 Tagen") && r[0].cls.includes("mhd-expired"), `abgelaufen: ${r[0].when}`);
  assert(r[1].when.startsWith("heute") && r[1].cls.includes("mhd-soon"), `heute: ${r[1].when}`);
  assert(r[3].when.startsWith("in 3 Tagen"), `in 3 Tagen: ${r[3].when}`);
  assertEqual(r[0].where, "Küche › Kühlschrank › Gemüsefach", "voller Pfad");
  assertEqual(r[3].href, "index.html?c=kuehlschrank#i=joghurt", "Link mit Markierung");
  assert(await page.evaluate(() => !window.__xss), "XSS nicht ausgeführt");
  assertEqual(await page.textContent("#expiring-count"), "4 Artikel, davon 1 abgelaufen", "Zähler");
  assertEqual(await page.getAttribute('[data-days="3"]', "aria-pressed"), "true", "3 Tage aktiv");

  // Handy: keine horizontale Scrollbar, Knöpfe gross genug
  const m = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
    sizes: [...document.querySelectorAll(".segmented button, #expiring-list a.card, #bottom-nav a, #bottom-nav button")].map((b) => b.getBoundingClientRect()).map((x) => [x.width, x.height]),
  }));
  assert(m.scroll <= m.client, `horizontale Scrollbar ${m.scroll} > ${m.client}`);
  for (const [w, h] of m.sizes) assert(w >= 44 && h >= 44, `Ziel zu klein: ${w}×${h}`);

  // ≤ 7 Tage: Butter (in 5) dazu, Senf (in 8) nicht; keine neue Abfrage
  await page.locator('[data-days="7"]').tap();
  await waitUntil(page, () => document.querySelectorAll("#expiring-list a.card").length === 5);
  r = await rows();
  assertEqual(r[4].name, "Butter", "Butter am Ende");
  assert(r[4].cls.includes("mhd-ok"), "in 5 Tagen nicht orange");
  assertEqual(await page.evaluate(() => window.__queries), ["collectionGroup:items"], "eine einzige Abfrage aller Artikel");

  // Antippen öffnet den Behälter und markiert den Artikel
  await page.locator('#expiring-list a.card[data-id="joghurt"]').tap();
  await page.waitForURL(/\?c=kuehlschrank#i=joghurt$/);
  await page.waitForSelector('#items .card[data-id="joghurt"].highlight', { timeout: 3000 });

  // Zeitraum bleibt auf diesem Gerät gemerkt
  await page.goto(server.url + "index.html?liste=ablauf");
  await page.waitForSelector("#expiring-list a.card");
  assertEqual(await page.getAttribute('[data-days="7"]', "aria-pressed"), "true", "7 Tage gemerkt");

  // Nichts fällig → Hinweis
  await page.evaluate(async () => {
    const fs = await import("/vendor/firebase-10.14.1/firebase-firestore.js");
    for (const [c, i] of [["kuehlschrank", "milch"], ["kuehlschrank", "joghurt"], ["gemuesefach", "salat"], ["keller", "butter"], ["lose-box", "xss"]]) {
      await fs.deleteDoc(fs.doc(fs.getFirestore(), "containers", c, "items", i));
    }
  });
  await page.reload();
  await page.waitForSelector("#expiring-list .empty-hint:has-text('Nichts läuft')");
  await t.done();
});

// BarcodeDetector + Kamera für den In-App-Scanner fälschen. Codes kommen aus window.__scanQueue.
const FAKE_SCANNER = () => {
  window.__scanQueue = [];
  window.BarcodeDetector = class {
    static async getSupportedFormats() { return ["qr_code"]; }
    constructor(opts) { this.formats = opts.formats; }
    async detect() {
      const v = window.__scanQueue.shift();
      return v ? [{ rawValue: v, format: "qr_code" }] : [];
    }
  };
  const fakeGetUserMedia = async () => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext("2d");
    let n = 0;
    setInterval(() => { ctx.fillStyle = n++ % 2 ? "#333" : "#666"; ctx.fillRect(0, 0, 64, 64); }, 50);
    return c.captureStream(20);
  };
  if (!navigator.mediaDevices) Object.defineProperty(navigator, "mediaDevices", { value: {} });
  navigator.mediaDevices.getUserMedia = fakeGetUserMedia;
};

test("20 Umzug: Ziel per QR-Code scannen (BarcodeDetector-Fake), unbekannte Behälter abgelehnt", async () => {
  const t = await open("index.html?c=keller", {
    init: FAKE_SCANNER,
    seed: {
      "containers/keller": { name: "Keller" },
      "containers/dachboden": { name: "Dachboden" },
      "containers/garage": { name: "Garage", parent: "dachboden" },
      "containers/keller/items/nudeln": { name: "Nudeln", qty: 3, unit: "Packung" },
      "containers/keller/items/reis": { name: "Reis", qty: 2, unit: "Packung" },
      "containers/keller/items/salz": { name: "Salz", qty: 1, unit: "Packung" },
    },
  });
  const { page } = t;
  const scan = async (url) => {
    await page.click('.photo-dialog [data-action="scan"]');
    await page.waitForSelector(".photo-dialog video.scanner-video");
    await page.evaluate((u) => window.__scanQueue.push(u), url);
  };
  const hint = () => page.textContent("#move-hint");
  await page.waitForSelector('#items .card[data-id="nudeln"]');
  await page.click("#select-btn");
  for (const id of ["nudeln", "reis"]) await page.click(`#items .select-card[data-id="${id}"]`);
  await page.click("#select-move");
  await page.waitForSelector('.photo-dialog [data-action="scan"]:not([disabled])');
  assertEqual(await page.inputValue("#move-target"), "dachboden", "Vorauswahl unverändert (erstes Ziel)");

  // Fremder Code: Hinweis, Scanner sucht weiter
  await scan("https://example.org/irgendwas?c=garage");
  await waitUntil(page, () => document.getElementById("toast").textContent.includes("kein QR-Code dieser App"));
  assertEqual(await page.locator("video.scanner-video").count(), 1, "Scanner bleibt offen");
  // danach unbekannter Behälter dieser App → abgelehnt, nichts angelegt
  await page.evaluate((u) => window.__scanQueue.push(u), server.url + "index.html?c=neue-box&n=Neue%20Box");
  await page.waitForSelector("video.scanner-video", { state: "detached" });
  assert((await hint()).includes("„Neue Box“ gibt es noch nicht"), `Hinweis unbekannt: ${await hint()}`);
  assertEqual(await page.inputValue("#move-target"), "dachboden", "Auswahl nicht geändert");

  // Eigener Behälter → abgelehnt
  await scan(server.url + "index.html?c=keller&n=Keller");
  await page.waitForSelector("video.scanner-video", { state: "detached" });
  assert((await hint()).includes("aus dem verschoben wird"), `Hinweis gleicher Behälter: ${await hint()}`);

  // Escape schliesst nur den Scanner, nicht den Verschieben-Dialog darunter
  await page.click('.photo-dialog [data-action="scan"]');
  await page.waitForSelector(".photo-dialog video.scanner-video");
  await page.keyboard.press("Escape");
  await page.waitForSelector("video.scanner-video", { state: "detached" });
  assertEqual(await page.locator("#move-target").count(), 1, "Verschieben-Dialog bleibt offen");

  // Gültiges Ziel → nur ausgewählt, verschoben wird erst mit "Verschieben"
  await scan(server.url + "index.html?c=garage&n=Garage");
  await page.waitForSelector("video.scanner-video", { state: "detached" });
  assertEqual(await page.inputValue("#move-target"), "garage", "Ziel ausgewählt");
  assertEqual(await hint(), 'Ziel: Dachboden › Garage – mit "Verschieben" bestätigen.', "Hinweis mit Pfad");
  assertEqual(await t.writes(), [], "noch nichts geschrieben");
  await page.click('.photo-dialog [data-action="ok"]');
  await card(page, "nudeln").waitFor({ state: "detached" });
  const db = await t.db();
  assert(db["containers/garage/items/nudeln"] && db["containers/garage/items/reis"], "verschoben nach Garage");
  assert(db["containers/keller/items/salz"], "Salz bleibt");
  assert(!("containers/neue-box" in db), "unbekannter Behälter nicht angelegt");
  assert(!(await t.writes()).some((w) => w.path.startsWith("containers/neue-box")), "keine Schreibzugriffe auf neue-box");
  await t.done();
});

test("21 QR-Druckseite: alle Behälter aus der App, auswählen, filtern, nur Angehakte drucken", async () => {
  const t = await open("index.html", { seed: HOUSE, viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  const { page } = t;
  await page.waitForSelector("#container-list a.card");
  const cardState = () => page.locator(".qr-card").evaluateAll((cs) => cs.map((c) => ({
    name: c.querySelector(".label").textContent,
    where: c.querySelector(".where")?.textContent || "",
    on: c.classList.contains("selected") && c.querySelector("input").checked,
  })));

  // Oben "QR-Codes drucken": alle Behälter, alle angehakt, nach Pfad sortiert.
  await page.click("#qr-header");
  await page.waitForSelector(".qr-card svg");
  let cards = await cardState();
  assertEqual(cards.map((c) => c.name), ["Keller", "Fach 1", "Küche", "Kühlschrank", "Gemüsefach", "Lose Box"], "alle Behälter, nach Pfad");
  assertEqual(cards.find((c) => c.name === "Gemüsefach").where, "Küche › Kühlschrank", "Ort");
  assert(cards.every((c) => c.on), "alle angehakt");
  assertEqual(await page.textContent("#count"), "6", "Zähler");
  assertEqual(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "keine horizontale Scrollbar");

  // Filter + "Keine" wirkt nur auf die gefilterten, Antippen schaltet um.
  await page.fill("#filter", "kuhl");
  await waitUntil(page, () => [...document.querySelectorAll(".qr-card")].filter((c) => !c.hidden).length === 2);
  await page.click("#sel-none");
  await page.fill("#filter", "");
  await page.locator(".qr-card", { hasText: "Lose Box" }).locator("svg").tap();
  cards = await cardState();
  assertEqual(cards.filter((c) => c.on).map((c) => c.name), ["Keller", "Fach 1", "Küche"], "Auswahl");
  assertEqual(await page.textContent("#count"), "3", "Zähler nach Auswahl");

  // Druckansicht: nur die angehakten, ohne Checkboxen und Knöpfe.
  await page.emulateMedia({ media: "print" });
  const printed = await page.evaluate(() => ({
    cards: [...document.querySelectorAll(".qr-card")].filter((c) => getComputedStyle(c).display !== "none").map((c) => c.querySelector(".label").textContent),
    checkboxes: [...document.querySelectorAll(".qr-card input")].filter((i) => getComputedStyle(i).display !== "none").length,
    toolbar: getComputedStyle(document.getElementById("toolbar")).display,
  }));
  assertEqual(printed.cards, ["Keller", "Fach 1", "Küche"], "gedruckt werden nur angehakte");
  assertEqual(printed.checkboxes, 0, "keine Checkboxen im Druck");
  assertEqual(printed.toolbar, "none", "keine Knöpfe im Druck");
  await page.emulateMedia({ media: "screen" });
  await page.click("#sel-none");
  assert(await page.locator("#print-btn").isDisabled(), "Drucken aus, wenn nichts angehakt");

  // "QR" im Behälter: gleiche Seite mit allen Behältern, nur dieser angehakt.
  await page.goto(server.url + "index.html?c=kuehlschrank");
  await page.waitForSelector("#container-title:not(:empty)");
  await waitUntil(page, () => document.getElementById("qr-link").href.includes("sel="));
  await page.click("#qr-link");
  await page.waitForSelector(".qr-card svg");
  cards = await cardState();
  assertEqual(cards.length, 6, "alle Behälter auch aus dem Behälter");
  assertEqual(cards.filter((c) => c.on).map((c) => c.name), ["Kühlschrank"], "nur dieser angehakt");
  assertEqual(await page.textContent("#count"), "1", "Zähler 1");
  await t.done();
});

test("22 QR-Code bleibt gleich: hängt nur an der ID, nicht an Name oder Ort", async () => {
  const t = await open("qr.html?c=kuehlschrank&n=K%C3%BChlschrank&p=K%C3%BCche");
  const { page } = t;
  const snapshot = async () => {
    await page.waitForSelector(".qr-card svg");
    return page.evaluate(() => ({ url: document.querySelector(".qr-card .url").textContent, svg: document.querySelector(".qr-card svg").outerHTML }));
  };
  const before = await snapshot();
  await page.goto(server.url + "qr.html?c=kuehlschrank&n=Eisschrank&p=Keller%20%E2%80%BA%20Regal");
  const after = await snapshot();
  assertEqual(after.url, server.url + "index.html?c=kuehlschrank", "Link nur mit ID");
  assertEqual(after.url, before.url, "gleicher Link nach Umbenennen/Verschieben");
  assert(after.svg === before.svg, "gleiches QR-Bild nach Umbenennen/Verschieben");
  await t.done();
});

// Kamera ohne BarcodeDetector (wie iPhone/Safari): die Kamera zeigt einen echten QR-Code, erkannt
// wird er von jsQR.
const FAKE_CAMERA_WITH_QR = () => {
  delete window.BarcodeDetector;
  const loadScript = (src) => new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  if (!navigator.mediaDevices) Object.defineProperty(navigator, "mediaDevices", { value: {} });
  navigator.mediaDevices.getUserMedia = async () => {
    await loadScript("vendor/qrcode-generator-1.4.4.js");
    const qr = window.qrcode(0, "M");
    qr.addData(new URL("index.html?c=keller", location.href).href);
    qr.make();
    const n = qr.getModuleCount(), cell = 8, margin = 4 * cell, size = n * cell + 2 * margin;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const draw = () => {
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = "#000";
      for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (qr.isDark(r, k)) ctx.fillRect(margin + k * cell, margin + r * cell, cell, cell);
    };
    draw();
    setInterval(draw, 100); // captureStream liefert nur bei Änderungen neue Bilder
    return c.captureStream(10);
  };
};

test("23 Scannen unten öffnet direkt die Kamera, auch ohne BarcodeDetector (jsQR)", async () => {
  const t = await open("index.html", { init: FAKE_CAMERA_WITH_QR, seed: HOUSE, viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  const { page } = t;
  await page.waitForSelector("#container-list a.card");
  assertEqual(await page.evaluate(() => "BarcodeDetector" in window), false, "kein BarcodeDetector");
  assert(await page.locator("#scan-btn").count() === 1, "Scan-Knopf in der Übersicht");
  await page.locator('#bottom-nav [data-nav="scan"]').tap();
  await page.waitForURL(/index\.html\?c=keller$/, { timeout: 10000 });
  await page.waitForSelector("#container-title:not(:empty)");
  assertEqual(await page.textContent("#container-title"), "Keller", "Behälter per Scan geöffnet");
  await t.done();
});

test("24 qr.html ohne Liste im Link (Lesezeichen/alter Link) zeigt die Behälter dieses Geräts", async () => {
  const t = await open("index.html", { seed: HOUSE });
  const { page } = t;
  await page.waitForSelector("#container-list a.card");
  await page.goto(server.url + "qr.html");
  await page.waitForSelector(".qr-card svg");
  assertEqual(await page.locator(".qr-card").count(), 6, "alle Behälter aus der App");
  assertEqual(await page.locator("#empty").isVisible(), false, "kein Hinweis");
  assertEqual(await page.locator("#toolbar").isVisible(), true, "Filterleiste sichtbar");
  // Ein Link mit Liste hat Vorrang vor der gespeicherten Liste.
  await page.goto(server.url + "qr.html?c=box-x&n=Box%20X");
  await page.waitForSelector(".qr-card svg");
  assertEqual(await page.locator(".qr-card").count(), 1, "Liste aus dem Link");
  await t.done();
});

test("25 Papierkorb: erster Tipp fragt nach, erst zweiter Tipp löscht, dann Rückgängig", async () => {
  const t = await open("index.html?c=box-1", {
    seed: {
      "containers/box-1": { name: "Box 1" },
      "containers/box-1/items/milch": { name: "Milch", qty: 2, unit: "Stk" },
      "containers/box-1/items/reis": { name: "Reis", qty: 1, unit: "Packung" },
    },
    viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true,
  });
  const { page } = t;
  await page.waitForSelector('#items .card[data-id="milch"]');
  const del = card(page, "milch").locator('[data-action="del"]');

  // Ein Tipp: nichts gelöscht, Knopf fragt nach; nach 4 s wieder normal.
  await del.tap();
  assertEqual(await del.textContent(), "Löschen?", "Nachfrage im Knopf");
  assertEqual(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "keine horizontale Scrollbar");
  await page.waitForTimeout(300);
  assert(!(await t.writes()).some((w) => w.op === "delete"), "nach einem Tipp nichts gelöscht");
  await waitUntil(page, () => document.querySelector('#items .card[data-id="milch"] [data-action="del"]').textContent === "🗑", { timeout: 6000 });

  // Zwei Tipps: gelöscht, mit Rückgängig.
  await del.tap();
  await del.tap();
  await card(page, "milch").waitFor({ state: "detached" });
  assert(await page.locator("#toast button", { hasText: "Rückgängig" }).isVisible(), "Rückgängig sichtbar");
  await page.locator("#toast button", { hasText: "Rückgängig" }).tap();
  await page.waitForSelector('#items .card[data-id="milch"]');

  // Detailansicht: "Entfernen" braucht ebenfalls zwei Tipps.
  await card(page, "reis").locator('[data-action="details"]').tap();
  await page.locator('.photo-dialog [data-action="del"]').tap();
  assertEqual(await page.textContent('.photo-dialog [data-action="del"]'), "Wirklich entfernen?", "Nachfrage im Dialog");
  assert(await page.locator(".photo-dialog").isVisible(), "Dialog bleibt offen");
  await page.locator('.photo-dialog [data-action="del"]').tap();
  await card(page, "reis").waitFor({ state: "detached" });
  await t.done();
});

let failed = 1;
try {
  failed = await run(process.argv[2]);
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
