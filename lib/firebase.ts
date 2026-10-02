import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, EmailAuthProvider, signInWithPopup, linkWithCredential, linkWithPopup, unlink, fetchSignInMethodsForEmail, reauthenticateWithCredential, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error("Error signing in with Google", error);
    throw error;
  }
};

export const signUpWithEmail = async (email: string, password: string) => {
  try {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    return result.user;
  } catch (error) {
    console.error("Error signing up with Email", error);
    throw error;
  }
};

export const signInWithEmail = async (email: string, password: string) => {
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    return result.user;
  } catch (error) {
    console.error("Error signing in with Email", error);
    throw error;
  }
};

export const resetPassword = async (email: string) => {
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (error) {
    console.error("Error sending password reset email", error);
    throw error;
  }
};

export const logOut = async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Error signing out", error);
    throw error;
  }
};

/** Returns the list of linked providerIds for the current user (e.g. ['google.com', 'password']). */
export const getLinkedProviders = (): string[] => {
  return auth.currentUser?.providerData.map(p => p.providerId) ?? [];
};

export const hasPasswordProvider = () => getLinkedProviders().includes('password');
export const hasGoogleProvider = () => getLinkedProviders().includes('google.com');

/**
 * Link an email/password credential to the currently signed-in (e.g. Google) user.
 * This lets a Google user later sign in with email+password on web or mobile.
 */
export const linkEmailPassword = async (email: string, password: string) => {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('No user is currently signed in.');
  const credential = EmailAuthProvider.credential(email, password);
  try {
    const result = await linkWithCredential(currentUser, credential);
    return result.user;
  } catch (error) {
    console.error("Error linking email/password", error);
    throw error;
  }
};

/**
 * Link a Google account to the currently signed-in (e.g. email/password) user
 * via a popup. After linking, either method signs into the same account.
 */
export const linkGoogleAccount = async () => {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('No user is currently signed in.');
  try {
    const result = await linkWithPopup(currentUser, googleProvider);
    return result.user;
  } catch (error) {
    console.error("Error linking Google account", error);
    throw error;
  }
};

/**
 * Unlink a provider ('password' or 'google.com'). Refuses to unlink the last
 * remaining sign-in method so the account never becomes inaccessible.
 */
export const unlinkProvider = async (providerId: string) => {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('No user is currently signed in.');
  if ((currentUser.providerData?.length ?? 0) <= 1) {
    throw new Error('Cannot unlink the only sign-in method. Link another method first.');
  }
  try {
    const result = await unlink(currentUser, providerId);
    return result;
  } catch (error) {
    console.error("Error unlinking provider", error);
    throw error;
  }
};

/** Which sign-in methods exist for an email (used to hint "try Google instead"). */
export const getSignInMethods = async (email: string) => {
  return fetchSignInMethodsForEmail(auth, email);
};

/** Re-authenticate before sensitive operations when Firebase asks for a recent login. */
export const reauthenticateWithPassword = async (password: string) => {
  const currentUser = auth.currentUser;
  if (!currentUser?.email) throw new Error('No user is currently signed in.');
  const credential = EmailAuthProvider.credential(currentUser.email, password);
  return reauthenticateWithCredential(currentUser, credential).then(r => r.user);
};

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo?: any[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
