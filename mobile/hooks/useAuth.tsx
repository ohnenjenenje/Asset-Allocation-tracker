import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  auth,
  signInWithEmail,
  signUpWithEmail,
  resetPassword,
  signInWithGoogleIdToken,
  logOut,
} from '@/lib/firebase';

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
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState('');

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
        return 'Incorrect email or password.';
      case 'auth/email-already-in-use':
        return 'Account already exists. Try logging in.';
      case 'auth/weak-password':
        return 'Password is too weak. Please use at least 6 characters.';
      default:
        return err?.message || 'Authentication failed. Please try again.';
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
        signOut: () => logOut(),
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
