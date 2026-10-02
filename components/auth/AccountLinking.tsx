'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';

export default function AccountLinking() {
  const {
    user,
    hasPasswordLinked,
    hasGoogleLinked,
    linkedProviders,
    isLinking,
    linkMessage,
    setLinkMessage,
    handleLinkEmailPassword,
    handleLinkGoogle,
    handleUnlinkProvider,
  } = useAuth();

  const [linkEmail, setLinkEmail] = useState('');
  const [linkPassword, setLinkPassword] = useState('');
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  useEffect(() => {
    if (user?.email) setLinkEmail((prev) => prev || user.email || '');
  }, [user?.email]);

  if (!user) return null;

  const canUnlink = linkedProviders.length > 1;

  const submitPasswordLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await handleLinkEmailPassword(linkEmail.trim(), linkPassword);
    if (ok) {
      setLinkPassword('');
      setShowPasswordForm(false);
    }
  };

  return (
    <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800">
      <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-1">Account — Sign-in methods</h3>
      <p className="text-xs text-zinc-500 mb-3">
        Signed in as <span className="font-medium text-zinc-700 dark:text-zinc-300">{user.email}</span>.
        Link both methods so you can sign in with Google or email/password on web and mobile.
      </p>

      <div className="flex flex-col gap-2 mb-3">
        <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2 text-sm">
            <span className={`w-2 h-2 rounded-full ${hasGoogleLinked ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600'}`} />
            <span className="font-medium text-zinc-800 dark:text-zinc-200">Google</span>
            <span className="text-xs text-zinc-500">{hasGoogleLinked ? 'Linked' : 'Not linked'}</span>
          </div>
          {hasGoogleLinked ? (
            <button
              type="button"
              disabled={isLinking || !canUnlink}
              title={canUnlink ? 'Unlink Google' : 'Link another method first'}
              onClick={() => handleUnlinkProvider('google.com')}
              className="text-xs font-medium text-red-500 hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Unlink
            </button>
          ) : (
            <button
              type="button"
              disabled={isLinking}
              onClick={handleLinkGoogle}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
            >
              {isLinking ? 'Linking…' : 'Link Google'}
            </button>
          )}
        </div>

        <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2 text-sm">
            <span className={`w-2 h-2 rounded-full ${hasPasswordLinked ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600'}`} />
            <span className="font-medium text-zinc-800 dark:text-zinc-200">Email / Password</span>
            <span className="text-xs text-zinc-500">{hasPasswordLinked ? 'Linked' : 'Not linked'}</span>
          </div>
          {hasPasswordLinked ? (
            <button
              type="button"
              disabled={isLinking || !canUnlink}
              title={canUnlink ? 'Unlink email/password' : 'Link another method first'}
              onClick={() => handleUnlinkProvider('password')}
              className="text-xs font-medium text-red-500 hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Unlink
            </button>
          ) : (
            <button
              type="button"
              disabled={isLinking}
              onClick={() => { setShowPasswordForm((v) => !v); setLinkMessage(''); }}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
            >
              {showPasswordForm ? 'Hide' : 'Set password'}
            </button>
          )}
        </div>
      </div>

      {!hasPasswordLinked && showPasswordForm && (
        <form onSubmit={submitPasswordLink} className="space-y-2 mb-3">
          <input
            type="email"
            value={linkEmail}
            onChange={(e) => setLinkEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className="w-full px-4 py-2.5 text-sm border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <input
            type="password"
            value={linkPassword}
            onChange={(e) => setLinkPassword(e.target.value)}
            placeholder="Choose a password (min 6 chars)"
            required
            minLength={6}
            className="w-full px-4 py-2.5 text-sm border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <button
            type="submit"
            disabled={isLinking}
            className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
          >
            {isLinking ? 'Linking…' : 'Link email/password'}
          </button>
        </form>
      )}

      {linkMessage && (
        <p className={`text-xs px-3 py-2 rounded-lg ${linkMessage.includes('now sign in') || linkMessage.includes('unlinked') ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'}`}>
          {linkMessage}
        </p>
      )}
    </div>
  );
}
