import { useState, useCallback, useEffect } from "react";
import { AssistantOverlay } from "./components/assistant/AssistantOverlay";
import { PermissionDialog } from "./components/permissions/PermissionDialog";
import { SettingsView } from "./components/settings/SettingsView";
import { HistoryView } from "./components/settings/HistoryView";
import { useTauriEvent } from "./hooks/useTauriEvent";
import { useWebSocket } from "./hooks/useWebSocket";
import { useAssistantStore } from "./stores/assistantStore";
import { TAURI_EVENTS } from "./lib/constants";
import { wsClient } from "./lib/ws";
import { AnimatePresence } from "framer-motion";

export default function App() {
  const [runtimePort, setRuntimePort] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

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
    setVoiceSettings,
    setActiveTheme,
    setActiveModels,
    setActiveProvider,
    setAllApiKeys,
    resetSessionTokens,
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
    });
  };

  return (
    <>
      <AssistantOverlay 
        onOpenSettings={() => setShowSettings(true)} 
        onOpenHistory={() => setShowHistory(true)}
        onNewChat={() => resetSessionTokens()}
      />
      <PermissionDialog />
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
