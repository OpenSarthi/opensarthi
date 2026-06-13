// Standalone copy of assistantStore — no Tauri imports, no cross-package paths.
// Keep in sync with apps/desktop/src/stores/assistantStore.ts
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

export interface ThreadTab {
  id: string;
  title: string;
  messages: Message[];
  currentPlan: Plan | null;
  executingStepIndex: number | null;
  taskPaused: boolean;
  tokenUsage: TokenUsage;
}

const computeTabTitle = (messages: Message[], defaultName: string): string => {
  const firstUserMsg = messages.find(m => m.role === "user");
  if (!firstUserMsg) return defaultName;
  const prompt = firstUserMsg.content;
  const p = prompt.toLowerCase().trim();
  let title = "";
  if (p.includes("update") || p.includes("upgrade")) title = "System Update";
  else if (p.includes("install")) title = "Install Package";
  else if (p.includes("open") || p.includes("launch")) title = "Launch App";
  else if (p.includes("search") || p.includes("find")) title = "Search";
  else {
    const words = prompt.trim().split(/\s+/).slice(0, 3)
      .map(w => w.replace(/[^a-zA-Z]/g, "").toUpperCase()).filter(Boolean);
    title = words.join(" ") || "Agent Run";
  }
  return title.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};

const loadGlobalTokens = (): Record<string, number> => {
  const tokens: Record<string, number> = {};
  if (typeof window !== "undefined") {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("opensarthi_global_tokens_")) {
        tokens[key.replace("opensarthi_global_tokens_", "")] = parseInt(localStorage.getItem(key) || "0", 10);
      }
    }
  }
  return tokens;
};

const initialThreadId = crypto.randomUUID();
const initialTab: ThreadTab = {
  id: initialThreadId,
  title: "Thread 1",
  messages: [],
  currentPlan: null,
  executingStepIndex: null,
  taskPaused: false,
  tokenUsage: { requestTokens: 0, responseTokens: 0, totalTokens: 0, sessionTotalTokens: 0 },
};

interface AssistantState {
  voiceState: VoiceState;
  isConnected: boolean;
  currentTranscript: string | null;
  activeThreadId: string;
  tabs: ThreadTab[];
  messages: Message[];
  threads: Thread[];
  currentPlan: Plan | null;
  executingStepIndex: number | null;
  taskPaused: boolean;
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
  wakeWords: string[];
  wakeWordEnabled: boolean;
  wakeWordThreshold: number;
  tokenUsage: TokenUsage;
  globalSessionTokens: Record<string, number>;
  userName: string;
  userSkills: string[];
  customPrompt: string;
  onboardingCompleted: boolean;
  shellOutputLines: string[];
  lastClassification: string | null;

  // Actions
  setVoiceState: (state: VoiceState) => void;
  setConnected: (connected: boolean) => void;
  setTranscript: (text: string | null) => void;
  setActiveThreadId: (id: string) => void;
  addTab: (id?: string) => void;
  removeTab: (id: string) => void;
  loadThreadToTab: (id: string, messages: Message[], tokenTotals: any) => void;
  updateTokenUsageFromWS: (thread_id: string, usage: any) => void;
  addMessage: (msg: Message, thread_id?: string) => void;
  setMessages: (msgs: Message[]) => void;
  setThreads: (threads: Thread[]) => void;
  clearMessages: () => void;
  setPlan: (plan: Plan | null, thread_id?: string) => void;
  updateStepStatus: (index: number, update: Partial<PlanStep>, thread_id?: string) => void;
  setExecutingStep: (index: number | null, thread_id?: string) => void;
  addOrUpdateToolAction: (tool: string, description: string, status: "pending" | "running" | "success" | "error" | "skipped" | "terminated", result?: any, thread_id?: string) => void;
  setActiveModels: (local: string, cloud: string) => void;
  setActiveProvider: (provider: string) => void;
  setCloudApiKey: (key: string) => void;
  setAllApiKeys: (keys: { gemini: string; openai: string; anthropic: string; groq: string; openrouter: string }) => void;
  setActiveTheme: (theme: string) => void;
  setVoiceSettings: (accent: string, speed: number, continuous: boolean) => void;
  setWakeWordSettings: (enabled: boolean, threshold: number, phrases: string[]) => void;
  updateTokenUsage: (usage: { request_tokens: number; response_tokens: number; total_tokens: number }, thread_id?: string) => void;
  resetSessionTokens: () => void;
  restoreThreadTokens: (usage: { request_tokens: number; response_tokens: number; total_tokens: number }) => void;
  setPersonalization: (userName: string, userSkills: string[], customPrompt: string) => void;
  setOnboardingCompleted: (done: boolean) => void;
  setTaskPaused: (paused: boolean, thread_id?: string) => void;
  appendShellOutputLine: (line: string) => void;
  clearShellOutput: () => void;
  setLastClassification: (c: string) => void;
}

