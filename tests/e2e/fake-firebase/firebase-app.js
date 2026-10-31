// Ersatz für https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js (nur tests/e2e/).
export function initializeApp(options = {}, name = "[DEFAULT]") {
  return { name, options, automaticDataCollectionEnabled: false, __fake: true };
}
export function getApp() {
  return { name: "[DEFAULT]", options: {}, __fake: true };
}
export const SDK_VERSION = "10.14.1-fake";
