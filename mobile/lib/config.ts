// Central app configuration. Values come from .env (EXPO_PUBLIC_* are bundled at build time).
// Firebase defaults match the web app's firebase-applet-config.json (same project/database),
// so the mobile app reads/writes the same portfolio data.
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'https://portfolio-tracker-hjvx.onrender.com';

export const FIREBASE_CONFIG = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? 'AIzaSyAEEYk3TibsfxvUXTxnCNrQbJF7YVH8f_s',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? 'liquid-muse-491818-a9.firebaseapp.com',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? 'liquid-muse-491818-a9',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? 'liquid-muse-491818-a9.firebasestorage.app',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '178094132106',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '1:178094132106:web:eae58a57935805c96bd673',
};

// Firestore database ID — the web app uses a non-default database, so we must too.
export const FIRESTORE_DATABASE_ID =
  process.env.EXPO_PUBLIC_FIRESTORE_DATABASE_ID ?? 'ai-studio-328b3c1b-fe51-473d-8aab-a5d08c941ff2';

export const API_TIMEOUT_MS = 60_000; // Render free tier may cold-start
