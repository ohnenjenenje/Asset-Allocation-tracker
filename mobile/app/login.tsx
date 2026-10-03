import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PieChart } from 'lucide-react-native';
import { useAuth } from '@/hooks/useAuth';
import { isGoogleSignInSupported, requestGoogleIdToken } from '@/lib/googleSignIn';

export default function LoginScreen() {
  const { isSigningIn, authError, setAuthError, handleEmailAuth, handleResetPassword, handleGoogleIdToken } = useAuth();
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [isResetMode, setIsResetMode] = useState(false);
  const [isGoogleBusy, setIsGoogleBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submitGoogle = async () => {
    if (isGoogleBusy) return;
    setIsGoogleBusy(true);
    setAuthError('');
    try {
      const result = await requestGoogleIdToken();
      if (result.type === 'cancelled') return;
      if (result.type === 'unavailable') {
        setAuthError(
          'Google sign-in needs a development build. Run the dev-client build, or use email sign-in in Expo Go.',
        );
        return;
      }
      if (result.type === 'error') {
        setAuthError(result.message);
        return;
      }
      await handleGoogleIdToken(result.idToken);
    } finally {
      setIsGoogleBusy(false);
    }
  };

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

          {isGoogleSignInSupported() && (
            <>
              <View className="flex-row items-center mb-4">
                <View className="flex-1 h-px bg-border" />
                <Text className="text-textMuted text-sm mx-3 font-medium">OR</Text>
                <View className="flex-1 h-px bg-border" />
              </View>
              <TouchableOpacity
                onPress={submitGoogle}
                disabled={isSigningIn || isGoogleBusy}
                className="bg-surface border border-border rounded-xl py-3 items-center active:opacity-80 mb-4"
              >
                {isGoogleBusy ? (
                  <ActivityIndicator color="#2DD4BF" />
                ) : (
                  <Text className="text-textPrimary font-medium">Continue with Google</Text>
                )}
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
