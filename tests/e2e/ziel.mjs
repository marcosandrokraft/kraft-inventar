// Browser-Tests für das Paket Ziel ("Gehört nach …"): Ziel für Behälter/Artikel/mehrere setzen,
// Anzeige und Vererbung, Vorschläge (sichtbar, nie gespeichert, sparsam geladen), Auspacken-Ansicht,
// Vorauswahl im Verschieben-Dialog, Ziel verschwindet nach der Ankunft, Sperre, Übungsmodus, 360 px.
//   npm run test:e2e                 (smoke.mjs, features.mjs und diese Datei)
//   node tests/e2e/ziel.mjs vorschlag (nur Tests, deren Name "vorschlag" enthält)
import { startServer } from "./server.mjs";
import { launchBrowser, guardNetwork, watchPage, createRunner, assert, assertEqual, waitUntil } from "./harness.mjs";

const MOBILE = { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true };
const XSS = "<img src=x onerror=window.__xss=1>";

const server = await startServer();
const browser = await launchBrowser();
const { test, run } = createRunner();

async function open(pathAndQuery, { seed = {}, viewport, isMobile = false, hasTouch = false, signedOut = false } = {}) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: viewport || { width: 1000, height: 800 }, isMobile, hasTouch, locale: "de-CH" });
  const net = await guardNetwork(context, server.url);
  const log = await watchPage(context);
  const requests = [];
  context.on("request", (r) => requests.push(r.url()));
  await context.addInitScript(([s, out]) => {
    window.__seed = s;
    if (out) window.__fakeSignedOut = true;
  }, [seed, signedOut]);
  const page = await context.newPage();
  const dialogs = [];
  page.on("dialog", (d) => {
    dialogs.push({ type: d.type(), message: d.message() });
    d.accept();
  });
  await page.goto(server.url + pathAndQuery);
  return {
    page,
    requests,
    dialogs,
    db: () => page.evaluate(() => window.__fakeDb()),
    writes: () => page.evaluate(() => window.__writes),
    queries: () => page.evaluate(() => window.__queries),
    practiceDb: () => page.evaluate(() => JSON.parse(localStorage.getItem("vorrat-uebung-db") || "null")),
    async done() {
      const csp = await page.evaluate(() => window.__csp || []).catch(() => []);
      const xss = await page.evaluate(() => window.__xss).catch(() => undefined);
      await context.close();
      assertEqual(xss, undefined, "XSS ausgeführt");
      assertEqual(net.forbidden(), [], "Anfragen an echte Firebase/Google-Dienste");
      assertEqual(log.pageErrors, [], "Unbehandelte Fehler in der Seite");
      assertEqual(csp, [], "CSP-Verletzungen");
      assertEqual(log.cspConsole, [], "CSP-Meldungen in der Konsole");
      const errs = log.consoleErrors.filter((e) => !/ERR_BLOCKED_BY_CLIENT/.test(e));
      assertEqual(errs, [], "Fehler in der Konsole");
    },
  };
}

// Neue Wohnung (Küche mit Schublade, Bad mit Spiegelschrank, Keller) und zwei Umzugskisten.
const SEED = {
  "containers/kueche": { name: "Küche", type: "raum" },
  "containers/schublade": { name: "Schublade oben", type: "fach", parent: "kueche" },
  "containers/bad": { name: "Bad", type: "raum" },
  "containers/spiegel": { name: "Spiegelschrank", type: "schrank", parent: "bad" },
  "containers/keller": { name: "Keller", type: "raum" },
  "containers/kiste-1": { name: "Kiste 1", type: "box", target: "kueche" },
  "containers/kiste-2": { name: "Kiste 2", type: "box" },
  "containers/kiste-2-fach": { name: "Fach in Kiste 2", parent: "kiste-2" },
  "containers/kueche/items/milch": { name: "Milch", qty: 1, unit: "l" },
  "containers/spiegel/items/pflaster": { name: "Pflaster", qty: 1, unit: "Packung" },
  "containers/kiste-1/items/teller": { name: "Teller", qty: 6, unit: "Stk" },
  "containers/kiste-1/items/tassen": { name: "Tassen", qty: 4, unit: "Stk" },
  "containers/kiste-1/items/messerset": { name: "Messerset", qty: 1, unit: "Stk", target: "schublade" },
  "containers/kiste-2/items/pflaster": { name: "Pflaster", qty: 2, unit: "Packung" },
  "containers/kiste-2/items/zahnbürste": { name: "Zahnbürste", qty: 2, unit: "Stk" },
  "containers/kiste-2/items/fotoalbum": { name: "Fotoalbum", qty: 3, unit: "Stk" },
};

