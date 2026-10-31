# Tests

## Unit-Tests

`tests/unit/lib.test.mjs` testet die reine Logik aus `lib.js` (IDs/slugify, HTML-Escaping,
Foto-Prüfung, Mengen addieren, Suche, QR-Links/Scanner, Zuschnitt nach Freistellung).
`tests/unit/runde2.test.mjs`: Einheiten, Schrittweite ±50, Pfad/Unterbehälter/Zyklen, eindeutige
IDs für Unterbehälter, MHD (Schnellwahl, Status, Sommerzeit), Datumserkennung aus OCR-Text,
GS1-Verfallsdatum (AI 17, ersatzweise Mindesthaltbarkeit AI 15) aus DataMatrix-Rohtext, Klammer-Schreibweise und Digital Link.
Braucht nur Node.js (getestet mit v16.16.0), kein Java, kein Netz:

```sh
npm install
npm test
```

## Firestore-Regeln-Tests

Die Datei `tests/rules/rules.test.mjs` prüft `firestore.rules` gegen den lokalen
Firestore-Emulator (Zugriff nur für Mitglieder, Validierung von Namen/Menge/Einheit/Foto,
gültige IDs, `increment`, Collection-Group-Suche, Verschieben per Batch; Runde 2: `type`/`parent`
am Behälter, Behälter löschen, `mhd` am Artikel, neue Einheiten, Umzug mehrerer Artikel per Batch).

### Voraussetzungen

- Node.js 16 oder neuer (getestet mit v16.16.0), danach einmal `npm install`.
- Java 11 oder neuer für den Firestore-Emulator (getestet mit Eclipse Temurin 17 JRE).
  Eine portable JRE/JDK genügt, sie muss nur beim Aufruf im `PATH` stehen.
- Die Versionen sind auf Node 16 abgestimmt und fest eingetragen:
  `firebase-tools@12.9.1`, `firebase@9.23.0`, `@firebase/rules-unit-testing@2.0.7`.
  Der Eintrag `overrides.universal-analytics = 0.5.3` in `package.json` ist nötig, weil
  `universal-analytics@0.5.4` ein reines ESM-`uuid` zieht, an dem `firebase-tools@12` abstürzt.
  Neuere `firebase-tools`-Versionen (ab 13) brauchen Node 18+, ab 14 auch Java 21.

### Starten

```sh
npm run test:rules
```

Mit portabler Java (Git Bash), Pfad anpassen:

```sh
export JAVA_HOME="/c/pfad/zu/jdk-17-jre"
export PATH="$JAVA_HOME/bin:$PATH"
npm run test:rules
```

PowerShell:

```powershell
$env:JAVA_HOME = "C:\pfad\zu\jdk-17-jre"; $env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
npm run test:rules
```

Das Script startet den Emulator (Port 8080, siehe `firebase.json`), führt die Mocha-Tests aus
und beendet den Emulator wieder.

### Hinweis: demo-Projekt

Die Tests laufen mit der Projekt-ID `demo-kraft-inventar`. Projekt-IDs mit `demo-`-Präfix
sind für Firebase garantiert offline: Es wird kein echtes Projekt angesprochen, es braucht
kein `firebase login`, und es wird nichts deployt. Die Warnung „You are not currently
authenticated“ beim Start kann ignoriert werden. Testnutzer verwenden nur Platzhalter-Adressen
(`@example.com`).

## Browser-Smoke-Tests (Playwright)

`tests/e2e/smoke.mjs` startet einen lokalen Webserver und öffnet die App in Edge/Chrome (headless,
`playwright-core` – kein Browser-Download, benutzt den installierten Edge bzw. Chrome; anderer Pfad
über `E2E_BROWSER_PATH`, Fenster sichtbar mit `E2E_HEADED=1`). Firebase wird komplett durch
In-Memory-Fakes ersetzt (`tests/e2e/fake-firebase/`), Anfragen an Google/Firebase werden blockiert
und als Fehler gewertet. Geprüft: Übersicht und Suche, +/− per increment ohne Foto, Rückgängig,
Menge addieren, Verschieben, XSS, keine CSP-Verletzungen, QR lokal, Handy-Layout (360 px, Knöpfe ≥ 44 px),
Doppeltipp, ungültige Links; Runde 2 (Tests 10–16): Einheiten/±50, Hierarchie (oberste Ebene, Pfad,
Unterbehälter, "liegt in" ohne Kreise), Behälter löschen nur wenn leer + Rückgängig, Leiste unten
und "zuletzt geöffnet", Umzugsmodus + Rückgängig, MHD (Schnellwahl, Kalender, entfernen,
Kamera mit gefälschter Texterkennung bzw. gefälschtem BarcodeDetector – immer mit Bestätigung);
Tests 17–18: Auto-Anlegen nur über Links von aussen, Löschen auf anderem Gerät, "Alle" beachtet den
Filter, Dialoge liegen über der Leiste unten.
Firebase wird seit Runde 2 aus `vendor/firebase-10.14.1/` geladen; die Tests ersetzen genau diese
Dateien durch die Fakes, jede Anfrage an gstatic.com gilt als Fehler.

```sh
npm run test:e2e
```

Optional, lädt ca. 56 MB aus dem Netz: prüft, ob die echte Freistellungs-Bibliothek unter der
Content-Security-Policy aus `index.html` funktioniert:

```sh
npm run test:e2e:cutout
```

Optional, lädt ca. 4 MB von cdn.jsdelivr.net: prüft, ob die Texterkennung fürs MHD (`ocr.js`,
tesseract.js 7.0.0) unter der CSP aus `index.html` läuft und aus einem gezeichneten Etikett
"MHD 12.03.27" das richtige Datum vorschlägt (mit `--ohne-unsafe-eval` auch ohne 'unsafe-eval'):

```sh
npm run test:e2e:ocr
```
