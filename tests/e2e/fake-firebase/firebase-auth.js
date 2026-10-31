// Ersatz für vendor/firebase-10.14.1/firebase-auth.js (nur tests/e2e/).
// Standard: angemeldet als Platzhalter-Benutzer. window.__fakeSignedOut = true → abgemeldet.
const user = window.__fakeSignedOut
  ? null
  : { uid: "tester-uid", email: (window.__fakeUser && window.__fakeUser.email) || "tester@example.com", emailVerified: true };

const auth = { currentUser: user, __fake: true };
window.__authCalls = [];

export function getAuth() { return auth; }

export function onAuthStateChanged(a, cb) {
  setTimeout(() => cb(auth.currentUser), 0);
  return () => {};
}

export function isSignInWithEmailLink() { return false; }

export async function sendSignInLinkToEmail(a, email, settings) {
  window.__authCalls.push({ fn: "sendSignInLinkToEmail", email, settings });
}

export async function signInWithEmailLink(a, email) {
  window.__authCalls.push({ fn: "signInWithEmailLink", email });
  return { user: auth.currentUser };
}

export async function signOut() {
  window.__authCalls.push({ fn: "signOut" });
  auth.currentUser = null;
}
