import { useState, useEffect, useCallback } from "react";
import { X, Save, Volume2, Palette, Cpu, Bell, User, CheckCircle2, RefreshCw, Globe, Tag, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  PROVIDER_MODELS,
  PROVIDER_LABELS,
  OLLAMA_ALL_SUGGESTIONS,
  formatModelLabel,
  validateClientDirect,
  type FetchedModel,
} from "../../lib/models";

// ─── Theme registry (mirrors desktop THEMES + light extras from globals.css) ───
const THEMES = [
  { value: "theme-green-black", label: "🟢 Matrix Green" },
  { value: "theme-red-black", label: "🔴 Dark Crimson" },
  { value: "theme-purple-black", label: "🟣 Dark Nebula" },
  { value: "theme-blue-black", label: "🌊 Dark Ocean" },
  { value: "theme-mono-dark", label: "⚫ Mono Dark" },
  { value: "theme-multicolor-dark", label: "🌌 Cyberpunk Neon" },
  { value: "theme-light-sakura", label: "🌸 Light Sakura" },
  { value: "theme-light-slate", label: "🏙️ Light Slate" },
  { value: "theme-light-clean", label: "⬜ Light Clean" },
  { value: "theme-multicolor-light", label: "🌈 Vivid Rainbow" },
];

// Swatch presets for quick accent selection
const ACCENT_PRESETS = ["#1aff1a", "#ff3b30", "#8c00ff", "#0091ff", "#ff9500", "#ff2d55", "#00e6a0", "#f5d90b", "#00b8d4", "#ff6ec7"];

interface SettingsViewProps {
  viewMode?: "agent" | "interaction" | "system" | "all";
  onClose: () => void;
  currentLocalModel: string;
  currentCloudModel: string;
  currentProvider: string;
  currentGeminiKey: string;
  currentOpenaiKey: string;
  currentAnthropicKey: string;
  currentGroqKey: string;
  currentOpenrouterKey: string;
  currentCustomOpenaiBaseUrl?: string;
  currentCustomOpenaiApiKey?: string;
  currentCustomOpenaiProviderName?: string;
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
  currentCustomAccent?: string | null;
  onSave: (settings: {
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
    soundEnabled: boolean;
    soundVolume: number;
    longTermMemoryEnabled: boolean;
    useLanggraph: boolean;
    useSupervisor: boolean;
    useNativeVoice: boolean;
    customAccent: string | null;
  }) => void;
}

// ─── Shared styles (touch-optimized, larger hit targets) ──────────────────────
const selectStyle: React.CSSProperties = {
  background: "rgba(0,0,0,0.6)",
  border: "1px solid var(--border)",
  padding: "14px",
  color: "var(--text-primary)",
  fontFamily: "var(--font-mono)",
  fontSize: "14px",
  outline: "none",
  borderRadius: "10px",
  width: "100%",
  colorScheme: "dark",
  cursor: "pointer",
  WebkitAppearance: "none",
  MozAppearance: "none",
  appearance: "none",
  backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ff3b30' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 14px center",
  backgroundSize: "16px",
  boxSizing: "border-box",
};

const inputStyle: React.CSSProperties = {
  background: "rgba(0,0,0,0.6)",
  border: "1px solid var(--border)",
  padding: "14px",
  color: "var(--text-primary)",
  fontFamily: "var(--font-mono)",
  fontSize: "14px",
  outline: "none",
  borderRadius: "10px",
  width: "100%",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: "11px",
  color: "var(--text-secondary)",
  letterSpacing: "0.08em",
  marginBottom: "6px",
  fontFamily: "var(--font-mono)",
};

const sectionStyle: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.02)",
  border: "1px solid rgba(255, 255, 255, 0.06)",
  borderRadius: "14px",
  padding: "16px",
  marginBottom: "16px",
  display: "flex",
  flexDirection: "column",
  gap: "16px",
};

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h3 style={{ fontSize: "12px", color: "var(--accent)", letterSpacing: "0.05em", margin: 0, display: "flex", alignItems: "center", gap: "8px", fontFamily: "var(--font-mono)", fontWeight: "bold" }}>
      {icon} {title}
    </h3>
  );
}

