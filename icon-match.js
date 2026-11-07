// Schlägt zu einem Artikelnamen ein Icon aus item-icons.js vor. Reine Logik, kein DOM.
//
// Regeln (Deutsch hat den Kopf eines Kompositums am Ende):
//   1. Mehrwort-Schlagwort als ganze Wortfolge ("creme fraiche")
//   2. Pro Wort: exakt > Kompositum-Ende (Schlagwort ≥ 3 Zeichen) > Kompositum-Anfang (≥ 4 Zeichen);
//      innerhalb gleicher Stufe gewinnt das längere Schlagwort.
//   3. Bei mehreren Wörtern zählt das letzte Wort, das überhaupt passt; Füllwörter wie
//      bio, nature, light, Mengen und Zahlen werden vorher entfernt.
// Schlagwörter mit "=" davor treffen nur als ganzes Wort (z.B. "=ei", damit "Bleistift" kein Ei ist).

import { ITEM_ICONS } from "./item-icons.js";
import { normalizeSearch } from "./lib.js";

export const FALLBACK_ICON = "package";

const KEYWORDS = {
  milk: ["milch", "vollmilch", "magermilch", "hafermilch", "sojamilch", "mandelmilch", "rahm", "sahne", "vollrahm", "halbrahm", "kaffeerahm", "joghurt", "jogurt", "yoghurt", "quark", "kefir", "buttermilch", "mascarpone", "molke", "milchdrink", "milchprodukte", "crème fraîche", "sauerrahm", "doppelrahm", "schlagrahm", "rahmquark", "hüttenkäse"],
  cheese: ["käse", "kase", "hartkäse", "weichkäse", "reibkäse", "gruyère", "gruyere", "greyerzer", "emmentaler", "appenzeller", "tilsiter", "raclette", "raclettekäse", "fondue", "mozzarella", "parmesan", "feta", "brie", "camembert", "gouda", "cheddar", "sbrinz", "vacherin", "tete de moine", "frischkäse"],
  cuboid: ["butter", "anke", "margarine", "tofu", "kochbutter", "bratbutter", "räuchertofu"],
  egg: ["=ei", "eier", "eiern", "freilandeier", "bodenhaltung", "osterei", "ostereier", "spiegelei", "rührei", "eiweiss", "eigelb"],
  beef: ["fleisch", "rind", "rindfleisch", "hackfleisch", "gehacktes", "hack", "steak", "steaks", "entrecote", "filet", "braten", "schwein", "schweinefleisch", "kalb", "kalbfleisch", "kalbsfleisch", "lamm", "lammfleisch", "geschnetzeltes", "voressen", "plätzli", "schnitzel", "kotelett", "rindsfilet", "hamburger", "burger", "fleischkäse"],
  ham: ["schinken", "wurst", "würste", "würstchen", "bratwurst", "cervelat", "servelat", "salami", "aufschnitt", "landjäger", "wienerli", "wiener", "chorizo", "mortadella", "lyoner", "fleischwaren", "bündnerfleisch", "trockenfleisch", "rohschinken", "prosciutto", "coppa"],
  bacon: ["speck", "bacon", "pancetta", "speckwürfel", "lardo"],
  drumstick: ["poulet", "huhn", "hühner", "hähnchen", "hühnchen", "hendl", "chicken", "wings", "nuggets", "geflügel", "truthahn", "trute", "pute", "=ente", "pouletbrust", "pouletschenkel", "schenkel", "chicken wings", "chicken nuggets"],
  fish: ["fisch", "fische", "lachs", "räucherlachs", "thunfisch", "forelle", "dorsch", "kabeljau", "egli", "zander", "felchen", "sardinen", "sardellen", "hering", "makrele", "pangasius", "sushi", "fischstäbchen", "meeresfrüchte"],
  shrimp: ["crevetten", "crevette", "krevetten", "garnelen", "garnele", "shrimps", "shrimp", "scampi", "prawns", "hummer", "krabben", "muscheln", "calamari", "tintenfisch"],
  apple: ["apfel", "äpfel", "aepfel", "birne", "birnen", "obst", "früchte", "frucht", "quitte", "quitten", "pfirsich", "pfirsiche", "nektarine", "nektarinen", "aprikose", "aprikosen", "aprikose", "zwetschgen", "pflaumen", "mango", "kiwi", "ananas", "melone", "melonen", "apfelmus"],
  banana: ["banane", "bananen"],
  cherry: ["kirsche", "kirschen", "beeren", "beere", "erdbeeren", "erdbeere", "himbeeren", "heidelbeeren", "blaubeeren", "brombeeren", "johannisbeeren", "preiselbeeren", "cranberries", "trübeli"],
  citrus: ["zitrone", "zitronen", "orange", "orangen", "mandarine", "mandarinen", "clementine", "clementinen", "limette", "limetten", "grapefruit", "zitrus", "zitrusfrüchte", "blutorangen"],
  grape: ["traube", "trauben", "weintrauben", "rosinen", "sultaninen"],
  avocado: ["avocado", "avocados", "guacamole", "oliven", "olive"],
  carrot: ["rüebli", "ruebli", "rübli", "karotte", "karotten", "möhre", "möhren", "gemüse", "kartoffel", "kartoffeln", "härdöpfel", "erdäpfel", "zwiebel", "zwiebeln", "knoblauch", "sellerie", "randen", "rande", "rote bete", "pastinaken", "ingwer", "radieschen", "rettich", "kürbis", "süsskartoffeln", "süsskartoffel", "fenchel", "spargel"],
  broccoli: ["brokkoli", "broccoli", "blumenkohl", "kohl", "rosenkohl", "kohlrabi", "rotkohl", "weisskohl", "chabis", "rotkabis", "kabis", "zucchini", "zucchetti", "pilze", "champignons", "erbsli", "auberginen", "aubergine"],
  salad: ["salat", "salate", "kopfsalat", "eisbergsalat", "nüsslisalat", "feldsalat", "tomate", "tomaten", "cherrytomaten", "gurke", "gurken", "peperoni", "paprika", "rucola", "radicchio", "chicorée"],
  "leafy-green": ["spinat", "blattspinat", "mangold", "kräuter", "basilikum", "petersilie", "schnittlauch", "koriander", "minze", "rosmarin", "thymian", "lauch", "frühlingszwiebeln", "grünkohl", "blattgemüse", "dill"],
  bean: ["bohne", "bohnen", "grüne bohnen", "kidneybohnen", "linsen", "erbsen", "kichererbsen", "hülsenfrüchte", "edamame", "sojabohnen"],
  nut: ["nuss", "nüsse", "nüssli", "haselnüsse", "haselnuss", "baumnüsse", "walnüsse", "erdnüsse", "erdnuss", "mandeln", "mandel", "cashew", "cashews", "cashewnüsse", "pistazien", "macadamia", "kerne", "sonnenblumenkerne", "kürbiskerne", "pinienkerne", "samen", "leinsamen", "chiasamen", "erdnussbutter"],
  bread: ["brot", "brote", "brötchen", "weggli", "bürli", "semmel", "semmeln", "toast", "toastbrot", "zopf", "butterzopf", "pumpernickel", "knäckebrot", "bagel", "vollkornbrot", "ruchbrot", "bauernbrot", "brotlaib"],
  baguette: ["baguette", "brezel", "brezeln", "laugenbrezel", "pariserbrot", "flûte", "flute"],
  sandwich: ["sandwich", "sandwiches", "fladenbrot", "pita", "tortilla", "tortillas", "wraps", "zmorge", "frühstück", "sandwichs", "club sandwich"],
  croissant: ["gipfeli", "croissant", "croissants", "buttergipfeli", "laugengipfeli", "gebäck", "blätterteig", "kuchenteig", "teig", "pain au chocolat", "brioche", "schoggigipfeli"],
  wheat: ["mehl", "weissmehl", "ruchmehl", "vollkornmehl", "getreide", "reis", "risotto", "basmati", "couscous", "bulgur", "quinoa", "griess", "polenta", "haferflocken", "flocken", "müesli", "müsli", "cornflakes", "hafer", "dinkel", "weizen", "roggen", "gerste", "buchweizen", "=mais", "hefe", "backpulver", "paniermehl", "stärke", "maizena", "cerealien"],
  "bowl-chopsticks": ["nudeln", "pasta", "teigwaren", "spaghetti", "penne", "fusilli", "hörnli", "makkaroni", "maccaroni", "lasagne", "tagliatelle", "ravioli", "tortellini", "gnocchi", "spätzli", "spätzle", "ramen", "mie-nudeln", "glasnudeln", "reisnudeln", "eiernudeln", "nüdeli", "älplermagronen", "magronen", "linguine", "farfalle", "rigatoni", "cannelloni", "asia-nudeln", "nudelsuppe"],
  soup: ["suppe", "suppen", "bouillon", "brühe", "fond", "eintopf", "suppenwürfel", "fertigsuppe"],
  "cooking-pot": ["kochen", "zutaten", "=öl", "speiseöl", "olivenöl", "rapsöl", "sonnenblumenöl", "bratöl", "essig", "balsamico", "salz", "meersalz", "pfeffer", "gewürz", "gewürze", "paprikapulver", "curry", "zimt", "vanille", "vanillezucker", "zucker", "rohrzucker", "puderzucker", "gelierzucker", "süssstoff", "fertiggericht", "gericht", "fertiggerichte", "mahlzeit"],
  can: ["konserve", "konserven", "dose", "dosen", "büchse", "sauce", "saucen", "sosse", "tomatensauce", "pesto", "ketchup", "senf", "mayonnaise", "mayo", "dressing", "konfitüre", "konfi", "marmelade", "gelee", "honig", "nutella", "brotaufstrich", "aufstrich", "einmachglas", "passata", "tomatenmark", "pelati", "sugo", "sojasauce", "essiggurken", "kapern", "chutney", "vorrat"],
  pizza: ["pizza", "pizzen", "tiefkühlpizza", "flammkuchen", "pizzateig", "focaccia", "quiche", "wähe"],
  snowflake: ["tiefkühl", "tiefkühler", "tiefgekühlt", "gefroren", "gefrierfach", "gefrierbeutel", "eiswürfel", "kühlakku"],
  utensils: ["besteck", "gabel", "gabeln", "messer", "löffel", "kaffeelöffel", "geschirr", "teller", "tassen", "gläser", "pfanne", "pfannen", "kochtopf", "schüssel", "küchenutensilien", "backpapier", "alufolie", "frischhaltefolie", "kochlöffel", "schwingbesen"],
  cookie: ["guetzli", "guetsli", "kekse", "keks", "cookies", "cookie", "biskuit", "biskuits", "plätzchen", "zwieback", "kräcker", "cracker", "waffeln", "läckerli", "mailänderli", "brunsli", "zimtsterne", "spitzbuben", "lebkuchen", "biber"],
  cake: ["kuchen", "torte", "torten", "geburtstagskuchen", "cake", "muffins", "muffin", "cupcakes", "gugelhopf", "rüeblitorte", "backmischung"],
  "cake-slice": ["dessert", "desserts", "pudding", "tiramisu", "crème brûlée", "patisserie", "cremeschnitte", "mousse", "panna cotta", "vanillecreme", "meringue", "meringues"],
  candy: ["schokolade", "schoggi", "schokoladen", "praline", "pralinen", "bonbons", "bonbon", "süssigkeiten", "süsses", "gummibärchen", "gummibärli", "gummi", "riegel", "schokoriegel", "müesliriegel", "kaugummi", "marzipan", "nougat", "osterhase", "schoggihase", "toblerone", "kakao"],
  lollipop: ["lutscher", "lolli", "lollipop", "schleckstängel", "zuckerwatte"],
  "candy-cane": ["zuckerstange", "zuckerstangen", "candy cane"],
  "ice-cream-cone": ["glace", "glacé", "eis", "speiseeis", "glacecornet", "cornet", "vanilleeis", "erdbeereis", "himbeereis", "zitroneneis", "schokoladeneis", "wassereis", "eiscreme", "sorbet", "softeis", "glacestengel", "rakete"],
  popcorn: ["popcorn", "chips", "pommes chips", "snack", "snacks", "salzstangen", "salzstängeli", "brezeli", "apéro", "apero", "nachos", "flips", "erdnussflips", "knabbereien", "pommes", "pommes frites"],
  coffee: ["kaffee", "café", "kaffeebohnen", "kaffeepulver", "kaffeekapseln", "espresso", "cappuccino", "latte macchiato", "tee", "teebeutel", "schwarztee", "grüntee", "kräutertee", "pfefferminztee", "kamillentee", "früchtetee", "ovomaltine", "café crème", "kaffee creme", "kaffeemaschine", "kaffeefilter"],
  "cup-soda": ["cola", "limonade", "limo", "süssgetränk", "süssgetränke", "softdrink", "softdrinks", "eistee", "rivella", "fanta", "sprite", "energydrink", "energy", "tonic", "sirup", "getränk", "getränke", "ginger ale", "citro"],
  "glass-water": ["wasser", "mineralwasser", "mineral", "sprudel", "sprudelwasser", "hahnenwasser", "trinkwasser", "wasserflasche", "valser", "henniez"],
  carton: ["saft", "säfte", "orangensaft", "apfelsaft", "süssmost", "most", "multivitaminsaft", "nektar", "smoothie", "smoothies", "tetrapack", "tetrapak", "getränkekarton"],
  beer: ["bier", "biere", "=lager", "=pils", "weissbier", "radler", "panaché", "panache", "alkoholfreies bier", "dosenbier", "flaschenbier", "=ale", "=ipa", "stout"],
  wine: ["wein", "weine", "rotwein", "weisswein", "=rosé", "=rose", "roséwein", "schaumwein", "prosecco", "champagner", "sekt", "cava", "merlot", "chasselas", "fendant", "spirituosen", "schnaps", "kirsch", "whisky", "whiskey", "wodka", "vodka", "=gin", "likör", "aperol", "grappa", "cognac", "alkohol", "glühwein"],
  "spray-can": ["putzmittel", "reiniger", "allzweckreiniger", "glasreiniger", "badreiniger", "wc-reiniger", "entkalker", "spray", "sprays", "sprühdose", "spraydose", "=deo", "deodorant", "deospray", "haarspray", "insektenspray", "raumspray", "putzschwamm", "schwamm", "schwämme", "lappen", "putzlappen", "mikrofasertuch", "scheuermilch", "desinfektionsmittel", "desinfektion", "javel", "putzzeug", "reinigungsmittel"],
  "soap-dispenser-droplet": ["seife", "seifen", "flüssigseife", "handseife", "shampoo", "duschgel", "duschmittel", "spülmittel", "abwaschmittel", "geschirrspülmittel", "spülmaschinentabs", "tabs", "conditioner", "haarspülung", "badezusatz", "nachfüllpack"],
  "washing-machine": ["waschmittel", "waschpulver", "flüssigwaschmittel", "weichspüler", "fleckenentferner", "wäsche", "waschmaschine", "trockner", "wäscheklammern"],
  broom: ["besen", "schaufel", "kehrschaufel", "handbesen", "staubsauger", "staubsaugerbeutel", "mopp", "wischmopp", "putzeimer", "kübel", "staubwedel", "bürste", "bürsten"],
  toilet: ["toilettenpapier", "wc-papier", "klopapier", "wc", "toilette", "taschentücher", "taschentuch", "nastücher", "nastuch", "haushaltpapier", "küchenpapier", "küchenrolle", "feuchttücher", "kosmetiktücher"],
  toothbrush: ["zahnbürste", "zahnbürsten", "zahnpasta", "zahncreme", "zahnseide", "mundspülung", "zahnpflege", "zahnstocher"],
  "tube-lotion": ["sonnencreme", "handcreme", "gesichtscreme", "bodylotion", "lotion", "salbe", "creme", "nachtcreme", "tagescreme", "kosmetik", "makeup", "make-up", "lippenpflege", "lippenbalsam", "parfum", "parfüm", "serum", "rasierschaum", "rasierer", "rasierklingen", "tampons", "binden", "wattestäbchen", "watte"],
  trash: ["abfall", "abfallsack", "abfallsäcke", "kehricht", "kehrichtsack", "kehrichtsäcke", "gebührensack", "gebührensäcke", "müll", "müllsack", "müllsäcke", "mülltüten", "robidog", "abfalleimer", "kompost", "grünabfuhr"],
  lightbulb: ["glühbirne", "glühbirnen", "birnchen", "leuchtmittel", "lampe", "lampen", "leuchte", "=led", "led-lampe", "sparlampe", "energiesparlampe", "halogen", "lichterkette", "lichterketten", "leuchtstoffröhre"],
  battery: ["batterie", "batterien", "akku", "akkus", "knopfzelle", "knopfzellen", "powerbank", "aa-batterie", "aaa", "=aa"],
  flame: ["kerze", "kerzen", "teelicht", "teelichter", "duftkerze", "feuerzeug", "feuerzeuge", "streichhölzer", "zündhölzer", "zündholz", "anzünder", "grillanzünder", "grillkohle", "kohle", "brennsprit", "fondueset", "rechaud"],
  shirt: ["shirt", "t-shirt", "tshirt", "shirts", "socken", "strümpfe", "kleider", "kleidung", "hose", "hosen", "jeans", "pullover", "pulli", "jacke", "jacken", "unterwäsche", "unterhosen", "hemd", "hemden", "bluse", "mütze", "kappe", "schal", "handschuhe", "schuhe", "pyjama", "badehose", "bikini", "kleid"],
  pill: ["tablette", "tabletten", "pille", "pillen", "aspirin", "ibuprofen", "dafalgan", "paracetamol", "panadol", "dolo", "schmerzmittel", "schmerztabletten", "medikament", "medikamente", "kapseln", "kopfwehtabletten", "lutschtabletten", "antibiotika"],
  "pill-bottle": ["medizin", "vitamine", "vitamin", "nahrungsergänzung", "magnesium", "hustensirup", "hustensaft", "tropfen", "nasenspray", "augentropfen", "globuli", "apotheke", "hausapotheke"],
  bandage: ["pflaster", "verband", "verbände", "gaze", "verbandsmaterial", "erste hilfe", "kompresse", "kompressen", "heftpflaster", "blasenpflaster"],
  thermometer: ["thermometer", "fiebermesser", "fieberthermometer"],
  hammer: ["hammer", "fäustel", "gummihammer"],
  wrench: ["werkzeug", "schraubenschlüssel", "gabelschlüssel", "schraubenzieher", "schraubendreher", "zange", "zangen", "inbus", "inbusschlüssel", "säge", "feile", "multitool", "sackmesser", "taschenmesser", "cutter", "teppichmesser", "veloflickzeug", "flickzeug", "werkstatt"],
  screw: ["schraube", "schrauben", "dübel", "nagel", "nägel", "mutter", "muttern", "unterlagsscheiben", "haken", "beschläge", "bolzen"],
  drill: ["bohrmaschine", "akkuschrauber", "bohrer", "schlagbohrmaschine", "schrauber", "bohrhammer", "stichsäge", "schleifmaschine", "bits", "bohrersatz"],
  toolbox: ["werkzeugkasten", "werkzeugkiste", "werkzeugkoffer", "werkzeugset", "kleinteile"],
  scissors: ["schere", "scheren", "nagelschere", "papierschere", "gartenschere", "rosenschere", "haarschneider"],
  ruler: ["massband", "meterband", "doppelmeter", "meterstab", "zollstock", "lineal", "wasserwaage", "geodreieck"],
  paintbrush: ["pinsel", "malerpinsel", "farbroller", "roller", "malen", "malsachen", "abdeckband", "malerband"],
  "paint-bucket": ["farbe", "farben", "wandfarbe", "dispersionsfarbe", "lack", "lacke", "lasur", "grundierung", "farbeimer", "spachtelmasse", "silikon", "leim", "kleber", "klebstoff", "sekundenkleber", "holzleim"],
  plug: ["stecker", "steckdose", "steckdosenleiste", "mehrfachstecker", "verlängerung", "verlängerungskabel", "kabel", "ladekabel", "ladegerät", "netzteil", "adapter", "reiseadapter", "usb", "hdmi", "kabelrolle", "kabelbinder"],
  flashlight: ["taschenlampe", "taschenlampen", "stirnlampe", "stirnlampen", "laterne", "notlicht"],
  smartphone: ["handy", "natel", "smartphone", "telefon", "tablet", "ipad", "iphone", "handyhülle", "elektronik", "computer", "laptop", "fernbedienung", "maus", "tastatur", "festplatte", "speicherkarte", "usb-stick"],
  headphones: ["kopfhörer", "ohrhörer", "earbuds", "headset", "lautsprecher", "radio", "musik"],
  package: ["paket", "pakete", "päckli", "päckchen", "verpackung", "versand", "sendung", "karton", "kartons", "umzugskarton", "umzugskartons"],
  box: ["kiste", "kisten", "schachtel", "schachteln", "box", "aufbewahrung", "aufbewahrungsbox", "behälter", "harass", "harasse", "korb", "körbe", "ordner", "archiv"],
  gift: ["geschenk", "geschenke", "geschenkpapier", "geschenkband", "geschenkbox", "mitbringsel", "gutschein", "gutscheine", "geschenkkarte"],
  "party-popper": ["party", "geburtstag", "fest", "deko", "dekoration", "ballone", "ballon", "luftballone", "luftballons", "girlanden", "girlande", "konfetti", "servietten", "partygeschirr", "fasnacht", "halloween", "kostüm", "kostüme", "feuerwerk", "raketen"],
  "tree-pine": ["weihnacht", "weihnachten", "weihnachtsdeko", "weihnachtskugeln", "christbaum", "christbaumkugeln", "christbaumschmuck", "tannenbaum", "weihnachtsbaum", "adventskranz", "advent", "krippe", "lametta", "christbaumständer", "tannenzweige"],
  flower: ["blume", "blumen", "blumenstrauss", "pflanze", "pflanzen", "zimmerpflanze", "topfpflanze", "=rosen", "tulpen", "blumentopf", "blumenerde", "erde", "dünger", "saatgut", "garten", "gartenzubehör", "orchidee"],
  book: ["buch", "bücher", "roman", "romane", "kochbuch", "comic", "comics", "zeitschrift", "zeitschriften", "magazin", "heft", "hefte", "notizbuch", "album", "fotoalbum", "kalender", "anleitung", "lexikon", "atlas"],
  pen: ["stift", "stifte", "kugelschreiber", "kuli", "bleistift", "farbstift", "farbstifte", "filzstift", "marker", "leuchtstift", "füller", "papier", "druckerpapier", "briefpapier", "briefumschläge", "couverts", "couvert", "büro", "büromaterial", "bostitch", "klebeband", "post-it", "notizzettel", "radiergummi", "spitzer", "schreibwaren", "tinte", "druckerpatronen", "patronen", "toner"],
  "shopping-bag": ["tasche", "taschen", "einkaufstasche", "tragtasche", "tragtaschen", "einkaufstüte", "tüte", "tüten", "papiertasche", "jutebeutel", "rucksack", "koffer", "handtasche", "portemonnaie", "geldbeutel"],
  bone: ["tierfutter", "hundefutter", "katzenfutter", "futter", "trockenfutter", "nassfutter", "leckerli", "kauknochen", "knochen", "katzenstreu", "streu", "vogelfutter", "fischfutter", "hund", "katze", "haustier"],
  baby: ["baby", "windeln", "windel", "pampers", "babynahrung", "brei", "schoppen", "nuggi", "nuggis", "schnuller", "babyflasche", "babyfläschchen", "babybrei", "feuchttücher baby", "babypuder"],
  "gamepad-2": ["spiel", "spiele", "spielzeug", "spielsachen", "brettspiel", "brettspiele", "kartenspiel", "jass", "jasskarten", "puzzle", "puzzles", "lego", "konsole", "videospiel", "videospiele", "games", "game", "controller", "playstation", "nintendo", "würfel"],
};

