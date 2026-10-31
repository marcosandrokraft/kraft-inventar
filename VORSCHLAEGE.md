# Vorschläge, die eine Entscheidung brauchen

Stand: 2026-10-31 (Session "verbesserungen-2026-10-31"). Hier steht, was den Ablauf, das Datenmodell
oder die Navigation ändern würde. Antworte einfach mit der Nummer und "ja", "nein" oder "anders: …".

## Entscheidungen (2026-10-31) und Stand nach Runde 2

| Nr. | Thema | Entscheidung | Stand |
|---|---|---|---|
| 1 | Hierarchie Raum → Schrank → Fach → Box | **ja** – Behälter auch ohne übergeordneten Ort, Ebenen überspringbar | umgesetzt (Runde 2) |
| 2 | NFC | ohne Code: Sticker mit NFC-App beschreiben | keine Codeänderung |
| 3 | Mehr Einheiten | **ja**: l, kg, Flasche, Dose, Packung, Glas, Stück | umgesetzt ("Stück" = bestehendes "Stk") |
| 4 | Behälter löschen | **ja**, nur wenn leer, mit Rückgängig | umgesetzt |
| 5 | Einkaufsliste bei Menge 0 | **später**, zweiter Schritt, bezogen auf Küche/Kühlschrank | offen |
| 6 | MHD | **ja**, optional für jeden Artikel; Kamera-Erkennung als Experiment | umgesetzt |
| 7 | ±50 bei g/ml | **ja** | umgesetzt |
| 8 | Umzugsmodus | **ja** | umgesetzt (Auswahl + "Verschieben nach…"; Ziel-QR scannen noch nicht) |
| 9 | Leiste unten + zuletzt geöffnet | **ja** | umgesetzt |
| 10 | Fotos auslagern / Firebase Storage | **nein** | – |
| 11 | Firebase selbst hosten | **ja**, falls gratis, mind. gleich schnell, sicherer | umgesetzt (Begründung in STAND.md) |
| 12 | "Zuletzt geändert von" | **nein** | – |

Die Abschnitte unten sind der ursprüngliche Vorschlagstext (zum Nachlesen).

Aufwand: S = unter 1 Std., M = 1–3 Std., L = mehr als 3 Std. (jeweils inkl. Tests).

---

## 1. Hierarchie: Raum → Schrank → Fach → Box

**Heute:** Alle Behälter liegen flach nebeneinander ("Keller Regal 2 Box 3" steckt nur im Namen).

**Vorschlag:** Optionales Feld `parent` am Behälter ("liegt in …"). Die Übersicht zeigt dann nur
oberste Ebenen (z.B. Räume), ein Behälter zeigt oben seinen Pfad (Keller › Regal 2 › Box 3) und
unten seine Unter-Behälter. Die Suche zeigt den ganzen Pfad ("Bohrmaschine – Keller › Regal 2 › Box 3").
Ein Behälter kann über "Verschieben" in einen anderen gelegt werden (ganze Box umziehen).

- Bestehende Daten bleiben gültig (ohne `parent` = oberste Ebene), keine Migration nötig.
- Regeländerung nötig (`parent` als erlaubtes Feld, Zyklus-Schutz im Client).
- Aufwand: **L**. **Empfehlung: ja** – das ist der grösste Gewinn für "wo ist X?", sobald es mehr als
  ~15 Behälter gibt.

## 2. NFC-Tags zusätzlich zu QR-Codes

**Ohne Code-Änderung möglich:** NFC-Sticker (NTAG213/215, ca. 0.20–0.50 CHF/Stück) mit einer
NFC-App (z.B. "NFC Tools") beschreiben – Inhalt: genau der Link aus dem QR-Code
(`…/index.html?c=<id>&n=<Name>`). Handy an den Sticker halten öffnet den Behälter, auf iPhone (ab XS)
und Android, ohne die Kamera zu öffnen. Funktioniert auch hinter Folie/im Dunkeln.

**Optional mit Code:** Knopf "Auf NFC-Tag schreiben" im Behälter (Web NFC – nur Chrome auf Android,
nicht iPhone). Aufwand: **S–M**. **Empfehlung:** Sticker einfach mit der NFC-App beschreiben;
In-App-Schreiben nur, wenn ihr viele Tags anlegt und ein Android-Handy habt. QR-Codes beibehalten
(funktionieren mit jedem Handy).

## 3. Mehr Einheiten (l, kg, Flasche, Dose, Glas, Paar …)

Heute fest: Stk, Packung, g, ml – in App **und** Regeln. Erweiterung ist rückwärtskompatibel,
braucht aber eine Regeländerung. Aufwand: **S**. **Empfehlung: ja**, sag mir welche.

