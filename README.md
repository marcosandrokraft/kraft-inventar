# Vorrat – Kühlschrank/Schrank-Inhalts-App

Simple, kostenlose Web-App zum Verwalten, was in Kühlschrank, Vorratsschrank, Kleiderschrank etc. drin ist.
Mehrere Personen können gemeinsam darauf zugreifen. Pro Behälter gibt es einen QR-Code, der direkt
die Inhaltsliste dieses Behälters öffnet.

Kosten: 0.- (GitHub Pages Hosting + Firebase Spark-Plan, beides kostenlos im normalen Haushaltsgebrauch).

## 1. Firebase-Projekt anlegen (einmalig, ~5 Min.)

1. Gehe auf https://console.firebase.google.com und erstelle ein neues Projekt (Name egal, z.B. "vorrat-app").
   Google Analytics kannst du abwählen, wird nicht benötigt.
2. Im Projekt links auf **Build → Firestore Database** klicken → **Datenbank erstellen**.
   - Standort: `eur3 (europe-west)` (oder was dir am nächsten liegt).
   - Modus: "Testmodus" reicht zum Starten, wir ersetzen die Regeln gleich unten unter Schritt 4.
3. Links auf das Zahnrad → **Projekteinstellungen** → ganz unten bei "Meine Apps" auf das `</>`-Web-Symbol
   klicken → App registrieren (Name egal, Firebase Hosting NICHT aktivieren).
4. Du bekommst ein Code-Snippet mit einem `firebaseConfig`-Objekt. Trage genau diese Werte in
   [firebase-config.js](firebase-config.js) in diesem Ordner ein (apiKey, projectId, etc.).

## 2. Firestore-Regeln setzen

Im Firebase-Konsolen-Menü **Firestore Database → Regeln** den kompletten Inhalt von
[firestore.rules](firestore.rules) einfügen und veröffentlichen. Die Regeln erlauben nur Behälter und
Artikel in der erwarteten Form (Namenslänge, Menge, Einheit, Fotogrösse), damit niemand das
Gratis-Kontingent mit beliebigen Daten füllen kann.

Lesen und Schreiben dürfen nur angemeldete Personen, die in der Sammlung `members` stehen
(Anmeldung per E-Mail-Link, siehe [STAND.md](STAND.md)). Nach jeder Änderung an `firestore.rules`
die Regeln in der Konsole erneut veröffentlichen.

## 3. Auf GitHub Pages veröffentlichen

1. Erstelle ein neues **öffentliches** GitHub-Repo (z.B. `vorrat-app`) – GitHub Pages ist für
   öffentliche Repos kostenlos.
2. Lade den Inhalt dieses Ordners dort hoch (push), inklusive der ausgefüllten `firebase-config.js`.
   Das ist unproblematisch, da die Firebase-Web-Config nicht geheim ist (Schutz läuft über die
   Firestore-Regeln, nicht über die Config).
3. Im Repo: **Settings → Pages → Source: Deploy from branch**, Branch `main`, Ordner `/ (root)` → Save.
4. Nach 1-2 Minuten ist die App erreichbar unter `https://<dein-github-name>.github.io/<repo-name>/`.

## 4. QR-Codes erzeugen und aufkleben

1. Behälter in der App anlegen (Übersicht → "Neuer Behälter"). Jeder Behälter hat damit automatisch
   einen QR-Code.
2. In der App oben "QR-Codes drucken" (oder "🖨 QR-Codes drucken (Auswahl)" in der Übersicht) antippen:
   Die Druckseite zeigt alle Behälter, alle sind angehakt. Über "QR" in einem Behälter ist nur dieser
   angehakt. Mit "Alle"/"Keine", Filter und Antippen auswählen, was gedruckt werden soll.
3. Druckgrösse wählen, "Drucken", QR-Codes ausschneiden und auf die Behälter/Schränke kleben.
   Der QR-Code enthält nur die feste ID des Behälters (`index.html?c=<id>`). Er bleibt gleich, auch wenn
   der Behälter umbenannt, verschoben oder befüllt wird. Ältere Codes mit `&n=Name` funktionieren weiter.
   Scannen: "📷" unten öffnet direkt die Kamera, auf Android über den eingebauten Erkenner, auf
   iPhone/Firefox über jsQR (`vendor/jsqr-1.4.0/`, wird erst beim ersten Scan geladen).
   Die Codes werden lokal im Browser erzeugt (kein Fremddienst).
4. Tipp: Statt/zusätzlich zum QR-Code kann derselbe Link auf einen NFC-Sticker geschrieben werden
   (z.B. mit der App "NFC Tools") – Handy dranhalten öffnet den Behälter.

## 5. Benutzung

- QR-Code am Kühlschrank scannen → öffnet direkt die Artikelliste dieses Kühlschranks
  (Kamera-App, oder in der App "📷 Scan" – auf Android/Chrome).
- **Wo ist …?** Suchfeld oben in der Übersicht durchsucht alle Behälter (Gross/klein und Umlaute
  egal). Ein Treffer öffnet den Behälter und markiert den Artikel.
- Artikel hinzufügen über das Formular unten: optional 📷 Foto (aufnehmen oder aus der Galerie
  hochladen), Name, Anzahl, Einheit. Der Artikel erscheint sofort, das Foto wird im Hintergrund
  verarbeitet (⏳) und dann ergänzt.
