import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  auth,
  signInWithEmail,
  signUpWithEmail,
  resetPassword,
  signInWithGoogleIdToken,
  linkEmailPassword,
  linkGoogleIdToken,
  unlinkProvider,
  logOut,
} from '@/lib/firebase';
import { signOutFromGoogle } from '@/lib/googleSignIn';

type AuthContextValue = {
  user: User | null;
  isAuthReady: boolean;
  isSigningIn: boolean;
  authError: string;
  setAuthError: (e: string) => void;
  handleEmailAuth: (email: string, password: string, isLogin: boolean) => Promise<void>;
  handleResetPassword: (email: string) => Promise<void>;
  handleGoogleIdToken: (idToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  // account linking
  linkedProviders: string[];
  hasPasswordLinked: boolean;
  hasGoogleLinked: boolean;
  isLinking: boolean;
  linkMessage: string;
  setLinkMessage: (m: string) => void;
  handleLinkEmailPassword: (email: string, password: string) => Promise<boolean>;
  handleLinkGoogleIdToken: (idToken: string) => Promise<boolean>;
  handleUnlinkProvider: (providerId: string) => Promise<boolean>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState('');
  const [isLinking, setIsLinking] = useState(false);
  const [linkMessage, setLinkMessage] = useState('');

  const linkedProviders: string[] = user?.providerData.map((p) => p.providerId) ?? [];
  const hasPasswordLinked = linkedProviders.includes('password');
  const hasGoogleLinked = linkedProviders.includes('google.com');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const mapAuthError = (err: any) => {
    switch (err?.code) {
      case 'auth/operation-not-allowed':
        return 'Email/Password sign in is disabled. Enable it in Firebase Console.';
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Incorrect email or password. If you signed up with Google, sign in with Google first, then link email/password in More → Account.';
      case 'auth/account-exists-with-different-credential':
        return 'This email already uses a different sign-in method. Sign in with that method first, then link in More → Account.';
      case 'auth/email-already-in-use':
        return 'Account already exists. Try logging in.';
      case 'auth/weak-password':
        return 'Password is too weak. Please use at least 6 characters.';
      default:
        return err?.message || 'Authentication failed. Please try again.';
    }
  };

  const mapLinkError = (err: any) => {
    switch (err?.code) {
      case 'auth/provider-already-linked':
        return 'This sign-in method is already linked to your account.';
      case 'auth/credential-already-in-use':
      case 'auth/email-already-in-use':
        return 'These credentials belong to another account. Sign in with that method first, then link from More → Account.';
      case 'auth/requires-recent-login':
        return 'For security, please sign out and sign back in, then try linking again.';
      case 'auth/invalid-credential':
        return 'Invalid credentials. Please check the email and password.';
      case 'auth/weak-password':
        return 'Password is too weak. Please use at least 6 characters.';
      default:
        return err?.message || 'Linking failed. Please try again.';
    }
  };

  const run = async (fn: () => Promise<any>) => {
    if (isSigningIn) return;
    setIsSigningIn(true);
    setAuthError('');
    try {
      await fn();
    } catch (err: any) {
      setAuthError(mapAuthError(err));
    } finally {
      setIsSigningIn(false);
    }
  };

  /** Refresh local user so linked providers show instantly (link/unlink doesn't always fire onAuthStateChanged). */
  const refreshUser = async () => {
    try {
      await auth.currentUser?.reload();
    } catch {
      // ignore — local providerData is still updated by link/unlink
    }
    if (auth.currentUser) setUser({ ...auth.currentUser } as User);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthReady,
        isSigningIn,
        authError,
        setAuthError,
        handleEmailAuth: (email, password, isLogin) =>
          run(() => (isLogin ? signInWithEmail(email, password) : signUpWithEmail(email, password))),
        handleResetPassword: (email) =>
          run(async () => {
            await resetPassword(email);
            setAuthError('Password reset email sent. Please check your inbox.');
          }),
        handleGoogleIdToken: (idToken) => run(() => signInWithGoogleIdToken(idToken)),
        signOut: async () => {
          await signOutFromGoogle();
          await logOut();
        },
        linkedProviders,
        hasPasswordLinked,
        hasGoogleLinked,
        isLinking,
        linkMessage,
        setLinkMessage,
        handleLinkEmailPassword: async (email, password) => {
          if (isLinking) return false;
          if (!email || !password) {
            setLinkMessage('Please enter both email and password.');
            return false;
          }
          setIsLinking(true);
          setLinkMessage('');
          try {
            await linkEmailPassword(email, password);
            await refreshUser();
            setLinkMessage('Email/password linked. You can now sign in with either method.');
            return true;
          } catch (err: any) {
            setLinkMessage(mapLinkError(err));
            return false;
          } finally {
            setIsLinking(false);
          }
        },
        handleLinkGoogleIdToken: async (idToken) => {
          if (isLinking) return false;
          setIsLinking(true);
          setLinkMessage('');
          try {
            await linkGoogleIdToken(idToken);
            await refreshUser();
            setLinkMessage('Google account linked. You can now sign in with either method.');
            return true;
          } catch (err: any) {
            setLinkMessage(mapLinkError(err));
            return false;
          } finally {
            setIsLinking(false);
          }
        },
        handleUnlinkProvider: async (providerId) => {
          if (isLinking) return false;
          if (linkedProviders.length <= 1) {
            setLinkMessage('Cannot unlink the only sign-in method. Link another method first.');
            return false;
          }
          setIsLinking(true);
          setLinkMessage('');
          try {
            await unlinkProvider(providerId);
            await refreshUser();
            setLinkMessage('Sign-in method unlinked.');
            return true;
          } catch (err: any) {
            setLinkMessage(mapLinkError(err));
            return false;
          } finally {
            setIsLinking(false);
          }
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
