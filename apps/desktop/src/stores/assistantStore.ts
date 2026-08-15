import { create } from "zustand";
import type { Message, Plan, PlanStep, PlanReasoning, VoiceState } from "../lib/schemas";

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
  else if (p.includes("install") || p.includes("pacman -s") || p.includes("yay -s")) title = "Install Package";
  else if (p.includes("remove") || p.includes("uninstall")) title = "Remove Package";
  else if (p.includes("reboot") || p.includes("restart")) title = "System Reboot";
  else if (p.includes("shutdown") || p.includes("poweroff")) title = "System Shutdown";
  else if (p.includes("search") || p.includes("find") || p.includes("grep")) title = "File Search";
  else if (p.includes("open") || p.includes("launch") || p.includes("start")) title = "Launch App";
  else if (p.includes("create") || p.includes("write") || p.includes("mkdir") || p.includes("touch")) title = "Create File";
  else if (p.includes("kill") || p.includes("pkill")) title = "Kill Process";
  else if (p.includes("shell") || p.includes("command") || p.includes("run") || p.includes("sudo")) title = "Shell Command";
  else if (p.includes("chrome") || p.includes("firefox") || p.includes("browser")) title = "Open Browser";
  else if (p.includes("type") || p.includes("click") || p.includes("press")) title = "UI Automation";
  else if (p.includes("brightness") || p.includes("volume") || p.includes("screen")) title = "System Control";
  else {
    const words = prompt.trim().split(/\s+/).slice(0, 3).map(w => w.replace(/[^a-zA-Z]/g, "").toUpperCase()).filter(Boolean);
    title = words.join(" ") || "Agent Run";
  }
  return title.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
};

