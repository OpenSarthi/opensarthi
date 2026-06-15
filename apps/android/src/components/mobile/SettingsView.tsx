import { useState, useEffect, useRef } from "react";
import { X, Save, Volume2, Palette, Cpu, CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";

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
  ],
  openrouter: [
    { value: "openai/gpt-4o", label: "OpenAI GPT-4o (via OR)" },
    { value: "anthropic/claude-opus-4", label: "Claude Opus 4 (via OR)" },
    { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro (via OR)" },
    { value: "deepseek/deepseek-chat", label: "DeepSeek Chat (via OR)" },
  ],
};

const PROVIDER_LABELS: Record<string, { label: string; icon: string; apiKeyLabel: string; apiKeyPlaceholder: string; docsUrl: string }> = {
  google:    { label: "Google Gemini", icon: "✨", apiKeyLabel: "GEMINI API KEY", apiKeyPlaceholder: "AIza...", docsUrl: "https://aistudio.google.com/apikey" },
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
  currentContinuousListening: boolean;
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
  background: "rgba(0,0,0,0.6)",
  border: "1px solid var(--border)",
  padding: "12px",
  color: "var(--text-primary)",
  fontFamily: "var(--font-mono)",
  fontSize: "14px",
  outline: "none",
  borderRadius: "8px",
  width: "100%",
  colorScheme: "dark",
  cursor: "pointer",
  boxSizing: "border-box",
};

