# Aktueller Stand

Letzter Stand: 2026-10-31 (Branch `verbesserungen-2026-10-31`, noch nicht gemergt). Diese Datei fasst den Fortschritt zusammen, damit man (auch mit einer
neuen Claude-Session auf einem anderen Gerät) nahtlos weitermachen kann.

**Die App läuft:** https://marcosandrokraft.github.io/kraft-inventar/ – mit Anmeldung per E-Mail-Link,
Zugriff nur für freigeschaltete Personen.

## Erledigt

- Firebase-Projekt `kraft-inventar`, Firestore-Datenbank `(default)`, Config in [firebase-config.js](firebase-config.js).
- GitHub-Repo https://github.com/marcosandrokraft/kraft-inventar (öffentlich), GitHub Pages aktiv.
  `git push` funktioniert. Commits laufen unter der anonymen GitHub-Adresse (noreply), alte Commits
  wurden umgeschrieben, damit keine E-Mail-Adressen öffentlich sind.
- Authentication: "E-Mail/Passwort" + "E-Mail-Link (ohne Passwort)" aktiv,
  `marcosandrokraft.github.io` als autorisierte Domain eingetragen.
- [firestore.rules](firestore.rules) in der Konsole veröffentlicht: Zugriff nur für angemeldete Personen,
  die in der Sammlung `members` stehen, plus Prüfung der Datenform (Name, Menge, Einheit, Fotogrösse).
- Erste Person (Marco) freigeschaltet, Anmeldung getestet – funktioniert.
- Service Worker ist "network-first": neue Versionen kommen nach 1–2× Neuladen an.
- Fotos: Auswahl direkt beim Hinzufügen (Kamera oder Galerie), automatische Freistellung + Zuschnitt
  auf das Objekt, grössere Vorschaubilder, Grossansicht mit "Foto ändern". Freistellung lokal in
  Chrome getestet (vorher war sie wegen falscher Bibliothek-URL nie gelaufen). Erstes Foto pro Gerät
  lädt ca. 56 MB KI-Modell → im WLAN machen.

## Weitere Person freischalten

Firebase-Konsole → Firestore Database → Daten → auf oberster Ebene (🏠, **nicht** innerhalb eines
Behälters!) Sammlung `members` → "Dokument hinzufügen" → Dokument-ID = E-Mail-Adresse in
Kleinbuchstaben (keine Automatische ID, keine Leerzeichen) → Feld `name` (string) → Speichern.
Die Person öffnet die App und meldet sich mit genau dieser Adresse an. Entfernen = Dokument löschen.

**Adressen nie in Dateien im Repo schreiben – das Repo ist öffentlich.**

## Offen

1. **Gegenprobe:** App in einem privaten Browserfenster öffnen – ohne Anmeldung dürfen keine Daten sichtbar sein.
2. **Spark-Plan prüfen:** Firebase-Konsole → Zahnrad → "Nutzung und Abrechnung" → Tarif "Spark",
   kein Zahlungsmittel. Dann kann ein Angriff die App höchstens bis zum nächsten Tag lahmlegen, aber nie
   etwas kosten.
3. **GitHub-E-Mail privat:** GitHub → Settings → Emails → "Keep my email addresses private" und
   "Block command line pushes that expose my email" einschalten.
4. **QR-Codes** über `qr.html` erzeugen, aufkleben und mit zwei Geräten testen.
5. Optional: Öffentlichen Projektnamen (Absender der Login-Mail) unter Projekteinstellungen auf "Vorrat" ändern.
6. Lokal: Sicherungs-Branch `backup-vor-umschreiben` (enthält alte Commits mit E-Mail-Adressen, nie gepusht)
   löschen, sobald alles läuft: `git branch -D backup-vor-umschreiben`.

### Optional, zusätzlich (ebenfalls kostenlos)

- **App Check (blockt Skripte, die nicht von der Webseite kommen):**
  - https://www.google.com/recaptcha/admin/create → Typ "reCAPTCHA v3", Domain
    `marcosandrokraft.github.io` → Websiteschlüssel und geheimen Schlüssel kopieren.
  - Firebase-Konsole → Build → App Check → Web-App auswählen → "reCAPTCHA" → geheimen Schlüssel einfügen.
  - Websiteschlüssel in `firebase-config.js` bei `appCheckSiteKey` eintragen, hochladen, ein paar Tage
    testen. Wenn unter App Check → APIs → Cloud Firestore fast alles "verifiziert" ist → "Erzwingen".
