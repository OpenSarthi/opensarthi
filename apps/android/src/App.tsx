import { useEffect, useState } from "react";
import { useAssistantStore } from "./stores/assistantStore";
import { wsClient } from "./lib/ws";
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
    setActiveModels, setActiveProvider, setAllApiKeys,
    setVoiceSettings, setWakeWordSettings, setActiveTheme,
    setTaskPaused, setPersonalization, addOrUpdateToolAction,
    updateTokenUsageFromWS, loadThreadToTab, setLastClassification,
    setThreads,
  } = useAssistantStore();

  useEffect(() => {
    // Connect immediately on mount — runtime is already running via Chaquopy
    wsClient.connect();

    const unsubs = [
      wsClient.on("session_state", () => {
        setConnected(wsClient.isConnected);
        const onboardingDone = useAssistantStore.getState().onboardingCompleted;
        // Announce client state
        wsClient.send("client_state", { page: onboardingDone ? "assistant" : "onboarding" });
      }),

      wsClient.on("settings_sync", (msg) => {
        const p = msg.payload as any;
        setActiveModels(p.local_model ?? "", p.cloud_model ?? "");
        setActiveProvider(p.ai_provider ?? "google");
        setAllApiKeys({
          gemini: p.gemini_api_key ?? "",
          openai: p.openai_api_key ?? "",
          anthropic: p.anthropic_api_key ?? "",
          groq: p.groq_api_key ?? "",
          openrouter: p.openrouter_api_key ?? "",
        });
        setVoiceSettings(p.voice_accent ?? "ie", p.voice_speed ?? 1.35, p.continuous_listening ?? false);
        setWakeWordSettings(p.wake_word_enabled ?? true, p.wake_word_threshold ?? 0.5, p.wake_words ?? []);
        setActiveTheme(p.active_theme ?? "theme-red-black");
        if (p.user_name || p.user_skills || p.custom_prompt) {
          setPersonalization(p.user_name ?? "", p.user_skills ?? [], p.custom_prompt ?? "");
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

          // Sort by length descending to match longer phrases first and prevent partial word shadowing
          escapedWakeWords.sort((a: string, b: string) => b.length - a.length);

          const wakeWordRegex = new RegExp(`(?:${escapedWakeWords.join('|')})`, 'i');
          const hasWakeWord = wakeWordRegex.test(lowerText);
          
          if (hasWakeWord) {
            try {
              const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
              const oscillator = audioCtx.createOscillator();
              const gainNode = audioCtx.createGain();
              oscillator.type = 'sine';
              oscillator.frequency.setValueAtTime(600, audioCtx.currentTime);
              oscillator.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.1);
              gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
              gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
              oscillator.connect(gainNode);
              gainNode.connect(audioCtx.destination);
              oscillator.start();
              oscillator.stop(audioCtx.currentTime + 0.2);
            } catch (err) {
              console.warn("Beep failed:", err);
            }
            
            // Clean the text by discarding everything up to and including the matched wake word
            const wakeWordRegexFull = new RegExp(`^(?:.*?)(?:hey|hello|hi|he)?\\s*(?:${escapedWakeWords.join('|')})`, 'i');
            const cleanText = text
              .replace(wakeWordRegexFull, "")
              .replace(/^[\s,;:.!?]+/, "")
              .replace(/[\s,;:.!?]+$/, "")
              .trim();
            
            setVoiceState("listening");
            setTranscript(cleanText);
          }
        } else if (voiceState === "listening") {
          setTranscript(text);
        }
      }),

      wsClient.on("voice_state", (msg) => {
        const p = msg.payload as any;
        setVoiceState(p.state ?? "idle");
      }),

      wsClient.on("assistant_response", (msg) => {
        const p = msg.payload as any;
        addMessage({
          id: p.id ?? crypto.randomUUID(),
          role: "assistant",
          content: p.content ?? "",
          timestamp: p.timestamp ?? Date.now(),
          token_request: p.token_request,
          token_response: p.token_response,
          token_total: p.token_total,
        }, p.thread_id);
        setVoiceState("idle");
      }),

      wsClient.on("plan_created", (msg) => {
        const p = msg.payload as any;
        setPlan({ id: p.id, goal: p.goal, steps: p.steps ?? [], recovery_hint: p.recovery_hint ?? null }, p.thread_id);
      }),

      wsClient.on("tool_started", (msg) => {
        const p = msg.payload as any;
        updateStepStatus(p.index, { status: "running" }, p.thread_id);
        setExecutingStep(p.index, p.thread_id);
      }),

      wsClient.on("tool_completed", (msg) => {
        const p = msg.payload as any;
        updateStepStatus(p.index, { status: "success", result: p.result }, p.thread_id);
        setExecutingStep(null, p.thread_id);
      }),

      wsClient.on("tool_error", (msg) => {
        const p = msg.payload as any;
        updateStepStatus(p.index, { status: "error", error: p.error }, p.thread_id);
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

      wsClient.on("task_paused", (msg) => {
        const p = msg.payload as any;
        setTaskPaused(true, p.thread_id);
      }),

      wsClient.on("task_resumed", (msg) => {
        const p = msg.payload as any;
        setTaskPaused(false, p.thread_id);
      }),

      wsClient.on("agent_state", (msg) => {
        const p = msg.payload as any;
        if (p.state === "idle" || p.state === "complete") {
          setPlan(null, p.thread_id);
          setTaskPaused(false, p.thread_id);
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
      wsClient.on("speech_completed", () => {
        const { continuousListening } = useAssistantStore.getState();
        setVoiceState(continuousListening ? "listening" : "idle");
      }),

      wsClient.on("history_response", (msg) => {
        const p = msg.payload as any;
        setThreads(p.threads ?? []);
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
  const [showHistory, setShowHistory] = useState(false);
  const [showCustomizer, setShowCustomizer] = useState(false);

  const {
    activeLocalModel, activeCloudModel, activeProvider,
    geminiApiKey, openaiApiKey, anthropicApiKey, groqApiKey, openrouterApiKey,
    voiceAccent, voiceSpeed, continuousListening, activeTheme,
    wakeWords, wakeWordEnabled, wakeWordThreshold,
    onboardingCompleted,
    setActiveModels, setActiveProvider, setAllApiKeys,
    setVoiceSettings, setWakeWordSettings, setActiveTheme,
    setOnboardingCompleted, setPersonalization, addTab, resetSessionTokens,
  } = useAssistantStore();

  useEffect(() => {
    document.body.className = document.body.className
      .split(" ")
      .filter((c) => !c.startsWith("theme-"))
      .join(" ");
    document.body.classList.add(activeTheme);
  }, [activeTheme]);

  const handleSaveSettings = (settings: {
    localModel: string;
    cloudModel: string;
    provider: string;
    geminiKey: string;
    openaiKey: string;
    anthropicKey: string;
    groqKey: string;
    openrouterKey: string;
    voiceAccent: string;
    voiceSpeed: number;
    continuousListening: boolean;
    theme: string;
    wakeWords: string[];
    wakeWordEnabled: boolean;
    wakeWordThreshold: number;
  }) => {
    setActiveModels(settings.localModel, settings.cloudModel);
    setActiveProvider(settings.provider);
    setAllApiKeys({
      gemini: settings.geminiKey,
      openai: settings.openaiKey,
      anthropic: settings.anthropicKey,
      groq: settings.groqKey,
      openrouter: settings.openrouterKey,
    });
    setVoiceSettings(settings.voiceAccent, settings.voiceSpeed, settings.continuousListening);
    setWakeWordSettings(settings.wakeWordEnabled, settings.wakeWordThreshold, settings.wakeWords);
    setActiveTheme(settings.theme);

    wsClient.send("update_settings", {
      local_model: settings.localModel,
      cloud_model: settings.cloudModel,
      ai_provider: settings.provider,
      gemini_api_key: settings.geminiKey,
      openai_api_key: settings.openaiKey,
      anthropic_api_key: settings.anthropicKey,
      groq_api_key: settings.groqKey,
      openrouter_api_key: settings.openrouterKey,
      voice_accent: settings.voiceAccent,
      voice_speed: settings.voiceSpeed,
      continuous_listening: settings.continuousListening,
      active_theme: settings.theme,
      wake_words: settings.wakeWords,
      wake_word_enabled: settings.wakeWordEnabled,
      wake_word_threshold: settings.wakeWordThreshold,
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
  }) => {
    setPersonalization(data.userName, data.skills, data.customPrompt);

    if (data.provider) {
      setActiveProvider(data.provider);
      if (data.localModel || data.cloudModel) {
        setActiveModels(data.localModel || activeLocalModel, data.cloudModel || activeCloudModel);
      }
      if (data.apiKey) {
        setAllApiKeys({
          gemini: data.provider === "google" ? data.apiKey : geminiApiKey,
          openai: data.provider === "openai" ? data.apiKey : openaiApiKey,
          anthropic: data.provider === "anthropic" ? data.apiKey : anthropicApiKey,
          groq: data.provider === "groq" ? data.apiKey : groqApiKey,
          openrouter: data.provider === "openrouter" ? data.apiKey : openrouterApiKey,
        });
      }
    }

    setOnboardingCompleted(true);

    const sendPersonalization = () => {
      wsClient.send("update_settings", {
        user_name: data.userName,
        user_skills: data.skills,
        custom_prompt: data.customPrompt,
        ...(data.provider ? {
          ai_provider: data.provider,
          local_model: data.localModel || activeLocalModel,
          cloud_model: data.cloudModel || activeCloudModel,
          gemini_api_key: data.provider === "google" ? (data.apiKey || geminiApiKey) : geminiApiKey,
          openai_api_key: data.provider === "openai" ? (data.apiKey || openaiApiKey) : openaiApiKey,
          anthropic_api_key: data.provider === "anthropic" ? (data.apiKey || anthropicApiKey) : anthropicApiKey,
          groq_api_key: data.provider === "groq" ? (data.apiKey || groqApiKey) : groqApiKey,
          openrouter_api_key: data.provider === "openrouter" ? (data.apiKey || openrouterApiKey) : openrouterApiKey,
        } : {})
      });
      // Inform the server we have switched page
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
        onOpenSettings={() => setShowSettings(true)}
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
            currentLocalModel={activeLocalModel}
            currentCloudModel={activeCloudModel}
            currentProvider={activeProvider}
            currentGeminiKey={geminiApiKey}
            currentOpenaiKey={openaiApiKey}
            currentAnthropicKey={anthropicApiKey}
            currentGroqKey={groqApiKey}
            currentOpenrouterKey={openrouterApiKey}
            currentVoiceAccent={voiceAccent}
            currentVoiceSpeed={voiceSpeed}
            currentContinuousListening={continuousListening}
            currentTheme={activeTheme}
            currentWakeWords={wakeWords}
            currentWakeWordEnabled={wakeWordEnabled}
            currentWakeWordThreshold={wakeWordThreshold}
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
