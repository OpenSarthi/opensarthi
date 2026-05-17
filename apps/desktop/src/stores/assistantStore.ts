import { create } from "zustand";
import type { Message, Plan, PlanStep, VoiceState } from "../lib/schemas";

interface AssistantState {
  // Session
  voiceState: VoiceState;
  isConnected: boolean;
  currentTranscript: string | null;

  // Conversation
  messages: Message[];

  // Execution
  currentPlan: Plan | null;
  executingStepIndex: number | null;

  // Actions
  setVoiceState: (state: VoiceState) => void;
  setConnected: (connected: boolean) => void;
  setTranscript: (text: string | null) => void;
  addMessage: (msg: Message) => void;
  clearMessages: () => void;
  setPlan: (plan: Plan | null) => void;
  updateStepStatus: (index: number, update: Partial<PlanStep>) => void;
  setExecutingStep: (index: number | null) => void;
}

export const useAssistantStore = create<AssistantState>((set) => ({
  voiceState: "idle",
  isConnected: false,
  currentTranscript: null,
  messages: [],
  currentPlan: null,
  executingStepIndex: null,

  setVoiceState: (voiceState) => set({ voiceState }),
  setConnected: (isConnected) => set({ isConnected }),
  setTranscript: (currentTranscript) => set({ currentTranscript }),

  addMessage: (msg) =>
    set((s) => ({ messages: [...s.messages, msg] })),

  clearMessages: () => set({ messages: [], currentPlan: null }),

  setPlan: (currentPlan) => set({ currentPlan, executingStepIndex: null }),

  updateStepStatus: (index, update) =>
    set((s) => {
      if (!s.currentPlan) return s;
      const steps = s.currentPlan.steps.map((step, i) =>
        i === index ? { ...step, ...update } : step
      );
      return { currentPlan: { ...s.currentPlan, steps } };
    }),

  setExecutingStep: (executingStepIndex) => set({ executingStepIndex }),
}));
