import { useState, useEffect, FormEvent } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  auth,
  signInWithGoogle,
  signInWithEmail,
  signUpWithEmail,
  resetPassword,
} from '@/lib/firebase';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isEmailLoginMode, setIsEmailLoginMode] = useState(true);
  const [isResetMode, setIsResetMode] = useState(false);
  const [emailAuthInput, setEmailAuthInput] = useState('');
  const [passwordAuthInput, setPasswordAuthInput] = useState('');
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    if (isSigningIn) return;
    setIsSigningIn(true);
    setAuthError('');
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error("Sign in failed:", error);
      setAuthError('Sign in with Google failed.');
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleEmailAuth = async (e: FormEvent) => {
    e.preventDefault();
    if (isSigningIn) return;
    if (!emailAuthInput || !passwordAuthInput) {
      setAuthError('Please enter both email and password.');
      return;
    }
    setIsSigningIn(true);
    setAuthError('');
    try {
      if (isEmailLoginMode) {
        await signInWithEmail(emailAuthInput, passwordAuthInput);
      } else {
        await signUpWithEmail(emailAuthInput, passwordAuthInput);
      }
    } catch (err: any) {
      console.error("Email auth error:", err);
      if (err.code === 'auth/operation-not-allowed') {
        setAuthError('Email/Password sign in is disabled. Enable it in Firebase Console.');
      } else if (err.code === 'auth/invalid-credential') {
        setAuthError('Incorrect email or password.');
      } else if (err.code === 'auth/email-already-in-use') {
        setAuthError('Account already exists. Try logging in.');
      } else if (err.code === 'auth/weak-password') {
        setAuthError('Password is too weak. Please use at least 6 characters.');
      } else {
        setAuthError(err.message || 'Authentication failed. Please try again.');
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (isSigningIn) return;
    if (!emailAuthInput) {
      setAuthError('Please enter your email address.');
      return;
    }
    setIsSigningIn(true);
    setAuthError('');
    try {
      await resetPassword(emailAuthInput);
      setAuthError('Password reset email sent. Please check your inbox.');
      setIsResetMode(false);
    } catch (err: any) {
      setAuthError('Failed to send reset email: ' + err.message);
    } finally {
      setIsSigningIn(false);
    }
  };

  return {
    user,
    setUser,
    isAuthReady,
    isSigningIn,
    isEmailLoginMode,
    setIsEmailLoginMode,
    isResetMode,
    setIsResetMode,
    emailAuthInput,
    setEmailAuthInput,
    passwordAuthInput,
    setPasswordAuthInput,
    authError,
    setAuthError,
    handleSignIn,
    handleEmailAuth,
    handleResetPassword,
  };
}
