import { useState, useCallback, useEffect } from "react";
import { AssistantOverlay } from "./components/assistant/AssistantOverlay";
import { PermissionDialog } from "./components/permissions/PermissionDialog";
import { InputDialog } from "./components/permissions/InputDialog";
import { SettingsView } from "./components/settings/SettingsView";
import { HistoryView } from "./components/settings/HistoryView";
import { OnboardingView } from "./components/onboarding/OnboardingView";
import { McpSettingsModal } from "./components/settings/McpSettingsModal";
import { JsonImportModal } from "./components/assistant/JsonImportModal";
import { useTauriEvent } from "./hooks/useTauriEvent";
import { useWebSocket } from "./hooks/useWebSocket";
import { useWindowOverlay } from "./hooks/useWindowOverlay";
import { useAssistantStore } from "./stores/assistantStore";
import { TAURI_EVENTS } from "./lib/constants";
import { wsClient } from "./lib/ws";
import { AnimatePresence } from "framer-motion";

export default function App() {
  const [runtimePort, setRuntimePort] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [showMcpSettings, setShowMcpSettings] = useState(false);
  const [showJsonImport, setShowJsonImport] = useState(false);

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
    activeTheme,
    wakeWords,
    wakeWordEnabled,
    wakeWordThreshold,
    setVoiceSettings,
    setWakeWordSettings,
    setActiveTheme,
    setActiveModels,
    setActiveProvider,
    setAllApiKeys,
    resetSessionTokens,
    onboardingCompleted,
    setPersonalization,
    setOnboardingCompleted,
  } = useAssistantStore();

  // Dynamic Theme application to document.body
  useEffect(() => {
    document.body.className = document.body.className
      .split(" ")
      .filter((c) => !c.startsWith("theme-"))
      .join(" ");
    document.body.classList.add(activeTheme);
  }, [activeTheme]);

  // Listen for the runtime sidecar to announce its port
  useTauriEvent<number>(TAURI_EVENTS.RUNTIME_PORT_READY, useCallback((port) => {
    setRuntimePort(port);
  }, []));

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
    // Delay slightly to allow WS to connect if this is the very first launch
    setTimeout(sendPersonalization, 2000);
  };

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
      <AssistantOverlay 
        onOpenSettings={() => setShowSettings(true)} 
        onOpenHistory={() => setShowHistory(true)}
        onOpenCustomizer={() => setShowCustomizer(true)}
        onOpenMcpSettings={() => setShowMcpSettings(true)}
        onOpenJsonImport={() => setShowJsonImport(true)}
        onNewChat={() => resetSessionTokens()}
      />
      <PermissionDialog />
      <InputDialog />
      <McpSettingsModal isOpen={showMcpSettings} onClose={() => setShowMcpSettings(false)} />
      <JsonImportModal isOpen={showJsonImport} onClose={() => setShowJsonImport(false)} />
      <AnimatePresence>
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
          />
        )}
      </AnimatePresence>
    </>
  );
}
