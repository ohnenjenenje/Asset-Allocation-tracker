import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  // @ts-expect-error getReactNativePersistence is exposed by firebase/auth on RN
  getReactNativePersistence,
  initializeAuth,
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  GoogleAuthProvider,
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

/** Sign-in using a Google idToken obtained via expo-auth-session. */
export const signInWithGoogleIdToken = (idToken: string) => {
  const credential = GoogleAuthProvider.credential(idToken);
  return signInWithCredential(auth, credential).then((r) => r.user);
};

export const logOut = () => signOut(auth);
