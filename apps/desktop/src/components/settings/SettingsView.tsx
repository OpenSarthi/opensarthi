import { useState, useEffect, useCallback } from "react";
import { X, Save, Volume2, Bell, Cpu, ChevronRight, CheckCircle2, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { playCue } from "../../hooks/useAudioCues";
import { useAssistantStore } from "../../stores/assistantStore";
import {
  PROVIDER_MODELS,
  PROVIDER_LABELS,
  OLLAMA_ALL_SUGGESTIONS,
  formatModelLabel,
  type FetchedModel,
} from "../../lib/models";

interface SettingsViewProps {
  viewMode?: "agent" | "interaction" | "all";
  onClose: () => void;
  currentLocalModel: string;
  currentCloudModel: string;
  currentProvider: string;
  currentGeminiKey: string;
  currentOpenaiKey: string;
  currentAnthropicKey: string;
  currentGroqKey: string;
  currentOpenrouterKey: string;
  currentVoiceAccent: string;
  currentVoiceSpeed: number;
  currentContinuousListening: boolean;
  currentTheme: string;
  currentWakeWords: string[];
  currentWakeWordEnabled: boolean;
  currentWakeWordThreshold: number;
  currentSoundEnabled: boolean;
  currentSoundVolume: number;
  currentLongTermMemoryEnabled: boolean;
  currentUseLanggraph: boolean;
  currentUseSupervisor: boolean;
  currentUseNativeVoice: boolean;
  runtimePort: number | null;
  onSave: (settings: {
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
    useLanggraph: boolean;
    useSupervisor: boolean;
    useNativeVoice: boolean;
    remoteDashboardEnabled: boolean;
  }) => void;
}


const selectStyle: React.CSSProperties = {
  background: "rgba(0,0,0,0.5)",
  border: "1px solid var(--border)",
  padding: "9px 36px 9px 12px",
  color: "var(--text-primary)",
  fontFamily: "var(--font-mono)",
  fontSize: "13px",
  outline: "none",
  borderRadius: "4px",
  width: "100%",
  WebkitAppearance: "none",
  MozAppearance: "none",
  appearance: "none",
  backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ff3b30' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 10px center",
  backgroundSize: "14px",
  colorScheme: "dark",
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  background: "rgba(0,0,0,0.5)",
  border: "1px solid var(--border)",
  padding: "9px 12px",
  color: "var(--text-primary)",
  fontFamily: "var(--font-mono)",
  fontSize: "13px",
  outline: "none",
  borderRadius: "4px",
  width: "100%",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: "11px",
  color: "var(--text-secondary)",
  letterSpacing: "0.06em",
  marginBottom: "4px",
};

const sectionStyle: React.CSSProperties = {
  borderBottom: "1px solid rgba(255,255,255,0.07)",
  paddingBottom: "16px",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};

function Toggle({ id, checked, onChange, label, sublabel }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; sublabel?: string }) {
  return (
    <div
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", cursor: "pointer" }}
      onClick={() => onChange(!checked)}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        <label htmlFor={id} style={{ ...labelStyle, marginBottom: 0, cursor: "pointer" }}>{label}</label>
        {sublabel && <span style={{ fontSize: "10px", color: "var(--text-muted)", letterSpacing: "0.04em" }}>{sublabel}</span>}
      </div>
      <div
        id={id}
        style={{
          width: "42px",
          height: "24px",
          borderRadius: "12px",
          background: checked ? "var(--accent)" : "rgba(255,255,255,0.08)",
          border: `1.5px solid ${checked ? "var(--border-accent)" : "var(--border)"}`,
          position: "relative",
          flexShrink: 0,
          transition: "background 0.22s, border-color 0.22s, box-shadow 0.22s",
          boxShadow: checked ? "0 0 10px var(--accent-glow)" : "none",
        }}
      >
        <div
          style={{
            width: "16px",
            height: "16px",
            borderRadius: "50%",
            background: checked ? "#000" : "var(--text-muted)",
            position: "absolute",
            top: "3px",
            left: checked ? "21px" : "3px",
            transition: "left 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s",
            boxShadow: checked ? "0 1px 4px rgba(0,0,0,0.4)" : "none",
          }}
        />
      </div>
    </div>
  );
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h3 style={{ fontSize: "11px", color: "var(--text-secondary)", letterSpacing: "0.05em", margin: 0, display: "flex", alignItems: "center", gap: "6px" }}>
      {icon} {title}
    </h3>
  );
}

