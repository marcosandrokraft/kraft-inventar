# Aktueller Stand

Letzter Stand: 2026-11-21, Paket "Ziel" (Branch `ziel-umzug`, noch nicht gemergt/gepusht; **vorher
neue Regeln veröffentlichen**, siehe unten). Diese Datei fasst den Fortschritt zusammen, damit man (auch mit einer
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

## Paket "Ziel" – "Gehört nach …" für den Umzug (2026-11-21, Branch `ziel-umzug`, noch nicht gemergt/gepusht)

Wozu: Beim Umzug sehen Helfer beim Auspacken, wohin eine Kiste bzw. ein Artikel gehört.

**Umgesetzt:**

- Optionales Feld `target` (= ID eines anderen Behälters) an **Behältern** und **Artikeln**. Artikel ohne
  eigenes Ziel erben das Ziel ihres Behälters (bzw. des nächsten Behälters darüber mit Ziel; Anzeige
  "· über Kiste 1").
- **Setzen/Ändern/Entfernen:** Bearbeiten-Dialog des Behälters ("Gehört nach (Umzug)"), Artikel-Details
  ("Gehört nach …"), Mehrfachauswahl ("Ziel", ein Batch, mit Rückgängig). Auswahl mit Pfad wie im
  Verschieben-Dialog. Nicht möglich: eigener Behälter, eigener Unterbehälter (Zyklus), ein Ort, an dem
  es schon liegt.
- **Ziel erreicht:** Liegt etwas im Ziel oder in einem Unterbehälter davon, wird das Ziel nicht mehr
  angezeigt. Beim Verschieben ans Ziel wird `target` am Artikel entfernt (Meldung "· am Ziel"); beim
  Behälter, sobald "liegt in" auf das Ziel (oder darunter) gesetzt wird (deleteField). Wird ein Artikel
  in eine andere Kiste umgepackt, nimmt er ein geerbtes Ziel als eigenes mit.
- **Anzeige:** im Marine-Kopf "→ Küche" (Messing, Pfad auf die letzten 2 Teile gekürzt); in Artikelzeilen
  "→ Küche › Schublade oben" (eigenes Ziel; das geerbte steht im Kopf). "Nach Ziel ordnen" (Auspacken-
  Ansicht, gemerkt pro Gerät) erscheint nur, wenn es mind. ein Ziel/Vorschlag und zwei Gruppen gibt.
  Ohne Ziele sieht die App aus wie bisher.
- **Vorschläge** (lib.js `suggestTarget`, nie gespeichert, kursiv "Vorschlag: → …"): nur in Behältern
  ohne (geerbtes) Ziel, die Umzugskisten sind (ein Wort im Namen beginnt mit Kiste/Karton/Umzug –
  "Werkzeugkiste" zählt nicht) oder Artikel mit noch nicht erreichtem Ziel enthalten. (a) Gleicher/ähnlicher Name liegt an einem festen Ort (keine Box, keine Umzugskiste) →
  dorthin, wenn eindeutig; (b) Art des Artikels (Icon-Gruppe) → Raum/Schrank mit passendem Namen
  (Lebensmittel → Küche/Vorrat, Pflege → Bad, Werkzeug → Keller/Werkstatt …), nur der oberste und nur
  wenn eindeutig. Für (a) wird die Artikelliste der Suche **einmal** geladen und 10 Min. in
  sessionStorage gemerkt – normale Behälter laden nichts zusätzlich.
- **Verschieben:** Ziel bzw. Vorschlag im Verschieben-Dialog vorausgewählt (mehrere: wenn alle dasselbe
  haben), Bestätigung wie bisher, mit Rückgängig (stellt auch das Ziel wieder her).
- **Sperre:** Ziele sind sichtbar, ändern nur mit Schreibrecht (bei Sperre nur Owner).
- **Übung:** Beispieldaten mit "Kiste 1" (→ Küche, Messerset → Schublade oben) und "Kiste 2" (Vorschläge).
  Tutorial: Schritt "Verschieben" erwähnt «Ziel» (keine zusätzlichen Schritte).
- Nicht umgesetzt (abgewählt): "Erledigt"-Knopf, Einräumen per Scan, Ziel auf dem QR-Etikett.
- Service Worker **v16**.

**Wichtig – Reihenfolge beim Veröffentlichen:**

1. **Zuerst die neuen Regeln veröffentlichen:** Firebase-Konsole → Firestore Database → Regeln → Inhalt
   von [firestore.rules](firestore.rules) einfügen → Veröffentlichen. Sonst lehnt Firestore jedes
   Speichern mit `target` ab ("permission-denied"). Die neuen Regeln sind rückwärtskompatibel (die alte
   App läuft damit weiter).
2. Danach mergen und pushen: `git checkout main && git merge ziel-umzug && git push`.

Hinweis: Ältere App-Versionen (noch nicht neu geladene Handys) kennen `target` nicht – sie lassen es
beim Bearbeiten stehen, verlieren es aber, wenn sie einen Artikel verschieben.

**Tests:** siehe [TESTS.md](TESTS.md) (Paket Ziel): `npm test` 229/229, `npm run test:rules` 110/110,
`npm run test:e2e` 26/26 + 12/12 + 9/9.
Unabhängiger Review (Subagent) gemacht; behoben: Umzugskisten nur am Wortanfang, geerbtes Ziel beim
Umpacken, Neuaufbau nur bei relevanten Behälteränderungen, Speichern ohne Änderung schreibt nichts,
"Küche" ≠ "Kuchenform", Namensschlüssel vorberechnet.

## Paket "Schutz" (2026-11-21, Branch `schutz-besucher`, noch nicht gemergt/gepusht)

Frage: Was können **nicht angemeldete Besucher** der öffentlichen Seite anrichten (Übungsmodus,
Anmeldeseite, Links) – und wie schützen wir uns? Kurzfassung: An die echten Daten kommt niemand
(Regeln, im Emulator mit 19 neuen Besucher-Tests geprüft). Die echte Schwachstelle ist das
**Tageslimit für Anmelde-Mails im Spark-Tarif: 5 pro Projekt und Tag** – wer will, kann es mit 5
beliebigen Adressen aufbrauchen; dann kann sich an dem Tag niemand **neu** anmelden (schon
angemeldete Geräte bleiben angemeldet). Das kann nur App Check (Schritt 4 unten) wirklich verhindern.

**Umgesetzt (in der App, wirkt gegen Missbrauch über die Seite selbst):**

- **Anmeldeseite:** pro Gerät höchstens 1 Link pro 60 s, 3 pro Stunde, 5 pro 24 h
  (`LOGIN_MAIL_LIMITS` in [lib.js](lib.js)); Formatprüfung der Adresse; unsichtbares Fallen-Feld für
  Formular-Bots (füllt es jemand aus, kommt die normale Meldung, aber es geht keine Mail raus);
  neutrale Meldung ("Link an … unterwegs" – verrät nicht, ob die Adresse freigeschaltet ist);
  verständliche Meldung beim Tageslimit ("auth/quota-exceeded"). Der Link in der Mail führt nur noch
  mit `?c=`/`&n=` zurück, alle anderen Parameter fallen weg (niemand kann Text in fremde Anmelde-Mails
  schmuggeln). **Ehrlich:** Ein Skript ruft Firebase direkt auf und umgeht all das.
- **Übungsmodus:** Grenzen pro Gerät – 60 Behälter, 400 Artikel, 20 Fotos, ca. 2 Mio. Zeichen
  (`PRACTICE_LIMITS` in [uebung-firebase.js](uebung-firebase.js)); darüber freundliche Meldung mit Knopf
  "Übung zurücksetzen", nichts geht kaputt, Löschen/Ändern geht weiter. Fotos in der Übung ohne
  Freistellung und klein (max. 320 px, ≤ 60 KB) – kein 56-MB-Download von fremden Servern beim
  Ausprobieren. Die Vorab-Verbindung (preconnect) zu Firestore wird nur noch mit echten Daten aufgebaut.
- **Einbetten (Clickjacking):** [frame-guard.js](frame-guard.js) blendet die App aus, wenn eine andere
  Seite sie in einen Rahmen lädt (frame-ancestors geht auf GitHub Pages nicht – keine eigenen Header).
- **Überlange Links:** `?c=` über 200 Zeichen → "Ungültiger Behälter-Link"; QR-Druckbogen höchstens 500 Behälter.
- `firestore.rules` **unverändert** (keine Lücke gefunden). Service Worker **v15**.

**Was du in der Konsole tun solltest (in dieser Reihenfolge, alles kostenlos):**

1. **Spark prüfen** (falls noch nicht, siehe "Offen" Punkt 2): ohne Zahlungsmittel kostet ein Angriff
   nie Geld, er kann höchstens Tageslimits aufbrauchen. *Nutzen: hoch, Aufwand: 1 Min.*
2. **Schutz vor Adress-Ausspähung prüfen:** Firebase-Konsole → Authentication → Einstellungen →
   Nutzeraktionen (User actions) → "Email enumeration protection" muss angehakt sein (bei Projekten
   ab 15.09.2023 Standard) → Speichern. *Nutzen: gering* – der Anmelde-Link verrät ohnehin nichts,
   aber andere Auth-Schnittstellen sonst schon.
3. **API-Key einschränken:** https://console.cloud.google.com/apis/credentials (Projekt kraft-inventar)
   → "Browser key (auto created by Firebase)" →
   - Anwendungseinschränkungen: "Websites" → `https://marcosandrokraft.github.io/*` und
     `https://kraft-inventar.firebaseapp.com/*` (für die Anmelde-Seite von Firebase; zum lokalen
     Testen zusätzlich `http://localhost:*/*`).
   - API-Einschränkungen: "Schlüssel einschränken" → Identity Toolkit API, Token Service API,
     Cloud Firestore API, Firebase App Check API.
   - Speichern, 5 Min. warten, App auf dem Handy neu laden und **Anmelden testen** (neuer Link). Kommt
     "requests-from-referer-…-are-blocked", fehlt eine Adresse in der Liste.
   *Nutzen: mittel* – blockiert fremde Webseiten und Missbrauch des Schlüssels für andere Google-APIs;
   ein Skript kann den Referer aber fälschen, gegen gezielte Angriffe hilft das allein nicht.
4. **App Check einrichten – erst überwachen, dann erzwingen:**
   1. **Zuerst die CSP erweitern** (sonst blockiert die App reCAPTCHA und Anfragen hängen): in
      [index.html](index.html) in der `Content-Security-Policy`-Zeile bei `script-src` ergänzen:
      `https://www.google.com https://www.gstatic.com`. Mehr braucht es nicht (geprüft mit
      `npm run test:e2e:appcheck`: ohne Ergänzung blockiert, mit Ergänzung keine Verletzung).
   2. https://www.google.com/recaptcha/admin/create → "reCAPTCHA v3" (Google empfiehlt für neue
      Projekte inzwischen reCAPTCHA Enterprise; v3 wird weiter unterstützt und ist hier vorbereitet),
      Domains `marcosandrokraft.github.io` und `localhost` → Websiteschlüssel und geheimen Schlüssel kopieren.
   3. Firebase-Konsole → App Check → Apps → Web-App → reCAPTCHA → **geheimen** Schlüssel eintragen → Speichern.
   4. **Websiteschlüssel** (der öffentliche) in [firebase-config.js](firebase-config.js) bei `appCheckSiteKey`
      eintragen. Commit + Push zusammen mit der CSP-Ergänzung, auf den Handys 1–2× neu laden.
   5. **Ein paar Tage nur beobachten:** App Check → APIs → Cloud Firestore und Authentication zeigen
      den Anteil "verifizierter" Anfragen. Noch nichts erzwingen.
   6. Wenn praktisch alles verifiziert ist: **Cloud Firestore → Erzwingen**. Danach einen Tag testen,
      dann **Authentication → Erzwingen** (Authentication ist bei App Check noch "Preview"; geschützt
      werden laut Google u.a. das Anfordern des Anmelde-Links und die Anmeldung damit).
   7. Lokal testen (localhost) nach dem Erzwingen nur mit Debug-Token (App Check → Apps → Debug-Tokens).
   *Nutzen: hoch* – Anfragen ohne gültigen reCAPTCHA-Nachweis werden abgewiesen; das ist der einzige
   wirksame Schutz für das 5-Mails-Tageslimit. Kein absoluter Schutz (Angreifer mit echtem Browser),
   aber Massen-Skripte fallen weg. Rückweg: "Erzwingen" wieder ausschalten.
