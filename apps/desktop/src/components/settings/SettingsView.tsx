import { useState, useEffect } from "react";
import { X, Save, Volume2, Palette, Cpu, ChevronRight, CheckCircle2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// Provider → models mapping
const PROVIDER_MODELS: Record<string, { value: string; label: string }[]> = {
  google: [
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Fast)" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro (Smart)" },
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
  ],
  openai: [
    { value: "gpt-4o", label: "GPT-4o (Latest)" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini (Fast)" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
    { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
  ],
  anthropic: [
    { value: "claude-opus-4-5", label: "Claude Opus 4.5" },
    { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5 (Balanced)" },
    { value: "claude-haiku-3-5", label: "Claude Haiku 3.5 (Fast)" },
    { value: "claude-3-opus-20240229", label: "Claude 3 Opus" },
  ],
  groq: [
    { value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (Versatile)" },
    { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B (Instant)" },
    { value: "groq/compound", label: "Groq Compound" },
    { value: "groq/compound-mini", label: "Groq Compound Mini" },
    { value: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout 17B" },
    { value: "qwen/qwen3-32b", label: "Qwen3 32B" },
    { value: "openai/gpt-oss-120b", label: "GPT OSS 120B" },
    { value: "openai/gpt-oss-20b", label: "GPT OSS 20B" },
  ],
  openrouter: [
    { value: "openai/gpt-4o", label: "OpenAI GPT-4o (via OR)" },
    { value: "anthropic/claude-opus-4", label: "Claude Opus 4 (via OR)" },
    { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro (via OR)" },
    { value: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B (via OR)" },
    { value: "deepseek/deepseek-chat", label: "DeepSeek Chat (via OR)" },
    { value: "mistralai/mistral-large", label: "Mistral Large (via OR)" },
  ],
  ollama: [],
};

const PROVIDER_LABELS: Record<string, { label: string; icon: string; apiKeyLabel: string; apiKeyPlaceholder: string; docsUrl: string }> = {
  ollama:    { label: "Ollama (Local)", icon: "🦙", apiKeyLabel: "", apiKeyPlaceholder: "", docsUrl: "" },
  google:    { label: "Google Gemini", icon: "✨", apiKeyLabel: "GOOGLE AI API KEY", apiKeyPlaceholder: "AIza...", docsUrl: "https://aistudio.google.com/apikey" },
  openai:    { label: "OpenAI", icon: "🤖", apiKeyLabel: "OPENAI API KEY", apiKeyPlaceholder: "sk-...", docsUrl: "https://platform.openai.com/api-keys" },
  anthropic: { label: "Anthropic Claude", icon: "🧠", apiKeyLabel: "ANTHROPIC API KEY", apiKeyPlaceholder: "sk-ant-...", docsUrl: "https://console.anthropic.com/settings/keys" },
  groq:      { label: "Groq (Ultra-Fast)", icon: "⚡", apiKeyLabel: "GROQ API KEY", apiKeyPlaceholder: "gsk_...", docsUrl: "https://console.groq.com/keys" },
  openrouter:{ label: "OpenRouter", icon: "🔀", apiKeyLabel: "OPENROUTER API KEY", apiKeyPlaceholder: "sk-or-...", docsUrl: "https://openrouter.ai/settings/keys" },
};

interface SettingsViewProps {
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
  currentTheme: string;
  currentWakeWords: string[];
  currentWakeWordEnabled: boolean;
  currentWakeWordThreshold: number;
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

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h3 style={{ fontSize: "11px", color: "var(--text-secondary)", letterSpacing: "0.05em", margin: 0, display: "flex", alignItems: "center", gap: "6px" }}>
      {icon} {title}
    </h3>
  );
}

export function SettingsView({
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
  currentTheme,
  currentWakeWords,
  currentWakeWordEnabled,
  currentWakeWordThreshold,
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

  const [voiceAccent, setVoiceAccent] = useState(currentVoiceAccent);
  const [voiceSpeed, setVoiceSpeed] = useState(currentVoiceSpeed);
  const [theme, setTheme] = useState(currentTheme);
  const [wakeWordsInput, setWakeWordsInput] = useState((currentWakeWords || []).join(", "));
  const [wakeWordEnabled, setWakeWordEnabled] = useState(currentWakeWordEnabled !== undefined ? currentWakeWordEnabled : true);
  const [wakeWordThreshold, setWakeWordThreshold] = useState(currentWakeWordThreshold !== undefined ? currentWakeWordThreshold : 0.5);
  const [saved, setSaved] = useState(false);

  const providerInfo = PROVIDER_LABELS[provider] || PROVIDER_LABELS.google;
  const isLocal = provider === "ollama";

  // When provider changes, reset to first model of new provider
  useEffect(() => {
    const models = PROVIDER_MODELS[provider];
    if (models && models.length > 0) {
      setCloudModel(models[0].value);
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
    const parsedWakeWords = wakeWordsInput
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean);

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
      voiceAccent,
      voiceSpeed,
      continuousListening: true,
      theme,
      wakeWords: parsedWakeWords,
      wakeWordEnabled,
      wakeWordThreshold,
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
        background: "var(--bg-glass)",
        backdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        className="hud-panel"
        initial={{ scale: 0.93, y: 15, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.93, y: 15, opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 350 }}
        style={{
          width: "840px",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          gap: "0",
          overflow: "hidden",
          background: "rgba(0, 0, 0, 0.4)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          boxShadow: "0 10px 40px rgba(0, 0, 0, 0.5), inset 0 0 20px rgba(255,255,255,0.02)"
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 20px", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "14px", color: "var(--accent)", letterSpacing: "0.1em", fontWeight: "bold", margin: 0 }}>
            // SYSTEM CONFIGURATION
          </h2>
          <button onClick={onClose} style={{ color: "var(--text-secondary)", cursor: "pointer", background: "none", border: "none", display: "flex", alignItems: "center" }}>
            <X size={18} />
          </button>
        </div>

        {/* Scrollable content in 2 Columns */}
        <div style={{ overflowY: "auto", flex: 1, padding: "20px 24px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "28px" }}>
          
          {/* Column 1: AI Provider & Model Config */}
          <div style={{ display: "flex", flexDirection: "column", gap: "20px", borderRight: "1px solid rgba(255,255,255,0.06)", paddingRight: "24px" }}>
            <div style={sectionStyle}>
              <SectionHeader icon={<Cpu size={12} color="var(--accent)" />} title="[ AI PROVIDER & MODEL ]" />

              {/* Step 1: Provider */}
              <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                <label style={labelStyle}>1. SELECT AI PROVIDER</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                  {Object.entries(PROVIDER_LABELS).map(([key, info]) => (
                    <button
                      key={key}
                      onClick={() => setProvider(key)}
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
                      <label style={labelStyle}>
                        <ChevronRight size={10} style={{ display: "inline", marginRight: 4 }} />
                        2. LOCAL MODEL NAME (Ollama)
                      </label>
                      <input
                        value={localModel}
                        onChange={(e) => setLocalModel(e.target.value)}
                        placeholder="e.g. qwen2.5-coder:3b, llama3.2:3b"
                        style={inputStyle}
                      />
                    </>
                  ) : (
                    <>
                      <label style={labelStyle}>
                        <ChevronRight size={10} style={{ display: "inline", marginRight: 4 }} />
                        2. SELECT MODEL
                      </label>
                      <select
                        value={cloudModel}
                        onChange={(e) => setCloudModel(e.target.value)}
                        style={selectStyle}
                      >
                        {PROVIDER_MODELS[provider]?.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
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

              {/* Save AI Settings */}
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
            </div>
          </div>

          {/* Column 2: Theme & Interaction settings */}
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {/* ── THEME SECTION ── */}
            <div style={sectionStyle}>
              <SectionHeader icon={<Palette size={12} color="var(--accent)" />} title="[ INTERFACE THEME ]" />
              <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                <label style={labelStyle}>ACTIVE STYLING MATRIX</label>
                <select value={theme} onChange={(e) => setTheme(e.target.value)} style={selectStyle}>
                  <option value="theme-red-black">🔴 Dark Crimson (HUD Default)</option>
                  <option value="theme-mono-dark">⚫ Mono Dark (Black &amp; White)</option>
                  <option value="theme-green-black">🟢 Dark Forest (Matrix Green)</option>
                  <option value="theme-purple-black">🟣 Dark Nebula (Cyberpunk Purple)</option>
                  <option value="theme-blue-black">🌊 Dark Ocean (Neon Cyan)</option>
                  <option value="theme-light-sakura">🌸 Light Sakura (Pink &amp; White)</option>
                  <option value="theme-light-slate">🏙️ Light Slate (Sky Blue &amp; Gray)</option>
                  <option value="theme-light-clean">⬜ Light Clean (Pure White)</option>
                </select>
              </div>
            </div>

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

              {/* Wake Word Detection Options */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "4px", paddingTop: "12px", borderTop: "1px dashed rgba(255,255,255,0.07)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <label style={{ ...labelStyle, marginBottom: 0, cursor: "pointer" }} htmlFor="wake-word-enabled">
                    ENABLE WAKE WORD DETECTION
                  </label>
                  <input
                    id="wake-word-enabled"
                    type="checkbox"
                    checked={wakeWordEnabled}
                    onChange={(e) => setWakeWordEnabled(e.target.checked)}
                    style={{ width: "16px", height: "16px", accentColor: "var(--accent)", cursor: "pointer" }}
                  />
                </div>

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
          </div>

        </div>

        {/* Footer — Save theme+voice */}
        <div style={{ padding: "14px 20px", borderTop: "1px solid var(--border)", background: "rgba(0,0,0,0.3)" }}>
          <button
            onClick={handleSaveAI}
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
            {saved ? <><CheckCircle2 size={16} /> ALL SETTINGS SAVED!</> : <><Save size={16} /> SAVE ALL SETTINGS</>}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
