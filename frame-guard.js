// Schutz vor Clickjacking: Eine fremde Seite könnte die App unsichtbar in einen Rahmen (iframe) laden
// und Klicks darauf umleiten. Der eigentliche Schutz wäre der HTTP-Header "frame-ancestors" bzw.
// "X-Frame-Options" – GitHub Pages kann keine eigenen Header setzen, und im <meta>-CSP wirkt
// frame-ancestors nicht. Deshalb: läuft die Seite in einem Rahmen, blendet style.css alles aus
// (html.framed) und zeigt nur einen Hinweis. Klassisches Skript im <head>, läuft vor allem anderen.
// Ein Rahmen ohne Skripte (sandbox) verhindert auch die App selbst – dann bleibt nur "Lade…".
(function () {
  var framed;
  try {
    framed = window.top !== window.self;
  } catch (e) {
    framed = true; // fremder Ursprung oben → Zugriff verweigert = eingebettet
  }
  if (framed) document.documentElement.classList.add("framed");
})();