const inputStyle: React.CSSProperties = {
  background: "rgba(0,0,0,0.6)",
  border: "1px solid var(--border)",
  padding: "12px",
  color: "var(--text-primary)",
  fontFamily: "var(--font-mono)",
  fontSize: "14px",
  outline: "none",
  borderRadius: "8px",
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
  border: "1px solid rgba(255, 255, 255, 0.05)",
  borderRadius: "12px",
  padding: "16px",
  marginBottom: "16px",
  display: "flex",
  flexDirection: "column",
  gap: "14px",
};

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h3 style={{ fontSize: "12px", color: "var(--accent)", letterSpacing: "0.05em", margin: 0, display: "flex", alignItems: "center", gap: "8px", fontFamily: "var(--font-mono)", fontWeight: "bold" }}>
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
  currentContinuousListening,
  currentTheme,
  currentWakeWords,
  currentWakeWordEnabled,
  currentWakeWordThreshold,
  onSave,
}: SettingsViewProps) {
  const [provider, setProvider] = useState(currentProvider || "google");
  const [cloudModel, setCloudModel] = useState(currentCloudModel);

  // Per-provider API keys
  const [geminiKey, setGeminiKey] = useState(currentGeminiKey);
  const [openaiKey, setOpenaiKey] = useState(currentOpenaiKey);
  const [anthropicKey, setAnthropicKey] = useState(currentAnthropicKey);
  const [groqKey, setGroqKey] = useState(currentGroqKey);
  const [openrouterKey, setOpenrouterKey] = useState(currentOpenrouterKey);

  const [voiceAccent, setVoiceAccent] = useState(currentVoiceAccent);
  const [voiceSpeed, setVoiceSpeed] = useState(currentVoiceSpeed);
  const [continuousListening, setContinuousListening] = useState(currentContinuousListening ?? false);
  const [theme, setTheme] = useState(currentTheme);
  const [saved, setSaved] = useState(false);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(currentWakeWordEnabled);
  const [wakeWordThreshold, setWakeWordThreshold] = useState(currentWakeWordThreshold);
  const [wakeWords, setWakeWords] = useState<string[]>(currentWakeWords?.length ? currentWakeWords : ["hey sarthi", "opensarthi"]);
  const [newWakeWord, setNewWakeWord] = useState("");

  const providerInfo = PROVIDER_LABELS[provider] || PROVIDER_LABELS.google;

  const lastPropsRef = useRef({
    currentGeminiKey,
    currentOpenaiKey,
    currentAnthropicKey,
    currentGroqKey,
    currentOpenrouterKey,
  });

  useEffect(() => {
    if (lastPropsRef.current.currentGeminiKey !== currentGeminiKey) {
      setGeminiKey(currentGeminiKey);
      lastPropsRef.current.currentGeminiKey = currentGeminiKey;
    }
    if (lastPropsRef.current.currentOpenaiKey !== currentOpenaiKey) {
      setOpenaiKey(currentOpenaiKey);
      lastPropsRef.current.currentOpenaiKey = currentOpenaiKey;
    }
    if (lastPropsRef.current.currentAnthropicKey !== currentAnthropicKey) {
      setAnthropicKey(currentAnthropicKey);
      lastPropsRef.current.currentAnthropicKey = currentAnthropicKey;
    }
    if (lastPropsRef.current.currentGroqKey !== currentGroqKey) {
      setGroqKey(currentGroqKey);
      lastPropsRef.current.currentGroqKey = currentGroqKey;
    }
    if (lastPropsRef.current.currentOpenrouterKey !== currentOpenrouterKey) {
      setOpenrouterKey(currentOpenrouterKey);
      lastPropsRef.current.currentOpenrouterKey = currentOpenrouterKey;
    }
  }, [currentGeminiKey, currentOpenaiKey, currentAnthropicKey, currentGroqKey, currentOpenrouterKey]);

  useEffect(() => {
    const models = PROVIDER_MODELS[provider];
    if (models && models.length > 0) {
      const matches = models.find(m => m.value === cloudModel);
      if (!matches) setCloudModel(models[0].value);
    }
  }, [provider]);

  const addWakeWord = () => {
    const w = newWakeWord.trim().toLowerCase();
    if (w && !wakeWords.includes(w)) setWakeWords(prev => [...prev, w]);
    setNewWakeWord("");
  };

  const handleSave = () => {
    onSave({
      localModel: currentLocalModel,
      cloudModel, provider,
      geminiKey, openaiKey, anthropicKey, groqKey, openrouterKey,
      voiceAccent, voiceSpeed, continuousListening, theme,
      wakeWords, wakeWordEnabled, wakeWordThreshold,
    });
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 1000);
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
        padding: "16px 20px",
        borderBottom: "1px solid var(--border)",
        background: "rgba(0,0,0,0.2)",
        flexShrink: 0,
      }}>
        <h2 style={{ fontSize: "14px", color: "var(--accent)", letterSpacing: "0.1em", fontWeight: "bold", margin: 0, fontFamily: "var(--font-mono)" }}>
          // SYSTEM CONFIG
        </h2>
        <button onClick={onClose} style={{ color: "var(--text-secondary)", cursor: "pointer", background: "none", border: "none", display: "flex", alignItems: "center", padding: "4px" }}>
          <X size={20} />
        </button>
      </div>

      {/* Scrollable content container */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px", WebkitOverflowScrolling: "touch" }}>
        
        {/* AI SECTION */}
        <div style={sectionStyle}>
          <SectionHeader icon={<Cpu size={14} />} title="AI PROVIDER & MODEL" />

          {/* Provider Dropdown */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <label style={labelStyle}>1. ACTIVE PROVIDER</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              style={selectStyle}
            >
              {Object.entries(PROVIDER_LABELS).map(([key, info]) => (
                <option key={key} value={key}>
                  {info.icon} {info.label}
                </option>
              ))}
            </select>
          </div>

          {/* Model Dropdown */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <label style={labelStyle}>2. ACTIVE MODEL</label>
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
          </div>

          {/* Dynamic API Key Input */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={labelStyle}>{providerInfo.apiKeyLabel}</label>
            </div>
            <input
              value={
                provider === "google" ? geminiKey :
                provider === "openai" ? openaiKey :
                provider === "anthropic" ? anthropicKey :
                provider === "groq" ? groqKey : openrouterKey
              }
              onChange={(e) => {
                const val = e.target.value;
                if (provider === "google") setGeminiKey(val);
                else if (provider === "openai") setOpenaiKey(val);
                else if (provider === "anthropic") setAnthropicKey(val);
                else if (provider === "groq") setGroqKey(val);
                else setOpenrouterKey(val);
              }}
              type="password"
              placeholder={providerInfo.apiKeyPlaceholder}
              style={inputStyle}
            />
            {providerInfo.docsUrl && (
              <a
                href={providerInfo.docsUrl}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: "11px", color: "var(--accent)", marginTop: "6px", textDecoration: "underline", fontFamily: "var(--font-mono)" }}
              >
                Get API Key
              </a>
            )}
          </div>
        </div>

        {/* WAKE WORD SECTION */}
        <div style={sectionStyle}>
          <SectionHeader icon={<Volume2 size={14} />} title="WAKE WORD" />

          {/* Enable toggle */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label style={labelStyle}>WAKE WORD DETECTION</label>
            <div
              onClick={() => setWakeWordEnabled(e => !e)}
              style={{
                width: 48, height: 26, borderRadius: 13, cursor: "pointer",
                background: wakeWordEnabled ? "var(--accent)" : "rgba(255,255,255,0.1)",
                position: "relative", transition: "background 0.2s",
                flexShrink: 0,
              }}
            >
              <div style={{
                position: "absolute", top: 3, left: wakeWordEnabled ? 25 : 3,
                width: 20, height: 20, borderRadius: "50%",
                background: "#fff", transition: "left 0.2s",
              }} />
            </div>
          </div>

          {/* Wake words list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={labelStyle}>WAKE WORDS</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {wakeWords.map((w, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 4,
                  background: "rgba(255,255,255,0.07)", borderRadius: 20,
                  padding: "4px 10px", border: "1px solid rgba(255,255,255,0.1)",
                }}>
                  <span style={{ fontSize: 12, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>{w}</span>
                  <button
                    onClick={() => setWakeWords(prev => prev.filter((_, idx) => idx !== i))}
                    style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", padding: 0, fontSize: 14, lineHeight: 1 }}
                  >×</button>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                autoComplete="on"
                autoCorrect="on"
                spellCheck={true}
                value={newWakeWord}
                onChange={e => setNewWakeWord(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addWakeWord()}
                placeholder="Add wake word..."
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                onClick={addWakeWord}
                style={{
                  background: "var(--accent)", color: "#000", border: "none",
                  borderRadius: 8, padding: "0 14px", fontSize: 12, fontWeight: 700,
                  cursor: "pointer", fontFamily: "var(--font-mono)",
                }}
              >ADD</button>
            </div>
          </div>

          {/* Threshold */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", ...labelStyle }}>
              <span>SENSITIVITY</span>
              <span style={{ color: "var(--accent)" }}>{wakeWordThreshold.toFixed(2)}</span>
            </div>
            <input
              type="range" min="0.3" max="0.95" step="0.05"
              value={wakeWordThreshold}
              onChange={e => setWakeWordThreshold(parseFloat(e.target.value))}
              style={{ flex: 1, accentColor: "var(--accent)", cursor: "pointer", marginTop: 6 }}
            />
          </div>
        </div>

        {/* VOICE & THEME SECTION */}
        <div style={sectionStyle}>
          <SectionHeader icon={<Volume2 size={14} />} title="VOICE & THEME" />

          {/* Theme Dropdown */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <label style={labelStyle}>THEME STYLE</label>
            <select value={theme} onChange={(e) => setTheme(e.target.value)} style={selectStyle}>
              <option value="theme-red-black">🔴 Dark Crimson</option>
              <option value="theme-mono-dark">⚫ Mono Dark</option>
              <option value="theme-green-black">🟢 Dark Forest</option>
              <option value="theme-purple-black">🟣 Dark Nebula</option>
              <option value="theme-blue-black">🌊 Dark Ocean</option>
              <option value="theme-light-sakura">🌸 Light Sakura</option>
              <option value="theme-light-slate">🏙️ Light Slate</option>
              <option value="theme-light-clean">⬜ Light Clean</option>
            </select>
          </div>

          {/* Continuous Listening toggle */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <label style={labelStyle}>ALWAYS LISTENING (WAKE WORD)</label>
              <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: 2 }}>Continuously listen in background for wake word</div>
            </div>
            <div
              onClick={() => setContinuousListening(v => !v)}
              style={{
                width: 48, height: 26, borderRadius: 13, cursor: "pointer",
                background: continuousListening ? "var(--accent)" : "rgba(255,255,255,0.1)",
                position: "relative", transition: "background 0.2s", flexShrink: 0, marginLeft: 12,
              }}
            >
              <div style={{
                position: "absolute", top: 3, left: continuousListening ? 25 : 3,
                width: 20, height: 20, borderRadius: "50%",
                background: "#fff", transition: "left 0.2s",
              }} />
            </div>
          </div>

          {/* Voice Accent */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <label style={labelStyle}>SPEECH ACCENT</label>
            <select value={voiceAccent} onChange={(e) => setVoiceAccent(e.target.value)} style={selectStyle}>
              <optgroup label="English Accents">
                <option value="ie">🍀 F.R.I.D.A.Y. Accent (Irish)</option>
                <option value="com">🇺🇸 Google Accent (US)</option>
                <option value="co.uk">🇬🇧 British Accent (UK)</option>
                <option value="co.in">🇮🇳 Indian Accent (IN)</option>
                <option value="com.au">🇦🇺 Australian Accent (AU)</option>
              </optgroup>
              <optgroup label="Languages">
                <option value="hi">🇮🇳 Hindi / हिन्दी</option>
                <option value="fr">🇫🇷 French / Français</option>
                <option value="es">🇪🇸 Spanish / Español</option>
                <option value="de">🇩🇪 German / Deutsch</option>
                <option value="ja">🇯🇵 Japanese / 日本語</option>
              </optgroup>
            </select>
          </div>

          {/* Voice Speed */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", ...labelStyle }}>
              <span>PLAYBACK SPEED</span>
              <span style={{ color: "var(--accent)" }}>{voiceSpeed.toFixed(2)}x</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "4px" }}>
              <input
                type="range"
                min="0.8" max="2.0" step="0.05"
                value={voiceSpeed}
                onChange={(e) => setVoiceSpeed(parseFloat(e.target.value))}
                style={{ flex: 1, accentColor: "var(--accent)", cursor: "pointer", height: "6px", borderRadius: "3px" }}
              />
            </div>
          </div>
        </div>

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
            padding: "14px",
            fontWeight: "bold",
            fontSize: "14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            cursor: "pointer",
            borderRadius: "10px",
            letterSpacing: "0.06em",
            width: "100%",
            fontFamily: "var(--font-mono)",
            boxShadow: saved ? "0 0 12px rgba(0,230,160,0.3)" : "0 0 12px var(--accent-glow)",
          }}
        >
          {saved ? <><CheckCircle2 size={18} /> SETTINGS SAVED!</> : <><Save size={18} /> SAVE SETTINGS</>}
        </button>
      </div>
    </motion.div>
  );
}
