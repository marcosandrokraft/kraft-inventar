// Tests für firestore.rules gegen den lokalen Firestore-Emulator.
// Start: npm run test:rules (siehe TESTS.md). Projekt-ID "demo-..." = garantiert offline,
// es wird nie eine echte Firebase-Ressource angesprochen.
// Nur Platzhalter-Adressen (example.com) verwenden – das Repo ist öffentlich.

import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
// Gleiche (ESM-)Instanz wie in @firebase/rules-unit-testing, sonst erkennt das SDK
// serverTimestamp()/increment() nicht ("Unsupported field value").
import firebase from "firebase/compat/app";
import "firebase/compat/firestore";

const { FieldValue } = firebase.firestore;
// Erwartete PERMISSION_DENIED-Meldungen nicht ins Log schreiben.
firebase.firestore.setLogLevel("silent");

const PROJECT_ID = "demo-kraft-inventar";
const MEMBER = "alice@example.com";

let testEnv;

function member(email = MEMBER, uid = "alice") {
  return testEnv.authenticatedContext(uid, { email, email_verified: true }).firestore();
}

const validItem = () => ({
  name: "Nudeln",
  qty: 2,
  unit: "Packung",
  updatedAt: FieldValue.serverTimestamp(),
});

const validContainer = () => ({ name: "Keller", createdAt: FieldValue.serverTimestamp() });

const JPEG = "data:image/jpeg;base64,";

async function seed(fn) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore()));
}

