// ============================================================
// Your Firebase project config (Firebase console -> Project settings
// -> General -> Your apps -> Web app). firebase-init.js imports the
// SDK itself, so this file only needs to export the plain config object.
//
// IMPORTANT: this is a NEW app with its own data model (auction items and
// bids, not hostel listings or dating profiles) — do not point it at the
// existing hostelhive or love-wonders Firebase projects, or the apps'
// users/collections will mix. Create a separate Firebase project (e.g.
// "veusbid") and paste its config below before deploying.
// ============================================================
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "veusbid.firebaseapp.com",
  projectId: "veusbid",
  storageBucket: "veusbid.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
  measurementId: "YOUR_MEASUREMENT_ID"
};
