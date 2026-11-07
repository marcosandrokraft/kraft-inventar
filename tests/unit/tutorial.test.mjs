// Unit-Tests für die Einführung (tutorial.js): nur die reine Logik – Node hat kein document/window.
import assert from "node:assert/strict";
import {
  TUTORIAL_STEPS,
  TUTORIAL_STORAGE_KEY,
  stepIndexById,
  clampStep,
  parseTutorialState,
  serializeTutorialState,
  stepMatchesView,
  progressLabel,
  shouldAdvance,
  resolveStepForView,
  isTutorialActive,
  startTutorial,
  resumeTutorial,
  showFirstRunHint,
} from "../../tutorial.js";

const N = TUTORIAL_STEPS.length;
const step = (id) => TUTORIAL_STEPS[stepIndexById(id)];
const ctx = (view, containerId = null, practice = true) => ({ view, containerId, practice });

describe("tutorial: Import und Schritte", () => {
  it("lässt sich ohne DOM importieren, und die DOM-Funktionen tun ohne document nichts", () => {
    assert.equal(typeof document, "undefined");
    assert.equal(isTutorialActive(), false);
    assert.doesNotThrow(() => startTutorial(ctx("overview")));
    assert.doesNotThrow(() => resumeTutorial(ctx("overview")));
    assert.doesNotThrow(() => showFirstRunHint(ctx("overview")));
    assert.equal(TUTORIAL_STORAGE_KEY, "vorrat-tutorial");
  });

  it("hat rund 12 Schritte mit eindeutigen IDs und vollständigen Angaben", () => {
    assert.ok(N >= 10 && N <= 14, `Anzahl ${N}`);
    const ids = TUTORIAL_STEPS.map((s) => s.id);
    assert.equal(new Set(ids).size, N);
    for (const s of TUTORIAL_STEPS) {
      assert.match(s.id, /^[a-z-]+$/);
      assert.ok(s.title && s.text, s.id);
      assert.ok(Array.isArray(s.views) && s.views.length > 0, s.id);
      assert.ok(!s.views.includes("login"), s.id);
      assert.ok(Array.isArray(s.targets), s.id);
      assert.ok(s.advance && (s.advance.next || s.advance.event || s.advance.view), s.id);
      assert.ok(s.nav && s.nav.label && s.nav.url && s.nav.hint, s.id);
      assert.match(s.nav.url, /^index\.html/);
    }
  });

  it("Texte ohne ß und ohne Emoji", () => {
    const all = JSON.stringify(TUTORIAL_STEPS);
    assert.ok(!all.includes("ß"));
    assert.ok(!/\p{Extended_Pictographic}/u.test(all));
  });

  it("Reihenfolge: Willkommen zuerst, QR-Codes zuletzt", () => {
    assert.equal(TUTORIAL_STEPS[0].id, "willkommen");
    assert.equal(TUTORIAL_STEPS[N - 1].id, "qr");
    assert.ok(stepIndexById("behaelter") < stepIndexById("unterbehaelter"));
    assert.ok(stepIndexById("hinzufuegen") < stepIndexById("loeschen"));
    assert.ok(stepIndexById("suche") < stepIndexById("ablauf"));
    assert.equal(stepIndexById("gibts-nicht"), -1);
  });
});

describe("tutorial: progressLabel und clampStep", () => {
  it("progressLabel zählt ab 1", () => {
    assert.equal(progressLabel(0), `1/${N}`);
    assert.equal(progressLabel(2), `3/${N}`);
    assert.equal(progressLabel(N - 1), `${N}/${N}`);
    assert.equal(progressLabel(999), `${N}/${N}`);
  });

  it("clampStep begrenzt und macht aus Müll 0", () => {
    assert.equal(clampStep(3), 3);
    assert.equal(clampStep(-5), 0);
    assert.equal(clampStep(N + 10), N - 1);
    assert.equal(clampStep(2.9), 2);
    assert.equal(clampStep("4"), 4);
    assert.equal(clampStep(NaN), 0);
    assert.equal(clampStep(undefined), 0);
    assert.equal(clampStep(null), 0);
    assert.equal(clampStep("abc"), 0);
    assert.equal(clampStep(Infinity), 0);
    assert.equal(clampStep({}), 0);
  });
});