describe("firestore.rules", function () {
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
      await db.doc("containers/keller").set({ name: "Keller" });
      await db.doc("containers/keller/items/reis").set({ name: "Reis", qty: 1, unit: "Packung" });
    });
  });

  describe("Zugriff", () => {
    it("nicht angemeldet: kein Lesen", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(db.doc("containers/keller").get());
      await assertFails(db.doc("containers/keller/items/reis").get());
      await assertFails(db.collection("containers").get());
    });

    it("nicht angemeldet: kein Schreiben", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(db.doc("containers/neu").set(validContainer()));
      await assertFails(db.doc("containers/keller/items/nudeln").set(validItem()));
    });

    it("angemeldet, aber nicht in members: kein Zugriff", async () => {
      const db = member("mallory@example.com", "mallory");
      await assertFails(db.doc("containers/keller").get());
      await assertFails(db.doc("containers/keller/items/reis").get());
      await assertFails(db.doc("containers/neu").set(validContainer()));
      await assertFails(db.doc("containers/keller/items/nudeln").set(validItem()));
      await assertFails(db.doc("containers/keller/items/reis").delete());
    });

    it("email_verified false: kein Zugriff", async () => {
      const db = testEnv
        .authenticatedContext("alice", { email: MEMBER, email_verified: false })
        .firestore();
      await assertFails(db.doc("containers/keller").get());
      await assertFails(db.doc("containers/keller/items/nudeln").set(validItem()));
    });

    it("Token ohne E-Mail: kein Zugriff", async () => {
      const db = testEnv.authenticatedContext("anon").firestore();
      await assertFails(db.doc("containers/keller").get());
    });

    it("Mitglied kann Container und Items lesen", async () => {
      const db = member();
      await assertSucceeds(db.doc("containers/keller").get());
      await assertSucceeds(db.collection("containers").get());
      await assertSucceeds(db.doc("containers/keller/items/reis").get());
      await assertSucceeds(db.collection("containers/keller/items").get());
    });

    it("Mitglied kann Container und Items anlegen, ändern, Items löschen", async () => {
      const db = member();
      await assertSucceeds(db.doc("containers/vorratsschrank").set(validContainer(), { merge: true }));
      await assertSucceeds(db.doc("containers/keller").set({ name: "Keller unten" }, { merge: true }));
      await assertSucceeds(
        db.doc("containers/keller/items/nudeln").set(validItem(), { merge: true })
      );
      await assertSucceeds(
        db.doc("containers/keller/items/reis").set(
          { name: "Reis", qty: 3, unit: "g", updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        )
      );
      await assertSucceeds(db.doc("containers/keller/items/reis").delete());
    });

    it("Mitglied mit Grossbuchstaben in der Token-E-Mail hat Zugriff", async () => {
      const db = member("Alice@Example.COM");
      await assertSucceeds(db.doc("containers/keller").get());
      await assertSucceeds(db.doc("containers/keller/items/nudeln").set(validItem()));
    });

    it("members-Sammlung ist weder les- noch schreibbar (auch nicht für Mitglieder)", async () => {
      const db = member();
      await assertFails(db.doc(`members/${MEMBER}`).get());
      await assertFails(db.collection("members").get());
      await assertFails(db.doc("members/mallory@example.com").set({ x: 1 }));
      await assertFails(db.doc(`members/${MEMBER}`).delete());
      const outsider = member("mallory@example.com", "mallory");
      await assertFails(outsider.doc("members/mallory@example.com").set({ x: 1 }));
    });

    it("Container löschen: nur Mitglieder (Runde 2)", async () => {
      await assertFails(member("mallory@example.com", "mallory").doc("containers/keller").delete());
      await assertFails(testEnv.unauthenticatedContext().firestore().doc("containers/keller").delete());
      await assertSucceeds(member().doc("containers/keller").delete());
    });
  });

  describe("Validierung Container", () => {
    it("leerer Name abgelehnt", async () => {
      await assertFails(member().doc("containers/neu").set({ name: "" }));
    });
    it("Name > 100 Zeichen abgelehnt, genau 100 erlaubt", async () => {
      await assertFails(member().doc("containers/neu").set({ name: "x".repeat(101) }));
      await assertSucceeds(member().doc("containers/neu").set({ name: "x".repeat(100) }));
    });
    it("Name kein String abgelehnt", async () => {
      await assertFails(member().doc("containers/neu").set({ name: 42 }));
    });
    it("unbekannte Felder abgelehnt", async () => {
      await assertFails(member().doc("containers/neu").set({ name: "Neu", owner: "x" }));
      await assertFails(
        member().doc("containers/keller").set({ evil: true }, { merge: true })
      );
    });
    it("createdAt muss Timestamp sein", async () => {
      await assertFails(member().doc("containers/neu").set({ name: "Neu", createdAt: "gestern" }));
    });
  });

  describe("Validierung Items", () => {
    const itemRef = (db) => db.doc("containers/keller/items/nudeln");
    const withItem = (patch) => ({ ...validItem(), ...patch });

    it("leerer Name abgelehnt", async () => {
      await assertFails(itemRef(member()).set(withItem({ name: "" })));
    });
    it("Name > 100 Zeichen abgelehnt", async () => {
      await assertFails(itemRef(member()).set(withItem({ name: "x".repeat(101) })));
    });
    it("unbekannte Felder abgelehnt", async () => {
      await assertFails(itemRef(member()).set(withItem({ price: 3 })));
    });
    it("fehlende Pflichtfelder abgelehnt", async () => {
      await assertFails(itemRef(member()).set({ name: "Nudeln", qty: 1 }));
    });
    it("qty 0 abgelehnt", async () => {
      await assertFails(itemRef(member()).set(withItem({ qty: 0 })));
    });
    it("qty negativ abgelehnt", async () => {
      await assertFails(itemRef(member()).set(withItem({ qty: -1 })));
    });
    it("qty Kommazahl abgelehnt", async () => {
      await assertFails(itemRef(member()).set(withItem({ qty: 1.5 })));
    });
    it("qty > 100000 abgelehnt, 100000 erlaubt", async () => {
      await assertFails(itemRef(member()).set(withItem({ qty: 100001 })));
      await assertSucceeds(itemRef(member()).set(withItem({ qty: 100000 })));
    });
    it("qty als String abgelehnt", async () => {
      await assertFails(itemRef(member()).set(withItem({ qty: "2" })));
    });
    it("falsche Einheit abgelehnt, erlaubte Einheiten akzeptiert", async () => {
      await assertFails(itemRef(member()).set(withItem({ unit: "Tonne" })));
      await assertFails(itemRef(member()).set(withItem({ unit: "stk" })));
      await assertFails(itemRef(member()).set(withItem({ unit: "L" })));
      await assertFails(itemRef(member()).set(withItem({ unit: "Stück" })));
      for (const unit of ["Stk", "Packung", "g", "ml", "kg", "l", "Flasche", "Dose", "Glas"]) {
        await assertSucceeds(itemRef(member()).set(withItem({ unit })));
      }
    });
    it("gültiges JPEG-Foto erlaubt", async () => {
      await assertSucceeds(
        member()
          .doc("containers/keller/items/reis")
          .set({ photo: JPEG + "/9j/4AAQSkZJRgABAQ==", updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      );
    });
    it("Foto, das keine JPEG-data-URL ist, abgelehnt", async () => {
      const ref = member().doc("containers/keller/items/reis");
      await assertFails(ref.set({ photo: "data:image/png;base64,iVBORw0KGgo=" }, { merge: true }));
      await assertFails(ref.set({ photo: "https://example.com/bild.jpg" }, { merge: true }));
      await assertFails(ref.set({ photo: "data:image/svg+xml;base64,PHN2Zz4=" }, { merge: true }));
      await assertFails(ref.set({ photo: 123 }, { merge: true }));
    });
    it("Foto mit HTML/Script abgelehnt", async () => {
      const ref = member().doc("containers/keller/items/reis");
      await assertFails(
        ref.set({ photo: JPEG + "AAAA\"><script>alert(1)</script>" }, { merge: true })
      );
      await assertFails(
        ref.set({ photo: "javascript:alert(1)//" + JPEG + "AAAA" }, { merge: true })
      );
    });
    it("Foto zu gross abgelehnt", async () => {
      const big = JPEG + "A".repeat(900001 - JPEG.length);
      await assertFails(
        member().doc("containers/keller/items/reis").set({ photo: big }, { merge: true })
      );
      const ok = JPEG + "A".repeat(900000 - JPEG.length);
      await assertSucceeds(
        member().doc("containers/keller/items/reis").set({ photo: ok }, { merge: true })
      );
    });
  });

  describe("IDs", () => {
    it("ungültige Container-IDs beim Anlegen abgelehnt", async () => {
      const db = member();
      for (const id of ["Keller", "mein keller", "-keller", "keller-", "kel--ler", "k_eller", "x".repeat(101)]) {
        await assertFails(db.doc(`containers/${id}`).set({ name: "Keller" }));
      }
    });
    it("gültige slugify-IDs mit Umlauten/Ziffern erlaubt", async () => {
      const db = member();
      await assertSucceeds(db.doc("containers/kühlschrank-2").set({ name: "Kühlschrank 2" }));
      await assertSucceeds(db.doc("containers/kühlschrank-2/items/süßkartoffel").set(validItem()));
    });
    it("ungültige Item-IDs beim Anlegen abgelehnt", async () => {
      const db = member();
      for (const id of ["Reis", "basmati reis", "-reis"]) {
        await assertFails(db.doc(`containers/keller/items/${id}`).set(validItem()));
      }
    });
    it("Update eines bestehenden Dokuments mit Legacy-ID erlaubt", async () => {
      await seed(async (db) => {
        await db.doc("containers/Alte Kiste").set({ name: "Alte Kiste" });
        await db.doc("containers/Alte Kiste/items/Mehl Typ 405").set({ name: "Mehl", qty: 1, unit: "Packung" });
      });
      const db = member();
      await assertSucceeds(db.doc("containers/Alte Kiste").set({ name: "Alte Kiste 2" }, { merge: true }));
      await assertSucceeds(
        db.doc("containers/Alte Kiste/items/Mehl Typ 405").set({ qty: 2 }, { merge: true })
      );
      await assertSucceeds(
        db.doc("containers/Alte Kiste/items/Mehl Typ 405").update({ qty: FieldValue.increment(1) })
      );
      await assertSucceeds(db.doc("containers/Alte Kiste/items/Mehl Typ 405").delete());
    });
  });

  describe("increment", () => {
    it("increment-Update erlaubt", async () => {
      const ref = member().doc("containers/keller/items/reis");
      await assertSucceeds(
        ref.update({ qty: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() })
      );
      await assertSucceeds(ref.update({ qty: FieldValue.increment(-1) }));
    });
    it("increment mit Ergebnis qty 0 abgelehnt", async () => {
      // Seed hat qty 1
      await assertFails(
        member().doc("containers/keller/items/reis").update({ qty: FieldValue.increment(-1) })
      );
    });
    it("increment über 100000 abgelehnt", async () => {
      await assertFails(
        member().doc("containers/keller/items/reis").update({ qty: FieldValue.increment(100000) })
      );
    });
  });

  describe("collectionGroup('items')", () => {
    beforeEach(async () => {
      await seed(async (db) => {
        await db.doc("containers/kühlschrank").set({ name: "Kühlschrank" });
        await db.doc("containers/kühlschrank/items/milch").set({ name: "Milch", qty: 2, unit: "ml" });
      });
    });
    it("für Mitglied erlaubt", async () => {
      const snap = await assertSucceeds(member().collectionGroup("items").get());
      if (snap.size !== 2) throw new Error(`erwartet 2 Items, erhalten ${snap.size}`);
    });
    it("für Nicht-Mitglied verboten", async () => {
      await assertFails(member("mallory@example.com", "mallory").collectionGroup("items").get());
    });
    it("nicht angemeldet verboten", async () => {
      await assertFails(testEnv.unauthenticatedContext().firestore().collectionGroup("items").get());
    });
  });

  describe("Verschieben (Batch)", () => {
    it("Batch set in Ziel + delete in Quelle erlaubt", async () => {
      await seed((db) => db.doc("containers/garage").set({ name: "Garage" }));
      const db = member();
      const batch = db.batch();
      batch.set(
        db.doc("containers/garage/items/reis"),
        { name: "Reis", qty: 1, unit: "Packung", updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      batch.delete(db.doc("containers/keller/items/reis"));
      await assertSucceeds(batch.commit());
    });
    it("Batch für Nicht-Mitglied verboten", async () => {
      const db = member("mallory@example.com", "mallory");
      const batch = db.batch();
      batch.set(db.doc("containers/garage/items/reis"), validItem());
      batch.delete(db.doc("containers/keller/items/reis"));
      await assertFails(batch.commit());
    });
    it("Batch mit ungültigem Item scheitert komplett", async () => {
      const db = member();
      const batch = db.batch();
      batch.set(db.doc("containers/garage/items/reis"), { name: "Reis", qty: 0, unit: "Packung" });
      batch.delete(db.doc("containers/keller/items/reis"));
      await assertFails(batch.commit());
      await seed(async (sdb) => {
        const s = await sdb.doc("containers/keller/items/reis").get();
        if (!s.exists) throw new Error("Quelle wurde trotz abgelehntem Batch gelöscht");
      });
    });
  });
  describe("Runde 2: Hierarchie (type, parent)", () => {
    it("Behälter ohne type/parent bleibt gültig (alte Daten)", async () => {
      await assertSucceeds(member().doc("containers/neu").set({ name: "Neu" }));
      await assertSucceeds(member().doc("containers/keller").set({ name: "Keller 2" }, { merge: true }));
    });
    it("gültige Typen und parent erlaubt, Ebenen dürfen fehlen", async () => {
      for (const type of ["raum", "schrank", "fach", "box"]) {
        await assertSucceeds(member().doc(`containers/t-${type}`).set({ name: type, type }));
      }
      await assertSucceeds(member().doc("containers/box-7").set({ name: "Box 7", type: "box", parent: "keller", createdAt: FieldValue.serverTimestamp() }));
      await assertSucceeds(member().doc("containers/box-8").set({ name: "Box 8", type: "box" }), "Box ohne Raum");
    });
    it("unbekannter Typ abgelehnt", async () => {
      for (const type of ["Raum", "regal", "", 3, null]) {
        await assertFails(member().doc("containers/neu").set({ name: "Neu", type }));
      }
    });
    it("parent: kein String, leer, zu lang, mit / oder sich selbst abgelehnt", async () => {
      for (const parent of [5, "", "x".repeat(101), "a/b", null, true]) {
        await assertFails(member().doc("containers/neu").set({ name: "Neu", parent }));
      }
      await assertFails(member().doc("containers/keller").set({ parent: "keller" }, { merge: true }));
    });
    it("parent ändern und entfernen (deleteField)", async () => {
      await assertSucceeds(member().doc("containers/keller").set({ parent: "haus", type: "raum" }, { merge: true }));
      await assertSucceeds(member().doc("containers/keller").update({ parent: FieldValue.delete() }));
    });
    it("Nicht-Mitglied darf parent nicht setzen", async () => {
      await assertFails(member("mallory@example.com", "mallory").doc("containers/keller").set({ parent: "x" }, { merge: true }));
    });
  });

  describe("Runde 2: MHD", () => {
    const withMhd = (mhd) => ({ name: "Milch", qty: 1, unit: "l", mhd, updatedAt: FieldValue.serverTimestamp() });
    it("gültiges Datum erlaubt, ohne MHD auch", async () => {
      await assertSucceeds(member().doc("containers/keller/items/milch").set(withMhd("2027-03-12")));
      await assertSucceeds(member().doc("containers/keller/items/reis").update({ mhd: "2026-12-31" }));
      await assertSucceeds(member().doc("containers/keller/items/reis").update({ mhd: FieldValue.delete() }));
      await assertSucceeds(member().doc("containers/keller/items/reis").update({ qty: 2 }));
    });
    it("ungültige Formate abgelehnt", async () => {
      for (const mhd of ["12.03.2027", "2027-3-12", "2027-13-01", "2027-00-01", "2027-01-32", "1999-01-01", "2027-03-12T00:00", "", 20270312, null]) {
        await assertFails(member().doc("containers/keller/items/milch").set(withMhd(mhd)), String(mhd));
      }
    });
    it("Nicht-Mitglied darf kein MHD setzen", async () => {
      await assertFails(member("mallory@example.com", "mallory").doc("containers/keller/items/reis").update({ mhd: "2027-01-01" }));
    });
  });

  describe("Runde 2: Umzug (mehrere Artikel per Batch)", () => {
    it("mehrere Artikel in einem Batch verschieben", async () => {
      await seed(async (sdb) => {
        await sdb.doc("containers/keller/items/nudeln").set({ name: "Nudeln", qty: 2, unit: "Packung", mhd: "2027-01-01" });
        await sdb.doc("containers/garage").set({ name: "Garage" });
        await sdb.doc("containers/garage/items/reis").set({ name: "Reis", qty: 1, unit: "Packung" });
      });
      const db = member();
      const batch = db.batch();
      batch.update(db.doc("containers/garage/items/reis"), { qty: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() });
      batch.delete(db.doc("containers/keller/items/reis"));
      batch.set(db.doc("containers/garage/items/nudeln"), { name: "Nudeln", qty: 2, unit: "Packung", mhd: "2027-01-01", updatedAt: FieldValue.serverTimestamp() });
      batch.delete(db.doc("containers/keller/items/nudeln"));
      await assertSucceeds(batch.commit());
    });
  });
});
