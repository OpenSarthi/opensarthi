import { create } from "zustand";
import type { Message, Plan, PlanStep, VoiceState } from "../lib/schemas";

export interface Thread {
  id: string;
  created_at: string;
  first_message: string;
}

export interface TokenUsage {
  requestTokens: number;
  responseTokens: number;
  totalTokens: number;
  sessionTotalTokens: number;
}

interface AssistantState {
  // Session
  voiceState: VoiceState;
  isConnected: boolean;
  currentTranscript: string | null;

  // Conversation
  messages: Message[];
  threads: Thread[];

  // Execution
  currentPlan: Plan | null;
  executingStepIndex: number | null;

  // Model settings
  activeLocalModel: string;
  activeCloudModel: string;
  activeProvider: string;
  cloudApiKey: string;
  geminiApiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  groqApiKey: string;
  openrouterApiKey: string;
  activeTheme: string;

  voiceAccent: string;
  voiceSpeed: number;
  continuousListening: boolean;

  // Token tracking
  tokenUsage: TokenUsage;

  // Actions
  setVoiceState: (state: VoiceState) => void;
  setConnected: (connected: boolean) => void;
  setTranscript: (text: string | null) => void;
  addMessage: (msg: Message) => void;
  setMessages: (msgs: Message[]) => void;
  setThreads: (threads: Thread[]) => void;
  clearMessages: () => void;
  setPlan: (plan: Plan | null) => void;
  updateStepStatus: (index: number, update: Partial<PlanStep>) => void;
  setExecutingStep: (index: number | null) => void;
  addOrUpdateToolAction: (tool: string, description: string, status: "pending" | "running" | "success" | "error" | "skipped", result?: any) => void;
  setActiveModels: (local: string, cloud: string) => void;
  setActiveProvider: (provider: string) => void;
  setCloudApiKey: (key: string) => void;
  setAllApiKeys: (keys: { gemini: string; openai: string; anthropic: string; groq: string; openrouter: string }) => void;
  setActiveTheme: (theme: string) => void;
  setVoiceSettings: (accent: string, speed: number, continuous: boolean) => void;
  updateTokenUsage: (usage: { request_tokens: number; response_tokens: number; total_tokens: number }) => void;
  resetSessionTokens: () => void;
}

export const useAssistantStore = create<AssistantState>((set) => ({
  voiceState: "idle",
  isConnected: false,
  currentTranscript: null,
  messages: [],
  threads: [],
  currentPlan: null,
  executingStepIndex: null,
  activeLocalModel: "qwen2.5-coder:3b",
  activeCloudModel: "gemini-2.5-flash",
  activeProvider: "google",
  cloudApiKey: "",
  geminiApiKey: "",
  openaiApiKey: "",
  anthropicApiKey: "",
  groqApiKey: "",
  openrouterApiKey: "",
  activeTheme: "theme-red-black",
  voiceAccent: "ie",
  voiceSpeed: 1.35,
  continuousListening: false,
  tokenUsage: {
    requestTokens: 0,
    responseTokens: 0,
    totalTokens: 0,
    sessionTotalTokens: 0,
  },

  setVoiceState: (voiceState) => set({ voiceState }),
  setConnected: (isConnected) => set({ isConnected }),
  setTranscript: (currentTranscript) => set({ currentTranscript }),

  addMessage: (msg) =>
    set((s) => ({ messages: [...s.messages, msg] })),

  setMessages: (messages) => set({ messages }),
  setThreads: (threads) => set({ threads }),

  clearMessages: () => set({ messages: [], currentPlan: null, tokenUsage: { requestTokens: 0, responseTokens: 0, totalTokens: 0, sessionTotalTokens: 0 } }),

  setPlan: (currentPlan) => set({ currentPlan, executingStepIndex: null }),

  setActiveModels: (local, cloud) => set({ activeLocalModel: local, activeCloudModel: cloud }),
  setActiveProvider: (activeProvider) => set({ activeProvider }),
  setCloudApiKey: (cloudApiKey) => set({ cloudApiKey }),
  setAllApiKeys: (keys) => set({
    geminiApiKey: keys.gemini,
    openaiApiKey: keys.openai,
    anthropicApiKey: keys.anthropic,
    groqApiKey: keys.groq,
    openrouterApiKey: keys.openrouter,
  }),
  setActiveTheme: (activeTheme) => set({ activeTheme }),
  setVoiceSettings: (voiceAccent, voiceSpeed, continuousListening) => set({ voiceAccent, voiceSpeed, continuousListening }),

  updateTokenUsage: (usage) => set((s) => ({
    tokenUsage: {
      requestTokens: usage.request_tokens,
      responseTokens: usage.response_tokens,
      totalTokens: usage.total_tokens,
      sessionTotalTokens: s.tokenUsage.sessionTotalTokens + (usage.total_tokens || 0),
    }
  })),

  resetSessionTokens: () => set((s) => ({
    tokenUsage: { ...s.tokenUsage, sessionTotalTokens: 0 }
  })),

  updateStepStatus: (index, update) =>
    set((s) => {
      if (!s.currentPlan) return s;
      const steps = s.currentPlan.steps.map((step, i) =>
        i === index ? { ...step, ...update } : step
      );
      return { currentPlan: { ...s.currentPlan, steps } };
    }),

  setExecutingStep: (executingStepIndex) => set({ executingStepIndex }),

  addOrUpdateToolAction: (tool, description, status, result) => set((s) => {
    let plan = s.currentPlan;
    if (!plan) {
      plan = { 
        id: crypto.randomUUID(), 
        goal: "Executing User Command...", 
        steps: [], 
        recovery_hint: null 
      };
    }

    let steps = [...plan.steps];
    
    const existingIndex = steps.findIndex(st => st.tool === tool && st.description === description && st.status === "running");
    
    if (existingIndex >= 0) {
      steps[existingIndex] = { ...steps[existingIndex], status, result };
    } else {
      steps.push({
        index: steps.length,
        tool,
        args: {},
        description,
        status,
        result
      });
    }

    return { currentPlan: { ...plan, steps } };
  }),
}));