const card = (page, id) => page.locator(`#items .card[data-id="${id}"]`);
const lineOf = (page, id) => page.evaluate((i) => document.querySelector(`#items .card[data-id="${i}"] .item-target`)?.innerText ?? null, id);
const strip = (d) => { const { updatedAt, createdAt, ...rest } = d || {}; void updatedAt; void createdAt; return rest; };

async function noHorizontalScroll(page, what) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert(sw <= cw, `${what}: horizontales Scrollen (${sw} > ${cw})`);
}

// ---------------------------------------------------------------------------------------------

test("Z1 Behälter: Ziel im Bearbeiten-Dialog setzen, Anzeige im Kopf, Zyklus ausgeschlossen, Ankunft entfernt das Ziel", async () => {
  const t = await open("index.html?c=kiste-2", { seed: { ...SEED, "containers/xss": { name: XSS }, "containers/kiste-3": { name: "Kiste 3", target: "xss" } } });
  const { page } = t;
  await page.waitForSelector('#items .card[data-id="pflaster"]');
  assert(await page.isHidden("#container-target"), "Ohne Ziel kein Hinweis im Kopf");
  await page.click("#edit-btn");
  await page.waitForSelector("#cs-target");
  const opts = await page.$$eval("#cs-target option", (o) => o.map((x) => x.value));
  assert(opts[0] === "" && opts.includes("bad") && opts.includes("schublade"), `Optionen: ${opts}`);
  assert(!opts.includes("kiste-2") && !opts.includes("kiste-2-fach"), "nicht sich selbst / eigener Unterbehälter");
  const labels = await page.$$eval("#cs-target option", (o) => o.map((x) => x.textContent));
  assert(labels.includes("Küche › Schublade oben"), "Auswahl mit Pfad");
  await page.selectOption("#cs-target", "bad");
  await page.click('.photo-dialog [data-action="save"]');
  await waitUntil(page, () => !document.getElementById("container-target").hidden);
  assert(/^→.*Bad$/s.test((await page.innerText("#container-target")).trim()), "Kopf zeigt → Bad");
  let w = await t.writes();
  assertEqual({ path: w[0].path, target: w[0].data.target, merge: w[0].options?.merge }, { path: "containers/kiste-2", target: "bad", merge: true }, "Ziel gespeichert (merge)");
  // Unterbehälter erbt: Fach zeigt "→ Bad · über Kiste 2"
  await page.goto(server.url + "index.html?c=kiste-2-fach");
  await waitUntil(page, () => !document.getElementById("container-target").hidden);
  const fach = await page.innerText("#container-target");
  assert(fach.includes("Bad") && fach.includes("über Kiste 2"), `Vererbt: ${fach}`);

  // Kiste ins Bad stellen ("liegt in" = Ziel) → Ziel erreicht → Feld wird entfernt
  await page.goto(server.url + "index.html?c=kiste-2");
  await waitUntil(page, () => !document.getElementById("container-target").hidden);
  await page.click("#edit-btn");
  await page.waitForSelector("#cs-target");
  assertEqual(await page.inputValue("#cs-target"), "bad", "aktuelles Ziel vorausgewählt");
  await page.selectOption("#cs-parent", "bad");
  await page.click('.photo-dialog [data-action="save"]');
  await waitUntil(page, () => document.getElementById("container-target").hidden);
  assert((await page.textContent("#toast")).includes("Ziel erreicht"), "Meldung Ziel erreicht");
  w = await t.writes();
  assertEqual(w[w.length - 1].data.target, { __op: "deleteField" }, "Ziel per deleteField entfernt");
  assert(!("target" in (await t.db())["containers/kiste-2"]), "kein veraltetes Ziel gespeichert");

  // Ziel = Ort, an dem er schon liegt → gar nicht erst gespeichert
  await page.click("#edit-btn");
  await page.waitForSelector("#cs-target");
  await page.selectOption("#cs-target", "bad");
  await page.click('.photo-dialog [data-action="save"]');
  await waitUntil(page, () => document.getElementById("toast").textContent.includes("kein Ziel nötig"));
  assert(!("target" in (await t.db())["containers/kiste-2"]), "liegt schon dort → kein Ziel");

  // Name mit HTML als Ziel wird als Text angezeigt
  await page.goto(server.url + "index.html?c=kiste-3");
  await waitUntil(page, () => !document.getElementById("container-target").hidden);
  assert((await page.innerText("#container-target")).includes("<img"), "Zielname escaped");
  await t.done();
});

