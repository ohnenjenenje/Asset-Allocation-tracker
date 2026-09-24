import React from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { X, Send, Bot, MessageSquarePlus, ArrowUp } from 'lucide-react-native';
import { useDashboard } from '@/hooks/useDashboardData';
import { useAiChat } from '@/hooks/useAiChat';

export default function ChatScreen() {
  const dash = useDashboard() as any;
  const {
    assets, setAssets, fundHoldings, setFundHoldings, prices, fetchPrices, syncToDb,
    openRouterKey, aiProvider, selectedModel, googleModel, availableModels, searchSource,
  } = dash;

  const {
    chatMessages, aiInput, setAiInput, isAiTyping,
    messagesEndRef, chatContainerRef,
    scrollToBottom, scrollToTop, startNewChat, handleAiCommand,
  } = useAiChat({
    assets, setAssets, fundHoldings, setFundHoldings, prices, fetchPrices, syncToDb,
    openRouterKey, aiProvider, selectedModel, googleModel, availableModels, searchSource,
    setIsAddModalOpen: () => {}, setIsSettingsOpen: () => {},
  });

  const send = () => {
    if (!aiInput.trim() || isAiTyping) return;
    handleAiCommand();
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
        <View className="flex-row items-center">
          <View className="w-8 h-8 rounded-full bg-accent/20 items-center justify-center mr-2.5">
            <Bot size={17} color="#8B5CF6" />
          </View>
          <View>
            <Text className="text-textPrimary font-bold">AI Assistant</Text>
            <Text className="text-textMuted text-[10px]">{aiProvider === 'google' ? googleModel : selectedModel}</Text>
          </View>
        </View>
        <View className="flex-row items-center gap-2">
          <TouchableOpacity onPress={startNewChat} className="p-2"><MessageSquarePlus size={18} color="#8FA3BF" /></TouchableOpacity>
          <TouchableOpacity onPress={scrollToTop} className="p-2"><ArrowUp size={18} color="#8FA3BF" /></TouchableOpacity>
          <TouchableOpacity onPress={() => router.back()} className="p-2"><X size={20} color="#8FA3BF" /></TouchableOpacity>
        </View>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1" keyboardVerticalOffset={0}>
        <ScrollView
          ref={chatContainerRef as any}
          className="flex-1"
          contentContainerStyle={{ padding: 16, gap: 12 }}
          onContentSizeChange={scrollToBottom}
        >
          {chatMessages.map((m: any, i: number) => {
            const isUser = m.role === 'user';
            if (!m.content) return null;
            return (
              <View key={i} className={`max-w-[85%] rounded-2xl px-4 py-3 ${isUser ? 'self-end bg-primary/20' : 'self-start bg-surface border border-border'}`}>
                {m.thought ? <Text className="text-textMuted text-[10px] italic mb-1">💭 {m.thought.slice(0, 200)}</Text> : null}
                <Text className="text-textPrimary text-sm leading-5">{m.content}</Text>
                {m.isFallback ? <Text className="text-amber text-[10px] mt-1">auto-filled by fallback rules — please verify</Text> : null}
              </View>
            );
          })}
          {isAiTyping && (
            <View className="self-start bg-surface border border-border rounded-2xl px-4 py-3 flex-row items-center">
              <ActivityIndicator size="small" color="#8B5CF6" />
              <Text className="text-textMuted text-sm ml-2">Thinking…</Text>
            </View>
          )}
          <View ref={messagesEndRef as any} />
        </ScrollView>

        <View className="flex-row items-center px-3 pb-3 pt-2 border-t border-border gap-2">
          <TextInput
            value={aiInput}
            onChangeText={setAiInput}
            placeholder='Try "Add 10 Apple shares at $150"…'
            placeholderTextColor="#5A6B87"
            multiline
            className="flex-1 bg-surface border border-border rounded-2xl px-4 py-3 text-textPrimary max-h-32"
            onSubmitEditing={send}
          />
          <TouchableOpacity
            onPress={send}
            disabled={!aiInput.trim() || isAiTyping}
            className={`w-11 h-11 rounded-full items-center justify-center ${aiInput.trim() ? 'bg-primary' : 'bg-surfaceHigh'}`}
          >
            <Send size={18} color={aiInput.trim() ? '#0B1220' : '#5A6B87'} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
