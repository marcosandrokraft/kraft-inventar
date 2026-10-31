# Aktueller Stand

Letzter Stand: 2026-10-31, Runde 3 (Branch `verbesserungen-2026-10-31`, noch nicht gemergt). Diese Datei fasst den Fortschritt zusammen, damit man (auch mit einer
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

## Runde 3 (2026-10-31, gleicher Branch `verbesserungen-2026-10-31`)

**Was du tun musst (in dieser Reihenfolge) – gilt für Runde 2 und 3 zusammen:**

1. **Regeln ZUERST veröffentlichen, erst danach mergen und pushen:** Firebase-Konsole → Firestore
   Database → Regeln → kompletten Inhalt von [firestore.rules](firestore.rules) einfügen →
   Veröffentlichen. Runde 3 hat die Regeln **nicht** geändert, aber die Regeln aus Runde 2 sind noch
   nicht veröffentlicht – ohne sie lehnt Firestore Einheiten wie kg/l, Typ/"liegt in", MHD und
   Behälter löschen ab ("Speichern fehlgeschlagen (permission-denied)"). Die neue Liste "Läuft bald ab"
   nutzt dieselbe Abfrage wie die Suche (Collection-Group, schon in den Regeln freigegeben).
2. **Lokal ansehen** (z.B. `npx http-server .`, Anmelden geht auf `localhost`): Leiste unten
   → "Läuft ab"; im Behälter ☑ → Artikel ankreuzen → "Verschieben" → auf dem Android-Handy
   "📷 Ziel-QR-Code scannen".
3. **Dann mergen und pushen:** `git checkout main && git merge verbesserungen-2026-10-31 && git push`.
   Danach auf den Handys 1–2× neu laden (Service Worker **v5**).

**Entscheidungen zu den offenen Fragen aus Runde 2** (Details in [VORSCHLAEGE.md](VORSCHLAEGE.md)):
A Übersicht bleibt oberste Ebene · B − unter 50 g/ml entfernt (mit Rückgängig) bleibt ·
C Liste "läuft bald ab" → **umgesetzt** · D Ziel-QR im Umzug → **umgesetzt** · E Löschen-Regeln bleiben.

**Umgesetzt:**

- **Liste "Läuft bald ab"** (`index.html?liste=ablauf`; erreichbar über "⏰ Läuft ab" in der Leiste
  unten und "⏰ Läuft bald ab" in der Übersicht): alle Artikel, deren MHD abgelaufen ist oder in
  ≤ 3 Tagen abläuft, Schalter "≤ 7 Tage" (wird auf dem Gerät gemerkt). Sortiert nach Datum
  (abgelaufene oben), mit "seit 2 Tagen"/"heute"/"in 3 Tagen", Menge und vollem Behälterpfad.
  Antippen öffnet den Behälter und markiert den Artikel. Artikel werden mit derselben Logik wie die
  Suche geladen (`loadAllItems` in app.js): erst beim Öffnen der Liste bzw. beim ersten Tippen in
  der Suche, eine einzige Abfrage pro Seite – die Übersicht allein liest weiterhin keine Artikel.
  Lesezugriffe: Öffnen der Liste liest alle Artikel einmal (wie eine Suche).
  **Vorbereitet für die Einkaufsliste:** Listen laufen über `?liste=<name>` und `listView()` in
  app.js; eine spätere Einkaufsliste wird dort als weiterer Eintrag ergänzt (z.B. `?liste=einkauf`),
  die Ladelogik ist schon gemeinsam. Falls die Leiste unten zu voll wird, kann "Läuft ab" zu einem
  Eintrag "Listen" werden.
- **Umzugsmodus: Ziel per QR-Code scannen** – Knopf "📷 Ziel-QR-Code scannen" im
  Verschieben-Dialog, nur wo der Browser `BarcodeDetector` und eine Kamera hat (v.a. Android/Chrome);
  sonst bleibt der Dialog wie bisher. Der Scan **wählt das Ziel nur aus** (Hinweis "Ziel: Pfad"),
  verschoben wird erst mit "Verschieben". Geprüft wird mit derselben Logik wie beim normalen Scan
  (nur Links dieser App mit gültigem `?c=`); fremde Codes → Hinweis, Scanner sucht weiter.
  Der eigene Behälter und **unbekannte Behälter werden abgelehnt** ("gibt es noch nicht – zuerst
  öffnen bzw. anlegen"), es wird nichts angelegt. Manuelle Auswahl unverändert.
- `firestore.rules` **unverändert** (keine Änderung nötig).

**Tests (Stand Ende Runde 3, siehe [TESTS.md](TESTS.md)):** `npm test` 70/70, `npm run test:rules`
53/53 (Emulator, portable Java 17), `npm run test:e2e` 20/20 (neu: 19 Liste "läuft bald ab" bei 360 px, 20 Ziel-QR mit
gefälschtem BarcodeDetector/Kamera), `npm run test:e2e:cutout` ok, `npm run test:e2e:ocr`
ok. Nicht getestet: echter QR-Scan auf einem Handy (BarcodeDetector nur gefälscht), echte
Firebase-Datenbank.

**Offen / Ideen:**

- Einkaufsliste Küche/Kühlschrank (Entscheidung 5, "später").
- Behoben: Escape schliesst nur noch das oberste Fenster (vorher bei offenem Scanner auch den
  Verschieben-Dialog darunter).

## Runde 2 (2026-10-31, gleicher Branch `verbesserungen-2026-10-31`)

**Was du tun musst (in dieser Reihenfolge):**

1. **Regeln veröffentlichen – diesmal ZUERST, vor dem Mergen/Pushen:** Firebase-Konsole → Firestore
   Database → Regeln → kompletten Inhalt von [firestore.rules](firestore.rules) einfügen →
   Veröffentlichen. Ohne die neuen Regeln lehnt Firestore alles Neue ab (Einheiten wie kg/l/Flasche,
   Typ und "liegt in", MHD, Behälter löschen) – die App zeigt dann "Speichern fehlgeschlagen
   (permission-denied)". Die neuen Regeln akzeptieren alle alten Daten und die alte App-Version.
   (Die Regeln wurden **nicht** automatisch deployt.)
2. **Lokal ansehen** (siehe Punkt 1 der Session unten), besonders: Behälter verschachteln,
   Leiste unten, MHD setzen, auf dem Android-Handy "Datum mit Kamera lesen" an einer Packung.
3. **Mergen und pushen** wie unten beschrieben. Danach auf den Handys 1–2× neu laden
   (Service Worker v4).
4. Offene Fragen unten beantworten.

**Umgesetzt** (Details in [README.md](README.md) unter "Benutzung"):

- **Hierarchie:** Behälter haben optional einen Typ (Raum/Schrank/Fach/Box) und "liegt in"
  (beliebiger anderer Behälter, jederzeit änderbar über ✏️). Ebenen dürfen fehlen, ein Behälter
  ohne Ort ist erlaubt. Kreise werden verhindert (Auswahl bietet sich selbst und eigene
  Unterbehälter gar nicht an; kaputte Daten mit Kreis hängen die App nicht auf). Pfad oben
  ("Küche › Kühlschrank"), Unterbehälter unter "Darin", neue Unterbehälter über "+ Behälter hier
  hineinlegen". Die Übersicht zeigt nur die oberste Ebene. Die Suche zeigt den vollen Pfad,
  findet auch Behälter selbst, und "küche salz" findet Salz irgendwo in der Küche.
  Datenmodell: Felder `type` und `parent` am Behälter, beide optional – keine Migration nötig.
  Gibt es den Namen schon (z.B. zweimal "Fach 1"), bekommt der neue Unterbehälter die ID
  `<elternbehälter>-fach-1`.
- **Einheiten:** Stk, Packung, Flasche, Dose, Glas, g, kg, ml, l. Ältere Artikel ganz ohne Einheit
  lassen sich jetzt auch ändern (+/−, MHD); neue Artikel brauchen weiterhin eine Einheit. "Stück" ist das bestehende "Stk"
  (bewusst nicht doppelt, alte Artikel behalten ihre Einheit).
- **±50 bei g und ml**, sonst ±1. Fällt die Menge dadurch auf 0 oder darunter (z.B. 30 g − 50),
  wird der Artikel wie bisher entfernt – mit "Rückgängig".
- **Behälter löschen** (✏️ → "Behälter löschen"): nur ohne Artikel und ohne Unterbehälter,
  danach "Rückgängig" (stellt Name, Typ und Ort wieder her). Hat ein anderes Gerät den Behälter
  gerade offen, zeigt es "wurde inzwischen gelöscht" statt weiter hineinzuschreiben.
  **Geändert:** Ein fehlender Behälter wird nur noch automatisch angelegt, wenn der Link von aussen
  kommt (QR-Code mit der Kamera-App, NFC, Lesezeichen) oder mit dem In-App-Scanner gescannt wurde –
  nicht mehr über Links innerhalb der App (Zurück-Taste, "Zuletzt", veraltete Übersicht). Auf dem
  Gerät, auf dem gelöscht wurde, legt auch ein alter Link ihn nicht wieder an (nur ein erneuter Scan).
  Behälter mit älteren IDs (nicht im App-Format) haben keinen Löschen-Knopf, weil die Regeln sie
  nicht wiederherstellen könnten.
- **MHD** (Feld `mhd`, "YYYY-MM-DD", optional): Details → 📅 MHD → +3 Tage / +1 Woche / +1 Monat /
  Kalender / entfernen; Markierung orange (≤ 3 Tage) bzw. rot (abgelaufen), auch in der Suche.
  Verschieben und Rückgängig nehmen das MHD mit.
  **Experiment "Datum mit Kamera lesen":** Foto → erst GS1-Code (DataMatrix/QR/GS1 Digital Link;
  nur wo der Browser `BarcodeDetector` hat, also v.a. Android/Chrome; Verfallsdatum AI 17, sonst
  Mindesthaltbarkeit AI 15), sonst Texterkennung mit tesseract.js 7.0.0 (exakt versioniert von cdn.jsdelivr.net, erst beim
  Klick geladen, ca. 4 MB beim ersten Mal, läuft im Browser). Erkennt z.B. 12.03.27, 12/03/2027,
  03.2027 (= Monatsende). **Ehrlich: unzuverlässig** – auf echten Packungen (Prägedruck,
  Spiegelung, Rundungen) oft falsch oder nichts. Der Vorschlag wird nie automatisch gespeichert.
  Getestet nur mit einem am Computer gezeichneten Etikett (`npm run test:e2e:ocr`), nicht mit
  echten Packungen und nicht auf echten Handys.
- **Umzugsmodus:** ☑ im Behälter → Artikel ankreuzen (oder "Alle") → "Verschieben" → Ziel mit Pfad
  wählen. Alles in einem Batch; gibt es im Ziel denselben Artikel mit anderer Einheit, wird er
  übersprungen und gemeldet (ebenso, wenn die Menge im Ziel das Maximum überschreiten würde). "Rückgängig" im Hinweis macht den ganzen Umzug rückgängig (gilt jetzt
  auch beim Verschieben eines einzelnen Artikels).
- **Leiste unten:** Übersicht · Suchen · Scannen · Zuletzt. "Zuletzt" = die 6 zuletzt geöffneten
  Behälter, nur auf diesem Gerät (localStorage), zusätzlich als Chips oben in der Übersicht.
  Scannen geht in der App nur mit Android/Chrome; sonst Hinweis "mit der Kamera-App scannen".
- **Firebase selbst gehostet** (`vendor/firebase-10.14.1/`, Apache-2.0, Herkunft/Hashes in
  `README.txt` dort): **gratis** (GitHub Pages, ~720 KB mehr im Repo), **gleich schnell** (gstatic
  und GitHub Pages liefern beide gzip, ~175 KB; ein Verbindungsaufbau zu gstatic entfällt; danach
  kommt ohnehin alles aus dem Service-Worker-Cache), **sicherer** (Firebase-Code kommt nur noch
  aus dem eigenen Repo; `www.gstatic.com` und `www.google.com` sind aus `script-src` der CSP
  entfernt). Nachteil: Updates von Hand (3 Schritte in der README.txt) – war mit fester
  Versionsnummer aber vorher auch schon so.
  **Achtung App Check:** Falls du App Check (reCAPTCHA v3) einschaltest, in `index.html` in der
  CSP bei `script-src` wieder `https://www.google.com https://www.gstatic.com` ergänzen (steht
  auch als Kommentar dort).

**Tests (Stand Ende Runde 2, siehe [TESTS.md](TESTS.md)):** `npm test` 59/59, `npm run test:rules`
53/53 (Emulator, portable Java 17), `npm run test:e2e` 18/18 (Edge headless, Firebase gefälscht),
`npm run test:e2e:cutout` ok, `npm run test:e2e:ocr` ok (gezeichnetes Etikett, echtes tesseract.js
unter der CSP). Nicht getestet: echte Firebase-Datenbank/Anmeldung, echte Handys (iPhone/Android),
BarcodeDetector mit echten GS1-Codes, Texterkennung mit echten Packungsfotos.

**Offene Fragen (Standardlösung ist umgesetzt, leicht änderbar)** – beantwortet in Runde 3 (A–E, siehe oben):

1. Übersicht zeigt nur die oberste Ebene (Räume und Behälter ohne Ort). Lieber alle Behälter
   eingerückt als Baum?
2. g/ml: − unter 50 entfernt den Artikel (mit Rückgängig). Lieber auf 1 g stehen bleiben?
3. "Läuft bald ab" = heute bis in 3 Tagen. Soll es eine Liste "läuft bald ab" (z.B. für den
   Kühlschrank) in der Übersicht geben? Das würde gut zur späteren Einkaufsliste passen.
4. Umzugsmodus: Ziel wird aus einer Liste gewählt. Zusätzlich "Ziel-QR-Code scannen" (Android)?
5. Löschen eines Behälters ist für alle Mitglieder erlaubt (Regeln), "nur wenn leer" prüft die App.
   Reicht das, oder sollen die Regeln Löschen zusätzlich an eine Bedingung knüpfen?

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
Code-Dateien: `index.html`, `app.js`, `lib.js`, `ocr.js`, `qr.html`, `qr.js`, `vendor/` (inkl. Firebase), `register-sw.js`,
`style.css`, `manifest.json`, `icon.svg`, `sw.js`, `firebase-config.js`, `firestore.rules`.
Tests: `tests/`, `package.json`, `firebase.json` (siehe [TESTS.md](TESTS.md)).
