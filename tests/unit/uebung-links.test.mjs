// Übungsmodus: Links und gescannte Codes (lib.js).
import assert from "node:assert/strict";
import { containerUrl, practiceParam, scanTarget, practiceLinkAction, containerIdFromScan } from "../../lib.js";

const APP = "https://example.com/kraft-inventar/index.html";

describe("Übungsmodus: Links", () => {
  it("containerUrl mit practice setzt ?uebung=1 vor c=, ohne bleibt alles wie bisher", () => {
    assert.equal(containerUrl(APP, "keller"), "https://example.com/kraft-inventar/index.html?c=keller");
    assert.equal(containerUrl(APP, "keller", "Keller", { practice: true }), "https://example.com/kraft-inventar/index.html?uebung=1&c=keller&n=Keller");
    assert.equal(containerUrl(APP, "kühlschrank", null, { practice: false }), "https://example.com/kraft-inventar/index.html?c=k%C3%BChlschrank");
  });

  it("practiceParam: 1 = an, 0 = aus, sonst null", () => {
    assert.equal(practiceParam("?uebung=1&c=x"), true);
    assert.equal(practiceParam("?uebung=0"), false);
    assert.equal(practiceParam("?c=x"), null);
    assert.equal(practiceParam("?uebung=ja"), null);
    assert.equal(practiceParam(""), null);
  });

  it("scanTarget erkennt Übungs- und echte Codes, fremde Links → null", () => {
    assert.deepEqual(scanTarget(`${APP}?uebung=1&c=werkzeugbox&n=Werkzeugbox`, APP), { id: "werkzeugbox", practice: true });
    assert.deepEqual(scanTarget(`${APP}?c=werkzeugbox`, APP), { id: "werkzeugbox", practice: false });
    assert.deepEqual(scanTarget(`  ${APP}?c=garage&uebung=1  `, APP), { id: "garage", practice: true });
    assert.equal(scanTarget("https://evil.example.org/index.html?uebung=1&c=x", APP), null);
    assert.equal(scanTarget("kein Link", APP), null);
    assert.equal(scanTarget(`${APP}?uebung=1`, APP), null);
    // Übungs-Codes sind gleichzeitig gültige Behälter-Links (ältere App-Versionen öffnen sie normal)
    assert.equal(containerIdFromScan(`${APP}?uebung=1&c=keller`, APP), "keller");
  });

  it("practiceLinkAction: echter Code von aussen → Hinweis, sonst öffnen", () => {
    assert.equal(practiceLinkAction({ hasPracticeParam: false, internal: false }), "real");
    assert.equal(practiceLinkAction({ hasPracticeParam: true, internal: false }), "open");
    assert.equal(practiceLinkAction({ hasPracticeParam: false, internal: true }), "open");
    assert.equal(practiceLinkAction({ hasPracticeParam: true, internal: true }), "open");
  });
});
