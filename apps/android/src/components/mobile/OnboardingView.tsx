import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronRight, Sparkles, User, MessageSquare, X, Wrench, Globe, Tag, RefreshCw, CheckCircle2 } from "lucide-react";
import { useAssistantStore } from "../../stores/assistantStore";
import {
  PROVIDER_MODELS,
  PROVIDER_LABELS,
  OLLAMA_ALL_SUGGESTIONS,
  formatModelLabel,
  validateClientDirect,
  type FetchedModel,
} from "../../lib/models";

const SKILLS = [
  { id: "general",           icon: "🤖", label: "General",              desc: "Balanced chat & everyday help" },
  { id: "desktop_automation",icon: "🖥️", label: "Automation",           desc: "Control apps, click, type on screen" },
  { id: "developer",         icon: "💻", label: "Developer",            desc: "Code, debug, terminal & Git" },
  { id: "system_admin",      icon: "🔧", label: "SysAdmin",             desc: "System management & shell" },
  { id: "media",             icon: "🎵", label: "Media & Music",        desc: "Spotify, YouTube & media" },
  { id: "writing",           icon: "✍️", label: "Writing",              desc: "Drafts, blogs, emails & editing" },
  { id: "research",          icon: "🔬", label: "Research",             desc: "Deep analysis & summaries" },
  { id: "web",               icon: "🌐", label: "Web & Browser",        desc: "Browser & web automation" },
  { id: "files",             icon: "📂", label: "Files & Data",         desc: "File management & processing" },
  { id: "privacy",           icon: "🔒", label: "Privacy Mode",         desc: "Local models, minimal data" },
  { id: "home_user",         icon: "🏠", label: "Home User",            desc: "Friendly, simple & approachable" },
  { id: "gaming",            icon: "🎮", label: "Gaming & Fun",         desc: "Gaming tips & entertainment" },
];

const ALL_SKILL_IDS = SKILLS.map(s => s.id);

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px",
  background: "rgba(0, 0, 0, 0.6)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "white",
  fontSize: "14px",
  outline: "none",
  boxSizing: "border-box",
  colorScheme: "dark",
  cursor: "pointer",
};

interface OnboardingViewProps {
  onComplete: (data: {
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
  }) => void;
  isEdit?: boolean;
  onClose?: () => void;
}