test("Z2 Artikel: eigenes Ziel und geerbtes Ziel anzeigen, in den Details setzen, Rückgängig", async () => {
  const t = await open("index.html?c=kiste-1", { seed: SEED });
  const { page } = t;
  await page.waitForSelector('#items .card[data-id="messerset"] .item-target');
  assert(/^→.*Küche$/s.test((await page.innerText("#container-target")).trim()), "Kiste 1 → Küche im Kopf");
  assert(/^→.*Küche › Schublade oben$/s.test((await lineOf(page, "messerset")).trim()), "eigenes Ziel mit Pfad");
  assertEqual(await lineOf(page, "teller"), null, "geerbtes Ziel nicht in jeder Zeile (steht im Kopf)");
  const aria = await card(page, "messerset").locator('[data-action="details"]').getAttribute("aria-label");
  assert(aria.includes("gehört nach Küche › Schublade oben"), `Vorlesen: ${aria}`);

  // Details: geerbtes Ziel "über Kiste 1"
  await card(page, "teller").locator('[data-action="details"]').click();
  const det = await page.innerText(".photo-dialog .detail-target");
  assert(det.includes("Küche") && det.includes("über Kiste 1"), `Details: ${det}`);
  await page.click('.photo-dialog [data-action="target"]');
  await page.waitForSelector("#target-select");
  const first = await page.$eval("#target-select option", (o) => o.textContent);
  assert(first.includes("wie Kiste 1") && first.includes("Küche"), `Erste Option: ${first}`);
  const opts = await page.$$eval("#target-select option", (o) => o.map((x) => x.value));
  assert(!opts.includes("kiste-1"), "nicht der eigene Behälter");
  await page.selectOption("#target-select", "bad");
  await page.click('.photo-dialog [data-action="ok"]');
  await waitUntil(page, () => document.querySelector('#items .card[data-id="teller"] .item-target')?.innerText.includes("Bad"));
  let w = await t.writes();
  assertEqual(w.map((x) => `${x.op} ${x.path} ${JSON.stringify(x.data.target)}`), ['batch.update containers/kiste-1/items/teller "bad"'], "ein Update mit target");
  // Rückgängig → Feld wieder weg (vorher kein eigenes Ziel)
  await page.locator("#toast.show button", { hasText: "Rückgängig" }).click();
  await waitUntil(page, () => !document.querySelector('#items .card[data-id="teller"] .item-target'));
  w = await t.writes();
  assertEqual(w[1].data.target, { __op: "deleteField" }, "Rückgängig entfernt das Ziel");

  // Eigenes Ziel entfernen ("wie Kiste 1")
  await card(page, "messerset").locator('[data-action="details"]').click();
  await page.click('.photo-dialog [data-action="target"]');
  await page.waitForSelector("#target-select");
  assertEqual(await page.inputValue("#target-select"), "schublade", "eigenes Ziel vorausgewählt");
  await page.selectOption("#target-select", "");
  await page.click('.photo-dialog [data-action="ok"]');
  await waitUntil(page, () => !document.querySelector('#items .card[data-id="messerset"] .item-target'));
  assert(!("target" in (await t.db())["containers/kiste-1/items/messerset"]), "Ziel entfernt");
  await t.done();
});

