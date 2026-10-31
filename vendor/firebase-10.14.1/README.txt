Firebase JS SDK 10.14.1 - selbst gehostete Kopie
=================================================

Stand: 2026-10-31
Version: firebase 10.14.1 (enthaelt @firebase/app 0.10.13)
Lizenz: Apache-2.0 (Firestore enthaelt zusaetzlich protobuf-Code unter BSD-3-Clause),
        siehe LICENSE (= LICENSE aus github.com/firebase/firebase-js-sdk, Tag firebase@10.14.1)

Herkunft
--------
https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js
https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js
https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js
https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check.js
Byte-identisch mit den gleichnamigen Dateien im npm-Paket
https://registry.npmjs.org/firebase/-/firebase-10.14.1.tgz (package/firebase-*.js).
LICENSE: https://raw.githubusercontent.com/firebase/firebase-js-sdk/firebase%4010.14.1/LICENSE

Anpassungen (sonst nichts geaendert, Zeilenenden unveraendert)
---------------------------------------------------------------
firebase-firestore.js, firebase-auth.js, firebase-app-check.js (je 1x):
  from"https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js"
  -> from"./firebase-app.js"
firebase-app.js (2 Stellen, nur interner Name fuer Versions-/Log-Kennung, wie im npm-ESM-Build):
  const name$q = "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
  -> const name$q = "@firebase/app";
  const logger = new Logger('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js');
  -> const logger = new Logger('@firebase/app');
Danach: keine Referenz auf gstatic.com mehr (grep -c gstatic * = 0).
Keine dynamischen import()-Aufrufe / Chunks. Die Kommentare "//# sourceMappingURL=*.js.map"
sind geblieben (.map-Dateien fehlen; nur DevTools fragt sie an, harmlos).
Nachgeladen werden zur Laufzeit nur Google-Backends/-Skripte (nicht Teil dieses Ordners):
  www.google.com/recaptcha/api.js bzw. enterprise.js (nur App Check / Telefon-Login),
  apis.google.com/js/api.js und https://<authDomain>/__/auth/iframe (nur Popup/Redirect-Login).

SHA-256 Original (gstatic = npm)
--------------------------------
19f05d67deadb1a1fba077c18611c3c9b2fdd5b4ebbd0a5e391498925ebae23e  firebase-app.js
39bd17897082983e072d4b99caa2ca2f2fbf9eac644bc613ff93cf59a9646b46  firebase-firestore.js
b51687c5729f9516e2e65cf3b4735a5a4d4bc707c7754221cc53cb9fd799c21a  firebase-auth.js
c08fd74c71a1715acfca30ed7c7bbce8aabcce7de3b342c31ddc71f9fef872ab  firebase-app-check.js

SHA-256 angepasst (diese Dateien)
---------------------------------
22db254fcad0baade283c0a93c931cf56d5bec29df6964a1b884bf5ac0da65bf  firebase-app.js
0366e74c38a107145013a4ae806c170f9309057ff5405f3cf908adcb0826d9bb  firebase-firestore.js
1c1b9ea1bd9ece91a2a4397c7334b1f0f94b65fca84529b7e6f9ba9a60c49b1f  firebase-auth.js
e71721756a8d3c3c5352c3cdd6e38957aec17037554ec4c63f52ce3460fe01b0  firebase-app-check.js

Update auf neue Version X.Y.Z (3 Schritte)
------------------------------------------
1. Die 4 Dateien von https://www.gstatic.com/firebasejs/X.Y.Z/ in einen neuen Ordner
   vendor/firebase-X.Y.Z/ laden, SHA-256 mit dem npm-Paket firebase@X.Y.Z vergleichen,
   LICENSE vom Tag firebase@X.Y.Z dazulegen.
2. Alle "https://www.gstatic.com/firebasejs/X.Y.Z/firebase-app.js" ersetzen (Imports durch
   "./firebase-app.js", die zwei Namen in firebase-app.js durch "@firebase/app"); mit
   grep pruefen, dass kein "gstatic" mehr vorkommt; diese README anpassen.
3. Pfade in app.js, index.html (modulepreload) und sw.js auf den neuen Ordner umstellen,
   Cache-Namen in sw.js erhoehen, testen, alten Ordner loeschen.
