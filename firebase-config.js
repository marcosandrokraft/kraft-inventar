// Trage hier deine eigenen Firebase-Projekt-Werte ein.
// Diese Werte sind NICHT geheim (Firebase-Web-Config ist öffentlich lesbar) -
// der eigentliche Schutz läuft über die Firestore Security Rules (siehe README.md).
export const firebaseConfig = {
  apiKey: "AIzaSyBFCZx3Xuc-xbzfwgpMzC6E8NEvCQircnY",
  authDomain: "kraft-inventar.firebaseapp.com",
  projectId: "kraft-inventar",
  storageBucket: "kraft-inventar.firebasestorage.app",
  messagingSenderId: "940067770881",
  appId: "1:940067770881:web:8c8a86bd3b83c365f12600",
};

// Firestore "Database ID" – steht in der Firebase-Konsole unter Firestore Database oben im
// Datenbank-Auswahlfeld. Nur ändern, wenn dort NICHT "(default)" steht.
export const firestoreDatabaseId = "(default)";