test("Z3 Mehrfachauswahl: Ziel für mehrere Artikel auf einmal (ein Batch)", async () => {
  const t = await open("index.html?c=kiste-1", { seed: SEED });
  const { page } = t;
  await page.waitForSelector('#items .card[data-id="teller"]');
  await page.click("#select-btn");
  assert(await page.isDisabled("#select-target"), "Ziel erst mit Auswahl");
  for (const id of ["teller", "tassen"]) await page.click(`#items .select-card[data-id="${id}"]`);
  await page.click("#select-target");
  await page.waitForSelector("#target-select");
  assertEqual(await page.textContent(".photo-dialog strong"), "2 Artikel", "Dialogtitel");
  await page.selectOption("#target-select", "schublade");
  await page.click('.photo-dialog [data-action="ok"]');
  await waitUntil(page, () => document.getElementById("select-bar").hidden);
  const w = await t.writes();
  assertEqual(w.map((x) => `${x.op} ${x.path} ${x.data.target}`).sort(), [
    "batch.update containers/kiste-1/items/tassen schublade",
    "batch.update containers/kiste-1/items/teller schublade",
  ], "zwei Updates in einem Batch");
  await waitUntil(page, () => document.querySelectorAll("#items .item-target").length === 3);
  assert((await lineOf(page, "tassen")).includes("Schublade oben"), "Zeile zeigt neues Ziel");
  assert((await page.textContent("#toast")).includes("2 Artikel"), "Meldung");
  await t.done();
});

test("Z4 Vorschläge: sichtbar, als Vorschlag erkennbar, nie gespeichert, eine Abfrage, Auspacken-Ansicht", async () => {
  const t = await open("index.html?c=kiste-2", { seed: SEED });
  const { page } = t;
  await page.waitForSelector('#items .card[data-id="pflaster"] .item-target.is-suggestion');
  const pfl = await lineOf(page, "pflaster");
  assert(pfl.startsWith("Vorschlag:") && pfl.includes("Bad › Spiegelschrank"), `Pflaster: ${pfl}`);
  const zb = await lineOf(page, "zahnbürste");
  assert(zb.startsWith("Vorschlag:") && zb.includes("Bad") && !zb.includes("Spiegel"), `Zahnbürste: ${zb}`);
  assertEqual(await lineOf(page, "fotoalbum"), null, "kein Vorschlag für Fotoalbum");
  const style = await page.$eval('#items .card[data-id="pflaster"] .item-target', (e) => getComputedStyle(e).fontStyle);
  assertEqual(style, "italic", "Vorschlag kursiv");
  assertEqual(await t.writes(), [], "Vorschläge werden nicht gespeichert");
  assertEqual(await t.queries(), ["collectionGroup:items"], "genau eine Artikel-Abfrage für Vorschläge");

  // Auspacken-Ansicht
  assert(await page.isVisible("#group-toggle"), "Schalter 'Nach Ziel ordnen' sichtbar");
  await page.click("#group-toggle");
  await page.waitForSelector("#items h3.target-group");
  const heads = await page.$$eval("#items h3.target-group", (h) => h.map((x) => x.innerText.replace(/\s+/g, " ").trim()));
  assertEqual(heads, ["Vorschlag: → gehört nach Bad", "Vorschlag: → gehört nach Bad › Spiegelschrank", "Ohne Ziel"].map((s) => s), "Gruppen");
  assertEqual(await page.locator("#items .item-target").count(), 0, "in der Gruppenansicht keine Zielzeilen");
  assertEqual(await page.getAttribute("#group-toggle", "aria-pressed"), "true", "aria-pressed");

  // Neu laden: Ansicht gemerkt, Artikel-Index aus dem Zwischenspeicher → keine weitere Abfrage
  await page.reload();
  await page.waitForSelector("#items h3.target-group");
  assertEqual(await t.queries(), [], "Index aus sessionStorage, keine neue Abfrage");
  assertEqual(await t.writes(), [], "weiterhin nichts gespeichert");

  // Normaler Behälter ohne Ziele: sieht aus wie bisher, lädt nichts zusätzlich
  await page.goto(server.url + "index.html?c=kueche");
  await page.waitForSelector('#items .card[data-id="milch"]');
  await page.waitForTimeout(150);
  assertEqual(await page.locator("#items .item-target").count(), 0, "keine Zielzeilen");
  assert(await page.isHidden("#target-tools"), "kein Schalter");
  assert(await page.isHidden("#container-target"), "kein Ziel im Kopf");
  assertEqual(await t.queries(), [], "keine Abfrage");
  await t.done();
});

