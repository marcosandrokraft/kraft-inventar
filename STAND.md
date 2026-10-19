# Aktueller Stand

Letzter Stand: 2026-10-19. Diese Datei fasst den Fortschritt zusammen, damit man (auch mit einer
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

- +/− schreibt den ganzen Artikel neu (inkl. Foto); gleichzeitiges Drücken auf zwei Geräten kann eine
  Änderung überschreiben. Besser: Firestore `increment()`.
- Gleichen Artikel nochmals hinzufügen überschreibt die Menge statt sie zu addieren.

## Projektstruktur

Siehe [README.md](README.md) für die Einrichtungsanleitung (Firebase, GitHub Pages, QR-Codes).
Code-Dateien: `index.html`, `app.js`, `qr.html`, `style.css`, `manifest.json`, `icon.svg`, `sw.js`,
`firebase-config.js`, `firestore.rules`.