function Toggle({ checked, onChange, label, sublabel }: { checked: boolean; onChange: (v: boolean) => void; label: string; sublabel?: string }) {
  return (
    <div
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", cursor: "pointer", minHeight: 48 }}
      onClick={() => onChange(!checked)}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1 }}>
        <span style={{ ...labelStyle, marginBottom: 0, cursor: "pointer" }}>{label}</span>
        {sublabel && <span style={{ fontSize: "11px", color: "var(--text-muted)", letterSpacing: "0.04em" }}>{sublabel}</span>}
      </div>
      <div
        style={{
          width: "50px",
          height: "28px",
          borderRadius: "14px",
          background: checked ? "var(--accent)" : "rgba(255,255,255,0.08)",
          border: `1.5px solid ${checked ? "var(--border-accent)" : "var(--border)"}`,
          position: "relative",
          flexShrink: 0,
          transition: "background 0.22s, border-color 0.22s",
          boxShadow: checked ? "0 0 10px var(--accent-glow)" : "none",
        }}
      >
        <div
          style={{
            width: "22px",
            height: "22px",
            borderRadius: "50%",
            background: checked ? "#000" : "var(--text-muted)",
            position: "absolute",
            top: "2px",
            left: checked ? "24px" : "3px",
            transition: "left 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s",
          }}
        />
      </div>
    </div>
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
  currentCustomOpenaiBaseUrl = "",
  currentCustomOpenaiApiKey = "",
  currentCustomOpenaiProviderName = "",
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
  currentCustomAccent,
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
  const [customOpenaiBaseUrl, setCustomOpenaiBaseUrl] = useState(currentCustomOpenaiBaseUrl);
  const [customOpenaiApiKey, setCustomOpenaiApiKey] = useState("");
  const [customOpenaiProviderName, setCustomOpenaiProviderName] = useState(currentCustomOpenaiProviderName);

  // Test API key state
  const [testKeyState, setTestKeyState] = useState<"idle" | "checking" | "valid" | "invalid">("idle");
  const [testKeyMessage, setTestKeyMessage] = useState("");

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
  const [theme, setTheme] = useState(currentTheme || "theme-red-black");
  const [customAccent, setCustomAccentLocal] = useState<string | null>(currentCustomAccent || null);
  const [accentInput, setAccentInput] = useState((currentCustomAccent || "#1aff1a").toUpperCase());
  const [saved, setSaved] = useState(false);

  const providerInfo = PROVIDER_LABELS[provider] || PROVIDER_LABELS.google;
  const isLocal = provider === "ollama";
  const isCustomOpenai = provider === "custom_openai";

  const getCurrentKeyForProvider = useCallback(() => {
    switch (provider) {
      case "google": return currentGeminiKey;
      case "openai": return currentOpenaiKey;
      case "anthropic": return currentAnthropicKey;
      case "groq": return currentGroqKey;
      case "openrouter": return currentOpenrouterKey;
      case "custom_openai": return customOpenaiApiKey || currentCustomOpenaiApiKey;
      default: return "";
    }
  }, [provider, currentGeminiKey, currentOpenaiKey, currentAnthropicKey, currentGroqKey, currentOpenrouterKey, customOpenaiApiKey, currentCustomOpenaiApiKey]);

  const getCurrentKeyInput = useCallback(() => {
    switch (provider) {
      case "google": return geminiKey;
      case "openai": return openaiKey;
      case "anthropic": return anthropicKey;
      case "groq": return groqKey;
      case "openrouter": return openrouterKey;
      case "custom_openai": return customOpenaiApiKey;
      default: return "";
    }
  }, [provider, geminiKey, openaiKey, anthropicKey, groqKey, openrouterKey, customOpenaiApiKey]);

  const setCurrentKeyInput = (val: string) => {
    switch (provider) {
      case "google": setGeminiKey(val); break;
      case "openai": setOpenaiKey(val); break;
      case "anthropic": setAnthropicKey(val); break;
      case "groq": setGroqKey(val); break;
      case "openrouter": setOpenrouterKey(val); break;
      case "custom_openai": setCustomOpenaiApiKey(val); break;
    }
  };

  const hasSavedKey = !!getCurrentKeyForProvider();

  // Reset on provider change
  useEffect(() => {
    const staticModels = PROVIDER_MODELS[provider] || [];
    const modelExists = staticModels.some((m) => m.value === cloudModel);
    if (!modelExists && staticModels.length > 0) setCloudModel(staticModels[0].value);
    setDynamicModels([]);
    setModelFetchState("idle");
    setTestKeyState("idle");
    setTestKeyMessage("");
    // Native voice only available on Gemini Live
    if (provider !== "google") setUseNativeVoice(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  const effectiveBaseUrl = (customOpenaiBaseUrl || currentCustomOpenaiBaseUrl || "").trim() ||
    (isCustomOpenai ? "http://localhost:20128/v1" : "http://127.0.0.1:11434");

  // Fetch dynamic models — direct client first (works without runtime proxy on Android)
  const fetchDynamicModels = useCallback(async () => {
    if (!PROVIDER_LABELS[provider]?.supportsModelFetch) return;
    const keyInput = getCurrentKeyInput();
    const effectiveKey = keyInput || getCurrentKeyForProvider();

    setModelFetchState("loading");
    try {
      const direct = await validateClientDirect(provider, effectiveKey, effectiveBaseUrl);
      if (direct.valid && direct.models.length > 0) {
        setDynamicModels(direct.models);
        setModelFetchState("live");
        const currentSelected = isLocal ? localModel : cloudModel;
        const modelExists = direct.models.some((m) => m.value === currentSelected);
        if (!modelExists) {
          if (isLocal) setLocalModel(direct.models[0].value);
          else {
            setCloudModel(direct.models[0].value);
          }
          if (isCustomOpenai) setLocalModel(direct.models[0].value);
        }
        return;
      }
    } catch {
      // ignore, try backend proxy fallback path
    }

    // Backend proxy fallback (Chaquo runtime speaks on 127.0.0.1:8765)
    try {
      const base = "http://127.0.0.1:8765";
      const params = new URLSearchParams({ provider });
      if (effectiveKey) params.set("api_key", effectiveKey);
      if (isCustomOpenai || isLocal) params.set("base_url", effectiveBaseUrl);
      const res = await fetch(`${base}/models?${params}`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data: { models: FetchedModel[]; source: string } = await res.json();
        if (data.models && data.models.length > 0) {
          setDynamicModels(data.models);
          setModelFetchState(data.source === "offline" ? "offline" : "live");
          const currentSelected = isLocal ? localModel : cloudModel;
          if (data.models.some((m) => m.value === currentSelected) === false) {
            if (isLocal) setLocalModel(data.models[0].value);
            else setCloudModel(data.models[0].value);
          }
          return;
        }
      }
    } catch {
      // offline, do nothing
    }

    setModelFetchState("error");
  }, [provider, getCurrentKeyInput, getCurrentKeyForProvider, isCustomOpenai, isLocal, localModel, cloudModel, effectiveBaseUrl]);

  // Test API key
  const handleTestKey = useCallback(async () => {
    const keyInput = getCurrentKeyInput();
    const effectiveKey = keyInput || getCurrentKeyForProvider();

    setTestKeyState("checking");
    setTestKeyMessage("Testing...");

    const applySuccess = (models: FetchedModel[], message: string) => {
      setTestKeyState("valid");
      setTestKeyMessage(message);
      if (models.length > 0) {
        setDynamicModels(models);
        setModelFetchState("live");
        const currentSelected = isLocal ? localModel : cloudModel;
        if (models.some((m) => m.value === currentSelected) === false) {
          if (isLocal) setLocalModel(models[0].value);
          else setCloudModel(models[0].value);
        }
      }
      setTimeout(() => { setTestKeyState("idle"); setTestKeyMessage(""); }, 6000);
    };

    // Direct client validation first (fast for local endpoints, resilient when runtime busy)
    try {
      const direct = await validateClientDirect(provider, effectiveKey, effectiveBaseUrl);
      if (direct.valid) {
        applySuccess(direct.models, direct.message);
        return;
      }
      if (direct.message.includes("401") || direct.message.includes("403")) {
        setTestKeyState("invalid");
        setTestKeyMessage(direct.message);
        setTimeout(() => { setTestKeyState("idle"); setTestKeyMessage(""); }, 6000);
        return;
      }
    } catch {
      // continue to backend proxy
    }

    try {
      const base = "http://127.0.0.1:8765";
      const params = new URLSearchParams({ provider });
      if (effectiveKey) params.set("api_key", effectiveKey);
      if (isCustomOpenai || isLocal) params.set("base_url", effectiveBaseUrl);
      const res = await fetch(`${base}/validate_key?${params}`, { signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        const data: { valid: boolean; message: string; models: FetchedModel[] } = await res.json();
        if (data.valid) {
          applySuccess(data.models || [], data.message || "API key valid!");
        } else {
          setTestKeyState("invalid");
          setTestKeyMessage(data.message || "Validation failed");
          setTimeout(() => { setTestKeyState("idle"); setTestKeyMessage(""); }, 6000);
        }
        return;
      }
    } catch {
      // backend offline — report the direct result we already have
      try {
        const direct = await validateClientDirect(provider, effectiveKey, effectiveBaseUrl);
        if (direct.valid) applySuccess(direct.models, direct.message);
        else {
          setTestKeyState("invalid");
          setTestKeyMessage(direct.message || "Connection failed");
          setTimeout(() => { setTestKeyState("idle"); setTestKeyMessage(""); }, 6000);
        }
      } catch (err: any) {
        setTestKeyState("invalid");
        setTestKeyMessage(`Connection failed: ${err.message || String(err)}`);
        setTimeout(() => { setTestKeyState("idle"); setTestKeyMessage(""); }, 6000);
      }
    }
  }, [provider, getCurrentKeyInput, getCurrentKeyForProvider, isCustomOpenai, isLocal, localModel, cloudModel, effectiveBaseUrl]);

  // ─── Accent helpers (hex input) ─────────────────────────────────────────────
  const isValidHex = (s: string) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s.trim());

  // Apply accent live while typing so user sees the theme change instantly
  const applyCustomAccent = (hex: string) => {
    const v = hex.trim();
    if (!isValidHex(v)) return;
    const full = v.length === 4 ? "#" + v.slice(1).split("").map(c => c + c).join("") : v;
    setCustomAccentLocal(full);
    setAccentInput(full.toUpperCase());
  };

  const handleSave = () => {
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
      openrouterKey: provider === "openrouter"  ? (currentKey || currentOpenrouterKey) : currentOpenrouterKey,
      customOpenaiBaseUrl: provider === "custom_openai" ? (customOpenaiBaseUrl || currentCustomOpenaiBaseUrl) : currentCustomOpenaiBaseUrl,
      customOpenaiApiKey:  provider === "custom_openai" ? (currentKey || currentCustomOpenaiApiKey || "") : currentCustomOpenaiApiKey,
      customOpenaiProviderName: provider === "custom_openai" ? (customOpenaiProviderName || currentCustomOpenaiProviderName || "") : currentCustomOpenaiProviderName,
      voiceAccent,
      voiceSpeed,
      continuousListening,
      theme,
      wakeWords: parsedWakeWords,
      wakeWordEnabled,
      wakeWordThreshold,
      soundEnabled,
      soundVolume,
      longTermMemoryEnabled,
      useLanggraph,
      useSupervisor,
      useNativeVoice: provider === "google" ? useNativeVoice : false,
      customAccent,
    });
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 900);
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
        background: "var(--bg-primary)",
        display: "flex",
        flexDirection: "column",
        zIndex: 100,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "14px 20px",
        borderBottom: "1px solid var(--border)",
        background: "rgba(0,0,0,0.2)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {viewMode === "agent" ? <Cpu size={16} color="var(--accent)" /> :
           viewMode === "interaction" ? <Volume2 size={16} color="var(--accent)" /> :
           <User size={16} color="var(--accent)" />}
          <h2 style={{ fontSize: "14px", color: "var(--accent)", letterSpacing: "0.1em", fontWeight: "bold", margin: 0, fontFamily: "var(--font-mono)" }}>
            {viewMode === "agent" ? "// AGENT CONFIG"
             : viewMode === "interaction" ? "// VOICE & AUDIO"
             : viewMode === "system" ? "// SYSTEM SETTINGS"
             : "// SYSTEM CONFIG"}
          </h2>
        </div>
        <button onClick={onClose} style={{ color: "var(--text-secondary)", cursor: "pointer", background: "none", border: "none", display: "flex", alignItems: "center", padding: "6px" }}>
          <X size={22} />
        </button>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px", WebkitOverflowScrolling: "touch" }}>

        {/* ═══ COLUMN 1: AI PROVIDER & MODEL ═══ */}
        {(viewMode === "agent" || viewMode === "all") && (
          <>
            <div style={sectionStyle}>
              <SectionHeader icon={<Cpu size={14} />} title="AI PROVIDER & MODEL" />

              {/* Step 1: Provider */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={labelStyle}>1. SELECT AI PROVIDER</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  {Object.entries(PROVIDER_LABELS).map(([key, info]) => (
                    <button
                      key={key}
                      onClick={() => setProvider(key)}
                      style={{
                        padding: "12px 10px",
                        background: provider === key ? "var(--accent-glow)" : "rgba(0,0,0,0.3)",
                        border: `1px solid ${provider === key ? "var(--border-accent)" : "var(--border)"}`,
                        borderRadius: "10px",
                        color: provider === key ? "var(--accent)" : "var(--text-secondary)",
                        fontSize: "12px",
                        fontFamily: "var(--font-mono)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                        fontWeight: provider === key ? "bold" : "normal",
                        transition: "all 0.15s",
                        minHeight: 44,
                      }}
                    >
                      <span>{info.icon}</span>
                      <span>{info.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Step 2: Endpoint & Credentials */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${provider}-credentials`}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15 }}
                  style={{ display: "flex", flexDirection: "column", gap: "10px" }}
                >
                  <label style={labelStyle}>
                    2. {isLocal ? "LOCAL SERVER ENDPOINT" : isCustomOpenai ? "API ENDPOINT & CREDENTIALS" : "API CREDENTIALS"}
                  </label>

                  {/* Base URL for custom_openai */}
                  {isCustomOpenai && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6 }}>
                        <Globe size={12} style={{ opacity: 0.7 }} />
                        API ENDPOINT / BASE URL (required)
                      </label>
                      <input
                        value={customOpenaiBaseUrl}
                        onChange={(e) => { setCustomOpenaiBaseUrl(e.target.value); setTestKeyState("idle"); setTestKeyMessage(""); }}
                        type="text" inputMode="url"
                        placeholder="e.g. http://localhost:20128/v1 or http://127.0.0.1:8000/v1"
                        style={inputStyle}
                      />
                    </div>
                  )}

                  {/* Provider display name */}
                  {isCustomOpenai && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6 }}>
                        <Tag size={12} style={{ opacity: 0.7 }} />
                        PROVIDER DISPLAY NAME (optional)
                      </label>
                      <input
                        value={customOpenaiProviderName}
                        onChange={(e) => setCustomOpenaiProviderName(e.target.value)}
                        type="text"
                        placeholder="e.g. OmniRoute, vLLM, LM Studio, LocalAI"
                        style={inputStyle}
                      />
                    </div>
                  )}

                  {/* Ollama base URL */}
                  {isLocal && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6 }}>
                        <Globe size={12} style={{ opacity: 0.7 }} />
                        OLLAMA SERVER URL (optional)
                      </label>
                      <input
                        value={customOpenaiBaseUrl}
                        onChange={(e) => { setCustomOpenaiBaseUrl(e.target.value); setTestKeyState("idle"); setTestKeyMessage(""); }}
                        type="text" inputMode="url"
                        placeholder="http://127.0.0.1:11434"
                        style={inputStyle}
                      />
                    </div>
                  )}

                  {/* API Key */}
                  {!isLocal && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ ...labelStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span>{providerInfo.apiKeyLabel || (isCustomOpenai ? "API KEY (optional)" : "API KEY")}</span>
                        {hasSavedKey && (
                          <span style={{ fontSize: "10px", color: "var(--success)", display: "flex", alignItems: "center", gap: "3px" }}>
                            <CheckCircle2 size={11} /> KEY SAVED
                          </span>
                        )}
                      </label>
                      <input
                        value={getCurrentKeyInput()}
                        onChange={(e) => { setCurrentKeyInput(e.target.value); setTestKeyState("idle"); setTestKeyMessage(""); }}
                        type="password"
                        placeholder={hasSavedKey ? "•••••••••• (leave blank to keep)" : providerInfo.apiKeyPlaceholder}
                        style={inputStyle}
                      />
                    </div>
                  )}

                  {/* Test Key */}
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: 2, flexWrap: "wrap" }}>
                    <button
                      onClick={handleTestKey}
                      disabled={testKeyState === "checking" || (!getCurrentKeyInput() && !hasSavedKey && !isCustomOpenai && !isLocal)}
                      style={{
                        padding: "10px 16px",
                        background: testKeyState === "valid" ? "rgba(0,200,80,0.15)" : testKeyState === "invalid" ? "rgba(255,50,50,0.15)" : "rgba(255,255,255,0.06)",
                        border: `1px solid ${testKeyState === "valid" ? "var(--success)" : testKeyState === "invalid" ? "var(--danger)" : "var(--border)"}`,
                        color: testKeyState === "valid" ? "var(--success)" : testKeyState === "invalid" ? "var(--danger)" : "var(--text-secondary)",
                        borderRadius: "10px",
                        fontSize: "12px",
                        fontFamily: "var(--font-mono)",
                        cursor: testKeyState === "checking" ? "wait" : "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        letterSpacing: "0.05em",
                        transition: "all 0.2s",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {testKeyState === "checking" ? <><RefreshCw size={12} style={{ animation: "spin 1s linear infinite" }} /> TESTING...</>
                        : testKeyState === "valid" ? <><CheckCircle2 size={12} /> VALID</>
                        : testKeyState === "invalid" ? <>✕ FAILED</>
                        : <>{isLocal ? "TEST CONNECTION" : "TEST KEY"}</>}
                    </button>
                    {testKeyMessage && (
                      <span style={{ fontSize: "11px", color: testKeyState === "valid" ? "var(--success)" : testKeyState === "invalid" ? "var(--danger)" : "var(--text-secondary)", opacity: 0.9, flex: 1, minWidth: 100 }}>
                        {testKeyMessage}
                      </span>
                    )}
                  </div>

                  {providerInfo.docsUrl && (
                    <span style={{ fontSize: "11px", color: "var(--text-secondary)", opacity: 0.8 }}>
                      Get your key at: <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>{providerInfo.docsUrl}</span>
                    </span>
                  )}
                </motion.div>
              </AnimatePresence>

              {/* Step 3: Model Selection */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${provider}-model`}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15 }}
                  style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "4px" }}
                >
                  {isLocal ? (
                    <>
                      <label style={{ ...labelStyle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span>3. LOCAL MODEL (Ollama)</span>
                        <button
                          onClick={fetchDynamicModels}
                          title="Refresh local Ollama models"
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 4, fontSize: 11, padding: 4 }}
                        >
                          <RefreshCw size={12} style={{ animation: modelFetchState === "loading" ? "spin 1s linear infinite" : "none" }} />
                          {modelFetchState === "live" ? "LIVE" : modelFetchState === "offline" ? "OFFLINE" : modelFetchState === "loading" ? "FETCHING…" : "REFRESH"}
                        </button>
                      </label>
                      {dynamicModels.length > 0 ? (
                        <select value={localModel} onChange={(e) => setLocalModel(e.target.value)} style={selectStyle}>
                          {dynamicModels.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                          <option value="__custom__" disabled style={{ color: "rgba(255,255,255,0.4)" }}>── Custom ──</option>
                        </select>
                      ) : (
                        <select
                          value={OLLAMA_ALL_SUGGESTIONS.some(m => m.value === localModel) ? localModel : "__custom__"}
                          onChange={(e) => { if (e.target.value !== "__custom__") setLocalModel(e.target.value); }}
                          style={selectStyle}
                        >
                          <option value="__custom__" disabled>── Suggestions (Ollama offline) ──</option>
                          {OLLAMA_ALL_SUGGESTIONS.map((m) => <option key={m.value} value={m.value}>{formatModelLabel(m)}</option>)}
                        </select>
                      )}
                      <input
                        value={localModel}
                        onChange={(e) => setLocalModel(e.target.value)}
                        placeholder="Custom: e.g. qwen2.5-coder:3b, llama3.2:3b"
                        style={{ ...inputStyle, marginTop: 4, fontSize: 13 }}
                      />
                    </>
                  ) : isCustomOpenai ? (
                    <>
                      <label style={{ ...labelStyle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span>3. SELECT MODEL</span>
                        <button
                          onClick={fetchDynamicModels}
                          title="Fetch live models from endpoint"
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 4, fontSize: 11, padding: 4 }}
                        >
                          <RefreshCw size={12} style={{ animation: modelFetchState === "loading" ? "spin 1s linear infinite" : "none" }} />
                          {modelFetchState === "live" ? `LIVE (${dynamicModels.length})` : modelFetchState === "loading" ? "FETCHING…" : "FETCH LIVE"}
                        </button>
                      </label>
                      {dynamicModels.length > 0 && (
                        <select
                          value={cloudModel}
                          onChange={(e) => { setCloudModel(e.target.value); setLocalModel(e.target.value); }}
                          style={selectStyle}
                        >
                          {dynamicModels.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                      )}
                      <input
                        value={cloudModel}
                        onChange={(e) => { setCloudModel(e.target.value); setLocalModel(e.target.value); }}
                        placeholder="Model ID: e.g. auto/fast, cw/claude-4-6, gpt-4o"
                        style={{ ...inputStyle, marginTop: dynamicModels.length > 0 ? 4 : 0, fontSize: 13 }}
                      />
                      {dynamicModels.length > 0 ? (
                        <span style={{ fontSize: 11, color: "var(--accent)", opacity: 0.7 }}>✓ Live model catalog from endpoint ({dynamicModels.length} models)</span>
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--text-secondary)", opacity: 0.6 }}>Tap &apos;Test Key&apos; above or &apos;Fetch Live&apos; to load models, or type model ID manually</span>
                      )}
                    </>
                  ) : (
                    <>
                      <label style={{ ...labelStyle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span>3. SELECT MODEL</span>
                        {PROVIDER_LABELS[provider]?.supportsModelFetch && (
                          <button
                            onClick={fetchDynamicModels}
                            title="Fetch live model list"
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 4, fontSize: 11, padding: 4 }}
                          >
                            <RefreshCw size={12} style={{ animation: modelFetchState === "loading" ? "spin 1s linear infinite" : "none" }} />
                            {modelFetchState === "live" ? `LIVE (${dynamicModels.length})` : modelFetchState === "loading" ? "FETCHING…" : "FETCH LIVE"}
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
                        <span style={{ fontSize: 11, color: "var(--accent)", opacity: 0.7 }}>✓ Live model list from {provider} ({dynamicModels.length} models)</span>
                      )}
                    </>
                  )}
                </motion.div>
              </AnimatePresence>

              {/* Agent Engine toggles */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", borderTop: "1px dashed rgba(255,255,255,0.08)", paddingTop: "14px" }}>
                <Toggle
                  checked={longTermMemoryEnabled}
                  onChange={setLongTermMemoryEnabled}
                  label="LONG-TERM SEMANTIC MEMORY"
                  sublabel="Remembers preferences via embeddings"
                />
                <Toggle
                  checked={useLanggraph}
                  onChange={setUseLanggraph}
                  label="USE NATIVE LANGGRAPH FLOW"
                  sublabel="Stateful multi-step tasks & recovery"
                />
                <Toggle
                  checked={useSupervisor}
                  onChange={setUseSupervisor}
                  label="USE MULTI-AGENT SUPERVISOR"
                  sublabel="Domain-classified tool filtering for safety"
                />
                {provider === "google" && (
                  <Toggle
                    checked={useNativeVoice}
                    onChange={setUseNativeVoice}
                    label="USE NATIVE VOICE (GEMINI LIVE)"
                    sublabel="Sub-second real-time bidirectional audio"
                  />
                )}
              </div>
            </div>
          </>
        )}

        {/* ═══ COLUMN 2: VOICE & AUDIO ═══ */}
        {(viewMode === "interaction" || viewMode === "all" || viewMode === "system") && (
          <>
            <div style={sectionStyle}>
              <SectionHeader icon={<Volume2 size={14} />} title="VOICE & INTERACTION" />

              {/* Voice accent */}
              <div style={{ display: "flex", flexDirection: "column" }}>
                <label style={labelStyle}>VOICE CHARACTER / ACCENT</label>
                <select value={voiceAccent} onChange={(e) => setVoiceAccent(e.target.value)} style={selectStyle}>
                  <optgroup label="English Accents">
                    <option value="ie">🍀 F.R.I.D.A.Y. Accent (Irish)</option>
                    <option value="com">🇺🇸 Google Accent (US)</option>
                    <option value="co.uk">🇬🇧 British Accent (UK)</option>
                    <option value="co.in">🇮🇳 Indian Accent (IN)</option>
                    <option value="com.au">🇦🇺 Australian Accent (AU)</option>
                    <option value="ca">🇨🇦 Canadian Accent (CA)</option>
                  </optgroup>
                  <optgroup label="Languages">
                    <option value="hi">🇮🇳 Hindi / हिन्दी</option>
                    <option value="fr">🇫🇷 French / Français</option>
                    <option value="es">🇪🇸 Spanish / Español</option>
                    <option value="de">🇩🇪 German / Deutsch</option>
                    <option value="ja">🇯🇵 Japanese / 日本語</option>
                    <option value="pt">🇧🇷 Portuguese / Português</option>
                  </optgroup>
                </select>
              </div>

              {/* Voice speed */}
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", ...labelStyle }}>
                  <span>PLAYBACK SPEED</span>
                  <span style={{ color: "var(--accent)" }}>{voiceSpeed.toFixed(2)}x</span>
                </div>
                <input
                  type="range" min="0.8" max="2.0" step="0.05"
                  value={voiceSpeed}
                  onChange={(e) => setVoiceSpeed(parseFloat(e.target.value))}
                  style={{ flex: 1, accentColor: "var(--accent)", cursor: "pointer", marginTop: 8, height: "8px", borderRadius: "4px" }}
                />
              </div>

              <Toggle
                checked={continuousListening}
                onChange={setContinuousListening}
                label="CONTINUOUS BACKGROUND LISTENING"
                sublabel="Listens continuously after wake word"
              />

              {/* Wake word */}
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", paddingTop: "4px", borderTop: "1px dashed rgba(255,255,255,0.08)" }}>
                <Toggle
                  checked={wakeWordEnabled}
                  onChange={setWakeWordEnabled}
                  label="ENABLE WAKE WORD DETECTION"
                  sublabel='Say "hey sarthi" to activate'
                />
                {wakeWordEnabled && (
                  <>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <label style={labelStyle}>CUSTOM WAKE WORDS (COMMA SEPARATED)</label>
                      <input
                        value={wakeWordsInput}
                        onChange={(e) => setWakeWordsInput(e.target.value)}
                        placeholder="e.g. hey sarthi, hello sarthi"
                        style={inputStyle}
                      />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", ...labelStyle }}>
                        <span>SENSITIVITY / THRESHOLD</span>
                        <span style={{ color: "var(--accent)" }}>{wakeWordThreshold.toFixed(2)}</span>
                      </div>
                      <input
                        type="range" min="0.1" max="0.9" step="0.05"
                        value={wakeWordThreshold}
                        onChange={(e) => setWakeWordThreshold(parseFloat(e.target.value))}
                        style={{ flex: 1, accentColor: "var(--accent)", cursor: "pointer", marginTop: 8, height: "8px" }}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* ── SOUND & AUDIO CUES ── */}
            <div style={sectionStyle}>
              <SectionHeader icon={<Bell size={14} />} title="SOUND & AUDIO CUES" />
              <Toggle
                checked={soundEnabled}
                onChange={(val) => setSoundEnabledLocal(val)}
                label="ENABLE SOUND CUES"
                sublabel="Beeps & tones on wake, listen, reply, errors"
              />
              {soundEnabled && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <label style={labelStyle}>CUE VOLUME ({soundVolume}%)</label>
                  <input
                    type="range" min="0" max="100" step="5"
                    value={soundVolume}
                    onChange={(e) => setSoundVolume(parseInt(e.target.value, 10))}
                    style={{ flex: 1, accentColor: "var(--accent)", cursor: "pointer", height: "8px" }}
                  />
                </div>
              )}
            </div>
          </>
        )}

        {/* ═══ COLUMN 3: THEME & APPEARANCE ═══ */}
        {(viewMode === "system" || viewMode === "all") && (
          <div style={sectionStyle}>
            <SectionHeader icon={<Palette size={14} />} title="THEME & APPEARANCE" />

            {/* Theme dropdown */}
            <div style={{ display: "flex", flexDirection: "column" }}>
              <label style={labelStyle}>THEME STYLE</label>
              <select value={theme} onChange={(e) => { setTheme(e.target.value); setCustomAccentLocal(null); }} style={selectStyle}>
                {THEMES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            {/* Custom accent color */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <label style={{ ...labelStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>UI COLOUR OVERRIDE (ACCENT)</span>
                {customAccent && (
                  <button
                    onClick={() => { setCustomAccentLocal(null); setAccentInput(""); }}
                    style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 11, padding: 4 }}
                  >
                    <Trash2 size={12} /> RESET
                  </button>
                )}
              </label>

              {/* Quick swatches */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                {ACCENT_PRESETS.map((c) => (
                  <button
                    key={c}
                    onClick={() => applyCustomAccent(c)}
                    style={{
                      width: 36, height: 36, borderRadius: "50%",
                      background: c,
                      border: `2px solid ${customAccent === c ? "#fff" : "rgba(255,255,255,0.15)"}`,
                      cursor: "pointer",
                      boxShadow: customAccent === c ? `0 0 12px ${c}` : "none",
                      transform: customAccent === c ? "scale(1.15)" : "scale(1)",
                      transition: "all 0.15s",
                    }}
                    aria-label={`Accent ${c}`}
                  />
                ))}
              </div>

              {/* Hex input */}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  value={accentInput}
                  onChange={(e) => { setAccentInput(e.target.value.toUpperCase()); const v = e.target.value.trim(); if (isValidHex(v.startsWith("#") ? v : "#" + v)) applyCustomAccent(v.startsWith("#") ? v : "#" + v); }}
                  placeholder="#1AFF1A"
                  style={{ ...inputStyle, flex: 1, letterSpacing: "0.1em" }}
                />
                <div style={{ width: 44, height: 44, borderRadius: 10, background: customAccent || "var(--accent)", border: "1px solid var(--border)", flexShrink: 0 }} />
              </div>
              <span style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.04em" }}>
                Live preview — pick a preset or type a hex value. Overrides the accent of the selected theme.
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Footer Save Button */}
      <div style={{
        padding: "16px",
        borderTop: "1px solid var(--border)",
        background: "rgba(0,0,0,0.3)",
        flexShrink: 0,
      }}>
        <button
          onClick={handleSave}
          disabled={saved}
          style={{
            background: saved ? "var(--success, #00e6a0)" : "var(--accent)",
            color: "#000",
            border: "none",
            padding: "16px",
            fontWeight: "bold",
            fontSize: "14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            cursor: "pointer",
            borderRadius: "12px",
            letterSpacing: "0.06em",
            width: "100%",
            fontFamily: "var(--font-mono)",
            boxShadow: saved ? "0 0 12px rgba(0,230,160,0.3)" : "0 0 12px var(--accent-glow)",
          }}
        >
          {saved ? <><CheckCircle2 size={18} /> SETTINGS SAVED!</> : <><Save size={18} />
            {viewMode === "agent" ? "SAVE AGENT CONFIG"
             : viewMode === "interaction" ? "SAVE VOICE & AUDIO"
             : viewMode === "system" ? "SAVE SYSTEM SETTINGS"
             : "SAVE ALL SETTINGS"}</>}
        </button>
      </div>
    </motion.div>
  );
}