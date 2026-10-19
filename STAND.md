# Aktueller Stand (Pilot-Einrichtung)

Letzter Stand: 2026-10-19. Diese Datei fasst den Fortschritt zusammen, damit man (auch mit einer
neuen Claude-Session auf einem anderen Gerät) nahtlos weitermachen kann.

## Firebase-Projekt

- Projekt `kraft-inventar` wurde erstellt, Config ist in [firebase-config.js](firebase-config.js) eingetragen.
- Firestore-Datenbank wurde erstellt, Regeln wurden einmal im "offenen Testmodus" veröffentlicht.
- **Offen/zu prüfen:** Ob die verschärfte Regel-Datei [firestore.rules](firestore.rules)
  (Feld-Validierung, verhindert Kontingent-Missbrauch) in der Firebase-Konsole schon eingefügt wurde.
- **Offen/zu prüfen:** Ob der Spark-Plan (kostenlos, kein Zahlungsmittel) bestätigt wurde unter
  Firebase-Konsole → Zahnrad → "Nutzung und Abrechnung".
- **Offen/zu prüfen:** Database ID der Firestore-Datenbank. Steht dort nicht `(default)`, den Namen
  in `firebase-config.js` bei `firestoreDatabaseId` eintragen.

## GitHub

- Repo: https://github.com/marcosandrokraft/kraft-inventar
- Lokales Git wurde entfernt (`git init`/Push via Firmen-Account schlug mit HTTP 403 fehl) –
  Dateien werden stattdessen manuell per Drag&Drop auf GitHub hochgeladen.
- **Noch nicht erledigt:** GitHub Pages aktivieren (Settings → Pages → Branch `main`, Ordner `/ (root)`).

## Bekanntes Problem: App hängt bei "Lade…"

Mögliche Ursachen (alle drei sind in der lokalen Version behoben bzw. sichtbar gemacht):

1. **Firestore-Fehler ohne Anzeige** – `app.js` zeigt jetzt `err.code`/`err.message` statt endlos zu laden.
   Häufige Codes: `permission-denied` (Regeln), `not-found` bzw. Datenbank existiert nicht (Database ID falsch).
2. **Database ID nicht `(default)`** – jetzt einstellbar über `firestoreDatabaseId` in `firebase-config.js`.
3. **Freistellungs-Bibliothek (jsDelivr) wurde beim Start geladen** – schlug das fehl, lief `app.js`
   gar nicht. Wird jetzt erst beim ersten Foto geladen.

Zusätzlich: Der alte Service Worker (`sw.js`) lieferte immer die zwischengespeicherte Version aus,
neue Uploads kamen auf bereits besuchten Geräten nie an. Jetzt "network-first" (Cache `vorrat-shell-v2`).
Auf Geräten, die die Seite schon kannten, nach dem Upload die Seite 1–2× neu laden.

## Sicherheit: Anmeldung per E-Mail-Link (eingebaut 2026-10-19)

- Die App zeigt ohne Anmeldung nur noch ein Anmeldefeld. Man gibt die E-Mail ein, bekommt einen Link,
  klickt ihn an und bleibt auf dem Gerät angemeldet. Oben rechts gibt es "Abmelden".
- [firestore.rules](firestore.rules) lässt nur Adressen zu, für die in der Firestore-Sammlung `members`
  ein Dokument existiert (Dokument-ID = E-Mail in Kleinbuchstaben). Die Adressen stehen bewusst
  **nicht** im Code/Repo (öffentlich), und die App selbst kann die Liste weder lesen noch ändern.
- Kosten: Spark-Plan ohne Zahlungsmittel. Bei Überlastung/Angriff stoppt Firebase bis zum nächsten Tag,
  es entsteht nie eine Rechnung.

## Nächste Schritte (in dieser Reihenfolge)

1. **Spark-Plan prüfen:** Firebase-Konsole → Zahnrad → "Nutzung und Abrechnung" → Tarif muss "Spark"
   sein, kein Zahlungsmittel hinterlegt.
