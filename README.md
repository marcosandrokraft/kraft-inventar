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

Im Firebase-Konsolen-Menü **Firestore Database → Regeln** einfügen und veröffentlichen:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

**Wichtig:** Das bedeutet, jeder mit der App-URL kann lesen/schreiben (wie gewünscht, kein Login).
Die URL/QR-Codes also nicht öffentlich posten, nur an die Familie weitergeben. Das reicht für
den Haushaltsgebrauch völlig aus.

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
   `Kleiderschrank Marco`) und klicke "QR-Codes erzeugen".
3. Seite ausdrucken, QR-Codes ausschneiden und auf die jeweiligen Behälter/Schränke kleben.

## 5. Benutzung

- QR-Code am Kühlschrank scannen → öffnet direkt die Artikelliste dieses Kühlschranks.
- Artikel hinzufügen über das Formular unten (Name, Menge, Einheit).
- Menge über +/− anpassen; bei 0 wird der Artikel automatisch entfernt.
- 🗑 löscht einen Artikel sofort komplett.
- 📷-Button links am Artikel: Foto aufnehmen/auswählen. Das Objekt wird automatisch freigestellt
  (Hintergrund entfernt) und auf einen einheitlichen hellgrauen Hintergrund gelegt, dann verkleinert
  (Vorschaubild-Qualität) und direkt im Artikel-Dokument gespeichert. Erneut antippen ersetzt das Foto.
  - Die Freistellung läuft komplett im Handy-Browser (Bibliothek `@imgly/background-removal`) –
    **kein** ChatGPT/Claude/Server/API-Key nötig, bleibt kostenlos.
  - **Beim allerersten Mal pro Gerät** lädt der Browser dafür ein kleines KI-Modell herunter
    (ein paar MB) – am besten beim ersten Foto im WLAN sein. Danach ist es im Browser zwischengespeichert
    und geht schnell.
  - Klappt die Freistellung mal nicht (z.B. sehr altes Handy/Browser ohne WebAssembly), wird automatisch
    das normale (nicht freigestellte) Foto gespeichert, statt dass gar nichts passiert.
- Über "🏠 Übersicht" (oben) siehst du alle angelegten Behälter und kannst auch dort neue anlegen
  (z.B. falls du mal ohne QR-Code schnell etwas eintragen willst).
- "Zum Home-Bildschirm hinzufügen" (iOS/Android-Browser-Menü) macht daraus ein App-Icon ohne Appstore.

## Dateien

- `index.html` / `app.js` – Haupt-App (Übersicht + Behälter-Ansicht je nach `?c=`-Parameter)
- `qr.html` – QR-Code-Generator zum Drucken
- `firebase-config.js` – deine persönlichen Firebase-Zugangsdaten (ausfüllen!)
- `manifest.json`, `icon.svg`, `sw.js` – fürs Installieren als App (PWA)