export const useAssistantStore = create<AssistantState>((set) => ({
  voiceState: "idle",
  isConnected: false,
  currentTranscript: null,
  activeThreadId: initialThreadId,
  tabs: [initialTab],
  messages: [],
  threads: [],
  currentPlan: null,
  executingStepIndex: null,
  taskPaused: false,
  activeLocalModel: "gemini-2.5-flash",
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
  wakeWords: ["hey sarthi", "hello sarthi"],
  wakeWordEnabled: true,
  wakeWordThreshold: 0.5,
  tokenUsage: { requestTokens: 0, responseTokens: 0, totalTokens: 0, sessionTotalTokens: 0 },
  globalSessionTokens: loadGlobalTokens(),
  userName: "",
  userSkills: ["general", "mobile_user"],
  customPrompt: "",
  onboardingCompleted: typeof window !== "undefined" && localStorage.getItem("opensarthi_onboarding_done") === "1",
  shellOutputLines: [],
  lastClassification: null,

  setVoiceState: (voiceState) => set({ voiceState }),
  setConnected: (isConnected) => set({ isConnected }),
  setTranscript: (currentTranscript) => set({ currentTranscript }),

  setActiveThreadId: (id) => set((s) => {
    const tab = s.tabs.find(t => t.id === id);
    if (!tab) return {};
    return { activeThreadId: id, messages: tab.messages, currentPlan: tab.currentPlan, executingStepIndex: tab.executingStepIndex, taskPaused: tab.taskPaused, tokenUsage: tab.tokenUsage };
  }),

  addTab: (id) => set((s) => {
    const newId = id || crypto.randomUUID();
    const existing = s.tabs.find(t => t.id === newId);
    if (existing) return { activeThreadId: newId, messages: existing.messages, currentPlan: existing.currentPlan, executingStepIndex: existing.executingStepIndex, taskPaused: existing.taskPaused, tokenUsage: existing.tokenUsage };
    const newTab: ThreadTab = { id: newId, title: `Thread ${s.tabs.length + 1}`, messages: [], currentPlan: null, executingStepIndex: null, taskPaused: false, tokenUsage: { requestTokens: 0, responseTokens: 0, totalTokens: 0, sessionTotalTokens: 0 } };
    return { tabs: [...s.tabs, newTab], activeThreadId: newId, messages: [], currentPlan: null, executingStepIndex: null, taskPaused: false, tokenUsage: newTab.tokenUsage };
  }),

  removeTab: (id) => set((s) => {
    if (s.tabs.length <= 1) {
      const newId = crypto.randomUUID();
      const newTab: ThreadTab = { id: newId, title: "Thread 1", messages: [], currentPlan: null, executingStepIndex: null, taskPaused: false, tokenUsage: { requestTokens: 0, responseTokens: 0, totalTokens: 0, sessionTotalTokens: 0 } };
      return { tabs: [newTab], activeThreadId: newId, messages: [], currentPlan: null, executingStepIndex: null, taskPaused: false, tokenUsage: newTab.tokenUsage };
    }
    const filtered = s.tabs.filter(t => t.id !== id);
    const nextId = s.activeThreadId === id ? filtered[Math.max(0, s.tabs.findIndex(t => t.id === id) - 1)].id : s.activeThreadId;
    const activeTab = filtered.find(t => t.id === nextId)!;
    return { tabs: filtered, activeThreadId: nextId, messages: activeTab.messages, currentPlan: activeTab.currentPlan, executingStepIndex: activeTab.executingStepIndex, taskPaused: activeTab.taskPaused, tokenUsage: activeTab.tokenUsage };
  }),

  loadThreadToTab: (id, messages, tokenTotals) => set((s) => {
    const existingIndex = s.tabs.findIndex(t => t.id === id);
    const tokenUsage = tokenTotals ? { requestTokens: tokenTotals.token_request || 0, responseTokens: tokenTotals.token_response || 0, totalTokens: tokenTotals.token_total || 0, sessionTotalTokens: tokenTotals.token_total || 0 } : { requestTokens: 0, responseTokens: 0, totalTokens: 0, sessionTotalTokens: 0 };
    const title = computeTabTitle(messages, `Thread ${existingIndex >= 0 ? existingIndex + 1 : s.tabs.length + 1}`);
    const tab: ThreadTab = { id, title, messages, currentPlan: null, executingStepIndex: null, taskPaused: false, tokenUsage };
    const newTabs = [...s.tabs];
    if (existingIndex >= 0) newTabs[existingIndex] = tab; else newTabs.push(tab);
    return { tabs: newTabs, activeThreadId: id, messages: tab.messages, currentPlan: null, executingStepIndex: null, taskPaused: false, tokenUsage };
  }),

  updateTokenUsageFromWS: (thread_id, usage) => set((s) => {
    const tid = thread_id || s.activeThreadId;
    const updatedTabs = s.tabs.map(t => t.id === tid ? { ...t, tokenUsage: { requestTokens: usage.request_tokens, responseTokens: usage.response_tokens, totalTokens: usage.total_tokens, sessionTotalTokens: t.tokenUsage.sessionTotalTokens + (usage.delta_total_tokens || 0) } } : t);
    const activeTab = updatedTabs.find(t => t.id === s.activeThreadId)!;
    return { tabs: updatedTabs, tokenUsage: activeTab.tokenUsage };
  }),

  addMessage: (msg, thread_id) => set((s) => {
    const tid = thread_id || s.activeThreadId;
    const updatedTabs = s.tabs.map(t => t.id === tid ? { ...t, messages: [...t.messages, msg], title: computeTabTitle([...t.messages, msg], t.title) } : t);
    return { tabs: updatedTabs, messages: updatedTabs.find(t => t.id === s.activeThreadId)!.messages };
  }),

  setMessages: (messages) => set((s) => {
    const updatedTabs = s.tabs.map(t => t.id === s.activeThreadId ? { ...t, messages, title: computeTabTitle(messages, t.title) } : t);
    return { tabs: updatedTabs, messages };
  }),

  setThreads: (threads) => set({ threads }),

  clearMessages: () => set((s) => {
    const updatedTabs = s.tabs.map(t => t.id === s.activeThreadId ? { ...t, messages: [], currentPlan: null, taskPaused: false, tokenUsage: { requestTokens: 0, responseTokens: 0, totalTokens: 0, sessionTotalTokens: 0 } } : t);
    return { tabs: updatedTabs, messages: [], currentPlan: null, taskPaused: false };
  }),

  setPlan: (currentPlan, thread_id) => set((s) => {
    const tid = thread_id || s.activeThreadId;
    const updatedTabs = s.tabs.map(t => t.id === tid ? { ...t, currentPlan, executingStepIndex: null, taskPaused: false } : t);
    const activeTab = updatedTabs.find(t => t.id === s.activeThreadId)!;
    return { tabs: updatedTabs, currentPlan: activeTab.currentPlan, executingStepIndex: null, taskPaused: false };
  }),

  updateStepStatus: (index, update, thread_id) => set((s) => {
    const tid = thread_id || s.activeThreadId;
    const updatedTabs = s.tabs.map(t => {
      if (t.id !== tid || !t.currentPlan) return t;
      const steps = t.currentPlan.steps.map((step, i) => i === index ? { ...step, ...update } : step);
      return { ...t, currentPlan: { ...t.currentPlan, steps } };
    });
    return { tabs: updatedTabs, currentPlan: updatedTabs.find(t => t.id === s.activeThreadId)!.currentPlan };
  }),

  setExecutingStep: (executingStepIndex, thread_id) => set((s) => {
    const tid = thread_id || s.activeThreadId;
    const updatedTabs = s.tabs.map(t => t.id === tid ? { ...t, executingStepIndex } : t);
    return { tabs: updatedTabs, executingStepIndex: updatedTabs.find(t => t.id === s.activeThreadId)!.executingStepIndex };
  }),

  addOrUpdateToolAction: (tool, description, status, result, thread_id) => set((s) => {
    const tid = thread_id || s.activeThreadId;
    const updatedTabs = s.tabs.map(t => {
      if (t.id !== tid) return t;
      let plan = t.currentPlan || { id: crypto.randomUUID(), goal: "Executing User Command...", steps: [], recovery_hint: null };
      const steps = [...plan.steps];
      const existingIndex = steps.findIndex(st => st.tool === tool && st.description === description && (st.status === "pending" || st.status === "running"));
      if (existingIndex >= 0) steps[existingIndex] = { ...steps[existingIndex], status, result, timestamp: Date.now() };
      else steps.push({ index: steps.length, tool, args: {}, description, status, result, timestamp: Date.now() });
      return { ...t, currentPlan: { ...plan, steps } };
    });
    return { tabs: updatedTabs, currentPlan: updatedTabs.find(t => t.id === s.activeThreadId)!.currentPlan };
  }),

  setActiveModels: (local, cloud) => set({ activeLocalModel: local, activeCloudModel: cloud }),
  setActiveProvider: (activeProvider) => set({ activeProvider }),
  setCloudApiKey: (cloudApiKey) => set({ cloudApiKey }),
  setAllApiKeys: (keys) => set({ geminiApiKey: keys.gemini, openaiApiKey: keys.openai, anthropicApiKey: keys.anthropic, groqApiKey: keys.groq, openrouterApiKey: keys.openrouter }),
  setActiveTheme: (activeTheme) => set({ activeTheme }),
  setVoiceSettings: (voiceAccent, voiceSpeed, continuousListening) => set({ voiceAccent, voiceSpeed, continuousListening }),
  setWakeWordSettings: (wakeWordEnabled, wakeWordThreshold, wakeWords) => set({ wakeWordEnabled, wakeWordThreshold, wakeWords }),

  updateTokenUsage: (usage, thread_id) => set((s) => {
    const tid = thread_id || s.activeThreadId;
    const updatedTabs = s.tabs.map(t => t.id === tid ? { ...t, tokenUsage: { requestTokens: usage.request_tokens, responseTokens: usage.response_tokens, totalTokens: usage.total_tokens, sessionTotalTokens: t.tokenUsage.sessionTotalTokens + (usage.total_tokens || 0) } } : t);
    return { tabs: updatedTabs, tokenUsage: updatedTabs.find(t => t.id === s.activeThreadId)!.tokenUsage };
  }),

  resetSessionTokens: () => set((s) => {
    const updatedTabs = s.tabs.map(t => t.id === s.activeThreadId ? { ...t, tokenUsage: { ...t.tokenUsage, sessionTotalTokens: 0 } } : t);
    return { tabs: updatedTabs, tokenUsage: updatedTabs.find(t => t.id === s.activeThreadId)!.tokenUsage };
  }),

  restoreThreadTokens: (usage) => set((s) => {
    const updatedTabs = s.tabs.map(t => t.id === s.activeThreadId ? { ...t, tokenUsage: { requestTokens: usage.request_tokens, responseTokens: usage.response_tokens, totalTokens: usage.total_tokens, sessionTotalTokens: usage.total_tokens } } : t);
    return { tabs: updatedTabs, tokenUsage: updatedTabs.find(t => t.id === s.activeThreadId)!.tokenUsage };
  }),

  setPersonalization: (userName, userSkills, customPrompt) => set({ userName, userSkills, customPrompt }),
  setOnboardingCompleted: (done) => {
    if (typeof window !== "undefined") {
      if (done) localStorage.setItem("opensarthi_onboarding_done", "1");
      else localStorage.removeItem("opensarthi_onboarding_done");
    }
    set({ onboardingCompleted: done });
  },

  setTaskPaused: (taskPaused, thread_id) => set((s) => {
    const tid = thread_id || s.activeThreadId;
    const updatedTabs = s.tabs.map(t => t.id === tid ? { ...t, taskPaused } : t);
    return { tabs: updatedTabs, taskPaused: updatedTabs.find(t => t.id === s.activeThreadId)!.taskPaused };
  }),

  appendShellOutputLine: (line) => set((s) => ({ shellOutputLines: [...s.shellOutputLines.slice(-200), line] })),
  clearShellOutput: () => set({ shellOutputLines: [] }),
  setLastClassification: (lastClassification) => set({ lastClassification }),
}));