test("Z5 Verschieben: Ziel bzw. Vorschlag vorausgewählt, Ankunft entfernt das Ziel, Rückgängig", async () => {
  const t = await open("index.html?c=kiste-1", { seed: SEED });
  const { page } = t;
  await page.waitForSelector('#items .card[data-id="messerset"] .item-target');
  // einzeln: eigenes Ziel
  await card(page, "messerset").locator('[data-action="details"]').click();
  await page.click('.photo-dialog [data-action="move"]');
  await page.waitForSelector('.photo-dialog [data-action="ok"]:not([disabled])');
  assertEqual(await page.inputValue("#move-target"), "schublade", "Ziel vorausgewählt");
  assert((await page.textContent("#move-hint")).includes("Schublade oben"), "Hinweis");
  await page.click('.photo-dialog [data-action="ok"]');
  await card(page, "messerset").waitFor({ state: "detached" });
  assert((await page.textContent("#toast")).includes("am Ziel"), "Meldung am Ziel");
  let db = await t.db();
  assertEqual(strip(db["containers/schublade/items/messerset"]), { name: "Messerset", qty: 1, unit: "Stk" }, "angekommen: ohne target");
  await page.locator("#toast.show button", { hasText: "Rückgängig" }).click();
  await card(page, "messerset").waitFor();
  db = await t.db();
  assertEqual(db["containers/kiste-1/items/messerset"].target, "schublade", "Rückgängig stellt das Ziel wieder her");
  assert(!db["containers/schublade/items/messerset"], "im Ziel wieder weg");

  // mehrere mit gleichem (geerbtem) Ziel → vorausgewählt
  await page.click("#select-btn");
  for (const id of ["teller", "tassen"]) await page.click(`#items .select-card[data-id="${id}"]`);
  await page.click("#select-move");
  await page.waitForSelector('.photo-dialog [data-action="ok"]:not([disabled])');
  assertEqual(await page.inputValue("#move-target"), "kueche", "gemeinsames Ziel vorausgewählt");
  await page.keyboard.press("Escape");
  // verschiedene Ziele → keine Vorauswahl
  await page.click('#items .select-card[data-id="messerset"]');
  await page.click("#select-move");
  await page.waitForSelector('.photo-dialog [data-action="ok"]:not([disabled])');
  const first = await page.$eval("#move-target option", (o) => o.value);
  assertEqual(await page.inputValue("#move-target"), first, "keine Vorauswahl bei verschiedenen Zielen");
  assertEqual((await page.textContent("#move-hint")).trim(), "", "kein Hinweis");
  await page.keyboard.press("Escape");
  await page.click("#select-cancel");

  // Vorschlag vorausgewählt (Kiste 2), aber nichts gespeichert, bis bestätigt
  await page.goto(server.url + "index.html?c=kiste-2");
  await page.waitForSelector('#items .card[data-id="pflaster"] .item-target.is-suggestion');
  const before = (await t.writes()).length;
  await card(page, "pflaster").locator('[data-action="details"]').click();
  assert((await page.innerText(".photo-dialog .detail-target")).startsWith("Vorschlag"), "Details zeigen Vorschlag");
  await page.click('.photo-dialog [data-action="move"]');
  await page.waitForSelector('.photo-dialog [data-action="ok"]:not([disabled])');
  assertEqual(await page.inputValue("#move-target"), "spiegel", "Vorschlag vorausgewählt");
  assert(await page.$eval("#move-hint", (e) => e.classList.contains("is-suggestion") && e.textContent.includes("Vorschlag")), "als Vorschlag gekennzeichnet");
  await page.click('.photo-dialog [data-action="close"]');
  assertEqual((await t.writes()).length, before, "Abbrechen speichert nichts");
  await t.done();
});