// Wörter, die nichts über die Art des Artikels sagen (nach normalizeSearch verglichen).
const FILLER = new Set(
  [
    "bio", "nature", "natur", "light", "gross", "grosse", "grosser", "klein", "kleine", "kleiner", "mini", "maxi", "frisch",
    "frische", "extra", "fein", "feine", "original", "classic", "klassisch", "family", "familienpackung", "pack",
    "packung", "packungen", "stk", "stück", "stuck", "x", "g", "kg", "mg", "l", "dl", "cl", "ml", "liter", "gramm", "beutel",
    "flasche", "flaschen", "glas", "rolle", "rollen", "set", "neu", "alt", "offen", "angebrochen", "rest", "reste",
    "und", "mit", "ohne", "von", "vom", "aus", "fur", "für", "in", "im", "am", "an", "zum", "zur", "der", "die", "das",
    "den", "dem", "ein", "eine", "a", "la", "le", "les", "de", "du", "al", "à", "au", "et", "the", "of", "and",
    "rot", "rote", "roter", "weiss", "weisse", "grun", "grüne", "gelb", "gelbe", "schwarz", "blau",
    "laktosefrei", "glutenfrei", "vegan", "vegi", "vegetarisch", "zuckerfrei", "fettarm", "halbfett", "vollfett",
    "geräuchert", "gerauchert", "gekocht", "roh", "getrocknet", "gemahlen", "ganz", "ganze", "halb", "halbe",
    "tiefgekühlt", "tiefgekuhlt", "gefroren", "tk", "m-budget", "budget", "prix", "garantie", "premium", "fine", "food",
    "schweizer", "swiss", "suisse", "aargauer", "berner", "zürcher", "italienisch", "italienische", "französisch",
  ].map((w) => normalizeSearch(w)),
);

