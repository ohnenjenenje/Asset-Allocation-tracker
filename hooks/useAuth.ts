import { useState, useEffect, FormEvent } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  auth,
  signInWithGoogle,
  signInWithEmail,
  signUpWithEmail,
  resetPassword,
  linkEmailPassword,
  linkGoogleAccount,
  unlinkProvider,
} from '@/lib/firebase';

export function mapLinkError(err: any): string {
  switch (err?.code) {
    case 'auth/provider-already-linked':
      return 'This sign-in method is already linked to your account.';
    case 'auth/credential-already-in-use':
    case 'auth/email-already-in-use':
      return 'These credentials are already used by another account. Sign in with that method first, then link from Settings.';
    case 'auth/requires-recent-login':
      return 'For security, please sign out and sign back in, then try linking again.';
    case 'auth/invalid-credential':
      return 'Invalid credentials. Please check the email and password.';
    case 'auth/weak-password':
      return 'Password is too weak. Please use at least 6 characters.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Popup closed before linking completed.';
    default:
      return err?.message || 'Linking failed. Please try again.';
  }
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isEmailLoginMode, setIsEmailLoginMode] = useState(true);
  const [isResetMode, setIsResetMode] = useState(false);
  const [emailAuthInput, setEmailAuthInput] = useState('');
  const [passwordAuthInput, setPasswordAuthInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [isLinking, setIsLinking] = useState(false);
  const [linkMessage, setLinkMessage] = useState('');

  const linkedProviders: string[] = user?.providerData.map(p => p.providerId) ?? [];
  const hasPasswordLinked = linkedProviders.includes('password');
  const hasGoogleLinked = linkedProviders.includes('google.com');

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
    } catch (error: any) {
      console.error("Sign in failed:", error);
      if (error?.code === 'auth/account-exists-with-different-credential') {
        setAuthError('This email already uses email/password sign-in. Log in with email/password first, then link Google in Settings → Account.');
      } else {
        setAuthError('Sign in with Google failed.');
      }
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
        setAuthError('Incorrect email or password. If you signed up with Google, sign in with Google first, then link email/password in Settings → Account.');
      } else if (err.code === 'auth/email-already-in-use') {
        setAuthError('Account already exists. Try logging in.');
      } else if (err.code === 'auth/account-exists-with-different-credential') {
        setAuthError('This email already uses a different sign-in method (e.g. Google). Sign in with that method first, then link email/password in Settings → Account.');
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

  /** Link email/password to the current (e.g. Google) session. */
  const handleLinkEmailPassword = async (email: string, password: string) => {
    if (isLinking) return false;
    if (!email || !password) {
      setLinkMessage('Please enter both email and password.');
      return false;
    }
    setIsLinking(true);
    setLinkMessage('');
    try {
      await linkEmailPassword(email, password);
      try { await auth.currentUser?.reload(); } catch { /* ignore */ }
      // onAuthStateChanged fires, but force-refresh user object for instant UI
      if (auth.currentUser) setUser({ ...auth.currentUser } as User);
      setLinkMessage('Email/password linked. You can now sign in with either method.');
      return true;
    } catch (err: any) {
      setLinkMessage(mapLinkError(err));
      return false;
    } finally {
      setIsLinking(false);
    }
  };

  /** Link Google to the current (e.g. email/password) session via popup. */
  const handleLinkGoogle = async () => {
    if (isLinking) return false;
    setIsLinking(true);
    setLinkMessage('');
    try {
      await linkGoogleAccount();
      try { await auth.currentUser?.reload(); } catch { /* ignore */ }
      if (auth.currentUser) setUser({ ...auth.currentUser } as User);
      setLinkMessage('Google account linked. You can now sign in with either method.');
      return true;
    } catch (err: any) {
      setLinkMessage(mapLinkError(err));
      return false;
    } finally {
      setIsLinking(false);
    }
  };

  const handleUnlinkProvider = async (providerId: string) => {
    if (isLinking) return false;
    if (linkedProviders.length <= 1) {
      setLinkMessage('Cannot unlink the only sign-in method. Link another method first.');
      return false;
    }
    setIsLinking(true);
    setLinkMessage('');
    try {
      await unlinkProvider(providerId);
      try { await auth.currentUser?.reload(); } catch { /* ignore */ }
      if (auth.currentUser) setUser({ ...auth.currentUser } as User);
      setLinkMessage('Sign-in method unlinked.');
      return true;
    } catch (err: any) {
      setLinkMessage(mapLinkError(err));
      return false;
    } finally {
      setIsLinking(false);
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
    // account linking
    linkedProviders,
    hasPasswordLinked,
    hasGoogleLinked,
    isLinking,
    linkMessage,
    setLinkMessage,
    handleLinkEmailPassword,
    handleLinkGoogle,
    handleUnlinkProvider,
  };
}