5. **Autorisierte Domains aufräumen** (Authentication → Einstellungen → Autorisierte Domains): nur
   `marcosandrokraft.github.io`, `kraft-inventar.firebaseapp.com` (und `localhost`, solange du lokal
   testest). *Nutzen: gering.*

**Gut zu wissen:**

- Verweigerte Anfragen: Nicht angemeldete Besucher scheitern schon an `request.auth != null` – das kostet
  keine Lese-Kontingente. Angemeldete Nicht-Mitglieder kosten pro Anfrage 1 Lesevorgang (Prüfung in
  `members`), aber nur mit bestätigter Adresse (also nur über einen echten Anmelde-Link). Laut Google
  werden die Lesevorgänge der Regeln auch bei abgelehnten Anfragen berechnet.
- Jede Adresse kann über den Anmelde-Link ein (leeres) Konto anlegen; sieht aber nichts. Konten kannst
  du unter Authentication → Users löschen.
- Alle GitHub-Pages-Projekte unter `marcosandrokraft.github.io` teilen sich denselben Browser-Speicher
  (Anmeldung, Übungsdaten). Dort also nur eigene, vertrauenswürdige Seiten veröffentlichen.

**Tests:** `npm test` 183/183, `npm run test:rules` 99/99, `npm run test:e2e` 26/26 + 12/12,
`test:e2e:cutout` ok, `test:e2e:ocr` ok, neu `test:e2e:appcheck` ok (siehe [TESTS.md](TESTS.md)).
Nicht getestet: echte Firebase-Konsole/App Check mit echtem Schlüssel, echte Handys.