const loadGlobalTokens = (): Record<string, number> => {
  const tokens: Record<string, number> = {};
  if (typeof window !== "undefined") {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("opensarthi_global_tokens_")) {
        const modelKey = key.replace("opensarthi_global_tokens_", "");
        const val = parseInt(localStorage.getItem(key) || "0", 10);
        tokens[modelKey] = val;
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
  tokenUsage: {
    requestTokens: 0,
    responseTokens: 0,
    totalTokens: 0,
    sessionTotalTokens: 0,
  }
};

interface AssistantState {
  // Session
  voiceState: VoiceState;
  isConnected: boolean;
  currentTranscript: string | null;

  // Tabs & Threads
  activeThreadId: string;
  tabs: ThreadTab[];

  // Conversation (Legacy mapping to active tab)
  messages: Message[];
  threads: Thread[];

  // Execution (Legacy mapping to active tab)
  currentPlan: Plan | null;
  executingStepIndex: number | null;
  taskPaused: boolean;
  isOverlayMode: boolean;
  userOverrodeMinimize: boolean;
  setUserOverrodeMinimize: (val: boolean) => void;
  snapAlign: "left" | "right" | "none";

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
  wakeWords: string[];
  wakeWordEnabled: boolean;
  wakeWordThreshold: number;
  longTermMemoryEnabled: boolean;
  longTermMemories: any[];
  useLanggraph: boolean;
  nodeStatuses: Record<string, "idle" | "running" | "done">;
  
  // Remote dashboard pairing state
  remoteDashboardEnabled: boolean;
  mobilePairing: { key: string; url: string; qr: string } | null;
  setRemoteDashboardEnabled: (enabled: boolean) => void;
  setMobilePairing: (pairing: { key: string; url: string; qr: string } | null) => void;

  // Token tracking (Legacy mapping to active tab)
  tokenUsage: TokenUsage;
  globalSessionTokens: Record<string, number>;

  // Personalization
  userName: string;
  userSkills: string[];
  customPrompt: string;
  onboardingCompleted: boolean;

  // Actions
  setVoiceState: (state: VoiceState) => void;
  setConnected: (connected: boolean) => void;
  setLongTermMemoryEnabled: (enabled: boolean) => void;
  setLongTermMemories: (memories: any[]) => void;
  setUseLanggraph: (enabled: boolean) => void;
  setNodeStatus: (node: string, status: "idle" | "running" | "done", thread_id?: string) => void;
  setTranscript: (text: string | null) => void;
  
  // Tab control actions
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
  setOverlayMode: (val: boolean) => void;
  setSnapAlign: (align: "left" | "right" | "none") => void;
  // Shell output streaming
  shellOutputLines: string[];
  appendShellOutputLine: (line: string) => void;
  clearShellOutput: () => void;
  // Intent classification from orchestrator
  lastClassification: string | null;
  setLastClassification: (c: string) => void;
  // Chat streaming response (separate from voice transcript)
  streamingResponse: string | null;
  appendStreamChunk: (chunk: string) => void;
  clearStreamingResponse: () => void;
  // Track the ID of the most recently streamed message so the bubble
  // component can skip its typewriter animation (user already saw it stream)
  lastStreamedMessageId: string | null;
  markStreamedMessage: (id: string) => void;
  clearStreamedMessage: () => void;
  // Sound cue settings
  soundEnabled: boolean;
  soundVolume: number; // 0–100
  setSoundSettings: (enabled: boolean, volume: number) => void;
  // Plan reasoning (LLM prose text before the JSON plan)
  planReasonings: Record<string, PlanReasoning[]>; // threadId → list of reasoning objects
  addPlanReasoning: (reasoning: PlanReasoning) => void;
  clearPlanReasonings: (thread_id: string) => void;
  // Sidecar runtime logs
  sidecarLogs: string[];
  addSidecarLogs: (lines: string[]) => void;
  clearSidecarLogs: () => void;
  // Activity Logs
  activityLogs: { id: string; text: string; timestamp: number }[];
  addActivityLog: (text: string) => void;
  clearActivityLogs: () => void;
  // Content Panel (morning briefing, screen analysis, etc.)
  contentPanel: { contentType: string | null; contentData: any | null };
  setContentPanel: (contentType: string | null, contentData: any | null) => void;
  // Custom accent color
  customAccent: string | null;
  setCustomAccent: (color: string | null) => void;

  // Real-time system metrics
  systemMetrics: {
    cpu: number;
    mem: number;
    net_kbps: number;
    gpu: number | string;
    temp: number | string;
    mobile_status?: {
      enabled: boolean;
      connected: boolean;
      devices: string[];
    };
  };
  setSystemMetrics: (metrics: {
    cpu: number;
    mem: number;
    net_kbps: number;
    gpu: number | string;
    temp: number | string;
    mobile_status?: {
      enabled: boolean;
      connected: boolean;
      devices: string[];
    };
  }) => void;

  // Temporary storage for onboarding settings before connection handshake completes
  pendingOnboarding: any | null;
  setPendingOnboarding: (data: any | null) => void;
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
  isOverlayMode: false,
  userOverrodeMinimize: false,
  snapAlign: "right",
  activeLocalModel: "qwen2.5-coder:3b",
  activeCloudModel: "gemini-3.6-flash",
  activeProvider: "google",
  cloudApiKey: "",
  geminiApiKey: "",
  openaiApiKey: "",
  anthropicApiKey: "",
  groqApiKey: "",
  openrouterApiKey: "",
  activeTheme: "theme-green-black",
  voiceAccent: "ie",
  voiceSpeed: 1.35,
  continuousListening: true,
  wakeWords: ["hey sarthi", "hello sarthi"],
  wakeWordEnabled: true,
  wakeWordThreshold: 0.5,
  tokenUsage: {
    requestTokens: 0,
    responseTokens: 0,
    totalTokens: 0,
    sessionTotalTokens: 0,
  },
  globalSessionTokens: loadGlobalTokens(),
  userName: "",
  userSkills: ["general", "desktop_automation", "developer", "home_user"],
  customPrompt: "",
  onboardingCompleted: typeof window !== "undefined" && localStorage.getItem("opensarthi_onboarding_done") === "1",
  shellOutputLines: [],
  lastClassification: null,
  streamingResponse: null,
  soundEnabled: typeof window !== "undefined"
    ? localStorage.getItem("opensarthi_sound_enabled") !== "false"
    : true,
  soundVolume: typeof window !== "undefined"
    ? parseInt(localStorage.getItem("opensarthi_sound_volume") || "60", 10)
    : 60,
  longTermMemoryEnabled: false,
  longTermMemories: [],
  useLanggraph: true,
  nodeStatuses: {},
  planReasonings: {},
  remoteDashboardEnabled: false,
  mobilePairing: null,

  setVoiceState: (voiceState) => set({ voiceState }),
  setConnected: (isConnected) => set({ isConnected }),
  setLongTermMemoryEnabled: (longTermMemoryEnabled) => set({ longTermMemoryEnabled }),
  setRemoteDashboardEnabled: (remoteDashboardEnabled) => set({ remoteDashboardEnabled }),
  setMobilePairing: (mobilePairing) => set({ mobilePairing }),
  setLongTermMemories: (longTermMemories) => set({ longTermMemories }),
  setUseLanggraph: (useLanggraph) => set({ useLanggraph }),
  setNodeStatus: (node, status, _thread_id) => set((s) => ({
    nodeStatuses: { ...s.nodeStatuses, [node]: status }
  })),
  setTranscript: (currentTranscript) => set({ currentTranscript }),

  setActiveThreadId: (id) => set((s) => {
    const tab = s.tabs.find(t => t.id === id);
    if (!tab) return {};
    return {
      activeThreadId: id,
      messages: tab.messages,
      currentPlan: tab.currentPlan,
      executingStepIndex: tab.executingStepIndex,
      taskPaused: tab.taskPaused,
      tokenUsage: tab.tokenUsage,
    };
  }),

  addTab: (id) => set((s) => {
    const newId = id || crypto.randomUUID();
    const existing = s.tabs.find(t => t.id === newId);
    if (existing) {
      const tab = existing;
      return {
        activeThreadId: newId,
        messages: tab.messages,
        currentPlan: tab.currentPlan,
        executingStepIndex: tab.executingStepIndex,
        taskPaused: tab.taskPaused,
        tokenUsage: tab.tokenUsage,
      };
    }
    const newTab: ThreadTab = {
      id: newId,
      title: `Thread ${s.tabs.length + 1}`,
      messages: [],
      currentPlan: null,
      executingStepIndex: null,
      taskPaused: false,
      tokenUsage: {
        requestTokens: 0,
        responseTokens: 0,
        totalTokens: 0,
        sessionTotalTokens: 0,
      }
    };
    return {
      tabs: [...s.tabs, newTab],
      activeThreadId: newId,
      messages: newTab.messages,
      currentPlan: newTab.currentPlan,
      executingStepIndex: newTab.executingStepIndex,
      taskPaused: newTab.taskPaused,
      tokenUsage: newTab.tokenUsage,
    };
  }),

  removeTab: (id) => set((s) => {
    if (s.tabs.length <= 1) {
      const newId = crypto.randomUUID();
      const newTab: ThreadTab = {
        id: newId,
        title: "Thread 1",
        messages: [],
        currentPlan: null,
        executingStepIndex: null,
        taskPaused: false,
        tokenUsage: {
          requestTokens: 0,
          responseTokens: 0,
          totalTokens: 0,
          sessionTotalTokens: 0,
        }
      };
      return {
        tabs: [newTab],
        activeThreadId: newId,
        messages: newTab.messages,
        currentPlan: newTab.currentPlan,
        executingStepIndex: newTab.executingStepIndex,
        taskPaused: newTab.taskPaused,
        tokenUsage: newTab.tokenUsage,
      };
    }
    const filtered = s.tabs.filter(t => t.id !== id);
    let nextActiveId = s.activeThreadId;
    if (s.activeThreadId === id) {
      const index = s.tabs.findIndex(t => t.id === id);
      const nextIndex = index === 0 ? 0 : index - 1;
      nextActiveId = filtered[nextIndex].id;
    }
    const activeTab = filtered.find(t => t.id === nextActiveId)!;
    return {
      tabs: filtered,
      activeThreadId: nextActiveId,
      messages: activeTab.messages,
      currentPlan: activeTab.currentPlan,
      executingStepIndex: activeTab.executingStepIndex,
      taskPaused: activeTab.taskPaused,
      tokenUsage: activeTab.tokenUsage,
    };
  }),

  loadThreadToTab: (id, messages, tokenTotals) => set((s) => {
    const existingIndex = s.tabs.findIndex(t => t.id === id);
    const tokenUsage = tokenTotals ? {
      requestTokens: tokenTotals.token_request || tokenTotals.request_tokens || 0,
      responseTokens: tokenTotals.token_response || tokenTotals.response_tokens || 0,
      totalTokens: tokenTotals.token_total || tokenTotals.total_tokens || 0,
      sessionTotalTokens: tokenTotals.token_total || tokenTotals.total_tokens || 0,
    } : {
      requestTokens: 0,
      responseTokens: 0,
      totalTokens: 0,
      sessionTotalTokens: 0,
    };

    const title = computeTabTitle(messages, `Thread ${existingIndex >= 0 ? existingIndex + 1 : s.tabs.length + 1}`);

    // Restore any historical plan reasonings stored in messages
    const restoredReasonings = messages
      .filter(m => m.plan?.reasoning)
      .map(m => ({ text: m.plan!.reasoning!, attempt: 0, thread_id: id }));

    const tab: ThreadTab = {
      id,
      title,
      messages,
      currentPlan: null,
      executingStepIndex: null,
      taskPaused: false,
      tokenUsage,
    };

    return {
      activeThreadId: id,
      tabs: existingIndex >= 0
        ? s.tabs.map((t, idx) => idx === existingIndex ? tab : t)
        : [...s.tabs, tab],
      messages,
      currentPlan: null,
      executingStepIndex: null,
      taskPaused: false,
      tokenUsage,
      planReasonings: restoredReasonings.length > 0
        ? { ...s.planReasonings, [id]: restoredReasonings }
        : s.planReasonings,
    };
  }),

  updateTokenUsageFromWS: (thread_id, usage) => set((s) => {
    const tid = thread_id || s.activeThreadId;
    const updatedTabs = s.tabs.map(t => {
      if (t.id === tid) {
        return {
          ...t,
          tokenUsage: {
            requestTokens: usage.request_tokens,
            responseTokens: usage.response_tokens,
            totalTokens: usage.total_tokens,
            sessionTotalTokens: t.tokenUsage.sessionTotalTokens + (usage.delta_total_tokens || 0),
          }
        };
      }
      return t;
    });
    const activeTab = updatedTabs.find(t => t.id === s.activeThreadId)!;
    const modelKey = s.activeProvider === "ollama" || s.activeProvider === "local" ? s.activeLocalModel : s.activeCloudModel;
    const addedTokens = usage.delta_total_tokens || 0;
    const currentGlobal = s.globalSessionTokens[modelKey] || 0;
    const updatedGlobal = currentGlobal + addedTokens;
    const nextGlobalSessionTokens = {
      ...s.globalSessionTokens,
      [modelKey]: updatedGlobal,
    };
    if (typeof window !== "undefined") {
      localStorage.setItem(`opensarthi_global_tokens_${modelKey}`, updatedGlobal.toString());
    }
    return {
      tabs: updatedTabs,
      tokenUsage: activeTab.tokenUsage,
      globalSessionTokens: nextGlobalSessionTokens,
    };
  }),

  addMessage: (msg, thread_id) => set((s) => {
    const tid = thread_id || s.activeThreadId;
    const updatedTabs = s.tabs.map(t => {
      if (t.id === tid) {
        const nextMsgs = [...t.messages, msg];
        return {
          ...t,
          messages: nextMsgs,
          title: computeTabTitle(nextMsgs, t.title),
        };
      }
      return t;
    });
    const activeTab = updatedTabs.find(t => t.id === s.activeThreadId)!;
    return {
      tabs: updatedTabs,
      messages: activeTab.messages,
    };
  }),

  setMessages: (messages) => set((s) => {
    const updatedTabs = s.tabs.map(t => {
      if (t.id === s.activeThreadId) {
        return {
          ...t,
          messages,
          title: computeTabTitle(messages, t.title)
        };
      }
      return t;
    });
    return {
      tabs: updatedTabs,
      messages,
    };
  }),

  setThreads: (threads) => set({ threads }),

  clearMessages: () => set((s) => {
    const updatedTabs = s.tabs.map(t => {
      if (t.id === s.activeThreadId) {
        return {
          ...t,
          messages: [],
          currentPlan: null,
          taskPaused: false,
          tokenUsage: {
            requestTokens: 0,
            responseTokens: 0,
            totalTokens: 0,
            sessionTotalTokens: 0,
          }
        };
      }
      return t;
    });
    const activeTab = updatedTabs.find(t => t.id === s.activeThreadId)!;
    return {
      tabs: updatedTabs,
      messages: activeTab.messages,
      currentPlan: activeTab.currentPlan,
      taskPaused: activeTab.taskPaused,
      tokenUsage: activeTab.tokenUsage,
    };
  }),

  setPlan: (currentPlan, thread_id) => set((s) => {
    const tid = thread_id || s.activeThreadId;
    const updatedTabs = s.tabs.map(t => {
      if (t.id === tid) {
        return { ...t, currentPlan, executingStepIndex: null, taskPaused: false };
      }
      return t;
    });
    const activeTab = updatedTabs.find(t => t.id === s.activeThreadId)!;
    return {
      tabs: updatedTabs,
      currentPlan: activeTab.currentPlan,
      executingStepIndex: activeTab.executingStepIndex,
      taskPaused: activeTab.taskPaused,
    };
  }),

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
  setWakeWordSettings: (wakeWordEnabled, wakeWordThreshold, wakeWords) => set({ wakeWordEnabled, wakeWordThreshold, wakeWords }),

  updateTokenUsage: (usage, thread_id) => set((s) => {
    const tid = thread_id || s.activeThreadId;
    const updatedTabs = s.tabs.map(t => {
      if (t.id === tid) {
        return {
          ...t,
          tokenUsage: {
            requestTokens: t.tokenUsage.requestTokens + (usage.request_tokens || 0),
            responseTokens: t.tokenUsage.responseTokens + (usage.response_tokens || 0),
            totalTokens: t.tokenUsage.totalTokens + (usage.total_tokens || 0),
            sessionTotalTokens: t.tokenUsage.sessionTotalTokens + (usage.total_tokens || 0),
          }
        };
      }
      return t;
    });
    const activeTab = updatedTabs.find(t => t.id === s.activeThreadId)!;
    const modelKey = s.activeProvider === "ollama" || s.activeProvider === "local" ? s.activeLocalModel : s.activeCloudModel;
    const addedTokens = usage.total_tokens || 0;
    const currentGlobal = s.globalSessionTokens[modelKey] || 0;
    const updatedGlobal = currentGlobal + addedTokens;
    const nextGlobalSessionTokens = {
      ...s.globalSessionTokens,
      [modelKey]: updatedGlobal,
    };
    if (typeof window !== "undefined") {
      localStorage.setItem(`opensarthi_global_tokens_${modelKey}`, updatedGlobal.toString());
    }
    return {
      tabs: updatedTabs,
      tokenUsage: activeTab.tokenUsage,
      globalSessionTokens: nextGlobalSessionTokens,
    };
  }),

  resetSessionTokens: () => set((s) => {
    const updatedTabs = s.tabs.map(t => {
      if (t.id === s.activeThreadId) {
        return {
          ...t,
          tokenUsage: { ...t.tokenUsage, sessionTotalTokens: 0 }
        };
      }
      return t;
    });
    const activeTab = updatedTabs.find(t => t.id === s.activeThreadId)!;
    return {
      tabs: updatedTabs,
      tokenUsage: activeTab.tokenUsage,
    };
  }),

  restoreThreadTokens: (usage) => set((s) => {
    const updatedTabs = s.tabs.map(t => {
      if (t.id === s.activeThreadId) {
        return {
          ...t,
          tokenUsage: {
            requestTokens: usage.request_tokens,
            responseTokens: usage.response_tokens,
            totalTokens: usage.total_tokens,
            sessionTotalTokens: usage.total_tokens,
          }
        };
      }
      return t;
    });
    const activeTab = updatedTabs.find(t => t.id === s.activeThreadId)!;
    return {
      tabs: updatedTabs,
      tokenUsage: activeTab.tokenUsage,
    };
  }),

  setPersonalization: (userName, userSkills, customPrompt) => set({ userName, userSkills, customPrompt }),

  setOnboardingCompleted: (done) => {
    if (typeof window !== "undefined") {
      if (done) localStorage.setItem("opensarthi_onboarding_done", "1");
      else localStorage.removeItem("opensarthi_onboarding_done");
    }
    set({ onboardingCompleted: done });
  },

  updateStepStatus: (index, update, thread_id) => set((s) => {
    const tid = thread_id || s.activeThreadId;
    const updatedTabs = s.tabs.map(t => {
      if (t.id === tid) {
        if (!t.currentPlan) return t;
        const steps = t.currentPlan.steps.map((step, i) =>
          i === index ? { ...step, ...update } : step
        );
        return { ...t, currentPlan: { ...t.currentPlan, steps } };
      }
      return t;
    });
    const activeTab = updatedTabs.find(t => t.id === s.activeThreadId)!;
    return {
      tabs: updatedTabs,
      currentPlan: activeTab.currentPlan,
    };
  }),

  setExecutingStep: (executingStepIndex, thread_id) => set((s) => {
    const tid = thread_id || s.activeThreadId;
    const updatedTabs = s.tabs.map(t => {
      if (t.id === tid) {
        return { ...t, executingStepIndex };
      }
      return t;
    });
    const activeTab = updatedTabs.find(t => t.id === s.activeThreadId)!;
    return {
      tabs: updatedTabs,
      executingStepIndex: activeTab.executingStepIndex,
    };
  }),

  addOrUpdateToolAction: (tool, description, status, result, thread_id) => set((s) => {
    const tid = thread_id || s.activeThreadId;
    const updatedTabs = s.tabs.map(t => {
      if (t.id === tid) {
        let plan = t.currentPlan;
        if (!plan) {
          plan = { 
            id: crypto.randomUUID(), 
            goal: "Executing User Command...", 
            steps: [], 
            recovery_hint: null 
          };
        }

        const steps = [...plan.steps];
        const existingIndex = steps.findIndex(st => st.tool === tool && st.description === description && (st.status === "pending" || st.status === "running"));
        
        if (existingIndex >= 0) {
          steps[existingIndex] = { ...steps[existingIndex], status, result, timestamp: Date.now() };
        } else {
          steps.push({
            index: steps.length,
            tool,
            args: {},
            description,
            status,
            result,
            timestamp: Date.now()
          });
        }
        return { ...t, currentPlan: { ...plan, steps } };
      }
      return t;
    });
    const activeTab = updatedTabs.find(t => t.id === s.activeThreadId)!;
    return {
      tabs: updatedTabs,
      currentPlan: activeTab.currentPlan,
    };
  }),

  setTaskPaused: (taskPaused, thread_id) => set((s) => {
    const tid = thread_id || s.activeThreadId;
    const updatedTabs = s.tabs.map(t => {
      if (t.id === tid) {
        return { ...t, taskPaused };
      }
      return t;
    });
    const activeTab = updatedTabs.find(t => t.id === s.activeThreadId)!;
    return {
      tabs: updatedTabs,
      taskPaused: activeTab.taskPaused,
    };
  }),

  setOverlayMode: (isOverlayMode) => set({ isOverlayMode }),
  setUserOverrodeMinimize: (userOverrodeMinimize) => set({ userOverrodeMinimize }),
  setSnapAlign: (snapAlign) => set({ snapAlign }),

  appendShellOutputLine: (line) => set((s) => ({
    shellOutputLines: [...s.shellOutputLines.slice(-200), line],
  })),
  clearShellOutput: () => set({ shellOutputLines: [] }),
  setLastClassification: (lastClassification) => set({ lastClassification }),
  appendStreamChunk: (chunk) => set((s) => ({
    streamingResponse: (s.streamingResponse || "") + chunk,
  })),
  clearStreamingResponse: () => set({ streamingResponse: null }),
  lastStreamedMessageId: null,
  markStreamedMessage: (id) => set({ lastStreamedMessageId: id }),
  clearStreamedMessage: () => set({ lastStreamedMessageId: null }),
  setSoundSettings: (enabled, volume) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("opensarthi_sound_enabled", String(enabled));
      localStorage.setItem("opensarthi_sound_volume", String(volume));
    }
    set({ soundEnabled: enabled, soundVolume: volume });
  },

  addPlanReasoning: (reasoning) => set((state) => {
    const tid = reasoning.thread_id || "default";
    const existing = state.planReasonings[tid] || [];
    return {
      planReasonings: {
        ...state.planReasonings,
        [tid]: [...existing, reasoning],
      }
    };
  }),

  clearPlanReasonings: (thread_id) => set((state) => {
    const updated = { ...state.planReasonings };
    delete updated[thread_id];
    return { planReasonings: updated };
  }),
  sidecarLogs: [],
  addSidecarLogs: (lines) => set((state) => {
    const time = new Date().toLocaleTimeString([], { hour12: false });
    const formattedLines = lines.map(line => `[${time}] ${line}`);
    const merged = [...state.sidecarLogs, ...formattedLines];
    return {
      sidecarLogs: merged.slice(-150)
    };
  }),
  clearSidecarLogs: () => set({ sidecarLogs: [] }),
  activityLogs: [{ id: crypto.randomUUID(), text: "SYS: OpenSarthi online.", timestamp: Date.now() }],
  addActivityLog: (text) => set((state) => {
    const newLog = { id: crypto.randomUUID(), text, timestamp: Date.now() };
    return {
      activityLogs: [...state.activityLogs, newLog].slice(-100)
    };
  }),
  clearActivityLogs: () => set({ activityLogs: [] }),
  contentPanel: { contentType: null, contentData: null },
  setContentPanel: (contentType, contentData) => set({ contentPanel: { contentType, contentData } }),
  customAccent: typeof window !== "undefined" ? localStorage.getItem("opensarthi_custom_accent") : null,
  setCustomAccent: (color) => {
    if (typeof window !== "undefined") {
      if (color) {
        localStorage.setItem("opensarthi_custom_accent", color);
      } else {
        localStorage.removeItem("opensarthi_custom_accent");
      }
    }
    set({ customAccent: color });
  },
  systemMetrics: { 
    cpu: 0, 
    mem: 0, 
    net_kbps: 0, 
    gpu: "N/A", 
    temp: "N/A",
    mobile_status: { enabled: false, connected: false, devices: [] }
  },
  setSystemMetrics: (systemMetrics) => set({ systemMetrics }),
  pendingOnboarding: null,
  setPendingOnboarding: (data) => set({ pendingOnboarding: data }),
}));