// Tabelle aufbauen: normalisiertes Schlagwort -> { id, exactOnly }
const EXACT = new Map(); // Wort -> id (inkl. "=..."-Wörter)
const AFFIX = []; // [{ word, id }] für Kompositum-Ende/-Anfang, längste zuerst
const PHRASES = []; // [{ phrase, id }] Mehrwort-Schlagwörter
for (const [id, words] of Object.entries(KEYWORDS)) {
  for (const raw of words) {
    const exactOnly = raw.startsWith("=");
    const kw = normalizeSearch(exactOnly ? raw.slice(1) : raw);
    if (!kw) continue;
    if (/[^a-z0-9]/.test(kw)) {
      // Mehrwort oder mit Bindestrich: als Wortfolge vergleichen
      const phrase = kw.split(/[^a-z0-9]+/).filter(Boolean).join(" ");
      if (phrase.includes(" ")) PHRASES.push({ phrase, id });
      else if (!EXACT.has(phrase)) EXACT.set(phrase, id);
      continue;
    }
    if (!EXACT.has(kw)) EXACT.set(kw, id);
    if (!exactOnly && kw.length >= 3) AFFIX.push({ word: kw, id });
  }
}
AFFIX.sort((a, b) => b.word.length - a.word.length);
PHRASES.sort((a, b) => b.phrase.length - a.phrase.length);

