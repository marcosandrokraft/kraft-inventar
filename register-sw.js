// Service Worker registrieren (eigene Datei statt Inline-Skript, damit die Content-Security-Policy
// keine Inline-Skripte erlauben muss).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