2. **Database ID prüfen:** Firestore Database → oben im Auswahlfeld. Nicht `(default)`? → in
   `firebase-config.js` bei `firestoreDatabaseId` eintragen.
3. **E-Mail-Link-Anmeldung einschalten:** Build → Authentication → "Jetzt starten" →
   Reiter "Sign-in method" → "E-Mail/Passwort" → beide Schalter aktivieren
   ("E-Mail/Passwort" **und** "E-Mail-Link (Anmeldung ohne Passwort)") → Speichern.
4. **Domain freigeben:** Authentication → Reiter "Einstellungen" → "Autorisierte Domains" →
   "Domain hinzufügen" → `marcosandrokraft.github.io`.
5. **GitHub Pages aktivieren** (falls noch nicht): Repo → Settings → Pages → Branch `main`, `/ (root)`.
6. **Code hochladen** (`git push` oder Drag&Drop von `app.js`, `index.html`, `style.css`,
   `firebase-config.js`, `firestore.rules`, `STAND.md`).
7. **Anmeldung testen:** https://marcosandrokraft.github.io/kraft-inventar/ öffnen (ggf. 1–2× neu laden),
   E-Mail eingeben, Link aus der Mail öffnen (Hotmail: Junk-Ordner prüfen). Man sollte die Übersicht sehen.
8. **Dich freischalten:** Firestore Database → Reiter "Daten" → "Sammlung starten" → Sammlungs-ID
   `members` → Dokument-ID: deine E-Mail-Adresse in Kleinbuchstaben → ein Feld, z.B. `name` (string)
   mit deinem Namen → Speichern.
9. **Regeln veröffentlichen:** Firestore Database → Reiter "Regeln" → kompletten Inhalt von
   `firestore.rules` einfügen → "Veröffentlichen". Danach Seite neu laden: Muss weiterhin funktionieren.
   Gegenprobe: in einem privaten Fenster ohne Anmeldung kommt man nicht an Daten.
10. **QR-Codes** über `qr.html` erzeugen und testen.

### Optional, zusätzlich (ebenfalls kostenlos)

11. **App Check (blockt Skripte, die nicht von der Webseite kommen):**
    - https://www.google.com/recaptcha/admin/create → Typ "reCAPTCHA v3", Domain
      `marcosandrokraft.github.io` → Websiteschlüssel und geheimen Schlüssel kopieren.
    - Firebase-Konsole → Build → App Check → Web-App auswählen → "reCAPTCHA" → geheimen Schlüssel einfügen.
    - Websiteschlüssel in `firebase-config.js` bei `appCheckSiteKey` eintragen, hochladen, ein paar Tage
      testen. Wenn unter App Check → APIs → Cloud Firestore fast alles "verifiziert" ist → "Erzwingen".
12. **API-Key einschränken:** https://console.cloud.google.com/apis/credentials (Projekt kraft-inventar)
    → "Browser key" → Anwendungseinschränkungen: "Websites" → eintragen:
    `https://marcosandrokraft.github.io/*` und `https://kraft-inventar.firebaseapp.com/*` → Speichern.

### Weitere Person freischalten

In der Firebase-Konsole in der Sammlung `members` ein Dokument hinzufügen (Dokument-ID = ihre E-Mail in
Kleinbuchstaben). Regeln müssen dafür nicht geändert werden. Die Person öffnet die App und meldet sich
mit genau dieser Adresse an. Entfernen = Dokument löschen. **Adressen nie in Dateien im Repo schreiben.**

## Projektstruktur

Siehe [README.md](README.md) für die komplette Einrichtungsanleitung (Firebase, GitHub Pages, QR-Codes).
Code-Dateien: `index.html`, `app.js`, `qr.html`, `style.css`, `manifest.json`, `icon.svg`, `sw.js`,
`firebase-config.js`, `firestore.rules`.
