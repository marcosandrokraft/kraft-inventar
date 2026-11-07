Tabler-Icons für einzelne Artikel-Icons
=======================================

Herkunft
  Paket:      @tabler/icons (npm), https://tabler.io/icons
  Version:    3.24.0 (veröffentlicht 2024-12-02)
  Integrity:  sha512-qNis9e90QcdxAGV3wNIeX0Ba2R7ktm0cnqOToKHJfC2kj3fvJwEVLsw63K0/fm7NW8rSZjDSTQRmMnSg8g/wrg==
              (lokal am Tarball nachgerechnet, stimmt mit npm überein)
  Übernommen: 2026-11-07
  Lizenz:     MIT – vollständiger Text in LICENSE

Warum
  Lucide (Hauptquelle, siehe ../lucide/) hat keine Icons für Käse, Brot, Baguette und
  Nudeln. Tabler hat den gleichen Strichstil (viewBox 24, Strich, runde Enden).

Was übernommen wurde
  Nur die Geometrie aus icons/outline/<id>.svg von 4 Icons: cheese (Käse), bread (Brot),
  baguette (Baguette, Brezel), bowl-chopsticks (Nudeln & Teigwaren). Eingebettet in
  ../../item-icons.js (TABLER_ICON_IDS). Der unsichtbare Tabler-Rahmen
  <path stroke="none" d="M0 0h24v24H0z" fill="none"/> wird gezielt verworfen.

Neu erzeugen
  npm view @tabler/icons@<version> dist.integrity
  npm pack @tabler/icons@<version>   (in einem leeren Temp-Ordner), tar xzf …
  node tools/build-item-icons.mjs <lucide-package> <tabler-package>