describe("tutorial: Zustand lesen und schreiben", () => {
  it("serialize → parse ergibt denselben Schritt", () => {
    for (const i of [0, 4, N - 1]) {
      const raw = serializeTutorialState({ step: i, v: 1 });
      assert.deepEqual(JSON.parse(raw), { step: i, v: 1 });
      assert.deepEqual(parseTutorialState(raw), { step: i, v: 1 });
    }
  });

  it("serialize begrenzt ungültige Schritte", () => {
    assert.deepEqual(JSON.parse(serializeTutorialState({ step: -3 })), { step: 0, v: 1 });
    assert.deepEqual(JSON.parse(serializeTutorialState({ step: 999 })), { step: N - 1, v: 1 });
    assert.deepEqual(JSON.parse(serializeTutorialState(null)), { step: 0, v: 1 });
  });

  it("parse gibt bei Müll null zurück", () => {
    const bad = [
      null, undefined, "", "   ", "null", "42", "[]", "[1,2]", "{", "kaputt", "true",
      '{"step":1}', '{"step":1,"v":2}', '{"step":1,"v":"1"}', '{"step":-1,"v":1}',
      `{"step":${N},"v":1}`, '{"step":1.5,"v":1}', '{"step":"2","v":1}', '{"v":1}',
      '{"step":null,"v":1}', "x".repeat(500), 17, {}, { step: 1, v: 1 },
    ];
    for (const raw of bad) assert.equal(parseTutorialState(raw), null, String(raw).slice(0, 40));
  });

  it("parse ignoriert Zusatzfelder", () => {
    assert.deepEqual(parseTutorialState('{"step":2,"v":1,"x":"y"}'), { step: 2, v: 1 });
  });
});

describe("tutorial: stepMatchesView", () => {
  it("Willkommen und QR passen überall in der App, nie auf der Anmeldeseite", () => {
    for (const id of ["willkommen", "qr"]) {
      assert.equal(stepMatchesView(step(id), ctx("overview")), true);
      assert.equal(stepMatchesView(step(id), ctx("container", "keller")), true);
      assert.equal(stepMatchesView(step(id), ctx("list-ablauf")), true);
      assert.equal(stepMatchesView(step(id), ctx("login")), false);
    }
  });

  it("Behälter öffnen nur in der Übersicht", () => {
    assert.equal(stepMatchesView(step("behaelter"), ctx("overview")), true);
    assert.equal(stepMatchesView(step("behaelter"), ctx("container", "kueche")), false);
  });

  it("Unterbehälter nur in der Küche", () => {
    assert.equal(stepMatchesView(step("unterbehaelter"), ctx("container", "kueche")), true);
    assert.equal(stepMatchesView(step("unterbehaelter"), ctx("container", "keller")), false);
    assert.equal(stepMatchesView(step("unterbehaelter"), ctx("overview")), false);
  });

  it("Artikel-Schritte in jedem Behälter, nicht in der Übersicht", () => {
    for (const id of ["hinzufuegen", "menge", "mhd", "loeschen", "verschieben"]) {
      assert.equal(stepMatchesView(step(id), ctx("container", "kuehlschrank")), true, id);
      assert.equal(stepMatchesView(step(id), ctx("container", "werkzeugbox")), true, id);
      assert.equal(stepMatchesView(step(id), ctx("overview")), false, id);
      assert.equal(stepMatchesView(step(id), ctx("list-ablauf")), false, id);
    }
  });

  it("Suche in Übersicht und Behälter; 'Läuft ab'-Liste nur dort", () => {
    assert.equal(stepMatchesView(step("suche"), ctx("overview")), true);
    assert.equal(stepMatchesView(step("suche"), ctx("container", "kueche")), true);
    assert.equal(stepMatchesView(step("ablauf"), ctx("container", "kueche")), true);
    assert.equal(stepMatchesView(step("ablauf"), ctx("list-ablauf")), false);
    assert.equal(stepMatchesView(step("ablauf-liste"), ctx("list-ablauf")), true);
    assert.equal(stepMatchesView(step("ablauf-liste"), ctx("overview")), false);
  });

  it("ausserhalb des Übungsmodus passt nichts; Unsinn ergibt false", () => {
    assert.equal(stepMatchesView(step("willkommen"), ctx("overview", null, false)), false);
    assert.equal(stepMatchesView(null, ctx("overview")), false);
    assert.equal(stepMatchesView(step("willkommen"), null), false);
  });

  it("jeder nav-Knopf führt in eine passende Ansicht", () => {
    const viewOf = (url) => {
      const u = new URL(url, "https://x.test/");
      if (u.searchParams.get("c")) return ctx("container", u.searchParams.get("c"));
      if (u.searchParams.get("liste") === "ablauf") return ctx("list-ablauf");
      return ctx("overview");
    };
    for (const s of TUTORIAL_STEPS) assert.equal(stepMatchesView(s, viewOf(s.nav.url)), true, s.id);
  });
});