test("Z6 Sperre: Ziele sichtbar, aber nicht änderbar (Nicht-Owner)", async () => {
  const t = await open("index.html?c=kiste-1", {
    ...MOBILE,
    seed: { ...SEED, "settings/lock": { locked: true, lockedBy: "Marco" }, "members/tester@example.com": { name: "Tester" } },
  });
  const { page } = t;
  await page.waitForSelector('#items .card[data-id="messerset"] .item-target');
  await page.waitForSelector("#mode-bar.mode-lock");
  assert(await page.isVisible("#container-target"), "Ziel im Kopf sichtbar");
  assert(await page.isHidden("#select-btn") && await page.isHidden("#edit-btn"), "Auswählen/Bearbeiten ausgeblendet");
  await card(page, "messerset").locator('[data-action="details"]').click();
  assert(await page.isVisible(".photo-dialog .detail-target"), "Ziel in den Details");
  assertEqual(await page.locator('.photo-dialog [data-action="target"]').count(), 0, "kein 'Gehört nach …'");
  await page.keyboard.press("Escape");
  assertEqual(await t.writes(), [], "keine Schreibzugriffe");
  await t.done();
});

test("Z7 Übungsmodus: Kisten mit Ziel und Vorschlägen, Ziel setzen lokal, nichts an Firebase", async () => {
  const t = await open("index.html?uebung=1&c=kiste-1", { signedOut: true, ...MOBILE });
  const { page } = t;
  await page.waitForSelector('#items .card[data-id="messerset"] .item-target');
  assert((await page.innerText("#container-target")).includes("Küche"), "Kiste 1 → Küche");
  assert((await lineOf(page, "messerset")).includes("Schublade oben"), "Messerset → Schublade");
  await page.goto(server.url + "index.html?c=kiste-2"); // innerhalb der Übung (sessionStorage)
  await page.waitForSelector('#items .card[data-id="zahnbürste"] .item-target.is-suggestion');
  assert((await lineOf(page, "pflaster")).includes("Spiegelschrank"), "Pflaster → Spiegelschrank (gleicher Name)");
  assert((await lineOf(page, "hammer")).includes("Keller"), "Hammer → Keller (Kategorie, Werkzeugbox ist eine Box)");
  // Vorschlag im Dialog vorausgewählt → mit Speichern übernehmen
  await card(page, "zahnbürste").locator('[data-action="details"]').click();
  await page.click('.photo-dialog [data-action="target"]');
  await page.waitForSelector("#target-select");
  assertEqual(await page.inputValue("#target-select"), "bad", "Vorschlag vorausgewählt");
  assert((await page.textContent("#target-hint")).includes("Vorschlag"), "als Vorschlag gekennzeichnet");
  await page.click('.photo-dialog [data-action="ok"]');
  await waitUntil(page, () => !document.querySelector('#items .card[data-id="zahnbürste"] .item-target')?.classList.contains("is-suggestion"));
  const pdb = await t.practiceDb();
  assertEqual(pdb.docs["containers/kiste-2/items/zahnbürste"].target, "bad", "in der Übung gespeichert");
  assertEqual(await page.evaluate(() => typeof window.__writes), "undefined", "Firebase (Fake) nicht geladen");
  assertEqual(t.requests.filter((u) => /googleapis|firebaseio|firebaseapp|gstatic/.test(u)), [], "keine Anfragen an Google/Firebase");
  await t.done();
});

