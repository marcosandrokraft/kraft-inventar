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
async function open(pathAndQuery, { seed = {}, viewport, isMobile = false, hasTouch = false } = {}) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: viewport || { width: 1000, height: 800 }, isMobile, hasTouch, locale: "de-CH" });
  const net = await guardNetwork(context, server.url);
  const log = await watchPage(context);
  await context.addInitScript((s) => { window.__seed = s; }, seed);
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
  await page.waitForSelector("#search-results a.card.result");
  const results = await page.locator("#search-results a.card.result").evaluateAll((as) =>
    as.map((a) => ({ name: a.querySelector("strong").textContent, where: a.querySelector("small b").textContent, href: a.getAttribute("href") })));
  assertEqual(results.map((r) => r.name), ["Milch", "Hafermilch"], "Suchtreffer (Wortanfang zuerst)");
  assertEqual(results[0].where, "Kühlschrank", "Behältername im Treffer");
  assertEqual(results[0].href, "index.html?c=k%C3%BChlschrank#i=milch", "Link des Treffers");

  // Umlaut-/Grossschreibung-tolerant und über den Behälternamen
  await page.fill("#search", "KUEHLSCHRANK");
  await waitUntil(page, () => document.querySelectorAll("#search-results a.card.result").length === 1);

  await page.fill("#search", "milch");
  await page.waitForSelector("#search-results a.card.result");
  await page.click("#search-results a.card.result >> nth=0");
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

  await page.goto(server.url + "qr.html?c=xss-box&n=" + encodeURIComponent(XSS));
  await page.waitForSelector(".qr-card svg");
  assertEqual(await page.textContent(".qr-card .label"), XSS, "Name auf QR-Bogen");

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
    printVisible: !document.getElementById("print-btn").hidden,
  }));
  assertEqual(qr.cards, 1, "ein QR-Code");
  assert(qr.svgChildren > 0, "SVG enthält Pfade");
  assertEqual(qr.label, "Box 3", "Beschriftung");
  assertEqual(qr.url, server.url + "index.html?c=box-3&n=Box%203", "Link im QR-Code");
  assert(qr.printVisible, "Drucken-Knopf sichtbar");

  // Formular: mehrere Namen
  await page.fill('textarea[name="names"]', "Kühlschrank\nGefrierfach\nKühlschrank");
  await page.click('#gen-form button[type="submit"]');
  await waitUntil(page, () => document.querySelectorAll(".qr-card svg").length === 2);
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

let failed = 1;
try {
  failed = await run(process.argv[2]);
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
