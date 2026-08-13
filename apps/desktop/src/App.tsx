import { useState, useCallback, useEffect, useRef } from "react";
import { AssistantOverlay } from "./components/assistant/AssistantOverlay";
import { PermissionDialog } from "./components/permissions/PermissionDialog";
import { InputDialog } from "./components/permissions/InputDialog";
import { SettingsView } from "./components/settings/SettingsView";
import { HistoryView } from "./components/settings/HistoryView";
import { OnboardingView } from "./components/onboarding/OnboardingView";
import { McpSettingsModal } from "./components/settings/McpSettingsModal";
import { JsonImportModal } from "./components/assistant/JsonImportModal";
import { ContextModal } from "./components/assistant/ContextModal";
import { useTauriEvent } from "./hooks/useTauriEvent";
import { useWebSocket } from "./hooks/useWebSocket";
import { useWindowOverlay } from "./hooks/useWindowOverlay";
import { useAssistantStore } from "./stores/assistantStore";
import { usePermissionStore } from "./stores/permissionStore";
import { TAURI_EVENTS } from "./lib/constants";
import { wsClient } from "./lib/ws";
import { getRuntimePort } from "./lib/ipc";
import { AnimatePresence } from "framer-motion";

export default function App() {
  const [runtimePort, setRuntimePort] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsMode, setSettingsMode] = useState<"agent" | "interaction" | "all">("all");
  const logQueue = useRef<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [showMcpSettings, setShowMcpSettings] = useState(false);
  const [showJsonImport, setShowJsonImport] = useState(false);
  const [showContext, setShowContext] = useState(false);

  // Invoke window overlay and snapping logic
  useWindowOverlay();

  const {
    activeLocalModel,
    activeCloudModel,
    activeProvider,
    geminiApiKey,
    openaiApiKey,
    anthropicApiKey,
    groqApiKey,
    openrouterApiKey,
    voiceAccent,
    voiceSpeed,
    continuousListening,
    activeTheme,
    wakeWords,
    wakeWordEnabled,
    wakeWordThreshold,
    longTermMemoryEnabled,
    setVoiceSettings,
    setWakeWordSettings,
    setActiveTheme,
    setActiveModels,
    setActiveProvider,
    setAllApiKeys,
    setLongTermMemoryEnabled,
    resetSessionTokens,
    onboardingCompleted,
    isConnected,
    setPersonalization,
    setOnboardingCompleted,
    soundEnabled,
    soundVolume,
    setSoundSettings,
    setPendingOnboarding,
  } = useAssistantStore();

  // Dynamic Theme application to document.body
  useEffect(() => {
    document.body.className = document.body.className
      .split(" ")
      .filter((c) => !c.startsWith("theme-"))
      .join(" ");
    document.body.classList.add(activeTheme);
  }, [activeTheme]);

  // Disable default browser context menu globally to feel like a native desktop app
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    document.addEventListener("contextmenu", handleContextMenu);
    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
    };
  }, []);

  // Fetch runtime port on mount if sidecar is already running (e.g. page reload)
  useEffect(() => {
    getRuntimePort()
      .then((port) => {
        if (port > 0) {
          setRuntimePort(port);
        }
      })
      .catch((err) => {
        console.error("Failed to query runtime port on mount:", err);
      });
  }, []);

  // Listen for the runtime sidecar to announce its port
  useTauriEvent<number>(TAURI_EVENTS.RUNTIME_PORT_READY, useCallback((port) => {
    setRuntimePort(port);
  }, []));

  // Listen for live stdout/stderr logs from the sidecar and queue them
  useTauriEvent<string>(TAURI_EVENTS.RUNTIME_STDOUT, useCallback((line) => {
    logQueue.current.push(`[OUT] ${line}`);
  }, []));

  useTauriEvent<string>(TAURI_EVENTS.RUNTIME_STDERR, useCallback((line) => {
    logQueue.current.push(`[ERR] ${line}`);
  }, []));

  // Batch flush logs to Zustand store every 120ms to prevent main thread blocking
  useEffect(() => {
    const interval = setInterval(() => {
      if (logQueue.current.length > 0) {
        const batch = [...logQueue.current];
        logQueue.current = [];
        useAssistantStore.getState().addSidecarLogs(batch);
      }
    }, 120);
    return () => clearInterval(interval);
  }, []);

  // Connect WebSocket once port is known
  useWebSocket(runtimePort);

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
    soundEnabled: boolean;
    soundVolume: number;
    longTermMemoryEnabled: boolean;
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
    setSoundSettings(settings.soundEnabled, settings.soundVolume);
    setLongTermMemoryEnabled(settings.longTermMemoryEnabled);

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
      long_term_memory_enabled: settings.longTermMemoryEnabled,
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
    // Cache pending onboarding details locally so they are not wiped by initial connection sync
    setPendingOnboarding(data);

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
    // Send to backend when WS is ready (may not be connected yet — send via wsClient when available)
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
    };
    if (isConnected) {
      sendPersonalization();
    } else {
      const interval = setInterval(() => {
        if (useAssistantStore.getState().isConnected) {
          sendPersonalization();
          clearInterval(interval);
        }
      }, 300);
      setTimeout(() => clearInterval(interval), 10000);
    }
  };
  const pendingRequest = usePermissionStore((s) => s.pendingRequest);
  const pendingInputRequest = usePermissionStore((s) => s.pendingInputRequest);

  const isModalOpen = !onboardingCompleted || showSettings || showHistory || showCustomizer || showMcpSettings || showJsonImport || showContext || !!pendingRequest || !!pendingInputRequest;

  return (
    <>
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
      </AnimatePresence>

      <div 
        id="app-container" 
        className={isModalOpen ? "blurred-layout" : ""}
        style={{ 
          width: "100%", 
          height: "100%", 
          display: "flex", 
          flexDirection: "column",
          transition: "filter 0.2s ease-out, transform 0.2s ease-out" 
        }}
      >
        <AssistantOverlay 
          onOpenSettings={(mode = "all") => { setSettingsMode(mode); setShowSettings(true); }} 
          onOpenHistory={() => setShowHistory(true)}
          onOpenCustomizer={() => setShowCustomizer(true)}
          onOpenMcpSettings={() => setShowMcpSettings(true)}
          onOpenJsonImport={() => setShowJsonImport(true)}
          onOpenContext={() => setShowContext(true)}
          onNewChat={() => resetSessionTokens()}
        />
      </div>

      <PermissionDialog />
      <InputDialog />
      <McpSettingsModal isOpen={showMcpSettings} onClose={() => setShowMcpSettings(false)} />
      <JsonImportModal isOpen={showJsonImport} onClose={() => setShowJsonImport(false)} />
      <ContextModal isOpen={showContext} onClose={() => setShowContext(false)} />
      <AnimatePresence>
        {showSettings && (
          <SettingsView
            viewMode={settingsMode}
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
            currentSoundEnabled={soundEnabled}
            currentSoundVolume={soundVolume}
            currentLongTermMemoryEnabled={longTermMemoryEnabled}
            runtimePort={runtimePort}
            onSave={handleSaveSettings}
          />

        )}
        {showHistory && (
          <HistoryView
            onClose={() => setShowHistory(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