const SUFFIX_MIN = 3;
const PREFIX_MIN = 4;
const PLURAL_ENDINGS = ["en", "n", "e", "s", "er"];

function tokens(name) {
  return normalizeSearch(name)
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !/^\d/.test(t) && !FILLER.has(t));
}

// Bester Treffer für ein einzelnes Wort: { id, score } oder null
function matchToken(t) {
  if (EXACT.has(t)) return { id: EXACT.get(t), score: 3000 + t.length };
  // einfache Plural-/Flexionsformen: "Kerzen" -> "kerze"
  for (const end of PLURAL_ENDINGS) {
    if (t.length - end.length >= 4 && t.endsWith(end)) {
      const stem = t.slice(0, -end.length);
      if (EXACT.has(stem)) return { id: EXACT.get(stem), score: 2900 + stem.length };
    }
  }
  let best = null;
  for (const { word, id } of AFFIX) {
    if (word.length < SUFFIX_MIN || word.length >= t.length) continue;
    if (t.endsWith(word)) {
      best = { id, score: 2000 + word.length };
      break; // AFFIX ist nach Länge sortiert: der erste Treffer ist der längste
    }
  }
  if (best) return best;
  for (const { word, id } of AFFIX) {
    if (word.length < PREFIX_MIN || word.length >= t.length) continue;
    if (t.startsWith(word)) return { id, score: 1000 + word.length };
  }
  return null;
}

