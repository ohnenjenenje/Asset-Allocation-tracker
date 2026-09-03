// DIP: abstract portfolio persistence; SRP: single place for Firestore+Mongo sync

import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '@/lib/firebase';
import { User } from 'firebase/auth';

export interface PortfolioRepository {
  load(user: User): Promise<any | null>;
  save(user: User, updates: any, localState: any): Promise<void>;
}

const removeUndefined = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(removeUndefined);
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => [k, removeUndefined(v)]),
  );
};

export const firestoreMongoRepository: PortfolioRepository = {
  async load(user: User) {
    // 1. Try MongoDB primary
    try {
      const res = await fetch(`/api/sync?uid=${user.uid}`);
      const json = await res.json();
      if (json.success && json.data) return json.data;
    } catch {}
    // 2. Fallback to Firestore
    const userRef = doc(db, 'users', user.uid);
    const docSnap = await getDoc(userRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      // backfill Mongo
      fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid, email: user.email, displayName: user.displayName, data }),
      }).catch(() => {});
      return data;
    }
    return null;
  },

  async save(user: User, updates: any, localState: any) {
    const cleanUpdates = removeUndefined(updates);
    try {
      const userRef = doc(db, 'users', user.uid);
      const docSnap = await getDoc(userRef);
      const firestoreUpdates: any = {};
      if (cleanUpdates.assets !== undefined) firestoreUpdates.assets = cleanUpdates.assets;
      if (cleanUpdates.fundHoldings !== undefined) firestoreUpdates.fundHoldings = cleanUpdates.fundHoldings;
      if (cleanUpdates.settings) {
        for (const [k, v] of Object.entries(cleanUpdates.settings)) firestoreUpdates[`settings.${k}`] = v;
      }
      for (const [k, v] of Object.entries(cleanUpdates)) if (k.includes('.')) firestoreUpdates[k] = v;
      if (Object.keys(firestoreUpdates).length > 0) {
        if (docSnap.exists()) await updateDoc(userRef, firestoreUpdates);
        else {
          const initialData = {
            uid: user.uid,
            assets: cleanUpdates.assets || localState.assets,
            fundHoldings: cleanUpdates.fundHoldings || localState.fundHoldings,
            settings: {
              idealAllocation: localState.idealAllocation,
              searchSource: localState.searchSource,
              openRouterKey: localState.openRouterKey,
              aiProvider: localState.aiProvider,
              googleModel: localState.googleModel,
              openrouterModel: localState.selectedModel,
              ...(cleanUpdates.settings || {}),
            },
          };
          await setDoc(userRef, initialData);
        }
      }
      // Mongo backup (fire-and-forget, DIP: caller not coupled to fetch details)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid, email: user.email, displayName: user.displayName, data: updates }),
        signal: controller.signal,
      })
        .then((res) => {
          clearTimeout(timeoutId);
          if (!res.ok && res.status !== 503) console.warn('MongoDB backup sync returned status:', res.status);
        })
        .catch((err) => {
          clearTimeout(timeoutId);
          if (err.name !== 'AbortError') console.debug('Optional MongoDB backup sync skipped:', err.message);
        });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${user?.uid}`);
    }
  },
};
