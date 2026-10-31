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

1. Öffne auf dem Handy oder PC `.../qr.html` deiner veröffentlichten Seite.
2. Trage pro Zeile einen Behälter-Namen ein (z.B. `Kühlschrank`, `Gefrierfach`, `Vorratsschrank`,
   `Kleiderschrank Marco`) und klicke "QR-Codes erzeugen". Oder in der App: "🖨 QR-Codes für alle
   Behälter drucken" (Übersicht) bzw. "QR" im Behälter.
3. Druckgrösse wählen, ausdrucken, QR-Codes ausschneiden und auf die Behälter/Schränke kleben.
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
- ✏️ neben dem Behälternamen benennt ihn um (der QR-Code bleibt gültig).
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
- Über "🏠 Übersicht" (oben) siehst du alle angelegten Behälter und kannst auch dort neue anlegen
  (z.B. falls du mal ohne QR-Code schnell etwas eintragen willst).
- "Zum Home-Bildschirm hinzufügen" (iOS/Android-Browser-Menü) macht daraus ein App-Icon ohne Appstore.

## Dateien

- `index.html` / `app.js` – Haupt-App (Übersicht + Behälter-Ansicht je nach `?c=`-Parameter)
- `lib.js` – reine Logik (IDs, Suche, Mengen, Zuschnitt), getestet in `tests/unit`
- `qr.html` / `qr.js` / `vendor/qrcode-generator-1.4.4.js` – QR-Code-Druckbogen
- `register-sw.js` – registriert den Service Worker
- `tests/`, `package.json`, `firebase.json` – nur für Tests (siehe [TESTS.md](TESTS.md)), die App
  selbst braucht keinen Build-Schritt
- [VORSCHLAEGE.md](VORSCHLAEGE.md) – offene Ideen, die eine Entscheidung brauchen
- `firebase-config.js` – deine persönlichen Firebase-Zugangsdaten (ausfüllen!)
- `manifest.json`, `icon.svg`, `sw.js` – fürs Installieren als App (PWA)
