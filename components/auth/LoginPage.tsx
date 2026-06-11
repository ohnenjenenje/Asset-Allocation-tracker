import React from 'react';
import { PieChart as PieChartIcon } from 'lucide-react';

interface LoginPageProps {
  isResetMode: boolean;
  setIsResetMode: (val: boolean) => void;
  isEmailLoginMode: boolean;
  setIsEmailLoginMode: (val: boolean) => void;
  emailAuthInput: string;
  setEmailAuthInput: (val: string) => void;
  passwordAuthInput: string;
  setPasswordAuthInput: (val: string) => void;
  authError: string;
  setAuthError: (val: string) => void;
  isSigningIn: boolean;
  handleSignIn: () => void;
  handleEmailAuth: (e: React.FormEvent) => void;
  handleResetPassword: (e: React.FormEvent) => void;
}

export default function LoginPage({
  isResetMode,
  setIsResetMode,
  isEmailLoginMode,
  setIsEmailLoginMode,
  emailAuthInput,
  setEmailAuthInput,
  passwordAuthInput,
  setPasswordAuthInput,
  authError,
  setAuthError,
  isSigningIn,
  handleSignIn,
  handleEmailAuth,
  handleResetPassword,
}: LoginPageProps) {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-zinc-900 p-8 rounded-3xl shadow-xl max-w-md w-full text-center border border-zinc-200 dark:border-zinc-800">
        <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <PieChartIcon className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">Asset Allocation Tracker</h1>
        <p className="text-zinc-500 dark:text-zinc-400 mb-6">Sign in to manage your assets, analyze your allocation, and get AI-powered insights.</p>
        
        <form onSubmit={isResetMode ? handleResetPassword : handleEmailAuth} className="space-y-4 mb-6">
          <div className="space-y-1 text-left">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 ml-1">Email</label>
            <input 
              type="email" 
              value={emailAuthInput}
              onChange={(e) => setEmailAuthInput(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all text-zinc-900 dark:text-zinc-100"
            />
          </div>
          
          {!isResetMode && (
            <div className="space-y-1 text-left">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 ml-1">Password</label>
              <input 
                type="password" 
                value={passwordAuthInput}
                onChange={(e) => setPasswordAuthInput(e.target.value)}
                placeholder="••••••••"
                required={!isResetMode}
                minLength={6}
                className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all text-zinc-900 dark:text-zinc-100"
              />
            </div>
          )}

          {authError && (
            <div className={`text-sm px-4 py-3 rounded-lg text-left ${authError.includes('sent') ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30' : 'bg-red-50 text-red-600 dark:bg-red-900/30'}`}>
              {authError}
            </div>
          )}

          <button
            type="submit"
            disabled={isSigningIn}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-4 py-3 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            {isSigningIn ? 'Processing...' : (isResetMode ? 'Send Reset Link' : (isEmailLoginMode ? 'Sign In with Email' : 'Create Account'))}
          </button>
        </form>

        {isEmailLoginMode && !isResetMode && (
          <div className="text-right mb-6 -mt-4">
            <button 
              type="button"
              onClick={() => { setIsResetMode(true); setAuthError(''); }}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              Forgot password?
            </button>
          </div>
        )}
        {isResetMode && (
          <div className="text-center mb-6 -mt-4">
            <button 
              type="button"
              onClick={() => { setIsResetMode(false); setAuthError(''); }}
              className="text-sm text-zinc-500 hover:underline"
            >
              Back to login
            </button>
          </div>
        )}

        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800"></div>
          <span className="text-zinc-400 text-sm font-medium">OR</span>
          <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800"></div>
        </div>

        <button
          onClick={handleSignIn}
          disabled={isSigningIn}
          type="button"
          className="w-full flex items-center justify-center gap-3 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 px-6 py-3 rounded-xl font-medium hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-4"
        >
          {isSigningIn ? (
            <div className="w-5 h-5 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
          )}
          Continue with Google
        </button>

        <p className="text-zinc-500 dark:text-zinc-400 text-sm">
          {isEmailLoginMode ? "Don't have an account? " : "Already have an account? "}
          <button 
            type="button"
            className="text-blue-600 dark:text-blue-400 font-medium hover:underline focus:outline-none"
            onClick={() => {
              setIsEmailLoginMode(!isEmailLoginMode);
              setAuthError('');
            }}
          >
            {isEmailLoginMode ? "Sign up" : "Log in"}
          </button>
        </p>
      </div>
    </div>
  );
}
