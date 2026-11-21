// Paket "Schutz": Was können Besucher OHNE Anmeldung (bzw. angemeldet, aber nicht freigeschaltet)
// über die öffentliche Firebase-Konfiguration direkt in Firestore anrichten? Erwartung: nichts.
// Start: npm run test:rules (Emulator, Projekt "demo-…" – garantiert offline).
// Nur Platzhalter-Adressen (example.com) – das Repo ist öffentlich.

import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import firebase from "firebase/compat/app";
import "firebase/compat/firestore";

const { FieldValue } = firebase.firestore;
firebase.firestore.setLogLevel("silent");

const PROJECT_ID = "demo-kraft-inventar";
const MEMBER = "alice@example.com";
const OWNER = "owner@example.com";

let testEnv;

const item = () => ({ name: "Nudeln", qty: 2, unit: "Packung", updatedAt: FieldValue.serverTimestamp() });
const container = () => ({ name: "Keller", createdAt: FieldValue.serverTimestamp() });

// Besucher-Varianten: nicht angemeldet; Konto mit unbestätigter Adresse (z.B. per E-Mail/Passwort
// selbst registriert); bestätigte Adresse, aber nicht in members; anonym angemeldet; Token mit der
// Adresse eines Mitglieds, aber email_verified false (wer sich mit fremder Adresse registriert).
const visitors = {
  "nicht angemeldet": () => testEnv.unauthenticatedContext().firestore(),
  "Konto, Adresse unbestätigt": () => testEnv.authenticatedContext("u1", { email: "fremd@example.com", email_verified: false }).firestore(),
  "Konto bestätigt, nicht freigeschaltet": () => testEnv.authenticatedContext("u2", { email: "fremd@example.com", email_verified: true }).firestore(),
  "anonym angemeldet": () => testEnv.authenticatedContext("u3", { firebase: { sign_in_provider: "anonymous" } }).firestore(),
  "Mitglieds-Adresse, unbestätigt": () => testEnv.authenticatedContext("u4", { email: MEMBER, email_verified: false }).firestore(),
  "Owner-Adresse in Grossbuchstaben, unbestätigt": () => testEnv.authenticatedContext("u5", { email: OWNER.toUpperCase(), email_verified: false }).firestore(),
};

describe("firestore.rules: Besucher ohne Freischaltung", function () {
  this.timeout(30000);

  before(async () => {
    const host = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
    const [h, p] = host.split(":");
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"), host: h, port: Number(p) },
    });
  });

  after(async () => {
    if (testEnv) await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await db.doc(`members/${MEMBER}`).set({ name: "Alice" });
      await db.doc(`members/${OWNER}`).set({ role: "owner", name: "Owner" });
      await db.doc("settings/lock").set({ locked: false });
      await db.doc("settings/andere").set({ x: 1 });
      await db.doc("containers/keller").set({ name: "Keller" });
      await db.doc("containers/keller/items/reis").set({ name: "Reis", qty: 1, unit: "Packung" });
      await db.doc("sonstiges/x").set({ a: 1 });
    });
  });

  for (const [label, makeDb] of Object.entries(visitors)) {
    describe(label, () => {
      it("liest nichts: Behälter, Artikel, Listen, Collection-Group, members, settings, unbekannte Sammlungen", async () => {
        const db = makeDb();
        await assertFails(db.doc("containers/keller").get());
        await assertFails(db.collection("containers").get());
        await assertFails(db.doc("containers/keller/items/reis").get());
        await assertFails(db.collection("containers/keller/items").get());
        await assertFails(db.collectionGroup("items").get());
        await assertFails(db.doc(`members/${MEMBER}`).get());
        await assertFails(db.doc(`members/${OWNER}`).get());
        await assertFails(db.doc("members/fremd@example.com").get());
        await assertFails(db.collection("members").get());
        await assertFails(db.doc("settings/lock").get());
        await assertFails(db.doc("settings/andere").get());
        await assertFails(db.collection("settings").get());
        await assertFails(db.doc("sonstiges/x").get());
        await assertFails(db.doc("containers/gibt-es-nicht").get());
      });

      it("schreibt nichts: anlegen, ändern, löschen, Batch", async () => {
        const db = makeDb();
        await assertFails(db.doc("containers/neu").set(container()));
        await assertFails(db.doc("containers/keller").update({ name: "Gekapert" }));
        await assertFails(db.doc("containers/keller").delete());
        await assertFails(db.doc("containers/keller/items/neu").set(item()));
        await assertFails(db.doc("containers/keller/items/reis").update({ qty: FieldValue.increment(1) }));
        await assertFails(db.doc("containers/keller/items/reis").delete());
        await assertFails(db.collection("containers").add(container()));
        const batch = db.batch();
        batch.set(db.doc("containers/b1"), container());
        batch.delete(db.doc("containers/keller/items/reis"));
        await assertFails(batch.commit());
      });

      it("kann sich nicht freischalten, keine Sperre setzen, keine eigenen Sammlungen anlegen", async () => {
        const db = makeDb();
        await assertFails(db.doc("members/fremd@example.com").set({ name: "Ich" }));
        await assertFails(db.doc(`members/${MEMBER}`).set({ role: "owner" }, { merge: true }));
        await assertFails(db.doc(`members/${MEMBER}`).delete());
        await assertFails(db.doc("settings/lock").set({ locked: true }));
        await assertFails(db.doc("settings/lock").delete());
        await assertFails(db.doc("settings/andere").set({ x: 2 }));
        await assertFails(db.doc("sonstiges/neu").set({ a: 1 }));
        await assertFails(db.doc("spam/1").set({ text: "x".repeat(1000) }));
      });
    });
  }

  it("Gegenprobe: Daten sind nach den Besuchen unverändert, Mitglied liest weiter", async () => {
    const v = testEnv.unauthenticatedContext().firestore();
    await assertFails(v.doc("containers/keller").update({ name: "Gekapert" }));
    await assertFails(v.doc("settings/lock").set({ locked: true }));
    const m = testEnv.authenticatedContext("alice-gegenprobe", { email: MEMBER, email_verified: true }).firestore();
    const snap = await assertSucceeds(m.doc("containers/keller").get());
    if (snap.data().name !== "Keller") throw new Error("Behälter verändert");
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const sdb = ctx.firestore();
      const all = await sdb.collection("members").get();
      if (all.size !== 2) throw new Error(`members verändert: ${all.size}`);
      const lock = await sdb.doc("settings/lock").get();
      if (lock.data().locked !== false) throw new Error("Sperre verändert");
    });
  });
});
