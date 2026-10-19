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

## Nächste Schritte (in dieser Reihenfolge)

1. Geänderte Dateien auf GitHub hochladen (überschreiben):
   `app.js`, `sw.js`, `firebase-config.js`, `firestore.rules`, `STAND.md`
2. Inhalt von `firestore.rules` in Firebase-Konsole → Firestore → Regeln einfügen & veröffentlichen
3. Database ID prüfen (siehe oben)
4. Spark-Plan/Abrechnung bestätigen
5. GitHub Pages aktivieren (falls noch nicht geschehen)
6. Live-Seite neu laden, Fehlermeldung (falls noch vorhanden) hier eintragen
7. QR-Codes über `qr.html` erzeugen und testen (zwei Geräte gleichzeitig)

## Projektstruktur

Siehe [README.md](README.md) für die komplette Einrichtungsanleitung (Firebase, GitHub Pages, QR-Codes).
Code-Dateien: `index.html`, `app.js`, `qr.html`, `style.css`, `manifest.json`, `icon.svg`, `sw.js`,
`firebase-config.js`, `firestore.rules`.
