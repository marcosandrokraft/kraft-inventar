// Tests für firestore.rules, Paket Ziel: optionales Feld `target` ("Gehört nach …") an Behältern und
// Artikeln. Start: npm run test:rules (siehe TESTS.md). Projekt-ID "demo-..." = garantiert offline.
// Nur Platzhalter-Adressen (example.com) verwenden – das Repo ist öffentlich.

import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import firebase from "firebase/compat/app";
import "firebase/compat/firestore";

const { FieldValue } = firebase.firestore;
firebase.firestore.setLogLevel("silent");

const PROJECT_ID = "demo-kraft-inventar";
const MEMBER = "alice@example.com";
const OWNER = "owner@example.com";
const OUTSIDER = "mallory@example.com";

let testEnv;

function user(email, uid) {
  return testEnv.authenticatedContext(uid, { email, email_verified: true }).firestore();
}
const member = () => user(MEMBER, "alice");
const owner = () => user(OWNER, "owner");
const outsider = () => user(OUTSIDER, "mallory");

const validItem = (patch = {}) => ({
  name: "Messerset",
  qty: 1,
  unit: "Stk",
  updatedAt: FieldValue.serverTimestamp(),
  ...patch,
});

async function seed(fn) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore()));
}

const BAD_TARGETS = ["", "a/b", "/kueche", "x".repeat(101), 42, true, null, ["kueche"], { id: "kueche" }];

describe("firestore.rules: Ziel (target)", function () {
  this.timeout(20000);

  before(async () => {
    const host = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
    const [h, p] = host.split(":");
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"),
        host: h,
        port: Number(p),
      },
    });
  });

  after(async () => {
    if (testEnv) await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await seed(async (db) => {
      await db.doc(`members/${MEMBER}`).set({ note: "Testmitglied" });
      await db.doc(`members/${OWNER}`).set({ role: "owner", name: "Marco" });
      await db.doc("containers/kueche").set({ name: "Küche", type: "raum" });
      await db.doc("containers/kiste-1").set({ name: "Kiste 1", type: "box" });
      await db.doc("containers/kiste-1/items/teller").set({ name: "Teller", qty: 6, unit: "Stk" });
    });
  });

  describe("Behälter", () => {
    it("Ziel beim Anlegen und per merge setzen", async () => {
      await assertSucceeds(member().doc("containers/kiste-2").set({ name: "Kiste 2", target: "kueche", createdAt: FieldValue.serverTimestamp() }));
      await assertSucceeds(member().doc("containers/kiste-1").set({ name: "Kiste 1", type: "box", target: "kueche" }, { merge: true }));
      await assertSucceeds(member().doc("containers/kiste-1").update({ target: "x".repeat(100) }));
      // Ziel muss (aus Sicht der Regeln) nicht existieren – die App prüft das; ältere IDs sind erlaubt
      await assertSucceeds(member().doc("containers/kiste-1").update({ target: "Alte ID mit Leerzeichen" }));
    });
    it("Ziel entfernen (deleteField)", async () => {
      await seed((db) => db.doc("containers/kiste-1").set({ name: "Kiste 1", target: "kueche" }));
      await assertSucceeds(member().doc("containers/kiste-1").set({ name: "Kiste 1", target: FieldValue.delete() }, { merge: true }));
      await assertSucceeds(member().doc("containers/kiste-1").update({ target: FieldValue.delete() }));
    });
    it("ungültige Ziele abgelehnt", async () => {
      for (const target of BAD_TARGETS) {
        await assertFails(member().doc("containers/kiste-1").update({ target }), JSON.stringify(target));
        await assertFails(member().doc("containers/kiste-3").set({ name: "Kiste 3", target }), JSON.stringify(target));
      }
    });
    it("Ziel = eigene ID abgelehnt (beim Anlegen und Ändern)", async () => {
      await assertFails(member().doc("containers/kiste-1").update({ target: "kiste-1" }));
      await assertFails(member().doc("containers/kiste-3").set({ name: "Kiste 3", target: "kiste-3" }));
    });
    it("Ziel zusammen mit parent und type erlaubt, andere neue Felder weiterhin nicht", async () => {
      await assertSucceeds(member().doc("containers/kiste-1").set({ name: "Kiste 1", type: "box", parent: "kueche", target: "kueche" }));
      await assertFails(member().doc("containers/kiste-1").update({ targets: ["kueche"] }));
      await assertFails(member().doc("containers/kiste-1").update({ ziel: "kueche" }));
    });
  });

  describe("Artikel", () => {
    const ref = (db) => db.doc("containers/kiste-1/items/messerset");

    it("Ziel beim Anlegen, per update und im Batch (Verschieben) erlaubt", async () => {
      await assertSucceeds(ref(member()).set(validItem({ target: "kueche-schublade" })));
      await assertSucceeds(member().doc("containers/kiste-1/items/teller").update({ target: "kueche", updatedAt: FieldValue.serverTimestamp() }));
      const db = member();
      const batch = db.batch();
      batch.set(db.doc("containers/kueche/items/teller"), { name: "Teller", qty: 6, unit: "Stk", target: "kueche-schrank" });
      batch.delete(db.doc("containers/kiste-1/items/teller"));
      await assertSucceeds(batch.commit());
    });
    it("Ziel entfernen (deleteField)", async () => {
      await seed((db) => db.doc("containers/kiste-1/items/teller").set({ name: "Teller", qty: 6, unit: "Stk", target: "kueche" }));
      await assertSucceeds(member().doc("containers/kiste-1/items/teller").update({ target: FieldValue.delete() }));
    });
    it("ungültige Ziele abgelehnt", async () => {
      for (const target of BAD_TARGETS) {
        await assertFails(ref(member()).set(validItem({ target })), JSON.stringify(target));
        await assertFails(member().doc("containers/kiste-1/items/teller").update({ target }), JSON.stringify(target));
      }
    });
    it("Artikel ohne Ziel bleiben gültig (rückwärtskompatibel)", async () => {
      await assertSucceeds(ref(member()).set(validItem()));
      await assertSucceeds(member().doc("containers/kiste-1/items/teller").update({ qty: FieldValue.increment(1) }));
    });
  });

  describe("Berechtigung", () => {
    it("Nicht-Mitglied darf kein Ziel setzen", async () => {
      await assertFails(outsider().doc("containers/kiste-1").update({ target: "kueche" }));
      await assertFails(outsider().doc("containers/kiste-1/items/teller").update({ target: "kueche" }));
    });
    it("bei Sperre nur der Owner", async () => {
      await seed((db) => db.doc("settings/lock").set({ locked: true }));
      await assertFails(member().doc("containers/kiste-1").update({ target: "kueche" }));
      await assertFails(member().doc("containers/kiste-1/items/teller").update({ target: "kueche" }));
      await assertSucceeds(owner().doc("containers/kiste-1").update({ target: "kueche" }));
      await assertSucceeds(owner().doc("containers/kiste-1/items/teller").update({ target: "kueche" }));
      // Lesen bleibt für alle Mitglieder erlaubt
      await assertSucceeds(member().doc("containers/kiste-1").get());
    });
  });
});
