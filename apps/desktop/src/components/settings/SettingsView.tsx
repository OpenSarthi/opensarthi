import { useState } from "react";
import { X, Save, Volume2, Palette } from "lucide-react";
import { motion } from "framer-motion";

interface SettingsViewProps {
  onClose: () => void;
  currentLocalModel: string;
  currentCloudModel: string;
  currentGeminiKey: string;
  currentVoiceAccent: string;
  currentVoiceSpeed: number;
  currentTheme: string;
  onSave: (
    localModel: string,
    cloudModel: string,
    geminiKey: string,
    voiceAccent: string,
    voiceSpeed: number,
    continuousListening: boolean,
    theme: string
  ) => void;
}

export function SettingsView({
  onClose,
  currentLocalModel,
  currentCloudModel,
  currentGeminiKey,
  currentVoiceAccent,
  currentVoiceSpeed,
  currentTheme,
  onSave,
}: SettingsViewProps) {
  const [localModel, setLocalModel] = useState(currentLocalModel);
  const [cloudModel, setCloudModel] = useState(currentCloudModel);
  const [geminiKey, setGeminiKey] = useState(currentGeminiKey);
  const [voiceAccent, setVoiceAccent] = useState(currentVoiceAccent);
  const [voiceSpeed, setVoiceSpeed] = useState(currentVoiceSpeed);
  const [theme, setTheme] = useState(currentTheme);

  const predefinedOptions = [
    { value: "gemini-2.5-flash", label: "Google Gemini 2.5 Flash" },
    { value: "gemini-2.5-pro", label: "Google Gemini 2.5 Pro" },
    { value: "gpt-4o", label: "OpenAI GPT-4o" },
    { value: "gpt-4-turbo", label: "OpenAI GPT-4 Turbo" },
    { value: "claude-3-5-sonnet", label: "Anthropic Claude 3.5 Sonnet" },
    { value: "claude-3-opus", label: "Anthropic Claude 3 Opus" },
    { value: "kimi-k2.5:cloud", label: "Kimi K2.5 Cloud (Moonshot AI)" },
    { value: "deepseek-chat", label: "DeepSeek Chat" }
  ];

  const hasCurrentModel = predefinedOptions.some(opt => opt.value === cloudModel);
  const selectOptions = hasCurrentModel 
    ? predefinedOptions 
    : [...predefinedOptions, { value: cloudModel, label: `Custom Model: ${cloudModel}` }];

  const handleSave = () => {
    onSave(localModel, cloudModel, geminiKey, voiceAccent, voiceSpeed, true, theme);
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: "fixed",
        top: 0, left: 0, right: 0, bottom: 0,
        background: "var(--bg-glass)",
        backdropFilter: "blur(10px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        className="hud-panel"
        style={{ width: "440px", padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: "16px", color: "var(--accent)", letterSpacing: "0.1em", fontWeight: "bold" }}>
            // SYSTEM CONFIGURATION
          </h2>
          <button onClick={onClose} style={{ color: "var(--text-secondary)", cursor: "pointer", background: "none", border: "none" }}>
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Container for Settings */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxHeight: "480px", overflowY: "auto", paddingRight: "4px" }}>
          
          {/* AI Model Section */}
          <div style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "14px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <h3 style={{ fontSize: "11px", color: "var(--text-secondary)", letterSpacing: "0.05em", margin: 0 }}>[ AI CORE AGENT SETTINGS ]</h3>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "11px", color: "var(--text-secondary)" }}>LOCAL AI MODEL</label>
              <input
                value={localModel}
                onChange={(e) => setLocalModel(e.target.value)}
                placeholder="e.g. qwen2.5-coder:3b"
                style={{
                  background: "rgba(0,0,0,0.4)",
                  border: "1px solid var(--border)",
                  padding: "8px",
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "13px",
                  outline: "none"
                }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "11px", color: "var(--text-secondary)" }}>CLOUD AI MODEL</label>
              <select
                value={cloudModel}
                onChange={(e) => setCloudModel(e.target.value)}
                style={{
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                  padding: "8px",
                  paddingRight: "32px",
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "13px",
                  outline: "none",
                  borderRadius: "0px",
                  WebkitAppearance: "none",
                  MozAppearance: "none",
                  appearance: "none",
                  backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ff3b30' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`,
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 8px center",
                  backgroundSize: "16px",
                  colorScheme: "dark"
                }}
              >
                {selectOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                API KEY {currentGeminiKey ? "(SAVED)" : ""}
              </label>
              <input
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                type="password"
                placeholder={currentGeminiKey ? "•••••••••••••••• (Leave blank to keep existing key)" : "Enter API Key for the selected model..."}
                style={{
                  background: "rgba(0,0,0,0.4)",
                  border: "1px solid var(--border)",
                  padding: "8px",
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "13px",
                  outline: "none"
                }}
              />
            </div>
          </div>

          {/* Theme customizer Section */}
          <div style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "14px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <h3 style={{ fontSize: "11px", color: "var(--text-secondary)", letterSpacing: "0.05em", margin: 0, display: "flex", alignItems: "center", gap: "6px" }}>
              <Palette size={12} color="var(--accent)" /> [ INTERFACE THEME ]
            </h3>

            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "11px", color: "var(--text-secondary)" }}>ACTIVE STYLING MATRIX</label>
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                style={{
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                  padding: "8px",
                  paddingRight: "32px",
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "13px",
                  outline: "none",
                  borderRadius: "0px",
                  WebkitAppearance: "none",
                  MozAppearance: "none",
                  appearance: "none",
                  backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ff3b30' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`,
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 8px center",
                  backgroundSize: "16px",
                  colorScheme: "dark"
                }}
              >
                <option value="theme-red-black">🔴 Dark Crimson (Spider-Man / HUD Default)</option>
                <option value="theme-green-black">🟢 Dark Forest (Matrix Green)</option>
                <option value="theme-purple-black">🟣 Dark Nebula (Cyberpunk Purple)</option>
                <option value="theme-light-sakura">🌸 Light Sakura (Soft Pink & White)</option>
                <option value="theme-light-slate">🏙️ Light Slate (Sky Blue & Slate Gray)</option>
              </select>
            </div>
          </div>

          {/* Voice Config Section */}
          <div style={{ paddingBottom: "8px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <h3 style={{ fontSize: "11px", color: "var(--text-secondary)", letterSpacing: "0.05em", margin: 0, display: "flex", alignItems: "center", gap: "6px" }}>
              <Volume2 size={12} color="var(--accent)" /> [ VOICE & AGENTIC INTERACTIVE SETTINGS ]
            </h3>

            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "11px", color: "var(--text-secondary)" }}>VOICE CHARACTER / ACCENT</label>
              <select
                value={voiceAccent}
                onChange={(e) => setVoiceAccent(e.target.value)}
                style={{
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                  padding: "8px",
                  paddingRight: "32px",
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "13px",
                  outline: "none",
                  borderRadius: "0px",
                  WebkitAppearance: "none",
                  MozAppearance: "none",
                  appearance: "none",
                  backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ff3b30' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`,
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 8px center",
                  backgroundSize: "16px",
                  colorScheme: "dark"
                }}
              >
                <optgroup label="English Accents">
                  <option value="ie">🍀 F.R.I.D.A.Y. Accent (Irish Female)</option>
                  <option value="com">🇺🇸 Google Accent (US Female)</option>
                  <option value="co.uk">🇬🇧 British Accent (UK Female)</option>
                  <option value="co.in">🇮🇳 Indian Accent (IN Female)</option>
                  <option value="com.au">🇦🇺 Australian Accent (AU Female)</option>
                  <option value="ca">🇨🇦 Canadian Accent (CA Female)</option>
                  <option value="co.nz">🇳🇿 New Zealand Accent (NZ Female)</option>
                </optgroup>
                <optgroup label="International Languages">
                  <option value="fr">🇫🇷 French / Français</option>
                  <option value="es">🇪🇸 Spanish / Español</option>
                  <option value="de">🇩🇪 German / Deutsch</option>
                  <option value="hi">🇮🇳 Hindi / हिन्दी</option>
                  <option value="ja">🇯🇵 Japanese / 日本語</option>
                  <option value="it">🇮🇹 Italian / Italiano</option>
                  <option value="pt">🇧🇷 Portuguese / Português</option>
                </optgroup>
              </select>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                PLAYBACK SPEECH SPEED ({voiceSpeed}x)
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <input
                  type="range"
                  min="0.8"
                  max="2.0"
                  step="0.05"
                  value={voiceSpeed}
                  onChange={(e) => setVoiceSpeed(parseFloat(e.target.value))}
                  style={{
                    flex: 1,
                    accentColor: "var(--accent)",
                    height: "4px",
                    background: "rgba(255,255,255,0.1)",
                    border: "none",
                    outline: "none",
                    cursor: "pointer",
                  }}
                />
                <span style={{ fontSize: "13px", fontFamily: "var(--font-mono)", color: "var(--accent)", minWidth: "42px", textAlign: "right" }}>
                  {voiceSpeed.toFixed(2)}x
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={handleSave}
          style={{
            background: "var(--accent)",
            color: "#000",
            border: "none",
            padding: "10px",
            fontWeight: "bold",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            marginTop: "6px",
            cursor: "pointer"
          }}
          className="hover-glow"
        >
          <Save size={16} /> SAVE & APPLY CHANGES
        </button>
      </div>
    </motion.div>
  );
}
