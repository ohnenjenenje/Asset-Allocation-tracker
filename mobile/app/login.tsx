import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PieChart } from 'lucide-react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { useAuth } from '@/hooks/useAuth';

WebBrowser.maybeCompleteAuthSession();

// Configure these in Google Cloud / Firebase console for your app (optional).
const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '';

export default function LoginScreen() {
  const { isSigningIn, authError, setAuthError, handleEmailAuth, handleResetPassword, handleGoogleIdToken } = useAuth();
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [isResetMode, setIsResetMode] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest(
    GOOGLE_CLIENT_ID ? { clientId: GOOGLE_CLIENT_ID } : { clientId: 'disabled' },
  );

  useEffect(() => {
    if (response?.type === 'success') {
      const idToken = (response.params as any)?.id_token;
      if (idToken) handleGoogleIdToken(idToken);
    }
  }, [response]);

  const submit = () => {
    if (isResetMode) {
      if (!email) return setAuthError('Please enter your email address.');
      handleResetPassword(email);
      setIsResetMode(false);
      return;
    }
    if (!email || !password) return setAuthError('Please enter both email and password.');
    handleEmailAuth(email, password, isLoginMode);
  };

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }} keyboardShouldPersistTaps="handled">
          <View className="items-center mb-6">
            <View className="w-16 h-16 rounded-2xl bg-surfaceHigh items-center justify-center mb-4 border border-border">
              <PieChart color="#2DD4BF" size={32} />
            </View>
            <Text className="text-2xl font-bold text-textPrimary">Asset Allocation Tracker</Text>
            <Text className="text-textSecondary text-center mt-2">
              Sign in to manage your assets, analyze your allocation, and get AI-powered insights.
            </Text>
          </View>

          <View className="gap-y-3">
            <View>
              <Text className="text-sm font-medium text-textSecondary mb-1 ml-1">Email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor="#5A6B87"
                keyboardType="email-address"
                autoCapitalize="none"
                className="bg-surface border border-border rounded-xl px-4 py-3 text-textPrimary"
              />
            </View>

            {!isResetMode && (
              <View>
                <Text className="text-sm font-medium text-textSecondary mb-1 ml-1">Password</Text>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor="#5A6B87"
                  secureTextEntry
                  className="bg-surface border border-border rounded-xl px-4 py-3 text-textPrimary"
                />
              </View>
            )}

            {!!authError && (
              <View className={`px-4 py-3 rounded-lg ${authError.includes('sent') ? 'bg-profit/10' : 'bg-loss/10'}`}>
                <Text className={authError.includes('sent') ? 'text-profit text-sm' : 'text-loss text-sm'}>{authError}</Text>
              </View>
            )}

            <TouchableOpacity
              onPress={submit}
              disabled={isSigningIn}
              className="bg-primary rounded-xl py-3.5 items-center mt-1 active:opacity-80"
            >
              {isSigningIn ? (
                <ActivityIndicator color="#0B1220" />
              ) : (
                <Text className="text-bg font-bold">
                  {isResetMode ? 'Send Reset Link' : isLoginMode ? 'Sign In' : 'Create Account'}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          <View className="items-end mt-2 mb-6">
            {isLoginMode && !isResetMode ? (
              <TouchableOpacity onPress={() => { setIsResetMode(true); setAuthError(''); }}>
                <Text className="text-primary text-sm">Forgot password?</Text>
              </TouchableOpacity>
            ) : isResetMode ? (
              <TouchableOpacity onPress={() => { setIsResetMode(false); setAuthError(''); }}>
                <Text className="text-textMuted text-sm">Back to login</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {!!GOOGLE_CLIENT_ID && (
            <>
              <View className="flex-row items-center mb-4">
                <View className="flex-1 h-px bg-border" />
                <Text className="text-textMuted text-sm mx-3 font-medium">OR</Text>
                <View className="flex-1 h-px bg-border" />
              </View>
              <TouchableOpacity
                onPress={() => promptAsync()}
                disabled={isSigningIn || !request}
                className="bg-surface border border-border rounded-xl py-3 items-center active:opacity-80 mb-4"
              >
                <Text className="text-textPrimary font-medium">Continue with Google</Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity
            onPress={() => { setIsLoginMode(!isLoginMode); setAuthError(''); }}
            className="items-center"
          >
            <Text className="text-textMuted text-sm">
              {isLoginMode ? "Don't have an account? " : 'Already have an account? '}
              <Text className="text-primary font-medium">{isLoginMode ? 'Sign up' : 'Log in'}</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
