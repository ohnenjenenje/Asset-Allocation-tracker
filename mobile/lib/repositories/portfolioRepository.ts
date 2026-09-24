// DIP: abstract portfolio persistence; SRP: single place for Firestore+Mongo sync.
// Ported from web — `/api/sync` calls now go through apiFetch (absolute backend URL).

import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { apiFetch } from '@/lib/api';
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
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, removeUndefined(v)]),
  );
};

export const firestoreMongoRepository: PortfolioRepository = {
  async load(user: User) {
    // 1. Try MongoDB primary
    try {
      const res = await apiFetch(`/api/sync?uid=${user.uid}`);
      const json = await res.json();
      if (json.success && json.data) return json.data;
    } catch {}
    // 2. Fallback to Firestore
    const userRef = doc(db, 'users', user.uid);
    const docSnap = await getDoc(userRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      // backfill Mongo (fire-and-forget)
      apiFetch('/api/sync', {
        method: 'POST',
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
      // Mongo backup (fire-and-forget)
      apiFetch('/api/sync', {
        method: 'POST',
        body: JSON.stringify({ uid: user.uid, email: user.email, displayName: user.displayName, data: updates }),
      }).catch(() => {});
    } catch (e) {
      console.error('Firestore write error:', e);
      throw e;
    }
  },
};