export function SettingsView({
  viewMode = "all",
  onClose,
  currentLocalModel,
  currentCloudModel,
  currentProvider,
  currentGeminiKey,
  currentOpenaiKey,
  currentAnthropicKey,
  currentGroqKey,
  currentOpenrouterKey,
  currentVoiceAccent,
  currentVoiceSpeed,
  currentContinuousListening,
  currentTheme,
  currentWakeWords,
  currentWakeWordEnabled,
  currentWakeWordThreshold,
  currentSoundEnabled,
  currentSoundVolume,
  currentLongTermMemoryEnabled,
  currentUseLanggraph,
  currentUseSupervisor,
  currentUseNativeVoice,
  runtimePort,
  onSave,
}: SettingsViewProps) {

  const [provider, setProvider] = useState(currentProvider || "google");
  const [cloudModel, setCloudModel] = useState(currentCloudModel);
  const [localModel, setLocalModel] = useState(currentLocalModel);

  // Per-provider API keys
  const [geminiKey, setGeminiKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [groqKey, setGroqKey] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");

  // Dynamic model discovery
  const [dynamicModels, setDynamicModels] = useState<FetchedModel[]>([]);
  const [modelFetchState, setModelFetchState] = useState<"idle" | "loading" | "live" | "offline" | "error">("idle");

  const [voiceAccent, setVoiceAccent] = useState(currentVoiceAccent);
  const [voiceSpeed, setVoiceSpeed] = useState(currentVoiceSpeed);
  const [continuousListening, setContinuousListening] = useState(currentContinuousListening !== undefined ? currentContinuousListening : true);
  const [wakeWordsInput, setWakeWordsInput] = useState((currentWakeWords || []).join(", "));
  const [wakeWordEnabled, setWakeWordEnabled] = useState(currentWakeWordEnabled !== undefined ? currentWakeWordEnabled : true);
  const [wakeWordThreshold, setWakeWordThreshold] = useState(currentWakeWordThreshold !== undefined ? currentWakeWordThreshold : 0.5);
  const [soundEnabled, setSoundEnabledLocal] = useState(currentSoundEnabled !== undefined ? currentSoundEnabled : true);
  const [soundVolume, setSoundVolume] = useState(currentSoundVolume !== undefined ? currentSoundVolume : 60);
  const [longTermMemoryEnabled, setLongTermMemoryEnabled] = useState(currentLongTermMemoryEnabled !== undefined ? currentLongTermMemoryEnabled : false);
  const [useLanggraph, setUseLanggraph] = useState(currentUseLanggraph !== undefined ? currentUseLanggraph : true);
  const [useSupervisor, setUseSupervisor] = useState(currentUseSupervisor !== undefined ? currentUseSupervisor : false);
  const [useNativeVoice, setUseNativeVoice] = useState(currentUseNativeVoice !== undefined ? currentUseNativeVoice : false);
  const [saved, setSaved] = useState(false);

  const providerInfo = PROVIDER_LABELS[provider] || PROVIDER_LABELS.google;
  const isLocal = provider === "ollama";

  // When provider changes, reset model and trigger dynamic discovery
  useEffect(() => {
    const staticModels = PROVIDER_MODELS[provider] || [];
    const modelExists = staticModels.some((m) => m.value === cloudModel);
    if (!modelExists && staticModels.length > 0) {
      setCloudModel(staticModels[0].value);
    }
    setDynamicModels([]);
    setModelFetchState("idle");
  }, [provider]);

  // Fetch dynamic models from backend proxy
  const fetchDynamicModels = useCallback(async () => {
    if (!runtimePort || !PROVIDER_LABELS[provider]?.supportsModelFetch) return;
    const apiKey = provider === "openai" ? (openaiKey || currentOpenaiKey)
                 : provider === "openrouter" ? (openrouterKey || currentOpenrouterKey)
                 : undefined;
    setModelFetchState("loading");
    try {
      const params = new URLSearchParams({ provider });
      if (apiKey) params.set("api_key", apiKey);
      const res = await fetch(`http://127.0.0.1:${runtimePort}/models?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { models: FetchedModel[]; source: string } = await res.json();
      setDynamicModels(data.models);
      setModelFetchState(data.source === "offline" ? "offline" : data.models.length > 0 ? "live" : "offline");
      if (data.models.length > 0) {
        const modelExists = data.models.some(m => m.value === (isLocal ? localModel : cloudModel));
        if (!modelExists) {
          if (isLocal) setLocalModel(data.models[0].value);
          else setCloudModel(data.models[0].value);
        }
      }
    } catch {
      setModelFetchState("error");
    }
  }, [provider, runtimePort, openaiKey, openrouterKey, currentOpenaiKey, currentOpenrouterKey, isLocal, cloudModel, localModel]);

  // Auto-fetch on provider change if supported
  useEffect(() => {
    if (PROVIDER_LABELS[provider]?.supportsModelFetch) {
      fetchDynamicModels();
    }
  }, [provider]);

  const getCurrentKeyForProvider = () => {
    switch (provider) {
      case "google": return currentGeminiKey;
      case "openai": return currentOpenaiKey;
      case "anthropic": return currentAnthropicKey;
      case "groq": return currentGroqKey;
      case "openrouter": return currentOpenrouterKey;
      default: return "";
    }
  };

  const getCurrentKeyInput = () => {
    switch (provider) {
      case "google": return geminiKey;
      case "openai": return openaiKey;
      case "anthropic": return anthropicKey;
      case "groq": return groqKey;
      case "openrouter": return openrouterKey;
      default: return "";
    }
  };

  const setCurrentKeyInput = (val: string) => {
    switch (provider) {
      case "google": setGeminiKey(val); break;
      case "openai": setOpenaiKey(val); break;
      case "anthropic": setAnthropicKey(val); break;
      case "groq": setGroqKey(val); break;
      case "openrouter": setOpenrouterKey(val); break;
    }
  };

  const hasSavedKey = !!getCurrentKeyForProvider();

  const handleSaveAI = () => {
    // Only send the key that's being actively edited — don't overwrite other saved keys with empty strings
    const currentKey = getCurrentKeyInput();
    onSave({
      localModel,
      cloudModel,
      provider,
      geminiKey:     provider === "google"      ? (currentKey || currentGeminiKey)      : currentGeminiKey,
      openaiKey:     provider === "openai"      ? (currentKey || currentOpenaiKey)      : currentOpenaiKey,
      anthropicKey:  provider === "anthropic"   ? (currentKey || currentAnthropicKey)  : currentAnthropicKey,
      groqKey:       provider === "groq"        ? (currentKey || currentGroqKey)        : currentGroqKey,
      openrouterKey: provider === "openrouter"  ? (currentKey || currentOpenrouterKey) : currentOpenrouterKey,
      longTermMemoryEnabled,
      useLanggraph,
      useSupervisor,
      useNativeVoice: provider === "google" ? useNativeVoice : false,
      // Keep other settings unchanged (use original values from props)
      voiceAccent: currentVoiceAccent,
      voiceSpeed: currentVoiceSpeed,
      continuousListening: currentContinuousListening,
      theme: currentTheme,
      wakeWords: currentWakeWords,
      wakeWordEnabled: currentWakeWordEnabled,
      wakeWordThreshold: currentWakeWordThreshold,
      soundEnabled: currentSoundEnabled,
      soundVolume: currentSoundVolume,
      remoteDashboardEnabled: useAssistantStore.getState().remoteDashboardEnabled || false,
    });
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 800);
  };

  const handleSaveAll = () => {
    const parsedWakeWords = wakeWordsInput
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean);

    const currentKey = getCurrentKeyInput();
    onSave({
      localModel,
      cloudModel,
      provider,
      geminiKey:     provider === "google"      ? (currentKey || currentGeminiKey)      : currentGeminiKey,
      openaiKey:     provider === "openai"      ? (currentKey || currentOpenaiKey)      : currentOpenaiKey,
      anthropicKey:  provider === "anthropic"   ? (currentKey || currentAnthropicKey)  : currentAnthropicKey,
      groqKey:       provider === "groq"        ? (currentKey || currentGroqKey)        : currentGroqKey,
      openrouterKey: provider === "openrouter"  ? (currentKey || currentOpenrouterKey) : openrouterKey,
      longTermMemoryEnabled,
      useLanggraph,
      useSupervisor,
      useNativeVoice: provider === "google" ? useNativeVoice : false,
      // Save all modified state values
      voiceAccent,
      voiceSpeed,
      continuousListening,
      theme: useAssistantStore.getState().activeTheme,
      wakeWords: parsedWakeWords,
      wakeWordEnabled,
      wakeWordThreshold,
      soundEnabled,
      soundVolume,
      remoteDashboardEnabled: useAssistantStore.getState().remoteDashboardEnabled || false,
    });
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 800);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      style={{
        position: "fixed",
        top: 0, left: 0, right: 0, bottom: 0,
        background: "rgba(0, 0, 0, 0.05)",
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "flex-start",
        padding: "54px 12px 12px 12px",
        zIndex: 50,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        className="hud-panel"
        initial={{ x: 250, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 250, opacity: 0 }}
        transition={{ type: "spring", damping: 26, stiffness: 280 }}
        style={{
          width: viewMode === "agent" || viewMode === "interaction" ? "440px" : "680px",
          maxHeight: "calc(100vh - 66px)",
          display: "flex",
          flexDirection: "column",
          gap: "0",
          overflow: "hidden",
          background: "rgba(10, 10, 10, 0.98)",
          border: "1px solid var(--border)",
          boxShadow: "0 15px 50px rgba(0, 0, 0, 0.8), inset 0 0 1px 1px rgba(255,255,255,0.03)"
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 20px", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "14px", color: "var(--accent)", letterSpacing: "0.1em", fontWeight: "bold", margin: 0 }}>
            {viewMode === "agent"
              ? "// AGENT CONFIGURATION"
              : viewMode === "interaction"
              ? "// VOICE & AUDIO CONFIGURATION"
              : "// SYSTEM CONFIGURATION"}
          </h2>
          <button onClick={onClose} style={{ color: "var(--text-secondary)", cursor: "pointer", background: "none", border: "none", display: "flex", alignItems: "center" }}>
            <X size={18} />
          </button>
        </div>

        {/* Scrollable content in Columns */}
        <div style={{ overflowY: "auto", flex: 1, minHeight: 0, padding: "20px 24px 48px", display: "grid", gridTemplateColumns: viewMode === "agent" || viewMode === "interaction" ? "1fr" : "1fr 1fr", gap: "28px" }}>
          
          {/* Column 1: AI Provider & Model Config */}
          {(viewMode === "agent" || viewMode === "all") && (
            <div style={{
              display: "flex",
              flexDirection: "column",
              gap: "20px",
              borderRight: viewMode === "all" ? "1px solid rgba(255,255,255,0.06)" : "none",
              paddingRight: viewMode === "all" ? "24px" : "0"
            }}>
            <div style={sectionStyle}>
              <SectionHeader icon={<Cpu size={12} color="var(--accent)" />} title="[ AI PROVIDER & MODEL ]" />

              {/* Step 1: Provider */}
              <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                <label style={labelStyle}>1. SELECT AI PROVIDER</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                  {Object.entries(PROVIDER_LABELS).map(([key, info]) => (
                    <button
                      key={key}
                      onClick={() => {
                        setProvider(key);
                        if (key !== "google") {
                          setUseNativeVoice(false);
                        }
                      }}
                      style={{
                        padding: "8px 10px",
                        background: provider === key ? "var(--accent-glow)" : "rgba(0,0,0,0.3)",
                        border: `1px solid ${provider === key ? "var(--border-accent)" : "var(--border)"}`,
                        borderRadius: "4px",
                        color: provider === key ? "var(--accent)" : "var(--text-secondary)",
                        fontSize: "11px",
                        fontFamily: "var(--font-mono)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        fontWeight: provider === key ? "bold" : "normal",
                        letterSpacing: "0.03em",
                        transition: "all 0.15s",
                      }}
                    >
                      <span>{info.icon}</span>
                      <span>{info.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Step 2: Model */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={provider}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15 }}
                  style={{ display: "flex", flexDirection: "column", gap: "5px" }}
                >
                  {isLocal ? (
                    <>
                      <label style={{ ...labelStyle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span><ChevronRight size={10} style={{ display: "inline", marginRight: 4 }} />2. LOCAL MODEL (Ollama)</span>
                        <button
                          onClick={fetchDynamicModels}
                          title="Refresh local Ollama models"
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 4, fontSize: 10 }}
                        >
                          <RefreshCw size={11} style={{ animation: modelFetchState === "loading" ? "spin 1s linear infinite" : "none" }} />
                          {modelFetchState === "live" ? "LIVE" : modelFetchState === "offline" ? "OFFLINE" : modelFetchState === "loading" ? "FETCHING…" : "REFRESH"}
                        </button>
                      </label>
                      {dynamicModels.length > 0 ? (
                        <select
                          value={localModel}
                          onChange={(e) => setLocalModel(e.target.value)}
                          style={selectStyle}
                        >
                          {dynamicModels.map((m) => (
                            <option key={m.value} value={m.value}>{m.label}</option>
                          ))}
                          <option value="__custom__" disabled style={{ color: "rgba(255,255,255,0.4)" }}>── Custom ──</option>
                        </select>
                      ) : (
                        <select
                          value={OLLAMA_ALL_SUGGESTIONS.some(m => m.value === localModel) ? localModel : "__custom__"}
                          onChange={(e) => { if (e.target.value !== "__custom__") setLocalModel(e.target.value); }}
                          style={selectStyle}
                        >
                          <option value="__custom__" disabled>── Suggestions (Ollama offline) ──</option>
                          {OLLAMA_ALL_SUGGESTIONS.map((m) => (
                            <option key={m.value} value={m.value}>{formatModelLabel(m)}</option>
                          ))}
                        </select>
                      )}
                      <input
                        value={localModel}
                        onChange={(e) => setLocalModel(e.target.value)}
                        placeholder="Custom: e.g. qwen2.5-coder:3b, llama3.2:3b"
                        style={{ ...inputStyle, marginTop: 4, fontSize: 12 }}
                      />
                    </>
                  ) : (
                    <>
                      <label style={{ ...labelStyle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span><ChevronRight size={10} style={{ display: "inline", marginRight: 4 }} />2. SELECT MODEL</span>
                        {PROVIDER_LABELS[provider]?.supportsModelFetch && (
                          <button
                            onClick={fetchDynamicModels}
                            title="Fetch live model list"
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 4, fontSize: 10 }}
                          >
                            <RefreshCw size={11} style={{ animation: modelFetchState === "loading" ? "spin 1s linear infinite" : "none" }} />
                            {modelFetchState === "live" ? "LIVE" : modelFetchState === "loading" ? "FETCHING…" : "FETCH LIVE"}
                          </button>
                        )}
                      </label>
                      <select
                        value={cloudModel}
                        onChange={(e) => setCloudModel(e.target.value)}
                        style={selectStyle}
                      >
                        {(dynamicModels.length > 0 ? dynamicModels : (PROVIDER_MODELS[provider] || []).map(m => ({ value: m.value, label: formatModelLabel(m) }))).map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                      {dynamicModels.length > 0 && (
                        <span style={{ fontSize: 10, color: "var(--accent)", opacity: 0.7 }}>✓ Live model list from {provider}</span>
                      )}
                    </>
                  )}
                </motion.div>
              </AnimatePresence>

              {/* Step 3: API Key */}
              {!isLocal && (
                <AnimatePresence mode="wait">
                  <motion.div
                    key={`${provider}-key`}
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.15 }}
                    style={{ display: "flex", flexDirection: "column", gap: "5px", marginTop: "4px" }}
                  >
                    <label style={{ ...labelStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>{providerInfo.apiKeyLabel}</span>
                      {hasSavedKey && (
                        <span style={{ fontSize: "9px", color: "var(--success)", display: "flex", alignItems: "center", gap: "3px" }}>
                          <CheckCircle2 size={10} /> KEY SAVED
                        </span>
                      )}
                    </label>
                    <input
                      value={getCurrentKeyInput()}
                      onChange={(e) => setCurrentKeyInput(e.target.value)}
                      type="password"
                      placeholder={hasSavedKey ? "•••••••••• (leave blank to keep)" : providerInfo.apiKeyPlaceholder}
                      style={inputStyle}
                    />
                    {providerInfo.docsUrl && (
                      <span style={{ fontSize: "10px", color: "var(--text-secondary)", opacity: 0.8 }}>
                        Get your key at: <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>{providerInfo.docsUrl}</span>
                      </span>
                    )}
                  </motion.div>
                </AnimatePresence>
              )}

              {/* Long Term Memory Toggle */}
              <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px dashed rgba(255,255,255,0.07)" }}>
                <Toggle
                  id="long-term-memory"
                  checked={longTermMemoryEnabled}
                  onChange={setLongTermMemoryEnabled}
                  label="LONG-TERM SEMANTIC MEMORY"
                  sublabel="Uses embeddings to remember preferences (turn off for faster execution)"
                />
              </div>

              {/* LangGraph Toggle */}
              <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px dashed rgba(255,255,255,0.07)" }}>
                <Toggle
                  id="use-langgraph-toggle"
                  checked={useLanggraph}
                  onChange={setUseLanggraph}
                  label="USE NATIVE LANGGRAPH FLOW"
                  sublabel="Enables stateful multi-step tasks, sub-agent orchestration, and task recovery"
                />
              </div>

              {/* Multi-Agent Supervisor Toggle */}
              <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px dashed rgba(255,255,255,0.07)" }}>
                <Toggle
                  id="use-supervisor-toggle"
                  checked={useSupervisor}
                  onChange={setUseSupervisor}
                  label="USE MULTI-AGENT SUPERVISOR"
                  sublabel="Filters available tools dynamically by classifying task domain(s) for safety and speed"
                />
              </div>

              {/* Native Voice Toggle (Conditional) */}
              {provider === "google" && (
                <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px dashed rgba(255,255,255,0.07)" }}>
                  <Toggle
                    id="use-native-voice-toggle"
                    checked={useNativeVoice}
                    onChange={setUseNativeVoice}
                    label="USE NATIVE VOICE (GEMINI LIVE)"
                    sublabel="Connects directly to Gemini Live for sub-second real-time bidirectional audio conversation"
                  />
                </div>
              )}

              {/* Save AI Settings */}
              {viewMode === "all" && (
                <button
                  onClick={handleSaveAI}
                  style={{
                    background: saved ? "var(--success)" : "var(--accent)",
                    color: "#000",
                    border: "none",
                    padding: "9px 16px",
                    fontWeight: "bold",
                    fontSize: "12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    cursor: "pointer",
                    borderRadius: "4px",
                    letterSpacing: "0.05em",
                    transition: "background 0.3s",
                    alignSelf: "flex-start",
                    marginTop: "8px"
                  }}
                >
                  {saved ? <><CheckCircle2 size={14} /> SAVED!</> : <><Save size={14} /> SAVE AI SETTINGS</>}
                </button>
              )}
            </div>
            </div>
          )}

          {/* Column 2: Theme & Interaction settings */}
          {(viewMode === "interaction" || viewMode === "all") && (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

              {/* ── VOICE SECTION ── */}
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <SectionHeader icon={<Volume2 size={12} color="var(--accent)" />} title="[ VOICE & INTERACTION ]" />

                <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                  <label style={labelStyle}>VOICE CHARACTER / ACCENT</label>
                  <select value={voiceAccent} onChange={(e) => setVoiceAccent(e.target.value)} style={selectStyle}>
                    <optgroup label="English Accents">
                      <option value="ie">🍀 F.R.I.D.A.Y. Accent (Irish Female)</option>
                      <option value="com">🇺🇸 Google Accent (US Female)</option>
                      <option value="co.uk">🇬🇧 British Accent (UK Female)</option>
                      <option value="co.in">🇮🇳 Indian Accent (IN Female)</option>
                      <option value="com.au">🇦🇺 Australian Accent (AU Female)</option>
                      <option value="ca">🇨🇦 Canadian Accent (CA Female)</option>
                    </optgroup>
                    <optgroup label="International Languages">
                      <option value="fr">🇫🇷 French / Français</option>
                      <option value="es">🇪🇸 Spanish / Español</option>
                      <option value="de">🇩🇪 German / Deutsch</option>
                      <option value="hi">🇮🇳 Hindi / हिन्दी</option>
                      <option value="ja">🇯🇵 Japanese / 日本語</option>
                      <option value="pt">🇧🇷 Portuguese / Português</option>
                    </optgroup>
                  </select>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                  <label style={labelStyle}>PLAYBACK SPEECH SPEED ({voiceSpeed.toFixed(2)}x)</label>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <input
                      type="range"
                      min="0.8" max="2.0" step="0.05"
                      value={voiceSpeed}
                      onChange={(e) => setVoiceSpeed(parseFloat(e.target.value))}
                      style={{ flex: 1, accentColor: "var(--accent)", cursor: "pointer" }}
                    />
                    <span style={{ fontSize: "13px", fontFamily: "var(--font-mono)", color: "var(--accent)", minWidth: "42px", textAlign: "right" }}>
                      {voiceSpeed.toFixed(2)}x
                    </span>
                  </div>
                </div>

                <Toggle
                  id="continuous-listening"
                  checked={continuousListening}
                  onChange={setContinuousListening}
                  label="CONTINUOUS BACKGROUND LISTENING"
                  sublabel="Listens continuously after wake word — no gaps"
                />

                {/* Wake Word Detection Options */}
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "4px", paddingTop: "12px", borderTop: "1px dashed rgba(255,255,255,0.07)" }}>
                  <Toggle
                      id="wake-word-enabled"
                      checked={wakeWordEnabled}
                      onChange={setWakeWordEnabled}
                      label="ENABLE WAKE WORD DETECTION"
                      sublabel='Say "hey sarthi" to activate'
                    />

                  {wakeWordEnabled && (
                    <>
                      <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                        <label style={labelStyle}>CUSTOM WAKE WORDS (COMMA SEPARATED)</label>
                        <input
                          value={wakeWordsInput}
                          onChange={(e) => setWakeWordsInput(e.target.value)}
                          placeholder="e.g. hey sarthi, hello sarthi"
                          style={inputStyle}
                        />
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                        <label style={labelStyle}>DETECTION THRESHOLD / SENSITIVITY ({wakeWordThreshold.toFixed(2)})</label>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <input
                            type="range"
                            min="0.1" max="0.9" step="0.05"
                            value={wakeWordThreshold}
                            onChange={(e) => setWakeWordThreshold(parseFloat(e.target.value))}
                            style={{ flex: 1, accentColor: "var(--accent)", cursor: "pointer" }}
                          />
                          <span style={{ fontSize: "13px", fontFamily: "var(--font-mono)", color: "var(--accent)", minWidth: "42px", textAlign: "right" }}>
                            {wakeWordThreshold.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* ── SOUND & AUDIO SECTION ── */}
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", paddingTop: "4px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                <SectionHeader icon={<Bell size={12} color="var(--accent)" />} title="[ SOUND & AUDIO CUES ]" />

                <Toggle
                  id="sound-enabled"
                  checked={soundEnabled}
                  onChange={(val) => {
                    setSoundEnabledLocal(val);
                    if (val) {
                      setTimeout(() => playCue("listen_start"), 80);
                    }
                  }}
                  label="ENABLE SOUND CUES"
                  sublabel="Beeps & tones on wake, listen, reply, errors, etc."
                />

                {soundEnabled && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.15 }}
                    style={{ display: "flex", flexDirection: "column", gap: "5px" }}
                  >
                    <label style={labelStyle}>CUE VOLUME ({soundVolume}%)</label>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <input
                        type="range"
                        min="0" max="100" step="5"
                        value={soundVolume}
                        onChange={(e) => setSoundVolume(parseInt(e.target.value, 10))}
                        onMouseUp={() => playCue("listen_start")}
                        onTouchEnd={() => playCue("listen_start")}
                        style={{ flex: 1, accentColor: "var(--accent)", cursor: "pointer" }}
                      />
                      <span style={{ fontSize: "13px", fontFamily: "var(--font-mono)", color: "var(--accent)", minWidth: "42px", textAlign: "right" }}>
                        {soundVolume}%
                      </span>
                    </div>
                    <span style={{ fontSize: "10px", color: "var(--text-muted)", letterSpacing: "0.04em" }}>
                      Drag to adjust — releases a preview beep
                    </span>
                  </motion.div>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Footer — Save theme+voice */}
        <div style={{ padding: "14px 20px", borderTop: "1px solid var(--border)", background: "rgba(0,0,0,0.3)" }}>
          <button
            onClick={handleSaveAll}
            style={{
              background: saved ? "var(--success)" : "var(--accent)",
              color: "#000",
              border: "none",
              padding: "10px",
              fontWeight: "bold",
              fontSize: "13px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              cursor: "pointer",
              borderRadius: "4px",
              letterSpacing: "0.06em",
              width: "100%",
              transition: "background 0.3s",
            }}
            className="hover-glow"
          >
            {saved ? (
              <><CheckCircle2 size={16} /> SETTINGS SAVED!</>
            ) : (
              <>
                <Save size={16} />{" "}
                {viewMode === "agent"
                  ? "SAVE AGENT CONFIGURATION"
                  : viewMode === "interaction"
                  ? "SAVE INTERACTION CONFIGURATION"
                  : "SAVE ALL SETTINGS"}
              </>
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