export function OnboardingView({ onComplete, isEdit = false, onClose }: OnboardingViewProps) {
  const storeUserName = useAssistantStore(s => s.userName);
  const storeUserSkills = useAssistantStore(s => s.userSkills);
  const storeCustomPrompt = useAssistantStore(s => s.customPrompt);

  const [step, setStep] = useState<"skills" | "persona" | "agent">("skills");
  const [selected, setSelected] = useState<Set<string>>(() => {
    if (isEdit && storeUserSkills && storeUserSkills.length > 0) {
      return new Set(storeUserSkills);
    }
    return new Set(ALL_SKILL_IDS);
  });
  const [userName, setUserName] = useState(() => isEdit ? storeUserName : "");
  const [customPrompt, setCustomPrompt] = useState(() => isEdit ? storeCustomPrompt : "");

  // Agent Settings local states
  const [provider, setProvider] = useState("google");
  const [cloudModel, setCloudModel] = useState("gemini-2.5-flash");
  const [apiKey, setApiKey] = useState("");
  const [customOpenaiBaseUrl, setCustomOpenaiBaseUrl] = useState("");
  const [customOpenaiApiKey, setCustomOpenaiApiKey] = useState("");
  const [customOpenaiProviderName, setCustomOpenaiProviderName] = useState("");

  const isLocal = provider === "ollama";
  const isCustomOpenai = provider === "custom_openai";

  const toggle = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allSelected = selected.size === SKILLS.length;

  const handleSkillsContinue = () => {
    if (selected.size === 0) setSelected(new Set(["general"]));
    setStep("persona");
  };

  const handlePersonaContinue = () => {
    if (isEdit) {
      handleFinish();
    } else {
      setStep("agent");
    }
  };

  const handleFinish = () => {
    const skills = selected.size > 0 ? Array.from(selected) : ALL_SKILL_IDS;
    const allApiKeys: Record<string, string> = {};
    if (apiKey.trim()) {
      allApiKeys[provider] = apiKey.trim();
    }
    if (customOpenaiApiKey.trim()) {
      allApiKeys.custom_openai = customOpenaiApiKey.trim();
    }
    onComplete({
      skills,
      userName: userName.trim(),
      customPrompt: customPrompt.trim(),
      provider,
      cloudModel,
      localModel: isLocal ? cloudModel : undefined,
      apiKey: apiKey.trim(),
      customOpenaiBaseUrl: isCustomOpenai ? customOpenaiBaseUrl.trim() : undefined,
      customOpenaiApiKey: isCustomOpenai ? customOpenaiApiKey.trim() : undefined,
      customOpenaiProviderName: isCustomOpenai ? customOpenaiProviderName.trim() : undefined,
      allApiKeys: Object.keys(allApiKeys).length > 0 ? allApiKeys : undefined,
    });
  };

  const handleSkip = () => {
    onComplete({ skills: ALL_SKILL_IDS, userName: "", customPrompt: "" });
  };

  if (isEdit) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: "fixed", inset: 0, zIndex: 110,
          background: "var(--bg-primary)",
          display: "flex", flexDirection: "column",
          fontFamily: "var(--font-mono)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border)", padding: "16px 20px", background: "rgba(0,0,0,0.2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Wrench size={16} color="var(--accent)" />
            <span style={{ fontSize: "14px", fontWeight: "bold", color: "var(--accent)", letterSpacing: "0.05em" }}>// CUSTOMIZE PROFILE</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: "4px" }}>
            <X size={20} />
          </button>
        </div>

        {/* Scroll Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "20px" }}>
          
          {/* User Name */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label style={{ fontSize: "11px", color: "var(--text-secondary)", letterSpacing: "0.06em" }}>USER NAME</label>
            <input
              type="text"
              value={userName}
              onChange={e => setUserName(e.target.value.slice(0, 40))}
              placeholder="What should OpenSarthi call you?"
              style={{
                width: "100%", padding: "12px", background: "rgba(0,0,0,0.6)",
                border: "1px solid var(--border)", borderRadius: 8,
                color: "var(--text-primary)", fontSize: "14px", outline: "none", boxSizing: "border-box",
                fontFamily: "var(--font-mono)",
              }}
            />
          </div>

          {/* Custom prompt */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label style={{ fontSize: "11px", color: "var(--text-secondary)", letterSpacing: "0.06em" }}>CUSTOM INSTRUCTIONS</label>
            <textarea
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value.slice(0, 500))}
              placeholder="E.g., Speak concisely. I use Arch Linux. Focus on python development."
              rows={4}
              style={{
                width: "100%", padding: "12px", background: "rgba(0,0,0,0.6)",
                border: "1px solid var(--border)", borderRadius: 8,
                color: "var(--text-primary)", fontSize: "13px", outline: "none", boxSizing: "border-box",
                fontFamily: "var(--font-mono)", resize: "none", lineHeight: 1.5
              }}
            />
            <div style={{ textAlign: "right", fontSize: "10px", color: "var(--text-secondary)", opacity: 0.5 }}>
              {customPrompt.length}/500
            </div>
          </div>

          {/* Skills Grid */}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={{ fontSize: "11px", color: "var(--text-secondary)", letterSpacing: "0.06em" }}>CAPABILITIES</label>
              <button
                onClick={() => setSelected(allSelected ? new Set(["general"]) : new Set(ALL_SKILL_IDS))}
                style={{
                  fontSize: "10px", color: "var(--accent)", background: "transparent",
                  border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", cursor: "pointer",
                }}
              >
                {allSelected ? "DESELECT ALL" : "SELECT ALL"}
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              {SKILLS.map(skill => {
                const isOn = selected.has(skill.id);
                return (
                  <button
                    key={skill.id}
                    onClick={() => toggle(skill.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: "8px",
                      padding: "10px", borderRadius: 8, cursor: "pointer",
                      background: isOn ? "var(--accent-glow)" : "rgba(255,255,255,0.02)",
                      border: `1px solid ${isOn ? "var(--accent)" : "var(--border)"}`,
                      textAlign: "left",
                      boxSizing: "border-box",
                    }}
                  >
                    <span style={{ fontSize: "18px" }}>{skill.icon}</span>
                    <span style={{ fontSize: "12px", color: isOn ? "white" : "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                      {skill.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

        </div>

        {/* Footer */}
        <div style={{ display: "flex", gap: "12px", borderTop: "1px solid var(--border)", padding: "16px", background: "rgba(0,0,0,0.3)" }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: "14px", fontSize: "14px", fontWeight: "bold",
              background: "transparent", border: "1px solid var(--border)",
              borderRadius: 10, color: "var(--text-secondary)", cursor: "pointer",
              fontFamily: "var(--font-mono)",
            }}
          >
            CANCEL
          </button>
          <button
            onClick={handleFinish}
            style={{
              flex: 1, padding: "14px", fontSize: "14px", fontWeight: "bold",
              background: "var(--accent)", border: "none",
              borderRadius: 10, color: "#000", cursor: "pointer",
              fontFamily: "var(--font-mono)",
              boxShadow: "0 0 12px var(--accent-glow)",
            }}
          >
            SAVE CHANGES
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: "fixed", inset: 0, zIndex: 110,
        background: "var(--bg-primary)",
        display: "flex", flexDirection: "column",
        fontFamily: "var(--font-mono)",
        overflow: "hidden",
      }}
    >
      {/* Scrollable Center Form */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 20px", display: "flex", flexDirection: "column", gap: "24px", WebkitOverflowScrolling: "touch" }}>
        
        {/* Header */}
        <div style={{ textAlign: "center", marginTop: "16px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Sparkles size={20} color="var(--accent)" />
            <span style={{ fontSize: "20px", fontWeight: "bold", color: "white", letterSpacing: "0.05em" }}>
              OPENSARTHI
            </span>
          </div>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0 }}>
            {step === "skills" ? "Choose assistant capabilities" :
             step === "persona" ? "Personalize your experience" :
             "Set up your AI Engine"}
          </p>
        </div>

        {/* Steps dots */}
        <div style={{ display: "flex", justifyContent: "center", gap: "8px" }}>
          {["skills", "persona", "agent"].map((s) => (
            <div key={s} style={{
              width: step === s ? "24px" : "6px", height: "6px", borderRadius: "3px",
              background: step === s ? "var(--accent)" : "var(--border)",
              transition: "all 0.3s ease",
            }} />
          ))}
        </div>

        {/* Steps panels */}
        <AnimatePresence mode="wait">
          {step === "skills" ? (
            <motion.div key="skills" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label style={{ fontSize: "11px", color: "var(--text-secondary)", letterSpacing: "0.06em" }}>1. CAPABILITIES</label>
                  <button
                    onClick={() => setSelected(allSelected ? new Set(["general"]) : new Set(ALL_SKILL_IDS))}
                    style={{
                      fontSize: "10px", color: "var(--accent)", background: "transparent",
                      border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", cursor: "pointer",
                    }}
                  >
                    {allSelected ? "DESELECT ALL" : "SELECT ALL"}
                  </button>
                </div>
                
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  {SKILLS.map(skill => {
                    const isOn = selected.has(skill.id);
                    return (
                      <button
                        key={skill.id}
                        onClick={() => toggle(skill.id)}
                        style={{
                          display: "flex", alignItems: "center", gap: "8px",
                          padding: "12px 10px", borderRadius: 8, cursor: "pointer",
                          background: isOn ? "var(--accent-glow)" : "rgba(255,255,255,0.02)",
                          border: `1px solid ${isOn ? "var(--accent)" : "var(--border)"}`,
                          textAlign: "left",
                          boxSizing: "border-box",
                        }}
                      >
                        <span style={{ fontSize: "16px" }}>{skill.icon}</span>
                        <span style={{ fontSize: "11px", color: isOn ? "white" : "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                          {skill.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          ) : step === "persona" ? (
            <motion.div key="persona" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "11px", color: "var(--text-secondary)", letterSpacing: "0.06em", marginBottom: 6 }}>
                    <User size={12} /> YOUR NAME
                  </label>
                  <input
                    type="text"
                    value={userName}
                    onChange={e => setUserName(e.target.value.slice(0, 40))}
                    placeholder="Enter name..."
                    style={{
                      width: "100%", padding: "12px", background: "rgba(0,0,0,0.6)",
                      border: "1px solid var(--border)", borderRadius: 8,
                      color: "white", fontSize: "14px", outline: "none", boxSizing: "border-box",
                      fontFamily: "var(--font-mono)",
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "11px", color: "var(--text-secondary)", letterSpacing: "0.06em", marginBottom: 6 }}>
                    <MessageSquare size={12} /> SPECIAL DIRECTIONS
                  </label>
                  <textarea
                    value={customPrompt}
                    onChange={e => setCustomPrompt(e.target.value.slice(0, 500))}
                    placeholder="E.g., Respond with code examples where possible."
                    rows={5}
                    style={{
                      width: "100%", padding: "12px", background: "rgba(0,0,0,0.6)",
                      border: "1px solid var(--border)", borderRadius: 8,
                      color: "white", fontSize: "13px", outline: "none", boxSizing: "border-box",
                      fontFamily: "var(--font-mono)", resize: "none", lineHeight: 1.5
                    }}
                  />
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div key="agent" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* Provider selector */}
                <div>
                  <label style={{ display: "block", fontSize: "11px", color: "var(--text-secondary)", letterSpacing: "0.06em", marginBottom: 6 }}>
                    1. ACTIVE ENGINE
                  </label>
                  <select
                    value={provider}
                    onChange={(e) => {
                      const p = e.target.value;
                      setProvider(p);
                      const models = PROVIDER_MODELS[p] || [];
                      if (models.length > 0) setCloudModel(models[0].value);
                    }}
                    style={selectStyle}
                  >
                    {Object.entries(PROVIDER_LABELS).map(([key, info]) => (
                      <option key={key} value={key}>{info.icon} {info.label}</option>
                    ))}
                  </select>
                </div>

                {/* Base URL for custom_openai */}
                {isCustomOpenai && (
                  <div>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "11px", color: "var(--text-secondary)", letterSpacing: "0.06em", marginBottom: 6 }}>
                      <Globe size={12} style={{ opacity: 0.7 }} />
                      API ENDPOINT / BASE URL
                    </label>
                    <input
                      type="text" inputMode="url"
                      value={customOpenaiBaseUrl}
                      onChange={(e) => setCustomOpenaiBaseUrl(e.target.value)}
                      placeholder="e.g. http://localhost:20128/v1 or http://127.0.0.1:8000/v1"
                      style={{
                        width: "100%", padding: "12px", background: "rgba(0,0,0,0.6)",
                        border: "1px solid var(--border)", borderRadius: 8,
                        color: "white", fontSize: "13px", outline: "none", boxSizing: "border-box",
                        fontFamily: "var(--font-mono)",
                      }}
                    />
                  </div>
                )}

                {/* Provider display name for custom_openai */}
                {isCustomOpenai && (
                  <div>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "11px", color: "var(--text-secondary)", letterSpacing: "0.06em", marginBottom: 6 }}>
                      <Tag size={12} style={{ opacity: 0.7 }} />
                      PROVIDER DISPLAY NAME (optional)
                    </label>
                    <input
                      type="text"
                      value={customOpenaiProviderName}
                      onChange={(e) => setCustomOpenaiProviderName(e.target.value)}
                      placeholder="e.g. OmniRoute, vLLM, LM Studio"
                      style={{
                        width: "100%", padding: "12px", background: "rgba(0,0,0,0.6)",
                        border: "1px solid var(--border)", borderRadius: 8,
                        color: "white", fontSize: "13px", outline: "none", boxSizing: "border-box",
                        fontFamily: "var(--font-mono)",
                      }}
                    />
                  </div>
                )}

                {/* Model selector */}
                <div>
                  <label style={{ display: "block", fontSize: "11px", color: "var(--text-secondary)", letterSpacing: "0.06em", marginBottom: 6 }}>
                    {isLocal ? "2. LOCAL MODEL (Ollama)" : isCustomOpenai ? "2. SELECT MODEL" : "2. ACTIVE MODEL"}
                  </label>
                  {isLocal ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <select
                        value={cloudModel}
                        onChange={(e) => setCloudModel(e.target.value)}
                        style={selectStyle}
                      >
                        <option value="qwen2.5:3b">Qwen 2.5 3B (suggest)</option>
                        {OLLAMA_ALL_SUGGESTIONS.map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                      <input
                        value={cloudModel}
                        onChange={(e) => setCloudModel(e.target.value)}
                        placeholder="Custom: e.g. llama3.2:3b, qwen2.5:7b"
                        style={{
                          width: "100%", padding: "12px", background: "rgba(0,0,0,0.6)",
                          border: "1px solid var(--border)", borderRadius: 8,
                          color: "white", fontSize: "13px", outline: "none", boxSizing: "border-box",
                          fontFamily: "var(--font-mono)",
                        }}
                      />
                    </div>
                  ) : isCustomOpenai ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {(PROVIDER_MODELS[provider] || []).length > 0 ? (
                        <select
                          value={cloudModel}
                          onChange={(e) => setCloudModel(e.target.value)}
                          style={selectStyle}
                        >
                          {(PROVIDER_MODELS[provider] || []).map((m) => (
                            <option key={m.value} value={m.value}>{m.label}</option>
                          ))}
                        </select>
                      ) : null}
                      <input
                        type="text"
                        value={cloudModel}
                        onChange={(e) => setCloudModel(e.target.value)}
                        placeholder="Model ID: e.g. gpt-4o, claude-4-sonnet, auto/fast"
                        style={{
                          width: "100%", padding: "12px", background: "rgba(0,0,0,0.6)",
                          border: "1px solid var(--border)", borderRadius: 8,
                          color: "white", fontSize: "13px", outline: "none", boxSizing: "border-box",
                          fontFamily: "var(--font-mono)",
                        }}
                      />
                    </div>
                  ) : (
                    <select
                      value={cloudModel}
                      onChange={(e) => setCloudModel(e.target.value)}
                      style={selectStyle}
                    >
                      {(PROVIDER_MODELS[provider] || []).map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* API Key */}
                {!isLocal && (
                  <div>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "11px", color: "var(--text-secondary)", letterSpacing: "0.06em", marginBottom: 6 }}>
                      {isCustomOpenai ? "3. API KEY (optional)" : "3. API SECRET KEY"}
                    </label>
                    <input
                      type="password"
                      value={isCustomOpenai ? customOpenaiApiKey : apiKey}
                      onChange={(e) => isCustomOpenai ? setCustomOpenaiApiKey(e.target.value) : setApiKey(e.target.value)}
                      placeholder={isCustomOpenai ? "sk-... (leave blank if not required)" : "Paste your API key here..."}
                      style={{
                        width: "100%", padding: "12px", background: "rgba(0,0,0,0.6)",
                        border: "1px solid var(--border)", borderRadius: 8,
                        color: "white", fontSize: "13px", outline: "none", boxSizing: "border-box",
                        fontFamily: "var(--font-mono)",
                      }}
                    />
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>

      {/* Navigation Footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border)", padding: "16px", background: "rgba(0,0,0,0.3)" }}>
        <button
          onClick={step === "skills" ? handleSkip : step === "persona" ? () => setStep("skills") : () => setStep("persona")}
          style={{
            fontSize: "12px", color: "var(--text-secondary)", background: "transparent",
            border: "none", cursor: "pointer", fontFamily: "var(--font-mono)",
          }}
        >
          {step === "skills" ? "SKIP SETUP" : "BACK"}
        </button>

        <button
          onClick={step === "skills" ? handleSkillsContinue : step === "persona" ? handlePersonaContinue : handleFinish}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "12px 20px", borderRadius: 10, cursor: "pointer",
            background: "var(--accent)", border: "none", color: "#000",
            fontSize: "13px", fontWeight: "bold",
            boxShadow: "0 0 12px var(--accent-glow)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {step === "skills" || step === "persona" ? (
            <>CONTINUE <ChevronRight size={16} /></>
          ) : (
            <><Sparkles size={14} /> START SARTHI</>
          )}
        </button>
      </div>
    </motion.div>
  );
}