**Danach mergen und pushen:** `git checkout main && git merge schutz-besucher && git push`. Regeln müssen
diesmal nicht neu veröffentlicht werden (unverändert).

Quellen: [Auth-Limits](https://firebase.google.com/docs/auth/limits) (5 Mails/Tag Spark),
[App Check](https://firebase.google.com/docs/app-check),
[App Check mit reCAPTCHA v3](https://firebase.google.com/docs/app-check/web/recaptcha-provider),
[App Check für Authentication](https://cloud.google.com/identity-platform/docs/admin/app-check-integration),
[Email-Enumeration-Schutz](https://cloud.google.com/identity-platform/docs/admin/email-enumeration-protection),
[Regeln: Abrechnung](https://firebase.google.com/docs/firestore/security/rules-conditions),
[Firestore-Preise](https://firebase.google.com/docs/firestore/pricing).

## Paket "Übung & Icons" (2026-11-07, Branch `features-uebung`, noch nicht gemergt/gepusht)

**Was du tun musst (genau in dieser Reihenfolge):**

1. **Owner-Feld setzen:** Firebase-Konsole → Firestore Database → Daten → Sammlung `members` →
   dein eigenes Dokument öffnen → "Feld hinzufügen": Name `role`, Typ string, Wert `owner` (genau so,
   klein) → Speichern. Hat dein Dokument noch kein Feld `name`, ebenfalls ergänzen (wird bei einer Sperre
   als "gesperrt von …" angezeigt – nie die Adresse). Nur Owner können sperren; niemand kann sich über
   die App selbst zum Owner machen (members bleibt für die App nicht schreibbar).
2. **Regeln veröffentlichen – VOR dem Merge/Push:** Firestore Database → Regeln → kompletten Inhalt
   von [firestore.rules](firestore.rules) einfügen → Veröffentlichen. Sonst lehnt Firestore jeden neuen
   Artikel mit Icon ab ("Speichern fehlgeschlagen (permission-denied)"), und Sperre/Rolle funktionieren
   nicht. Die neuen Regeln akzeptieren alle alten Daten und die alte App-Version. (Nicht automatisch deployt.)
3. **Lokal ansehen** (`npx http-server .`): Hilfe (?) oben, "Ohne Anmeldung ausprobieren" auf der
   Anmeldeseite, Einführung, Icon-Vorschlag beim Hinzufügen, als Owner "Echte Daten sperren".
4. **Dann mergen und pushen:** `git checkout main && git merge features-uebung && git push`.
   Danach auf den Handys 1–2× neu laden (Service Worker **v14**).

**Umgesetzt:**

- **Icon-Vorschlag statt Foto:** 89 Strich-Icons – 85 aus Lucide (`lucide-static@1.61.0`, ISC) und
  Käse, Brot, Baguette, Nudeln aus Tabler (`@tabler/icons@3.24.0`, MIT); Lizenz und Herkunft in
  `vendor/lucide/` bzw. `vendor/tabler/`, erzeugt mit `tools/build-item-icons.mjs`, nicht abgetippt. Deutsche
  Schlagwörter mit Synonymen, Schweizer Wörtern (Rüebli, Anke, Poulet, Glace, Guetzli), Plural und
  Komposita (Kopf am Ende: "Vollmilch" → Milch, "Milchschokolade" → Süsses, "Apfelsaft" → Saft).
  Neues optionales Feld `icon` (Regeln: `^[a-z0-9-]{1,40}$`): gespeichert wird **nur ein selbst
  gewähltes** Icon (Raster im Formular oder in den Details); der Vorschlag wird nie gespeichert, sondern
  immer neu aus dem Namen abgeleitet – bessere Schlagwörter wirken so auch bei bestehenden Artikeln.
  "Automatisch (aus dem Namen)" entfernt ein gewähltes Icon wieder.
- **Übungsmodus** (`?uebung=1`, Schalter pro Tab): eigene Datenschicht `uebung-firebase.js` mit
  Beispieldaten (Küche › Kühlschrank › Gemüsefach, Vorratsschrank, Keller › Werkzeugbox, Bad ›
  Spiegelschrank; MHD abgelaufen/heute/bald). Firebase wird im Übungsmodus gar nicht geladen – kein
  Kontakt zur echten Datenbank, ihr Offline-Speicher bleibt unberührt. "Zuletzt" usw. getrennt
  (`uebung:`-Schlüssel). Abmelden löscht auch die Übungsdaten des Geräts.
- **Sperre:** Dokument `settings/lock` { locked, lockedAt, lockedBy } – nur Owner schreiben es. Bei
  Sperre lehnen die Regeln jedes Schreiben unter `containers/**` von Nicht-Ownern ab; Lesen bleibt.
  Die App zeigt den Balken "Vorübergehend gesperrt – nur Lesen" (Owner: "Gesperrt für andere") und
  blendet für Nicht-Owner alle Ändern-Knöpfe aus. Mitglieder dürfen jetzt ihr **eigenes**
  members-Dokument lesen (für Rolle und Name). Die Rolle wird beim Start gelesen (Änderung in der
  Konsole wirkt nach dem Neuladen).
- **Einführung** (`tutorial.js`): Hilfe (?) → "Einführung starten", 13 Schritte im Übungsmodus,
  interaktiv (geht weiter, wenn die Aktion gemacht wurde), einmaliger Hinweis für neue Geräte.

**Tests:** siehe [TESTS.md](TESTS.md) – `npm test` 159/159, `npm run test:rules` 80/80 (Emulator,
portable Java 17), `npm run test:e2e` 26/26 + 9/9, `test:e2e:cutout` ok, `test:e2e:ocr` ok.
Nicht getestet: echte Firebase-Datenbank (Regeln nur im Emulator), echte Handys, echter QR-Scan.

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

App Check, API-Key-Einschränkung usw.: ersetzt durch die genauere Anleitung im Abschnitt
**Paket "Schutz" → "Was du in der Konsole tun solltest"** oben (dort auch die nötige CSP-Ergänzung).

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