- **API-Key einschränken:** https://console.cloud.google.com/apis/credentials (Projekt kraft-inventar)
  → "Browser key" → Anwendungseinschränkungen: "Websites" → eintragen:
  `https://marcosandrokraft.github.io/*` und `https://kraft-inventar.firebaseapp.com/*` → Speichern.

### Ideen / bekannte Kleinigkeiten

- Erledigt am 2026-10-31: +/− per `increment()`, gleicher Artikel addiert die Menge.
- Weitere Ideen, die eine Entscheidung brauchen: [VORSCHLAEGE.md](VORSCHLAEGE.md).

## Session 2026-10-31: Verbesserungen (Branch `verbesserungen-2026-10-31`)

**Was du tun musst (in dieser Reihenfolge):**

1. **Branch ansehen und testen**, z.B. lokal mit einem kleinen Webserver
   (`npx http-server .` oder VS Code "Live Server") – Achtung: Anmelden funktioniert nur auf
   autorisierten Domains; `localhost` ist in Firebase standardmässig autorisiert.
   Besonders prüfen: **Foto mit Freistellung** (wegen der neuen Content-Security-Policy).
2. **Regeln veröffentlichen:** Firebase-Konsole → Firestore Database → Regeln → kompletten Inhalt
   von [firestore.rules](firestore.rules) einfügen → Veröffentlichen. Ohne das funktioniert die App
   trotzdem (die Suche fragt dann jeden Behälter einzeln ab), aber die strengeren Prüfungen
   (IDs, Fotoformat) sind erst danach aktiv.
3. **Mergen und pushen:** `git checkout main && git merge verbesserungen-2026-10-31 && git push`.
   Danach auf den Handys 1–2× neu laden (Service Worker v3).
4. Fragen in [VORSCHLAEGE.md](VORSCHLAEGE.md) beantworten.

**Geändert:**

- Sicherheit: strengere Regeln (IDs im App-Format beim Anlegen, Foto nur als JPEG-data-URL, Token muss
  E-Mail enthalten), Content-Security-Policy in index.html/qr.html (keine Inline-Skripte), QR-Codes
  werden lokal erzeugt statt über api.qrserver.com (Behälter-Links gehen nicht mehr an Fremde),
  Service Worker speichert keine Anmelde-Links (oobCode) und keine Fehlerseiten mehr, Abmelden löscht
  die Offline-Kopie der Daten, strengere Foto-Prüfung und HTML-Escaping in der App.
- Bedienung: Suche "Wo ist …?" über alle Behälter, Menge addieren statt überschreiben, +/− per
  increment, Entfernen mit "Rückgängig", Detailansicht mit Verschieben, Zahl antippen = Menge eingeben,
  Behälter umbenennen, QR pro Behälter/für alle drucken (mit Druckgrösse), In-App-Scanner (Android),
  Filter in grossen Behältern, Autovervollständigung, grössere Knöpfe (≥44 px), kein iOS-Zoom.
- Leistung/Offline: Firestore-Offline-Speicher (Inhalt nach dem Scan sofort da, Änderungen ohne Netz
  werden nachgereicht), Firebase-Bibliotheken im Service Worker zwischengespeichert, App-Dateien
  vorab gecacht, modulepreload; Artikel der Suche werden erst beim ersten Tippen geladen.
- Tests: siehe [TESTS.md](TESTS.md). Stand 2026-10-31: `npm test` 29/29, `npm run test:rules` 42/42
  (Emulator mit portabler Java 17), `npm run test:e2e` 9/9 (Edge headless, Firebase gefälscht),
  `npm run test:e2e:cutout` ok (echte Freistellung unter der CSP).
- Nicht getestet: echte Anmeldung/echte Datenbank, iPhone/Safari, BarcodeDetector-Scanner auf dem Handy.
- Datenformat unverändert, alte QR-Codes funktionieren weiter. Neue QR-Codes enthalten zusätzlich
  `&n=Name`, damit ein neu gescannter Behälter gleich richtig heisst.

**Falls nach dem Update etwas nicht geht:** Browser-Konsole öffnen; steht dort "Refused to load …
Content Security Policy", die gemeldete Adresse in der `Content-Security-Policy`-Zeile in
index.html ergänzen (oder die Zeile vorübergehend löschen).

## Projektstruktur

Siehe [README.md](README.md) für die Einrichtungsanleitung (Firebase, GitHub Pages, QR-Codes).
Code-Dateien: `index.html`, `app.js`, `lib.js`, `qr.html`, `qr.js`, `vendor/`, `register-sw.js`,
`style.css`, `manifest.json`, `icon.svg`, `sw.js`, `firebase-config.js`, `firestore.rules`.
Tests: `tests/`, `package.json`, `firebase.json` (siehe [TESTS.md](TESTS.md)).