- Gibt es den Artikel schon, wird die Menge addiert (bei anderer Einheit fragt die App nach).
- Menge über +/− anpassen oder die Zahl antippen und direkt eingeben; bei 0 wird der Artikel entfernt.
- 🗑 entfernt einen Artikel sofort – unten erscheint kurz "Rückgängig".
- Artikelnamen antippen → Details: Foto, **Verschieben** in einen anderen Behälter, Entfernen.
- ✏️ neben dem Behälternamen: umbenennen, Typ (Raum/Schrank/Fach/Box, optional), **"liegt in"**
  (z.B. Gemüsefach liegt im Kühlschrank, der in der Küche steht) und **löschen** (nur wenn leer,
  mit Rückgängig). Der QR-Code bleibt gültig. Ebenen dürfen fehlen: eine Box direkt in einem Raum
  oder ganz ohne Ort ist erlaubt.
- Im Behälter oben der Pfad (Küche › Kühlschrank), darunter "Darin" mit den Unterbehältern;
  ganz unten "+ Behälter hier hineinlegen". Die Übersicht zeigt nur die oberste Ebene, die Suche
  zeigt den ganzen Pfad.
- Einheiten: Stk, Packung, Flasche, Dose, Glas, g, kg, ml, l. Bei g und ml ändern +/− um 50.
- **MHD** (optional): Artikel antippen → 📅 MHD → +3 Tage, +1 Woche, +1 Monat, Kalender oder
  entfernen. "Läuft bald ab" (≤ 3 Tage) wird orange, "abgelaufen" rot markiert.
  **Experiment** "Datum mit Kamera lesen": Foto der Packung → liest zuerst einen GS1-Code
  (DataMatrix/QR mit Verfallsdatum, nur wo der Browser BarcodeDetector kann, v.a. Android), sonst
  Texterkennung (tesseract.js, lädt beim ersten Mal ca. 4 MB). **Unzuverlässig** – Prägedruck,
  Spiegelungen, gewölbte Dosen und kleine Schrift werden oft falsch oder gar nicht erkannt. Der
  Vorschlag wird nie automatisch übernommen, du bestätigst ihn immer.
- ☑ neben dem Behälternamen: **Umzugsmodus** – mehrere Artikel ankreuzen und auf einmal
  verschieben (mit Rückgängig). Auf Android/Chrome kann das Ziel auch per QR-Code gescannt werden
  ("📷 Ziel-QR-Code scannen"; nur bestehende Behälter, der Scan wählt das Ziel nur aus).
- Leiste unten: Übersicht, Suchen, Scannen (Android/Chrome), **Läuft ab** (alle Artikel mit MHD
  abgelaufen oder in ≤ 3 bzw. ≤ 7 Tagen, nach Datum, mit Behälterpfad; antippen öffnet den Behälter),
  **Zuletzt** (zuletzt geöffnete Behälter, nur auf diesem Gerät gespeichert).
- Ohne Netz: Zuletzt angesehene Inhalte bleiben sichtbar, Änderungen werden später übertragen
  ("Offline" oben). Abmelden löscht die Offline-Kopie auf dem Gerät.
- Vorschaubild links am Artikel: ohne Foto → 📷 antippen fügt eins hinzu; mit Foto → Grossansicht
  mit "Foto ändern".
- Fotos werden automatisch freigestellt (Hintergrund entfernt), auf das Objekt zugeschnitten, zentriert
  auf einen einheitlichen hellgrauen, quadratischen Hintergrund gelegt, verkleinert (max. 480 px,
  meist 10–40 KB) und direkt im Artikel-Dokument gespeichert.
  - Die Freistellung läuft komplett im Handy-Browser (Bibliothek `@imgly/background-removal`) –
    **kein** ChatGPT/Claude/Server/API-Key nötig, bleibt kostenlos.
  - **Beim allerersten Mal pro Gerät** lädt der Browser dafür ein KI-Modell herunter
    (**ca. 56 MB**, Fortschritt wird angezeigt) – beim ersten Foto im WLAN sein. Danach ist es im
    Browser zwischengespeichert, ein Foto dauert dann nur noch einige Sekunden.
  - Klappt die Freistellung mal nicht (z.B. sehr altes Handy/Browser ohne WebAssembly), wird automatisch
    das normale (nicht freigestellte) Foto gespeichert, statt dass gar nichts passiert.
- Über "🏠 Übersicht" (oben oder unten) siehst du alle Behälter der obersten Ebene und kannst auch dort neue anlegen
  (z.B. falls du mal ohne QR-Code schnell etwas eintragen willst).
- "Zum Home-Bildschirm hinzufügen" (iOS/Android-Browser-Menü) macht daraus ein App-Icon ohne Appstore.

## Dateien

- `index.html` / `app.js` – Haupt-App (Übersicht + Behälter-Ansicht je nach `?c=`-Parameter)
- `lib.js` – reine Logik (IDs, Suche, Mengen, Zuschnitt, Pfade, MHD, Datums-/GS1-Erkennung),
  getestet in `tests/unit`
- `ocr.js` – Experiment Texterkennung fürs MHD (lädt tesseract.js erst bei Bedarf)
- `vendor/firebase-10.14.1/` – Firebase-Bibliotheken, selbst gehostet (Apache-2.0, siehe README.txt dort)
- `qr.html` / `qr.js` / `vendor/qrcode-generator-1.4.4.js` – QR-Code-Druckbogen
- `register-sw.js` – registriert den Service Worker
- `tests/`, `package.json`, `firebase.json` – nur für Tests (siehe [TESTS.md](TESTS.md)), die App
  selbst braucht keinen Build-Schritt
- [VORSCHLAEGE.md](VORSCHLAEGE.md) – offene Ideen, die eine Entscheidung brauchen
- `firebase-config.js` – deine persönlichen Firebase-Zugangsdaten (ausfüllen!)
- `manifest.json`, `icon.svg`, `sw.js` – fürs Installieren als App (PWA)
