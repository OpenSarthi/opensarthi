import { useEffect, useState } from "react";
import { useAssistantStore } from "./stores/assistantStore";
import { wsClient } from "./lib/ws";
import { updateNotificationTaskState } from "./lib/native";
import { MobileAssistant } from "./components/mobile/MobileAssistant";
import { SettingsView } from "./components/mobile/SettingsView";
import { OnboardingView } from "./components/mobile/OnboardingView";
import { HistoryView } from "./components/mobile/HistoryView";
import { AnimatePresence } from "framer-motion";

/**
 * Wire up WebSocket handlers — same message handlers as desktop useWebSocket hook,
 * adapted for the mobile app (no Tauri, no port discovery).
 */
function useAndroidWebSocket() {
  const {
    setConnected, setTranscript, setVoiceState,
    addMessage, setPlan, updateStepStatus, setExecutingStep,
    setActiveModels, setActiveProvider, setAllApiKeys, setCustomOpenaiProviderName,
    setVoiceSettings, setWakeWordSettings, setActiveTheme,
    setTaskPaused, setPersonalization, addOrUpdateToolAction,
    updateTokenUsageFromWS, loadThreadToTab, setLastClassification,
    setThreads, setNodeStatus, setSystemMetrics, setLongTermMemories,
    setLongTermMemoryEnabled, setUseLanggraph, setUseSupervisor, setUseNativeVoice,
    setContentPanel, addActivityLog, addPlanReasoning, clearPlanReasonings,
    appendShellOutputLine, setPendingOnboarding,
  } = useAssistantStore();

  useEffect(() => {
    // Connect immediately on mount — runtime is already running via Chaquopy
    wsClient.connect();

    const unsubs = [
      wsClient.on("session_state", () => {
        setConnected(wsClient.isConnected);
        const onboardingDone = useAssistantStore.getState().onboardingCompleted;
        const activeId = useAssistantStore.getState().activeThreadId;
        // Announce client state
        wsClient.send("client_state", { page: onboardingDone ? "assistant" : "onboarding", thread_id: activeId });
        if (activeId) {
          wsClient.send("load_thread", { thread_id: activeId, onboarding_complete: onboardingDone });
        }
      }),

      wsClient.on("settings_sync", (msg) => {
        const p = msg.payload as any;
        const store = useAssistantStore.getState();

        // Apply pending onboarding overrides if present
        const pending = store.pendingOnboarding;
        if (pending) {
          p.ai_provider = pending.provider || p.ai_provider;
          if (pending.localModel) p.local_model = pending.localModel;
          if (pending.cloudModel) p.cloud_model = pending.cloudModel;
          if (pending.userName) p.user_name = pending.userName;
          if (pending.skills) p.user_skills = pending.skills;
          if (pending.customPrompt) p.custom_prompt = pending.customPrompt;
          if (pending.apiKey) {
            if (pending.provider === "google") p.gemini_api_key = pending.apiKey;
            else if (pending.provider === "openai") p.openai_api_key = pending.apiKey;
            else if (pending.provider === "anthropic") p.anthropic_api_key = pending.apiKey;
            else if (pending.provider === "groq") p.groq_api_key = pending.apiKey;
            else if (pending.provider === "openrouter") p.openrouter_api_key = pending.apiKey;
          }
          if (pending.provider === "custom_openai") {
            p.custom_openai_base_url = (pending as any).customOpenaiBaseUrl || p.custom_openai_base_url;
            p.custom_openai_api_key = (pending as any).customOpenaiApiKey || pending.apiKey || p.custom_openai_api_key;
            p.custom_openai_provider_name = (pending as any).customOpenaiProviderName || p.custom_openai_provider_name;
          }
        }

        if (p.local_model && p.cloud_model) setActiveModels(p.local_model, p.cloud_model);
        if (p.ai_provider) setActiveProvider(p.ai_provider);
        if (p.custom_openai_provider_name !== undefined) setCustomOpenaiProviderName(p.custom_openai_provider_name || "");
        if (p.voice_accent !== undefined && p.voice_speed !== undefined && p.continuous_listening !== undefined) {
          setVoiceSettings(p.voice_accent, p.voice_speed, p.continuous_listening);
        }
        if (p.wake_words !== undefined && p.wake_word_enabled !== undefined && p.wake_word_threshold !== undefined) {
          setWakeWordSettings(p.wake_word_enabled, p.wake_word_threshold, p.wake_words);
        }
        if (p.active_theme) setActiveTheme(p.active_theme);
        if (p.long_term_memory_enabled !== undefined) setLongTermMemoryEnabled(p.long_term_memory_enabled);
        if (p.use_langgraph !== undefined) setUseLanggraph(p.use_langgraph);
        if (p.use_supervisor !== undefined) setUseSupervisor(p.use_supervisor);
        if (p.use_native_voice !== undefined) setUseNativeVoice(p.use_native_voice);

        setAllApiKeys({
          gemini: p.gemini_api_key || "",
          openai: p.openai_api_key || "",
          anthropic: p.anthropic_api_key || "",
          groq: p.groq_api_key || "",
          openrouter: p.openrouter_api_key || "",
          customOpenaiBaseUrl: p.custom_openai_base_url || "",
          customOpenaiKey: p.custom_openai_api_key || "",
          customOpenaiApiKey: p.custom_openai_api_key || "",
          customOpenaiProviderName: p.custom_openai_provider_name || "",
        });

        if (p.user_name !== undefined || p.user_skills !== undefined || p.custom_prompt !== undefined) {
          setPersonalization(
            p.user_name || store.userName,
            p.user_skills || store.userSkills,
            p.custom_prompt || store.customPrompt,
          );
        }

        // Broadcast merged pending onboarding back to backend
        if (pending) {
          setPendingOnboarding(null);
          wsClient.send("update_settings", {
            user_name: p.user_name || "",
            user_skills: p.user_skills || [],
            custom_prompt: p.custom_prompt || "",
            ai_provider: p.ai_provider,
            local_model: p.local_model,
            cloud_model: p.cloud_model,
            gemini_api_key: p.gemini_api_key || "",
            openai_api_key: p.openai_api_key || "",
            anthropic_api_key: p.anthropic_api_key || "",
            groq_api_key: p.groq_api_key || "",
            openrouter_api_key: p.openrouter_api_key || "",
            custom_openai_base_url: p.custom_openai_base_url || "",
            custom_openai_api_key: p.custom_openai_api_key || "",
            custom_openai_provider_name: p.custom_openai_provider_name || "",
          });
        }
      }),

      wsClient.on("transcript_update", (msg) => {
        const p = msg.payload as any;
        const text = p.text ?? "";
        const { voiceState, setVoiceState, setTranscript, wakeWords, wakeWordEnabled } = useAssistantStore.getState();

        if (voiceState === "idle" || voiceState === "error") {
          if (!wakeWordEnabled || !wakeWords || wakeWords.length === 0) return;

          const lowerText = text.toLowerCase();
          const escapedWakeWords = wakeWords.map((w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
          const hasSarthi = wakeWords.some((w: string) => w.toLowerCase().includes("sarthi") || w.toLowerCase().includes("sarathi"));
          if (hasSarthi) {
            escapedWakeWords.push("sanati", "farati", "sarath", "sarth", "sorthi", "sorathi", "sorth", "sharthi", "sharathi", "sharth", "sarty", "sarathy", "sarti", "sarathi", "sarthii", "sarathii");
          }

          escapedWakeWords.sort((a: string, b: string) => b.length - a.length);

          const wakeWordPattern = escapedWakeWords.join('|');
          const wakeWordRegex = new RegExp(`(?:^|\\s)(?:hey|hello|hi)?\\s*(?:${wakeWordPattern})(?:\\s|$|[,;:.!?])`, 'i');
          const hasWakeWord = wakeWordRegex.test(lowerText);

          if (hasWakeWord) {
            const wakeWordRegexFull = new RegExp(`^(?:.*?)(?:hey|hello|hi)?\\s*(?:${wakeWordPattern})`, 'i');
            const cleanText = text
              .replace(wakeWordRegexFull, "")
              .replace(/^[\s,;:.!?]+/, "")
              .replace(/[\s,;:.!?]+$/, "")
              .trim();

            setVoiceState("listening");
            setTranscript(cleanText);
          }
        } else if (voiceState === "listening") {
          const currentTranscript = useAssistantStore.getState().currentTranscript;
          const newTranscript = currentTranscript ? `${currentTranscript} ${text}`.trim() : text;
          setTranscript(newTranscript);
        }
      }),

      wsClient.on("voice_state", (msg) => {
        const p = msg.payload as any;
        setVoiceState(p.state ?? "idle");
      }),

      wsClient.on("plan_created", (msg) => {
        const p = msg.payload as any;
        if (p.thread_id) clearPlanReasonings(p.thread_id);
        setPlan({ id: p.id, goal: p.goal, steps: p.steps ?? [], recovery_hint: p.recovery_hint ?? null, reasoning: p.reasoning ?? null }, p.thread_id);
        // Notify native runtime service that a task is active.
        updateNotificationTaskState(true, false);
        setVoiceState("processing");
        addActivityLog(`SYS: Task plan created with ${(p.steps ?? []).length} steps.`);
      }),

      wsClient.on("plan_reasoning", (msg) => {
        const p = msg.payload as any;
        addPlanReasoning({
          text: p.text ?? "",
          attempt: p.attempt ?? 0,
          thread_id: p.thread_id ?? null,
        });
      }),

      wsClient.on("tool_started", (msg) => {
        const p = msg.payload as any;
        if (p.tool === "shell") {
          useAssistantStore.getState().clearShellOutput();
        }
        setExecutingStep(p.index, p.thread_id);
        updateStepStatus(p.index, {
          status: "running",
          timestamp: Date.now(),
          ...(p.tool && { tool: p.tool }),
          ...(p.description && { description: p.description }),
          ...(p.args && { args: p.args }),
        }, p.thread_id);
      }),

      wsClient.on("tool_completed", (msg) => {
        const p = msg.payload as any;
        updateStepStatus(p.index, {
          status: "success",
          result: p.result,
          timestamp: Date.now(),
          ...(p.tool && { tool: p.tool }),
          ...(p.description && { description: p.description }),
          ...(p.args && { args: p.args }),
        }, p.thread_id);
        setExecutingStep(null, p.thread_id);
      }),

      wsClient.on("tool_error", (msg) => {
        const p = msg.payload as any;
        updateStepStatus(p.index, {
          status: "error",
          error: p.error,
          timestamp: Date.now(),
          ...(p.tool && { tool: p.tool }),
          ...(p.description && { description: p.description }),
          ...(p.args && { args: p.args }),
        }, p.thread_id);
        setExecutingStep(null, p.thread_id);
      }),

      wsClient.on("tool_terminated", (msg) => {
        const p = msg.payload as any;
        updateStepStatus(p.index, { status: "terminated" }, p.thread_id);
      }),

      wsClient.on("tool_action", (msg) => {
        const p = msg.payload as any;
        addOrUpdateToolAction(p.tool, p.description, p.status, p.result, p.thread_id);
      }),

      wsClient.on("assistant_response", (msg) => {
        const p = msg.payload as any;
        addMessage({
          id: p.id ?? crypto.randomUUID(),
          role: "assistant",
          content: p.content ?? "",
          timestamp: p.timestamp ?? Date.now(),
          plan: p.plan ?? null,
          token_request: p.token_request,
          token_response: p.token_response,
          token_total: p.token_total,
        }, p.thread_id);
        setTranscript(null);
        const usage = p.usage;
        if (usage) useAssistantStore.getState().updateTokenUsage(usage, p.thread_id);
        setVoiceState(p.is_voice ? "speaking" : "idle");
        setPlan(null, p.thread_id);
        setExecutingStep(null, p.thread_id);
        // Task completed — update native notification
        updateNotificationTaskState(false, false);
      }),

      wsClient.on("user_message", (msg) => {
        const p = msg.payload as any;
        const tid = p.thread_id || useAssistantStore.getState().activeThreadId;
        const activeTab = useAssistantStore.getState().tabs.find((t: any) => t.id === tid);
        const lastMsg = activeTab?.messages[activeTab.messages.length - 1];
        if (
          activeTab?.messages.some((m: any) => m.id === p.id) ||
          (lastMsg && lastMsg.role === "user" && lastMsg.content === p.content)
        ) return;
        addMessage({
          id: p.id ?? crypto.randomUUID(),
          role: "user",
          content: p.content ?? "",
          timestamp: p.timestamp ?? Date.now(),
        }, p.thread_id);
      }),

      wsClient.on("task_paused", (msg) => {
        const p = msg.payload as any;
        setTaskPaused(true, p.thread_id);
        updateNotificationTaskState(true, true);
        addActivityLog("SYS: Task execution paused.");
      }),

      wsClient.on("task_resumed", (msg) => {
        const p = msg.payload as any;
        setTaskPaused(false, p.thread_id);
        updateNotificationTaskState(true, false);
        addActivityLog("SYS: Task execution resumed.");
      }),

      wsClient.on("agent_state", (msg) => {
        const p = msg.payload as any;
        if (p.state === "idle" || p.state === "complete") {
          setPlan(null, p.thread_id);
          setTaskPaused(false, p.thread_id);
          updateNotificationTaskState(false, false);
        }
      }),

      wsClient.on("token_update", (msg) => {
        const p = msg.payload as any;
        updateTokenUsageFromWS(p.thread_id, p);
      }),

      wsClient.on("thread_loaded", (msg) => {
        const p = msg.payload as any;
        loadThreadToTab(p.thread_id, p.messages ?? [], p.token_totals);
      }),

      wsClient.on("intent_classified", (msg) => {
        const p = msg.payload as any;
        setLastClassification(p.classification ?? null);
      }),

      wsClient.on("speech_started", () => setVoiceState("speaking")),
      wsClient.on("speech_completed", (msg) => {
        const wasManual = (msg?.payload as any)?.was_manual === true;
        if (wasManual) { setVoiceState("idle"); return; }
        const { continuousListening } = useAssistantStore.getState();
        setVoiceState(continuousListening ? "listening" : "idle");
      }),

      wsClient.on("history_response", (msg) => {
        const p = msg.payload as any;
        setThreads(p.threads ?? []);
      }),

      wsClient.on("memories_response", (msg) => {
        const p = msg.payload as any;
        setLongTermMemories(p.memories ?? []);
      }),

      wsClient.on("graph_node_status", (msg) => {
        const p = msg.payload as any;
        setNodeStatus(p.node, p.status ?? "idle");
      }),

      wsClient.on("system_metrics", (msg) => {
        const p = msg.payload as any;
        if (p) setSystemMetrics({
          cpu: p.cpu ?? 0,
          mem: p.mem ?? 0,
          net_kbps: p.net_kbps ?? 0,
          gpu: p.gpu ?? "N/A",
          temp: p.temp ?? "N/A",
        });
      }),

      wsClient.on("shell_output", (msg) => {
        const p = msg.payload as any;
        if (p.line) appendShellOutputLine(p.line);
      }),

      wsClient.on("briefing_phase1", (msg) => {
        const p = msg.payload as any;
        const store = useAssistantStore.getState();
        const targetTid = (p.thread_id && store.tabs.some(t => t.id === p.thread_id)) ? p.thread_id : store.activeThreadId;
        store.addMessage({
          id: p.id ?? crypto.randomUUID(),
          role: "assistant",
          content: p.text ?? "",
          timestamp: p.timestamp ?? Date.now(),
        }, targetTid);
      }),

      wsClient.on("briefing_phase2", (msg) => {
        const p = msg.payload as any;
        const store = useAssistantStore.getState();
        if (p.content_panel_data) {
          store.setContentPanel("briefing", p.content_panel_data);
        }
        if (p.text) {
          const targetTid = (p.thread_id && store.tabs.some(t => t.id === p.thread_id)) ? p.thread_id : store.activeThreadId;
          store.addMessage({
            id: p.id ?? crypto.randomUUID(),
            role: "assistant",
            content: p.text,
            timestamp: p.timestamp ?? Date.now(),
          }, targetTid);
        }
      }),

      wsClient.on("screen_analysis", (msg) => {
        const p = msg.payload as any;
        const store = useAssistantStore.getState();
        if (p.text) store.setContentPanel("screen_analysis", p.text);
      }),

      wsClient.on("content_update", (msg) => {
        const p = msg.payload as any;
        const store = useAssistantStore.getState();
        store.setContentPanel(p.content_type, p.data);
      }),

      wsClient.on("activity_log", (msg) => {
        const p = msg.payload as any;
        if (p.text) addActivityLog(p.text);
      }),
    ];

    // Connection health check interval
    const healthCheck = setInterval(() => {
      setConnected(wsClient.isConnected);
    }, 2000);

    return () => {
      unsubs.forEach((u) => u?.());
      clearInterval(healthCheck);
      wsClient.disconnect();
    };
  }, []);
}

// ─── App Root ─────────────────────────────────────────────────────────────────

export default function App() {
  useAndroidWebSocket();

  const [showSettings, setShowSettings] = useState(false);
  const [settingsMode, setSettingsMode] = useState<"agent" | "interaction" | "system" | "all">("all");
  const [showHistory, setShowHistory] = useState(false);
  const [showCustomizer, setShowCustomizer] = useState(false);

  const {
    activeLocalModel, activeCloudModel, activeProvider,
    geminiApiKey, openaiApiKey, anthropicApiKey, groqApiKey, openrouterApiKey,
    customOpenaiBaseUrl, customOpenaiApiKey, customOpenaiProviderName,
    voiceAccent, voiceSpeed, continuousListening, activeTheme,
    wakeWords, wakeWordEnabled, wakeWordThreshold,
    longTermMemoryEnabled, useLanggraph, useSupervisor, useNativeVoice,
    soundEnabled, soundVolume, customAccent,
    onboardingCompleted,
    setActiveModels, setActiveProvider, setAllApiKeys, setCustomOpenaiProviderName,
    setVoiceSettings, setWakeWordSettings, setActiveTheme, setSoundSettings,
    setLongTermMemoryEnabled, setUseLanggraph, setUseSupervisor, setUseNativeVoice,
    setCustomAccent, setOnboardingCompleted, setPersonalization, addTab,
    resetSessionTokens, setPendingOnboarding,
  } = useAssistantStore();

  useEffect(() => {
    document.body.className = document.body.className
      .split(" ")
      .filter((c) => !c.startsWith("theme-"))
      .join(" ");
    document.body.classList.add(activeTheme);
  }, [activeTheme]);

  // Apply custom accent color dynamically (hex → HSL) — same as desktop
  useEffect(() => {
    if (customAccent) {
      const hex = customAccent.replace("#", "");
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      let h = 0;
      if (max !== min) {
        const d = max - min;
        switch (max) {
          case r: h = (g - b) / d + (g < b ? 6 : 0); break;
          case g: h = (b - r) / d + 2; break;
          case b: h = (r - g) / d + 4; break;
        }
        h = Math.round((h / 6) * 360);
      }

      document.documentElement.style.setProperty("--accent", customAccent);
      document.documentElement.style.setProperty("--border-accent", customAccent);
      document.documentElement.style.setProperty("--accent-dim", `hsl(${h}, 100%, 40%)`);
      document.documentElement.style.setProperty("--accent-glow", `${customAccent}66`);
      document.documentElement.style.setProperty("--accent-glow-lg", `${customAccent}26`);
      document.documentElement.style.setProperty("--shadow-accent", `0 0 24px ${customAccent}66`);
      document.documentElement.style.setProperty("--text-primary", `hsl(${h}, 60%, 92%)`);
      document.documentElement.style.setProperty("--text-secondary", `hsl(${h}, 100%, 65%)`);
      document.documentElement.style.setProperty("--text-muted", `hsl(${h}, 80%, 40%)`);
      document.documentElement.style.setProperty("--border", `hsla(${h}, 100%, 40%, 0.3)`);
      document.documentElement.style.setProperty(
        "--bg-body-gradient",
        `radial-gradient(ellipse at 20% 50%, hsla(${h}, 100%, 3%, 0.9) 0%, hsla(${h}, 60%, 1%, 0.98) 70%)`
      );
    } else {
      [
        "--accent", "--border-accent", "--accent-dim",
        "--accent-glow", "--accent-glow-lg", "--shadow-accent",
        "--text-primary", "--text-secondary", "--text-muted",
        "--border", "--bg-body-gradient",
      ].forEach(v => document.documentElement.style.removeProperty(v));
    }
  }, [customAccent]);

  const handleSaveSettings = (settings: {
    localModel: string;
    cloudModel: string;
    provider: string;
    geminiKey: string;
    openaiKey: string;
    anthropicKey: string;
    groqKey: string;
    openrouterKey: string;
    customOpenaiBaseUrl: string;
    customOpenaiApiKey: string;
    customOpenaiProviderName: string;
    voiceAccent: string;
    voiceSpeed: number;
    continuousListening: boolean;
    theme: string;
    wakeWords: string[];
    wakeWordEnabled: boolean;
    wakeWordThreshold: number;
    longTermMemoryEnabled: boolean;
    useLanggraph: boolean;
    useSupervisor: boolean;
    useNativeVoice: boolean;
    soundEnabled: boolean;
    soundVolume: number;
    customAccent: string | null;
  }) => {
    setActiveModels(settings.localModel, settings.cloudModel);
    setActiveProvider(settings.provider);
    setAllApiKeys({
      gemini: settings.geminiKey,
      openai: settings.openaiKey,
      anthropic: settings.anthropicKey,
      groq: settings.groqKey,
      openrouter: settings.openrouterKey,
      customOpenaiBaseUrl: settings.customOpenaiBaseUrl,
      customOpenaiApiKey: settings.customOpenaiApiKey,
      customOpenaiProviderName: settings.customOpenaiProviderName,
    });
    setCustomOpenaiProviderName(settings.customOpenaiProviderName);
    setVoiceSettings(settings.voiceAccent, settings.voiceSpeed, settings.continuousListening);
    setWakeWordSettings(settings.wakeWordEnabled, settings.wakeWordThreshold, settings.wakeWords);
    setActiveTheme(settings.theme);
    setSoundSettings(settings.soundEnabled, settings.soundVolume);
    setLongTermMemoryEnabled(settings.longTermMemoryEnabled);
    setUseLanggraph(settings.useLanggraph);
    setUseSupervisor(settings.useSupervisor);
    setUseNativeVoice(settings.useNativeVoice);
    setCustomAccent(settings.customAccent);

    wsClient.send("update_settings", {
      local_model: settings.localModel,
      cloud_model: settings.cloudModel,
      ai_provider: settings.provider,
      gemini_api_key: settings.geminiKey,
      openai_api_key: settings.openaiKey,
      anthropic_api_key: settings.anthropicKey,
      groq_api_key: settings.groqKey,
      openrouter_api_key: settings.openrouterKey,
      custom_openai_base_url: settings.customOpenaiBaseUrl || "",
      custom_openai_api_key: settings.customOpenaiApiKey || "",
      custom_openai_provider_name: settings.customOpenaiProviderName || "",
      voice_accent: settings.voiceAccent,
      voice_speed: settings.voiceSpeed,
      continuous_listening: settings.continuousListening,
      active_theme: settings.theme,
      wake_words: settings.wakeWords,
      wake_word_enabled: settings.wakeWordEnabled,
      wake_word_threshold: settings.wakeWordThreshold,
      long_term_memory_enabled: settings.longTermMemoryEnabled,
      use_langgraph: settings.useLanggraph,
      use_supervisor: settings.useSupervisor,
      use_native_voice: settings.useNativeVoice,
    });
  };

  const handleOnboardingComplete = (data: {
    skills: string[];
    userName: string;
    customPrompt: string;
    provider?: string;
    cloudModel?: string;
    localModel?: string;
    apiKey?: string;
    customOpenaiBaseUrl?: string;
    customOpenaiApiKey?: string;
    customOpenaiProviderName?: string;
    allApiKeys?: Record<string, string>;
  }) => {
    // Cache pending onboarding details locally so they are not wiped by initial connection sync
    setPendingOnboarding(data);
    setPersonalization(data.userName, data.skills, data.customPrompt);

    if (data.provider) {
      setActiveProvider(data.provider);
      if (data.localModel || data.cloudModel) {
        setActiveModels(data.localModel || activeLocalModel, data.cloudModel || activeCloudModel);
      }
      const gKey = data.allApiKeys?.google || (data.provider === "google" ? (data.apiKey || geminiApiKey) : geminiApiKey);
      const oKey = data.allApiKeys?.openai || (data.provider === "openai" ? (data.apiKey || openaiApiKey) : openaiApiKey);
      const aKey = data.allApiKeys?.anthropic || (data.provider === "anthropic" ? (data.apiKey || anthropicApiKey) : anthropicApiKey);
      const grKey = data.allApiKeys?.groq || (data.provider === "groq" ? (data.apiKey || groqApiKey) : groqApiKey);
      const orKey = data.allApiKeys?.openrouter || (data.provider === "openrouter" ? (data.apiKey || openrouterApiKey) : openrouterApiKey);
      const coBase = data.customOpenaiBaseUrl || customOpenaiBaseUrl;
      const coKey = data.allApiKeys?.custom_openai || data.customOpenaiApiKey || (data.provider === "custom_openai" ? (data.apiKey || customOpenaiApiKey) : customOpenaiApiKey);
      const coName = data.customOpenaiProviderName || customOpenaiProviderName;

      setAllApiKeys({
        gemini: gKey,
        openai: oKey,
        anthropic: aKey,
        groq: grKey,
        openrouter: orKey,
        customOpenaiBaseUrl: coBase,
        customOpenaiApiKey: coKey,
        customOpenaiProviderName: coName,
      });
      if (coName) setCustomOpenaiProviderName(coName);
    }

    setOnboardingCompleted(true);

    const sendPersonalization = () => {
      const gKey = data.allApiKeys?.google || (data.provider === "google" ? (data.apiKey || geminiApiKey) : geminiApiKey);
      const oKey = data.allApiKeys?.openai || (data.provider === "openai" ? (data.apiKey || openaiApiKey) : openaiApiKey);
      const aKey = data.allApiKeys?.anthropic || (data.provider === "anthropic" ? (data.apiKey || anthropicApiKey) : anthropicApiKey);
      const grKey = data.allApiKeys?.groq || (data.provider === "groq" ? (data.apiKey || groqApiKey) : groqApiKey);
      const orKey = data.allApiKeys?.openrouter || (data.provider === "openrouter" ? (data.apiKey || openrouterApiKey) : openrouterApiKey);
      const coBase = data.customOpenaiBaseUrl || customOpenaiBaseUrl;
      const coKey = data.allApiKeys?.custom_openai || data.customOpenaiApiKey || (data.provider === "custom_openai" ? (data.apiKey || customOpenaiApiKey) : customOpenaiApiKey);
      const coName = data.customOpenaiProviderName || customOpenaiProviderName;

      wsClient.send("update_settings", {
        user_name: data.userName,
        user_skills: data.skills,
        custom_prompt: data.customPrompt,
        ...(data.provider ? {
          ai_provider: data.provider,
          local_model: data.localModel || activeLocalModel,
          cloud_model: data.cloudModel || activeCloudModel,
          gemini_api_key: gKey,
          openai_api_key: oKey,
          anthropic_api_key: aKey,
          groq_api_key: grKey,
          openrouter_api_key: orKey,
          custom_openai_base_url: coBase,
          custom_openai_api_key: coKey,
          custom_openai_provider_name: coName,
        } : {})
      });
      const activeId = useAssistantStore.getState().activeThreadId;
      if (activeId) wsClient.send("load_thread", { thread_id: activeId, onboarding_complete: true });
      wsClient.send("client_state", { page: "assistant" });
    };

    if (wsClient.isConnected) {
      sendPersonalization();
    } else {
      const interval = setInterval(() => {
        if (wsClient.isConnected) {
          sendPersonalization();
          clearInterval(interval);
        }
      }, 300);
      setTimeout(() => clearInterval(interval), 10000);
    }
  };

  return (
    <>
      <MobileAssistant
        onOpenSettings={(mode = "all") => { setSettingsMode(mode); setShowSettings(true); }}
        onOpenHistory={() => setShowHistory(true)}
        onOpenCustomizer={() => setShowCustomizer(true)}
      />
      <AnimatePresence>
        {!onboardingCompleted && (
          <OnboardingView onComplete={handleOnboardingComplete} />
        )}
        {showCustomizer && (
          <OnboardingView
            isEdit
            onClose={() => setShowCustomizer(false)}
            onComplete={(data) => {
              handleOnboardingComplete(data);
              setShowCustomizer(false);
            }}
          />
        )}
        {showSettings && (
          <SettingsView
            onClose={() => setShowSettings(false)}
            viewMode={settingsMode}
            currentLocalModel={activeLocalModel}
            currentCloudModel={activeCloudModel}
            currentProvider={activeProvider}
            currentGeminiKey={geminiApiKey}
            currentOpenaiKey={openaiApiKey}
            currentAnthropicKey={anthropicApiKey}
            currentGroqKey={groqApiKey}
            currentOpenrouterKey={openrouterApiKey}
            currentCustomOpenaiBaseUrl={customOpenaiBaseUrl}
            currentCustomOpenaiApiKey={customOpenaiApiKey}
            currentCustomOpenaiProviderName={customOpenaiProviderName}
            currentVoiceAccent={voiceAccent}
            currentVoiceSpeed={voiceSpeed}
            currentContinuousListening={continuousListening}
            currentTheme={activeTheme}
            currentWakeWords={wakeWords}
            currentWakeWordEnabled={wakeWordEnabled}
            currentWakeWordThreshold={wakeWordThreshold}
            currentLongTermMemoryEnabled={longTermMemoryEnabled}
            currentUseLanggraph={useLanggraph}
            currentUseSupervisor={useSupervisor}
            currentUseNativeVoice={useNativeVoice}
            currentSoundEnabled={soundEnabled}
            currentSoundVolume={soundVolume}
            currentCustomAccent={customAccent}
            onSave={handleSaveSettings}
          />
        )}
        {showHistory && (
          <HistoryView
            onClose={() => setShowHistory(false)}
            onNewChat={() => {
              addTab();
              resetSessionTokens();
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
