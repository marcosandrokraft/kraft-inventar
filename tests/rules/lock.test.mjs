// Tests für firestore.rules: Artikel-Icon, Owner (members.role) und Sperre (settings/lock).
// Start: npm run test:rules (siehe TESTS.md). Projekt-ID "demo-..." = garantiert offline.
// Nur Platzhalter-Adressen (example.com) verwenden – das Repo ist öffentlich.

import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
// Gleiche (ESM-)Instanz wie in @firebase/rules-unit-testing (serverTimestamp/increment).
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
const owner = (email = OWNER) => user(email, "owner");
const outsider = () => user(OUTSIDER, "mallory");

const validItem = (patch = {}) => ({
  name: "Nudeln",
  qty: 2,
  unit: "Packung",
  updatedAt: FieldValue.serverTimestamp(),
  ...patch,
});
const validContainer = () => ({ name: "Garage", createdAt: FieldValue.serverTimestamp() });

async function seed(fn) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore()));
}
const setLock = (data) => seed((db) => db.doc("settings/lock").set(data));

describe("firestore.rules: Icon, Owner, Sperre", function () {
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
      await db.doc("containers/keller").set({ name: "Keller" });
      await db.doc("containers/keller/items/reis").set({ name: "Reis", qty: 1, unit: "Packung" });
    });
  });

  describe("Artikel-Icon", () => {
    const ref = (db) => db.doc("containers/keller/items/nudeln");

    it("gültige Icon-IDs erlaubt", async () => {
      for (const icon of ["milk", "leafy-green", "cup-soda", "a".repeat(40), "egg-2"]) {
        await assertSucceeds(ref(member()).set(validItem({ icon })), icon);
      }
    });
    it("ungültige Icon-IDs abgelehnt", async () => {
      for (const icon of ["Milk", "leafy green", "<script>", "a".repeat(41), "", 42, "a/b", "cup_soda", null, true]) {
        await assertFails(ref(member()).set(validItem({ icon })), String(icon));
      }
    });
    it("icon per merge setzen und per deleteField entfernen", async () => {
      const r = member().doc("containers/keller/items/reis");
      await assertSucceeds(r.set({ icon: "milk", updatedAt: FieldValue.serverTimestamp() }, { merge: true }));
      await assertSucceeds(r.update({ icon: FieldValue.delete() }));
      await assertFails(r.set({ icon: "Milk" }, { merge: true }));
    });
    it("icon zusammen mit Foto erlaubt", async () => {
      await assertSucceeds(
        ref(member()).set(validItem({ icon: "milk", photo: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==" }))
      );
    });
    it("Nicht-Mitglied darf kein icon setzen", async () => {
      await assertFails(outsider().doc("containers/keller/items/reis").set({ icon: "milk" }, { merge: true }));
    });
  });

  describe("Owner-Erkennung", () => {
    it("Mitglied kann sich nicht selbst zum Owner machen", async () => {
      await assertFails(member().doc(`members/${MEMBER}`).set({ role: "owner" }, { merge: true }));
      await assertFails(member().doc(`members/${MEMBER}`).update({ role: "owner" }));
      await assertFails(member().doc(`members/${OWNER}`).get());
      await assertFails(member().doc("settings/lock").set({ locked: true }));
    });
    it('role "Owner"/"admin"/true zählt nicht als Owner', async () => {
      for (const role of ["Owner", "admin", true, "owner "]) {
        await seed((db) => db.doc(`members/${MEMBER}`).set({ role }));
        await assertFails(member().doc("settings/lock").set({ locked: true }), String(role));
      }
    });
    it("Owner mit Grossbuchstaben in der Token-E-Mail wird erkannt", async () => {
      await assertSucceeds(owner("Owner@Example.COM").doc("settings/lock").set({ locked: true }));
      await assertSucceeds(owner("Owner@Example.COM").doc("containers/keller/items/nudeln").set(validItem()));
    });
  });

  describe("Lock-Dokument settings/lock", () => {
    it("Owner darf sperren, entsperren und löschen", async () => {
      const r = owner().doc("settings/lock");
      await assertSucceeds(r.set({ locked: true, lockedAt: FieldValue.serverTimestamp(), lockedBy: "Marco" }));
      await assertSucceeds(r.set({ locked: false }, { merge: true }));
      await assertSucceeds(r.update({ locked: true, lockedAt: FieldValue.serverTimestamp() }));
      await assertSucceeds(r.update({ lockedBy: FieldValue.delete(), lockedAt: FieldValue.delete() }));
      await assertSucceeds(r.set({ locked: false }));
      await assertSucceeds(r.delete());
    });
    it("Nicht-Owner-Mitglied darf es weder anlegen, ändern noch löschen", async () => {
      await assertFails(member().doc("settings/lock").set({ locked: true }));
      await assertFails(member().doc("settings/lock").set({ locked: false }));
      await setLock({ locked: true, lockedBy: "Marco" });
      await assertFails(member().doc("settings/lock").set({ locked: false }, { merge: true }));
      await assertFails(member().doc("settings/lock").update({ locked: false }));
      await assertFails(member().doc("settings/lock").delete());
    });
    it("Nicht-Mitglied darf es weder lesen noch schreiben", async () => {
      await setLock({ locked: true });
      await assertFails(outsider().doc("settings/lock").get());
      await assertFails(outsider().doc("settings/lock").set({ locked: false }));
      await assertFails(testEnv.unauthenticatedContext().firestore().doc("settings/lock").get());
    });
    it("Mitglied darf es lesen (auch wenn es fehlt)", async () => {
      await assertSucceeds(member().doc("settings/lock").get());
      await setLock({ locked: true, lockedBy: "Marco" });
      const snap = await assertSucceeds(member().doc("settings/lock").get());
      if (snap.data().locked !== true) throw new Error("locked erwartet");
    });
    it("ungültige Form abgelehnt (auch für Owner)", async () => {
      const r = owner().doc("settings/lock");
      for (const data of [
        { locked: "true" },
        { locked: 1 },
        {},
        { lockedBy: "Marco" },
        { locked: true, evil: 1 },
        { locked: true, lockedBy: "x".repeat(101) },
        { locked: true, lockedBy: "" },
        { locked: true, lockedBy: 7 },
        { locked: true, lockedAt: "heute" },
        { locked: true, lockedAt: 123 },
      ]) {
        await assertFails(r.set(data), JSON.stringify(data));
      }
      await assertSucceeds(r.set({ locked: true, lockedBy: "x".repeat(100) }));
    });
    it("andere Dokumente unter settings/ weder lesen noch schreiben", async () => {
      await seed((db) => db.doc("settings/other").set({ a: 1 }));
      for (const db of [member(), owner()]) {
        await assertFails(db.doc("settings/other").get());
        await assertFails(db.doc("settings/other").set({ a: 2 }));
        await assertFails(db.doc("settings/neu").set({ locked: true }));
        await assertFails(db.doc("settings/other").delete());
        await assertFails(db.collection("settings").get());
      }
    });
  });

  describe("Sperre", () => {
    it("ohne lock-Dokument darf Mitglied schreiben", async () => {
      await assertSucceeds(member().doc("containers/garage").set(validContainer()));
      await assertSucceeds(member().doc("containers/keller/items/nudeln").set(validItem()));
      await assertSucceeds(member().doc("containers/keller/items/reis").update({ qty: FieldValue.increment(1) }));
      await assertSucceeds(member().doc("containers/keller/items/reis").delete());
    });
    it("mit locked:false darf Mitglied schreiben", async () => {
      await setLock({ locked: false, lockedBy: "Marco" });
      await assertSucceeds(member().doc("containers/garage").set(validContainer()));
      await assertSucceeds(member().doc("containers/keller").set({ name: "Keller 2" }, { merge: true }));
      await assertSucceeds(member().doc("containers/keller/items/nudeln").set(validItem()));
      await assertSucceeds(member().doc("containers/keller/items/reis").delete());
      await assertSucceeds(member().doc("containers/garage").delete());
    });

    describe("mit locked:true", () => {
      beforeEach(() => setLock({ locked: true, lockedBy: "Marco" }));

      it("Nicht-Owner: Behälter nicht anlegen/ändern/löschen", async () => {
        await assertFails(member().doc("containers/garage").set(validContainer()));
        await assertFails(member().doc("containers/keller").set({ name: "Keller 2" }, { merge: true }));
        await assertFails(member().doc("containers/keller").update({ type: "raum" }));
        await assertFails(member().doc("containers/keller").delete());
      });
      it("Nicht-Owner: Artikel nicht anlegen/ändern/löschen", async () => {
        const r = member().doc("containers/keller/items/reis");
        await assertFails(member().doc("containers/keller/items/nudeln").set(validItem()));
        await assertFails(r.set({ qty: 3 }, { merge: true }));
        await assertFails(r.update({ qty: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }));
        await assertFails(r.update({ icon: "milk" }));
        await assertFails(r.delete());
      });
      it("Nicht-Owner: Batch-Umzug abgelehnt, Quelle bleibt", async () => {
        const db = member();
        const batch = db.batch();
        batch.set(db.doc("containers/garage/items/reis"), validItem({ name: "Reis", qty: 1 }));
        batch.delete(db.doc("containers/keller/items/reis"));
        await assertFails(batch.commit());
        await seed(async (sdb) => {
          if (!(await sdb.doc("containers/keller/items/reis").get()).exists) throw new Error("Quelle gelöscht");
        });
      });
      it("Nicht-Owner: Lesen bleibt erlaubt (get, list, collectionGroup)", async () => {
        const db = member();
        await assertSucceeds(db.doc("containers/keller").get());
        await assertSucceeds(db.collection("containers").get());
        await assertSucceeds(db.doc("containers/keller/items/reis").get());
        await assertSucceeds(db.collection("containers/keller/items").get());
        const snap = await assertSucceeds(db.collectionGroup("items").get());
        if (snap.size !== 1) throw new Error(`erwartet 1 Item, erhalten ${snap.size}`);
      });
      it("Nicht-Mitglied: weiterhin nichts", async () => {
        await assertFails(outsider().doc("containers/keller").get());
        await assertFails(outsider().doc("containers/keller/items/nudeln").set(validItem()));
      });
      it("Owner darf weiterhin alles", async () => {
        const db = owner();
        await assertSucceeds(db.doc("containers/garage").set(validContainer()));
        await assertSucceeds(db.doc("containers/keller").set({ name: "Keller 2" }, { merge: true }));
        await assertSucceeds(db.doc("containers/keller/items/nudeln").set(validItem({ icon: "milk" })));
        await assertSucceeds(db.doc("containers/keller/items/reis").update({ qty: FieldValue.increment(1) }));
        const batch = db.batch();
        batch.set(db.doc("containers/garage/items/reis"), validItem({ name: "Reis", qty: 2 }));
        batch.delete(db.doc("containers/keller/items/reis"));
        await assertSucceeds(batch.commit());
        await assertSucceeds(db.doc("containers/keller/items/nudeln").delete());
        await assertSucceeds(db.doc("containers/garage/items/reis").delete());
        await assertSucceeds(db.doc("containers/garage").delete());
      });
      it("Owner entsperrt, danach darf Mitglied wieder schreiben", async () => {
        await assertFails(member().doc("containers/keller/items/nudeln").set(validItem()));
        await assertSucceeds(owner().doc("settings/lock").set({ locked: false }));
        await assertSucceeds(member().doc("containers/keller/items/nudeln").set(validItem()));
      });
    });
  });

  // 8 Artikel = 16 Schreibvorgänge in einem Batch. Prüft, dass get()/exists() auf dieselben
  // Dokumente (members, settings/lock) nicht pro Schreibvorgang gegen das Limit zählen.
  describe("Batch-Umzug mit 8 Artikeln (get()-Limits)", () => {
    const N = 8;
    beforeEach(() =>
      seed(async (db) => {
        await db.doc("containers/garage").set({ name: "Garage" });
        for (let i = 0; i < N; i++) {
          await db.doc(`containers/keller/items/artikel-${i}`).set({ name: `Artikel ${i}`, qty: 1, unit: "Stk", icon: "milk" });
        }
      })
    );
    const moveAll = (db) => {
      const batch = db.batch();
      for (let i = 0; i < N; i++) {
        batch.set(
          db.doc(`containers/garage/items/artikel-${i}`),
          { name: `Artikel ${i}`, qty: 1, unit: "Stk", icon: "milk", updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
        batch.delete(db.doc(`containers/keller/items/artikel-${i}`));
      }
      return batch.commit();
    };

    it("entsperrt (ohne lock-Dokument), Mitglied: erlaubt", async () => {
      await assertSucceeds(moveAll(member()));
    });
    it("entsperrt (locked:false), Mitglied: erlaubt", async () => {
      await setLock({ locked: false });
      await assertSucceeds(moveAll(member()));
    });
    it("gesperrt, Owner: erlaubt", async () => {
      await setLock({ locked: true, lockedBy: "Marco" });
      await assertSucceeds(moveAll(owner()));
    });
    it("gesperrt, Nicht-Owner: abgelehnt", async () => {
      await setLock({ locked: true, lockedBy: "Marco" });
      await assertFails(moveAll(member()));
    });
  });
});
