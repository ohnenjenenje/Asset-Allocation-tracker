import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

type GoogleSignInModule = typeof import('@react-native-google-signin/google-signin');

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '';
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

let cached: GoogleSignInModule | null = null;

/** Google sign-in needs the native module, so it cannot run in Expo Go. */
export const isGoogleSignInSupported = () =>
  Boolean(WEB_CLIENT_ID) && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

export type GoogleSignInResult =
  | { type: 'success'; idToken: string }
  | { type: 'cancelled' }
  | { type: 'unavailable' }
  | { type: 'error'; message: string };

/** Loads and configures the native module on first use so Expo Go still renders. */
const loadGoogleSignIn = async (): Promise<GoogleSignInModule> => {
  if (!cached) {
    const mod = await import('@react-native-google-signin/google-signin');
    mod.GoogleSignin.configure({
      webClientId: WEB_CLIENT_ID,
      ...(Platform.OS === 'ios' && IOS_CLIENT_ID ? { iosClientId: IOS_CLIENT_ID } : null),
      offlineAccess: false,
    });
    cached = mod;
  }
  return cached;
};

/** Returns a Google ID token to be exchanged for a Firebase session. */
export async function requestGoogleIdToken(): Promise<GoogleSignInResult> {
  let googleSignIn: GoogleSignInModule;
  try {
    googleSignIn = await loadGoogleSignIn();
  } catch {
    return { type: 'unavailable' };
  }

  const { GoogleSignin, isSuccessResponse, isCancelledResponse, statusCodes } = googleSignIn;
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (isSuccessResponse(response)) {
      const idToken = response.data?.idToken;
      if (idToken) return { type: 'success', idToken };
      return { type: 'error', message: 'Google sign-in returned no ID token.' };
    }
    if (isCancelledResponse(response)) return { type: 'cancelled' };
    return { type: 'error', message: 'Google sign-in failed. Please try again.' };
  } catch (err: any) {
    if (err?.code === statusCodes.SIGN_IN_CANCELLED) return { type: 'cancelled' };
    if (err?.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      return { type: 'error', message: 'Google Play Services is not available on this device.' };
    }
    return { type: 'error', message: err?.message || 'Google sign-in failed. Please try again.' };
  }
}

export async function signOutFromGoogle() {
  try {
    const { GoogleSignin } = await loadGoogleSignIn();
    await GoogleSignin.signOut();
  } catch {
    // Native module unavailable (Expo Go) — nothing to sign out of.
  }
}