export function isKnownIcon(id) {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(ITEM_ICONS, id);
}

export function suggestIcon(name) {
  if (name == null) return null;
  const words = tokens(name);
  if (!words.length) return null;
  const all = normalizeSearch(name).split(/[^a-z0-9]+/).filter(Boolean);
  const joined = ` ${all.join(" ")} `;
  for (const { phrase, id } of PHRASES) {
    if (joined.includes(` ${phrase} `)) return isKnownIcon(id) ? id : null;
  }
  for (let i = words.length - 1; i >= 0; i--) {
    const hit = matchToken(words[i]);
    if (hit) return isKnownIcon(hit.id) ? hit.id : null;
  }
  return null;
}

// Was beim Speichern ins Feld `icon` kommt: nur ein selbst gewähltes, bekanntes Icon. Der Vorschlag
// aus dem Namen wird nie gespeichert, sondern immer neu abgeleitet (so wirken bessere Schlagwörter
// auch bei bestehenden Artikeln). → ID oder null (= kein Feld schreiben).
export function iconToStore(chosen) {
  return isKnownIcon(chosen) ? chosen : null;
}

export function iconForItem(item) {
  if (!item) return null;
  if (isKnownIcon(item.icon)) return item.icon;
  return suggestIcon(item.name);
}

const SEARCH_INDEX = Object.entries(ITEM_ICONS).map(([id, icon]) => ({
  id,
  words: [
    ...normalizeSearch(icon.label).split(/[^a-z0-9]+/),
    ...(KEYWORDS[id] || []).map((k) => normalizeSearch(k.replace(/^=/, ""))),
    id,
  ].filter(Boolean),
  group: normalizeSearch(icon.group),
}));

export function searchIcons(query) {
  const q = normalizeSearch(query);
  if (!q) return Object.keys(ITEM_ICONS);
  const result = [];
  const add = (id) => {
    if (!result.includes(id)) result.push(id);
  };
  const first = suggestIcon(query);
  if (first) add(first);
  for (const e of SEARCH_INDEX) if (e.words.some((w) => w.startsWith(q) || w.split(/[^a-z0-9]+/).some((p) => p.startsWith(q)))) add(e.id);
  for (const e of SEARCH_INDEX) if (e.words.some((w) => w.includes(q)) || e.group.includes(q)) add(e.id);
  return result;
}

// Für Tests: alle Schlagwort-IDs
export const KEYWORD_ICON_IDS = Object.keys(KEYWORDS);
