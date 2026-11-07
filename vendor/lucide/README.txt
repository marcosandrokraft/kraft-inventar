Lucide-Icons für die Artikel-Icons
===================================

Herkunft
  Paket:      lucide-static (npm), https://lucide.dev
  Version:    1.61.0 (veröffentlicht 2026-10-21)
  Integrity:  sha512-yLAiQB3MWUJEstsEDAwenSA3m7vr1tdLvgnC16Q/XMxRRma0DWwMs8M2bWlvgShrIs1m2mWMJ+0AiahqQO4GrA==
  Übernommen: 2026-11-07
  Lizenz:     ISC (Lucide), einige ursprünglich aus Feather (MIT) – vollständiger Text in LICENSE

Was übernommen wurde
  Nur die Geometrie (path/circle/rect/line/polyline/polygon/ellipse) von 85 Icons,
  eingebettet in ../../item-icons.js (Objekt ITEM_ICONS; dort auch deutsche
  Bezeichnung und Gruppe). Keine Schriften, kein Sprite, kein JavaScript aus dem Paket.

  IDs: milk, cuboid (Käse & Butter), egg, beef, ham, bacon, drumstick, fish, shrimp,
  apple, banana, cherry, citrus, grape, avocado, carrot, broccoli, salad, leafy-green,
  bean, nut, sandwich (Brot), croissant, wheat, soup, cooking-pot, can, pizza,
  snowflake, utensils, cookie, cake, cake-slice, candy, lollipop, candy-cane,
  ice-cream-cone, popcorn, coffee, cup-soda, glass-water, carton (Saft), beer, wine,
  spray-can, soap-dispenser-droplet, washing-machine, broom, toilet, toothbrush,
  tube-lotion, trash, lightbulb, battery, flame, shirt, pill, pill-bottle, bandage,
  thermometer, hammer, wrench, screw, drill, toolbox, scissors, ruler, paintbrush,
  paint-bucket, plug, flashlight, smartphone, headphones, package, box, gift,
  party-popper, tree-pine, flower, book, pen, shopping-bag, bone, baby, gamepad-2

Neu erzeugen (z.B. andere Version oder andere Icon-Auswahl)
  1. Auswahl (ID, Bezeichnung, Gruppe) in tools/build-item-icons.mjs anpassen.
  2. In einem leeren Temp-Ordner:
       npm view lucide-static@<version> dist.integrity
       npm pack lucide-static@<version>
       tar xzf lucide-static-<version>.tgz
  3. Im Repo:
       node tools/build-item-icons.mjs <temp-ordner>/package
     Das Skript liest die Version aus package.json des Pakets und schreibt item-icons.js.
  4. LICENSE aus dem Paket hierher kopieren, Version/Integrity/Datum oben anpassen,
     npm test laufen lassen.
  item-icons.js nicht von Hand ändern. Schlagwörter für die automatische Zuordnung
  stehen in icon-match.js.