## 4. Behälter löschen

Heute verbieten die Regeln das Löschen von Behältern (Schutz vor Versehen). Vorschlag: "Behälter
löschen" nur wenn er leer ist (Prüfung in der App) mit Rückgängig-Möglichkeit; Regeln: Löschen
für Mitglieder erlauben. Aufwand: **S**. **Empfehlung: ja**, sonst sammeln sich Test-/Tippfehler-Behälter.

## 5. Bei Menge 0 auf eine Einkaufsliste statt löschen

Heute: − bei 1 löscht den Artikel (jetzt mit "Rückgängig"). Alternative für Vorräte: Artikel bleibt
mit Menge 0 grau stehen ("leer – nachkaufen"), und es gibt eine Ansicht "Einkaufsliste" über alle
Behälter. Ändert den Ablauf und die Regeln (qty 0 erlauben). Aufwand: **M**.
**Empfehlung:** sinnvoll für Kühlschrank/Vorrat, nicht für Werkzeug/Kleider – evtl. pro Behälter
einschaltbar. Deine Entscheidung.

## 6. Mindesthaltbarkeit / Ablaufdatum

Optionales Datum pro Artikel, Übersicht "läuft bald ab". Neues Feld + Regeländerung.
Aufwand: **M**. **Empfehlung:** nur wenn ihr es wirklich pflegen würdet.

## 7. Grössere Schritte bei g/ml

Heute ändern +/− immer um 1 (500 g → 499 g). Bereits umgesetzt: Zahl antippen → Menge direkt
eingeben. Zusätzlich möglich: Schrittweite je Einheit (z.B. g/ml ±50) oder lange drücken = ±10.
Aufwand: **S**. **Empfehlung:** ±50 bei g/ml, falls ihr g/ml oft nutzt.

## 8. "Umzugsmodus": mehrere Artikel auf einmal verschieben

Heute: Artikel einzeln über die Detailansicht verschieben. Vorschlag: Mehrfachauswahl im Behälter,
dann "Verschieben nach …" oder Ziel-QR-Code scannen. Aufwand: **M**. **Empfehlung:** erst wenn
Einzel-Verschieben im Alltag zu mühsam ist.

## 9. Startbildschirm/Navigation

Umgesetzt (kleine Änderung): Übersicht hat oben die Suche "Wo ist …?" und (auf Android) einen
Scan-Knopf. Weitergehend: Leiste unten (Suchen · Scannen · Behälter) für Einhandbedienung und
"zuletzt geöffnete Behälter" oben. Ändert die Navigation. Aufwand: **M**. **Empfehlung:** ja, wenn
die App oft ohne QR-Code geöffnet wird.

## 10. Fotos aus den Artikel-Dokumenten auslagern

Heute steckt jedes Foto (10–40 KB) direkt im Artikel. Folge: Ein Behälter und die Suche laden immer
alle Fotos mit. Bis einige hundert Artikel ist das unproblematisch. Firebase Storage wäre sauberer,
braucht aber inzwischen den kostenpflichtigen Blaze-Tarif – deshalb **nicht empfohlen**. Alternative
im Gratis-Tarif: kleines Vorschaubild (~3 KB) im Artikel, grosses Foto in eigenem Dokument
(`items/{id}/photo/main`). Datenmodell-Umbau mit Migration. Aufwand: **L**.
**Empfehlung: vorerst nein**, erst wenn es spürbar langsam wird.

## 11. Firebase-Bibliotheken selbst hosten statt von gstatic.com laden

Subresource Integrity (SRI) ist für die per `import` geladenen Module praktisch nicht möglich
(Import-Map-Integrity kennt nicht jeder Browser). Wer die Lieferkette ganz absichern will, legt die
Firebase-Dateien ins Repo (`vendor/firebase/…`) und ändert die Import-Pfade. Nachteil: Updates von
Hand. Aufwand: **S–M**. **Empfehlung:** optional; gstatic.com (Google) mit fester Version ist ein
vertretbares Risiko. Gleiches gilt für die Freistellungs-Bibliothek von jsdelivr.

## 12. "Zuletzt geändert von"

Feld `updatedBy` (Name der Person) pro Artikel, z.B. "Milch – geändert von Marco, gestern".
Regeländerung (Feld muss zum angemeldeten Konto passen). Aufwand: **S–M**. **Empfehlung:** nur bei
Bedarf.

---

**Hinweis:** Alle umgesetzten Änderungen dieser Session sind in [STAND.md](STAND.md) beschrieben.