test("Z8 Handy 360 px: kein horizontales Scrollen, Knöpfe mind. 44 px", async () => {
  const long = "Sehr langer Behältername für den Umzug in die neue Wohnung";
  const t = await open("index.html?c=kiste-2", {
    ...MOBILE,
    seed: {
      ...SEED,
      "containers/lang": { name: long, type: "raum", parent: "bad" },
      "containers/kiste-2/items/seife": { name: "Seife mit sehr langem Namen zum Testen der Zeile", qty: 1, unit: "Stk", target: "lang" },
    },
  });
  const { page } = t;
  await page.waitForSelector('#items .card[data-id="seife"] .item-target');
  await noHorizontalScroll(page, "Liste mit Zielzeilen");
  const tog = await page.locator("#group-toggle").boundingBox();
  assert(tog.height >= 44, `Schalter ${tog.height}px`);
  await page.locator("#group-toggle").tap();
  await page.waitForSelector("#items h3.target-group");
  await noHorizontalScroll(page, "Auspacken-Ansicht");
  await page.locator("#select-btn").tap();
  await page.locator('#items .select-card[data-id="seife"]').tap();
  await noHorizontalScroll(page, "Auswahl mit Leiste");
  for (const sel of ["#select-all", "#select-target", "#select-move", "#select-cancel"]) {
    const b = await page.locator(sel).boundingBox();
    assert(b.height >= 44 && b.width >= 44, `${sel}: ${b.width}×${b.height}`);
  }
  const bar = await page.$eval("#select-bar", (e) => e.scrollWidth <= e.clientWidth);
  assert(bar, "Auswahlleiste passt");
  await page.locator("#select-cancel").tap();
  await card(page, "seife").locator('[data-action="details"]').tap();
  const btn = await page.locator('.photo-dialog [data-action="target"]').boundingBox();
  assert(btn.height >= 44, `Gehört-nach-Knopf ${btn.height}px`);
  await page.locator('.photo-dialog [data-action="target"]').tap();
  await page.waitForSelector("#target-select");
  await noHorizontalScroll(page, "Ziel-Dialog");
  await t.done();
});

test("Z9 Umpacken behält das geerbte Ziel; Umbenennen lässt das Ziel unangetastet; Speichern ohne Änderung schreibt nichts", async () => {
  const t = await open("index.html?c=kiste-1", { seed: SEED });
  const { page } = t;
  await page.waitForSelector('#items .card[data-id="teller"]');
  // Teller (erbt Küche) von Kiste 1 in Kiste 2 → nimmt "Küche" als eigenes Ziel mit
  await card(page, "teller").locator('[data-action="details"]').click();
  await page.click('.photo-dialog [data-action="move"]');
  await page.waitForSelector('.photo-dialog [data-action="ok"]:not([disabled])');
  await page.selectOption("#move-target", "kiste-2");
  await page.click('.photo-dialog [data-action="ok"]');
  await card(page, "teller").waitFor({ state: "detached" });
  assertEqual((await t.db())["containers/kiste-2/items/teller"].target, "kueche", "geerbtes Ziel mitgenommen");
  // Umbenennen: target nicht im Schreibzugriff
  await page.click("#edit-btn");
  await page.waitForSelector("#cs-target");
  await page.fill("#cs-name", "Kiste eins");
  await page.click('.photo-dialog [data-action="save"]');
  await waitUntil(page, () => document.getElementById("container-title").textContent === "Kiste eins");
  let w = await t.writes();
  assert(!("target" in w[w.length - 1].data), "Umbenennen schreibt kein target");
  assertEqual((await t.db())["containers/kiste-1"].target, "kueche", "Ziel bleibt");
  // Ziel-Dialog ohne Änderung → nichts geschrieben
  const n = w.length;
  await card(page, "messerset").locator('[data-action="details"]').click();
  await page.click('.photo-dialog [data-action="target"]');
  await page.waitForSelector("#target-select");
  await page.click('.photo-dialog [data-action="ok"]');
  await page.waitForTimeout(200);
  assertEqual((await t.writes()).length, n, "unverändert gespeichert → kein Schreibzugriff");
  await t.done();
});

const failed = await run(process.argv[2]);
await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
