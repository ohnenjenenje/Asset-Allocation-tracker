import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  // @ts-expect-error getReactNativePersistence is exposed by firebase/auth on RN
  getReactNativePersistence,
  initializeAuth,
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  EmailAuthProvider,
  GoogleAuthProvider,
  linkWithCredential,
  unlink,
  signInWithCredential,
  signOut,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FIREBASE_CONFIG, FIRESTORE_DATABASE_ID } from './config';

const app = !getApps().length ? initializeApp(FIREBASE_CONFIG) : getApp();

let authInstance: any;
try {
  authInstance = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch {
  // Already initialized (fast refresh)
  authInstance = getAuth(app);
}
export const auth = authInstance;
export const db = getFirestore(app, FIRESTORE_DATABASE_ID);

export const signUpWithEmail = (email: string, password: string) =>
  createUserWithEmailAndPassword(auth, email, password).then((r) => r.user);

export const signInWithEmail = (email: string, password: string) =>
  signInWithEmailAndPassword(auth, email, password).then((r) => r.user);

export const resetPassword = (email: string) => sendPasswordResetEmail(auth, email);

/** Sign-in using a Google idToken obtained via the native Google Sign-In SDK. */
export const signInWithGoogleIdToken = (idToken: string) => {
  const credential = GoogleAuthProvider.credential(idToken);
  return signInWithCredential(auth, credential).then((r) => r.user);
};

/** Linked providerIds for the current user (e.g. ['google.com', 'password']). */
export const getLinkedProviders = (): string[] =>
  auth.currentUser?.providerData.map((p: any) => p.providerId) ?? [];

/**
 * Link an email/password credential to the current (e.g. Google) session so the
 * same Firebase account can sign in with either method on mobile or web.
 */
export const linkEmailPassword = (email: string, password: string) => {
  const currentUser = auth.currentUser;
  if (!currentUser) return Promise.reject(new Error('No user is currently signed in.'));
  const credential = EmailAuthProvider.credential(email, password);
  return linkWithCredential(currentUser, credential).then((r) => r.user);
};

/** Link a Google ID token to the current (e.g. email/password) session. */
export const linkGoogleIdToken = (idToken: string) => {
  const currentUser = auth.currentUser;
  if (!currentUser) return Promise.reject(new Error('No user is currently signed in.'));
  const credential = GoogleAuthProvider.credential(idToken);
  return linkWithCredential(currentUser, credential).then((r) => r.user);
};

/**
 * Unlink a provider ('password' or 'google.com'). Refuses to unlink the last
 * remaining method so the account never becomes inaccessible.
 */
export const unlinkProvider = (providerId: string) => {
  const currentUser = auth.currentUser;
  if (!currentUser) return Promise.reject(new Error('No user is currently signed in.'));
  if ((currentUser.providerData?.length ?? 0) <= 1) {
    return Promise.reject(
      new Error('Cannot unlink the only sign-in method. Link another method first.'),
    );
  }
  return unlink(currentUser, providerId);
};

export const logOut = () => signOut(auth);