describe("tutorial: shouldAdvance", () => {
  it("Weiter/Überspringen geht bei jedem Schritt", () => {
    for (const s of TUTORIAL_STEPS) assert.equal(shouldAdvance(s, { type: "next" }), true, s.id);
  });

  it("Klick-Schritte gehen nur über Weiter", () => {
    for (const id of ["willkommen", "scannen", "ablauf-liste", "qr"]) {
      const s = step(id);
      for (const type of ["item-added", "qty-changed", "mhd-saved", "item-removed", "search", "dialog-open"]) {
        assert.equal(shouldAdvance(s, { type, query: "Hammer" }), false, `${id}/${type}`);
      }
      assert.equal(shouldAdvance(s, { type: "view", view: "container", containerId: "kueche" }), false, id);
      assert.equal(shouldAdvance(s, { type: "view", view: "list-ablauf" }), false, id);
    }
  });

  it("Ansichts-Schritte: richtige Ansicht ja, falsche nein", () => {
    assert.equal(shouldAdvance(step("behaelter"), { type: "view", view: "container", containerId: "kueche" }), true);
    assert.equal(shouldAdvance(step("behaelter"), { type: "view", view: "container", containerId: "keller" }), false);
    assert.equal(shouldAdvance(step("behaelter"), { type: "view", view: "overview" }), false);
    assert.equal(shouldAdvance(step("unterbehaelter"), { type: "view", view: "container", containerId: "kuehlschrank" }), true);
    assert.equal(shouldAdvance(step("unterbehaelter"), { type: "view", view: "container", containerId: "kueche" }), false);
    assert.equal(shouldAdvance(step("ablauf"), { type: "view", view: "list-ablauf" }), true);
    assert.equal(shouldAdvance(step("ablauf"), { type: "view", view: "overview" }), false);
    assert.equal(shouldAdvance(step("behaelter"), { type: "item-added" }), false);
  });

  it("Ereignis-Schritte: richtiges Ereignis ja, falsches nein", () => {
    const pairs = [["hinzufuegen", "item-added"], ["menge", "qty-changed"], ["mhd", "mhd-saved"], ["loeschen", "item-removed"]];
    for (const [id, type] of pairs) {
      assert.equal(shouldAdvance(step(id), { type, containerId: "kuehlschrank", itemId: "x" }), true, id);
      for (const [, other] of pairs) {
        if (other !== type) assert.equal(shouldAdvance(step(id), { type: other }), false, `${id}/${other}`);
      }
      assert.equal(shouldAdvance(step(id), { type: "item-restored" }), false, id);
      assert.equal(shouldAdvance(step(id), { type: "view", view: "container", containerId: "kuehlschrank" }), false, id);
    }
  });

  it("Verschieben geht auch nach erledigtem Verschieben weiter", () => {
    assert.equal(shouldAdvance(step("verschieben"), { type: "move-done" }), true);
    assert.equal(shouldAdvance(step("verschieben"), { type: "item-removed" }), false);
  });

  it("Suche braucht Text", () => {
    assert.equal(shouldAdvance(step("suche"), { type: "search", query: "Hammer" }), true);
    assert.equal(shouldAdvance(step("suche"), { type: "search", query: "" }), false);
    assert.equal(shouldAdvance(step("suche"), { type: "search", query: "   " }), false);
    assert.equal(shouldAdvance(step("suche"), { type: "search" }), false);
    assert.equal(shouldAdvance(step("suche"), { type: "item-added" }), false);
  });

  it("Unsinn ergibt false", () => {
    assert.equal(shouldAdvance(null, { type: "next" }), false);
    assert.equal(shouldAdvance(step("menge"), null), false);
    assert.equal(shouldAdvance(step("menge"), {}), false);
    assert.equal(shouldAdvance(step("menge"), { type: 5 }), false);
  });
});

describe("tutorial: Fortsetzen nach Navigation", () => {
  it("überspringt erfüllte Ansichts-Schritte", () => {
    const b = stepIndexById("behaelter");
    assert.equal(resolveStepForView(b, ctx("container", "kueche")), b + 1);
    assert.equal(resolveStepForView(b, ctx("overview")), b);
    // Küche → Kühlschrank direkt (z.B. QR gescannt): nur ein Schritt weiter, kein Durchrauschen
    assert.equal(resolveStepForView(b, ctx("container", "kuehlschrank")), b);
    const u = stepIndexById("unterbehaelter");
    assert.equal(resolveStepForView(u, ctx("container", "kuehlschrank")), u + 1);
    const a = stepIndexById("ablauf");
    assert.equal(resolveStepForView(a, ctx("list-ablauf")), stepIndexById("ablauf-liste"));
    assert.equal(resolveStepForView(N - 1, ctx("overview")), N - 1);
  });
});
