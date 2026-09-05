import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  ChevronRight,
  Sparkles,
  User,
  MessageSquare,
  X,
  Wrench,
  RefreshCw,
  CheckCircle2,
  Globe,
  Tag,
} from "lucide-react";
import { useAssistantStore } from "../../stores/assistantStore";
import {
  PROVIDER_MODELS,
  PROVIDER_LABELS,
  OLLAMA_ALL_SUGGESTIONS,
  formatModelLabel,
  validateClientDirect,
  FetchedModel,
} from "../../lib/models";

const SKILLS = [
  { id: "general",           icon: "🤖", label: "General Assistant",    desc: "Balanced chat & everyday help", color: "#00FF66" },
  { id: "desktop_automation",icon: "🖥️", label: "Desktop Automation",   desc: "Control apps, click, type on screen", color: "#00D9FF" },
  { id: "developer",         icon: "💻", label: "Developer & Coding",   desc: "Code, debug, terminal & Git", color: "#7B2FFE" },
  { id: "system_admin",      icon: "🔧", label: "System Admin",         desc: "System management & shell commands", color: "#FF5722" },
  { id: "media",             icon: "🎵", label: "Media & Music",        desc: "Spotify, YouTube & media controls", color: "#FFEB3B" },
  { id: "writing",           icon: "✍️", label: "Writing & Content",    desc: "Drafts, blogs, emails & editing", color: "#E91E63" },
  { id: "research",          icon: "🔬", label: "Research & Analysis",  desc: "Deep analysis & smart summaries", color: "#9C27B0" },
  { id: "web",               icon: "🌐", label: "Web & Browser",        desc: "Browser automation & web tasks", color: "#2196F3" },
  { id: "files",             icon: "📂", label: "Files & Data",         desc: "File management & data processing", color: "#4CAF50" },
  { id: "privacy",           icon: "🔒", label: "Privacy Mode",         desc: "Local model preferred, minimal data", color: "#607D8B" },
  { id: "home_user",         icon: "🏠", label: "Home User",            desc: "Friendly, simple & approachable", color: "#FF9800" },
  { id: "gaming",            icon: "🎮", label: "Gaming & Fun",         desc: "Gaming tips & entertainment", color: "#3F51B5" },
];

const ALL_SKILL_IDS = SKILLS.map(s => s.id);

const hexToRgba = (hex: string, alpha: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 36px 12px 16px",
  background: "rgba(10, 10, 18, 0.75)",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  borderRadius: 10,
  color: "white",
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "inherit",
  WebkitAppearance: "none",
  MozAppearance: "none",
  appearance: "none",
  backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.5)' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 14px center",
  backgroundSize: "16px",
  colorScheme: "dark",
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 16px",
  background: "rgba(255, 255, 255, 0.05)",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  borderRadius: 10,
  color: "white",
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "inherit",
  transition: "border-color 0.2s",
};

const PROVIDER_OPTIONS = [
  { id: "google", name: "Google Gemini", icon: "✨", desc: "Best Vision & Speed" },
  { id: "openai", name: "OpenAI GPT", icon: "🤖", desc: "Industry Standard" },
  { id: "anthropic", name: "Claude AI", icon: "🧠", desc: "Intelligent Agent" },
  { id: "groq", name: "Groq Cloud", icon: "⚡", desc: "Ultra-Fast Inference" },
  { id: "openrouter", name: "OpenRouter", icon: "🔀", desc: "Multi-Model Router" },
  { id: "custom_openai", name: "Custom / OmniRoute", icon: "🔧", desc: "Local Proxy / vLLM" },
  { id: "ollama", name: "Ollama (Local)", icon: "🏠", desc: "100% Private & Offline" },
];

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
  runtimePort?: number | null;
}

export function OnboardingView({ onComplete, isEdit = false, onClose, runtimePort }: OnboardingViewProps) {
  const storeUserName = useAssistantStore(s => s.userName);
  const storeUserSkills = useAssistantStore(s => s.userSkills);
  const storeCustomPrompt = useAssistantStore(s => s.customPrompt);
  const storeGeminiApiKey = useAssistantStore(s => s.geminiApiKey);
  const storeOpenaiApiKey = useAssistantStore(s => s.openaiApiKey);
  const storeAnthropicApiKey = useAssistantStore(s => s.anthropicApiKey);
  const storeGroqApiKey = useAssistantStore(s => s.groqApiKey);
  const storeOpenrouterApiKey = useAssistantStore(s => s.openrouterApiKey);
  const storeCustomOpenaiApiKey = useAssistantStore(s => s.customOpenaiApiKey);
  const storeCustomOpenaiBaseUrl = useAssistantStore(s => s.customOpenaiBaseUrl);
  const storeCustomOpenaiProviderName = useAssistantStore(s => s.customOpenaiProviderName);
  const storeActiveProvider = useAssistantStore(s => s.activeProvider);
  const storeActiveCloudModel = useAssistantStore(s => s.activeCloudModel);
  const storeActiveLocalModel = useAssistantStore(s => s.activeLocalModel);

  const [step, setStep] = useState<"skills" | "persona" | "agent">("skills");
  const [selected, setSelected] = useState<Set<string>>(() => {
    if (isEdit && storeUserSkills && storeUserSkills.length > 0) {
      return new Set(storeUserSkills);
    }
    return new Set(ALL_SKILL_IDS);
  });
  const [userName, setUserName] = useState(() => isEdit ? storeUserName : "");
  const [customPrompt, setCustomPrompt] = useState(() => isEdit ? storeCustomPrompt : "");
  const [nameError, setNameError] = useState("");

  // Agent Settings local states
  const [provider, setProvider] = useState(() => storeActiveProvider || "google");
  const [cloudModel, setCloudModel] = useState(() => storeActiveCloudModel || "gemini-3.6-flash");
  const [localModel, setLocalModel] = useState(() => storeActiveLocalModel || OLLAMA_ALL_SUGGESTIONS[0]?.value || "llama3.1:8b");
  const [customOpenaiBaseUrl, setCustomOpenaiBaseUrl] = useState(() => storeCustomOpenaiBaseUrl || "http://localhost:20128/v1");
  const [customOpenaiProviderName, setCustomOpenaiProviderName] = useState(() => storeCustomOpenaiProviderName || "");
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState("http://127.0.0.1:11434");

  const [apiKeys, setApiKeys] = useState<Record<string, string>>(() => ({
    google: storeGeminiApiKey || "",
    openai: storeOpenaiApiKey || "",
    anthropic: storeAnthropicApiKey || "",
    groq: storeGroqApiKey || "",
    openrouter: storeOpenrouterApiKey || "",
    custom_openai: storeCustomOpenaiApiKey || "",
  }));

  const [testKeyState, setTestKeyState] = useState<"idle" | "checking" | "valid" | "invalid">("idle");
  const [testKeyMessage, setTestKeyMessage] = useState("");
  const [dynamicModels, setDynamicModels] = useState<FetchedModel[]>([]);
  const [modelFetchState, setModelFetchState] = useState<"idle" | "loading" | "live" | "offline" | "error">("idle");

  const isLocal = provider === "ollama";
  const isCustomOpenai = provider === "custom_openai";
  const providerInfo = PROVIDER_LABELS[provider] || {
    label: provider,
    icon: "✨",
    apiKeyLabel: "API KEY",
    apiKeyPlaceholder: "Paste your API key...",
    docsUrl: "",
    supportsModelFetch: false,
  };

  const handleProviderSelect = (pId: string) => {
    setProvider(pId);
    setTestKeyState("idle");
    setTestKeyMessage("");
    setDynamicModels([]);
    setModelFetchState("idle");

    const models = PROVIDER_MODELS[pId] || [];
    if (pId === "ollama") {
      setLocalModel(OLLAMA_ALL_SUGGESTIONS[0]?.value || "llama3.1:8b");
    } else if (pId === "custom_openai") {
      setCloudModel("auto/fast");
      setLocalModel("auto/fast");
    } else if (models.length > 0) {
      setCloudModel(models[0].value);
    }
  };

  // Fetch dynamic models (Backend proxy + Direct client fallback)
  const fetchDynamicModels = useCallback(async () => {
    if (!PROVIDER_LABELS[provider]?.supportsModelFetch) return;
    const effectiveKey = (apiKeys[provider] || "").trim();
    const effectiveBaseUrl = (isCustomOpenai ? customOpenaiBaseUrl : ollamaBaseUrl).trim() ||
      (isCustomOpenai ? "http://localhost:20128/v1" : "http://127.0.0.1:11434");

    setModelFetchState("loading");

    // For custom_openai, try direct fetch first since local server responds immediately
    if (isCustomOpenai) {
      try {
        const directResult = await validateClientDirect("custom_openai", effectiveKey, effectiveBaseUrl);
        if (directResult.valid && directResult.models.length > 0) {
          setDynamicModels(directResult.models);
          setModelFetchState("live");
          const currentSelected = cloudModel || localModel;
          const modelExists = directResult.models.some((m) => m.value === currentSelected);
          if (!modelExists) {
            setCloudModel(directResult.models[0].value);
            setLocalModel(directResult.models[0].value);
          }
          return;
        }
      } catch {
        // Fall back to backend proxy below
      }
    }

    // Try backend proxy if runtimePort is available
    if (runtimePort) {
      try {
        const params = new URLSearchParams({ provider });
        if (effectiveKey) params.set("api_key", effectiveKey);
        if (isCustomOpenai || provider === "ollama") {
          params.set("base_url", effectiveBaseUrl);
        }
        const res = await fetch(`http://127.0.0.1:${runtimePort}/models?${params}`);
        if (res.ok) {
          const data: { models: FetchedModel[]; source: string } = await res.json();
          if (data.models && data.models.length > 0) {
            setDynamicModels(data.models);
            setModelFetchState(data.source === "offline" ? "offline" : "live");
            const currentSelected = isLocal ? localModel : cloudModel;
            const modelExists = data.models.some((m) => m.value === currentSelected);
            if (!modelExists) {
              if (isLocal) {
                setLocalModel(data.models[0].value);
              } else if (isCustomOpenai) {
                setCloudModel(data.models[0].value);
                setLocalModel(data.models[0].value);
              } else {
                setCloudModel(data.models[0].value);
              }
            }
            return;
          }
        }
      } catch {
        // Fall back to direct client fetch
      }
    }

    // Fallback: Direct client fetch
    try {
      const direct = await validateClientDirect(provider, effectiveKey, effectiveBaseUrl);
      if (direct.valid && direct.models.length > 0) {
        setDynamicModels(direct.models);
        setModelFetchState("live");
        const currentSelected = isLocal ? localModel : cloudModel;
        const modelExists = direct.models.some((m) => m.value === currentSelected);
        if (!modelExists) {
          if (isLocal) {
            setLocalModel(direct.models[0].value);
          } else {
            setCloudModel(direct.models[0].value);
            if (isCustomOpenai) setLocalModel(direct.models[0].value);
          }
        }
        return;
      }
    } catch {
      // Ignore
    }

    setModelFetchState("error");
  }, [provider, runtimePort, apiKeys, isCustomOpenai, customOpenaiBaseUrl, ollamaBaseUrl, isLocal, cloudModel, localModel]);

  // Test API key / Test Connection handler
  const handleTestKey = useCallback(async () => {
    const effectiveKey = (apiKeys[provider] || "").trim();
    const effectiveBaseUrl = (isCustomOpenai ? customOpenaiBaseUrl : ollamaBaseUrl).trim() ||
      (isCustomOpenai ? "http://localhost:20128/v1" : "http://127.0.0.1:11434");

    setTestKeyState("checking");
    setTestKeyMessage("Testing...");

    const applySuccess = (models: FetchedModel[], message: string) => {
      setTestKeyState("valid");
      setTestKeyMessage(message);
      if (models.length > 0) {
        setDynamicModels(models);
        setModelFetchState("live");
        const currentSelected = isLocal ? localModel : cloudModel;
        const modelExists = models.some((m) => m.value === currentSelected);
        if (!modelExists) {
          if (isLocal) {
            setLocalModel(models[0].value);
          } else {
            setCloudModel(models[0].value);
            if (isCustomOpenai) setLocalModel(models[0].value);
          }
        }
      }
    };

    // For custom_openai, try direct browser fetch first since local server responds immediately
    if (isCustomOpenai) {
      try {
        const direct = await validateClientDirect("custom_openai", effectiveKey, effectiveBaseUrl);
        if (direct.valid) {
          applySuccess(direct.models, `✓ Connected! Found ${direct.models.length} models`);
          return;
        }
      } catch {
        // Fall through to backend proxy
      }
    }

    // Try backend proxy if runtimePort is available
    if (runtimePort) {
      try {
        const params = new URLSearchParams({ provider });
        if (effectiveKey) params.set("api_key", effectiveKey);
        if (isCustomOpenai || provider === "ollama") {
          params.set("base_url", effectiveBaseUrl);
        }
        const res = await fetch(`http://127.0.0.1:${runtimePort}/validate_key?${params}`);
        if (res.ok) {
          const data = await res.json();
          if (data.valid) {
            applySuccess(data.models || [], `✓ ${data.message || "Valid API key"}`);
            return;
          } else {
            // If backend proxy failed or returned invalid, try direct client validation as fallback
            const direct = await validateClientDirect(provider, effectiveKey, effectiveBaseUrl);
            if (direct.valid) {
              applySuccess(direct.models, `✓ ${direct.message}`);
              return;
            }
            setTestKeyState("invalid");
            setTestKeyMessage(`✕ ${data.message || "Invalid credentials"}`);
            return;
          }
        }
      } catch {
        // Fall through to direct client validation
      }
    }

    // Fallback: Direct client validation
    try {
      const direct = await validateClientDirect(provider, effectiveKey, effectiveBaseUrl);
      if (direct.valid) {
        applySuccess(direct.models, `✓ ${direct.message}`);
      } else {
        setTestKeyState("invalid");
        setTestKeyMessage(`✕ ${direct.message}`);
      }
    } catch (err: any) {
      setTestKeyState("invalid");
      setTestKeyMessage(`✕ Error: ${err?.message || "Could not validate"}`);
    }
  }, [provider, apiKeys, isCustomOpenai, customOpenaiBaseUrl, ollamaBaseUrl, runtimePort, isLocal, localModel, cloudModel]);

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
      // If we are in customization edit popup, skip step 3 and save directly
      handleFinish();
    } else {
      setStep("agent");
    }
  };

  const handleFinish = () => {
    const skills = selected.size > 0 ? Array.from(selected) : ALL_SKILL_IDS;
    const finalLocalModel = localModel.trim() || "llama3.1:8b";
    const finalApiKey = (apiKeys[provider] || "").trim();
    onComplete({
      skills,
      userName: userName.trim(),
      customPrompt: customPrompt.trim(),
      provider,
      cloudModel: isCustomOpenai ? cloudModel.trim() : cloudModel,
      localModel: isCustomOpenai ? cloudModel.trim() : finalLocalModel,
      apiKey: finalApiKey,
      customOpenaiBaseUrl: isCustomOpenai
        ? customOpenaiBaseUrl.trim()
        : isLocal && ollamaBaseUrl.trim() !== "http://127.0.0.1:11434"
        ? ollamaBaseUrl.trim()
        : undefined,
      customOpenaiApiKey: isCustomOpenai ? (apiKeys.custom_openai || "").trim() : undefined,
      customOpenaiProviderName: isCustomOpenai ? customOpenaiProviderName.trim() : undefined,
      allApiKeys: apiKeys,
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
        transition={{ duration: 0.15 }}
        style={{
          position: "fixed",
          top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0, 0, 0, 0.05)",
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "flex-start",
          padding: "54px 12px 12px 12px",
          zIndex: 9999,
          fontFamily: "var(--font-sans, 'Inter', sans-serif)",
        }}
        onClick={onClose}
      >
        <motion.div
          className="hud-panel"
          initial={{ x: 250, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 250, opacity: 0 }}
          transition={{ type: "spring", stiffness: 280, damping: 26 }}
          onClick={e => e.stopPropagation()}
          style={{
            width: "min(720px, calc(100vw - 24px))",
            maxHeight: "calc(100vh - 66px)",
            background: "rgba(10, 10, 10, 0.98)",
            border: "1px solid var(--border)",
            boxShadow: "0 15px 50px rgba(0, 0, 0, 0.8), inset 0 0 1px 1px rgba(255,255,255,0.03)",
            padding: 24,
            display: "flex", flexDirection: "column", gap: 16,
            overflowY: "auto",
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border)", paddingBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Wrench size={16} color="var(--accent)" />
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.03em" }}>Customise Persona & Skills</span>
            </div>
            <button
              onClick={onClose}
              style={{
                background: "none", border: "none", color: "var(--text-secondary)",
                cursor: "pointer", padding: 4, display: "flex", alignItems: "center",
                transition: "color 0.2s"
              }}
              onMouseOver={e => e.currentTarget.style.color = "var(--accent)"}
              onMouseOut={e => e.currentTarget.style.color = "var(--text-secondary)"}
            >
              <X size={18} />
            </button>
          </div>

          {/* Body content */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            
            {/* Persona Setup Section */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", letterSpacing: "0.05em" }}>1. PROFILE & INSTRUCTIONS</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 16 }}>
                <div>
                  <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: "var(--text-secondary)", letterSpacing: "0.06em", marginBottom: 6 }}>USER NAME</label>
                  <input
                    type="text"
                    value={userName}
                    onChange={e => {
                      setUserName(e.target.value.slice(0, 40));
                      setNameError("");
                    }}
                    placeholder="What should I call you?"
                    maxLength={40}
                    style={{
                      width: "100%", padding: "9px 12px", background: "rgba(0,0,0,0.5)",
                      border: "1px solid var(--border)", borderRadius: 6,
                      color: "var(--text-primary)", fontSize: 12, outline: "none", boxSizing: "border-box",
                      fontFamily: "var(--font-mono)",
                    }}
                  />
                  {nameError && <p style={{ fontSize: 10, color: "var(--danger)", margin: "4px 0 0" }}>{nameError}</p>}
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: "var(--text-secondary)", letterSpacing: "0.06em", marginBottom: 6 }}>CUSTOM INSTRUCTIONS</label>
                  <textarea
                    value={customPrompt}
                    onChange={e => setCustomPrompt(e.target.value.slice(0, 500))}
                    placeholder="Short description of your preferences..."
                    rows={3}
                    maxLength={500}
                    style={{
                      width: "100%", padding: "9px 12px", background: "rgba(0,0,0,0.5)",
                      border: "1px solid var(--border)", borderRadius: 6,
                      color: "var(--text-primary)", fontSize: 11, outline: "none", boxSizing: "border-box",
                      fontFamily: "var(--font-mono)", resize: "none", lineHeight: 1.5
                    }}
                  />
                  <div style={{ textAlign: "right", fontSize: 9, color: "var(--text-muted)", marginTop: 2 }}>
                    {customPrompt.length}/500
                  </div>
                </div>
              </div>
            </div>

            {/* Skills selection section */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", letterSpacing: "0.05em" }}>2. AGENT CAPABILITIES</div>
                <button
                  onClick={() => setSelected(allSelected ? new Set(["general"]) : new Set(ALL_SKILL_IDS))}
                  style={{
                    fontSize: 9, fontWeight: 600, letterSpacing: "0.05em",
                    color: allSelected ? "var(--accent)" : "var(--text-secondary)",
                    background: allSelected ? "var(--accent-glow)" : "transparent",
                    border: `1px solid ${allSelected ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: 6, padding: "3px 8px", cursor: "pointer",
                  }}
                >
                  {allSelected ? "✓ ALL SELECTED" : "SELECT ALL"}
                </button>
              </div>

              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: 8,
                maxHeight: "360px",
                overflowY: "auto",
                paddingRight: 4
              }}>
                {SKILLS.map(skill => {
                  const isOn = selected.has(skill.id);
                  return (
                    <button
                      key={skill.id}
                      onClick={() => toggle(skill.id)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "8px 12px", borderRadius: 6, cursor: "pointer",
                        background: isOn
                          ? "var(--accent-glow)"
                          : "rgba(255,255,255,0.02)",
                        border: `1px solid ${isOn ? "var(--accent)" : "var(--border)"}`,
                        transition: "all 0.15s ease",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ fontSize: 18, flexShrink: 0 }}>{skill.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: isOn ? "white" : "var(--text-secondary)" }}>
                          {skill.label}
                        </div>
                      </div>
                      {isOn && <Check size={11} color="var(--accent)" style={{ flexShrink: 0 }} />}
                    </button>
                  );
                })}
              </div>
            </div>

          </div>

          {/* Footer Actions */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 14, marginTop: 4 }}>
            <button
              onClick={onClose}
              style={{
                padding: "8px 16px", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
                background: "transparent", border: "1px solid var(--border)",
                borderRadius: 6, color: "var(--text-secondary)", cursor: "pointer",
                transition: "all 0.2s"
              }}
              onMouseOver={e => { e.currentTarget.style.borderColor = "var(--text-primary)"; e.currentTarget.style.color = "var(--text-primary)"; }}
              onMouseOut={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-secondary)"; }}
            >CANCEL</button>
            <motion.button
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              onClick={handleFinish}
              style={{
                padding: "8px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.05em",
                background: "var(--accent)",
                border: "none", borderRadius: 6, color: "#000", cursor: "pointer",
                boxShadow: "0 4px 16px var(--accent-glow)",
              }}
            >
              SAVE CHANGES
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "radial-gradient(ellipse at 50% 50%, #06180f 0%, #04090c 60%, #020202 100%)",
        display: "flex", flexDirection: "column",
        fontFamily: "var(--font-sans, 'Inter', sans-serif)",
        overflowY: "auto",
        boxSizing: "border-box",
        padding: "60px 48px",
        alignItems: "center",
      }}
    >
      {/* Background glow orbs */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 0 }}>
        <div style={{ position: "absolute", top: "10%", left: "15%", width: 600, height: 600, borderRadius: "50%", background: "radial-gradient(circle, rgba(0,255,102,0.06) 0%, transparent 70%)", filter: "blur(60px)" }} />
        <div style={{ position: "absolute", bottom: "10%", right: "15%", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(0,217,255,0.05) 0%, transparent 70%)", filter: "blur(60px)" }} />
      </div>

      <div style={{
        position: "relative", zIndex: 1,
        width: "100%", maxWidth: 1000,
        display: "flex", flexDirection: "column", gap: 36,
      }}>
        {/* Header */}
        <div style={{ textAlign: "center" }}>
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, type: "spring", stiffness: 200 }}
            style={{ display: "inline-flex", alignItems: "center", gap: 12, marginBottom: 12 }}
          >
            <div style={{
              width: 44, height: 44, borderRadius: "50%",
              background: "linear-gradient(135deg, #00FF66, #00D9FF)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 0 24px rgba(0, 217, 255, 0.4)",
            }}>
              <svg width="24" height="24" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="24" cy="24" r="20" stroke="#08080c" strokeWidth="4" strokeDasharray="6 3" />
                <path d="M24 12 L34 24 L24 36 L14 24 Z" fill="#08080c" fillOpacity="0.15" stroke="#08080c" strokeWidth="4" />
                <circle cx="24" cy="24" r="4" fill="#08080c" />
              </svg>
            </div>
            <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", color: "white" }}>
              OpenSarthi
            </span>
          </motion.div>

          <AnimatePresence mode="wait">
            {step === "skills" ? (
              <motion.div key="skills-header" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                <h1 style={{ fontSize: 22, fontWeight: 700, color: "white", margin: "0 0 6px" }}>
                  What would you like me to help with?
                </h1>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", margin: 0 }}>
                  Select your use cases — this shapes how I respond and which features I enable.
                </p>
              </motion.div>
            ) : step === "persona" ? (
              <motion.div key="persona-header" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                <h1 style={{ fontSize: 22, fontWeight: 700, color: "white", margin: "0 0 6px" }}>
                  Let's personalise your experience
                </h1>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", margin: 0 }}>
                  Optional — you can always change this in Settings later.
                </p>
              </motion.div>
            ) : (
              <motion.div key="agent-header" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                <h1 style={{ fontSize: 22, fontWeight: 700, color: "white", margin: "0 0 6px" }}>
                  Configure your AI core settings
                </h1>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", margin: 0 }}>
                  Select your preferred AI provider, model, and credentials.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Step indicator */}
        <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
          {["skills", "persona", "agent"].map((s) => (
            <div key={s} style={{
              width: step === s ? 28 : 8, height: 8, borderRadius: 4,
              background: step === s ? "#00FF66" : "rgba(255,255,255,0.15)",
              boxShadow: step === s ? "0 0 8px #00FF66" : "none",
              transition: "width 0.3s ease, background 0.3s ease, box-shadow 0.3s ease",
            }} />
          ))}
        </div>

        <AnimatePresence mode="wait">
          {step === "skills" ? (
            <motion.div key="skills-step" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.2 }}>
              {/* Select All toggle */}
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
                <button
                  onClick={() => setSelected(allSelected ? new Set(["general"]) : new Set(ALL_SKILL_IDS))}
                  style={{
                    fontSize: 11, fontWeight: 600, letterSpacing: "0.05em",
                    color: allSelected ? "#00FF66" : "rgba(255,255,255,0.5)",
                    background: allSelected ? "rgba(0, 255, 102, 0.12)" : "transparent",
                    border: `1px solid ${allSelected ? "rgba(0, 255, 102, 0.3)" : "rgba(255,255,255,0.1)"}`,
                    borderRadius: 6, padding: "5px 12px", cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                >
                  {allSelected ? "✓ ALL SELECTED" : "SELECT ALL"}
                </button>
              </div>

              {/* Skills grid */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                gap: 10,
              }}>
                {SKILLS.map((skill, idx) => {
                  const isOn = selected.has(skill.id);
                  const skillColor = (skill as any).color || "#00FF66";
                  return (
                    <motion.button
                      key={skill.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.03 }}
                      onClick={() => toggle(skill.id)}
                      style={{
                        display: "flex", alignItems: "flex-start", gap: 12,
                        padding: "12px 14px", borderRadius: 12, cursor: "pointer",
                        background: isOn
                          ? `linear-gradient(135deg, ${hexToRgba(skillColor, 0.15)}, ${hexToRgba(skillColor, 0.04)})`
                          : "rgba(255,255,255,0.04)",
                        border: `1px solid ${isOn ? skillColor : "rgba(255,255,255,0.08)"}`,
                        boxShadow: isOn ? `0 0 16px ${hexToRgba(skillColor, 0.12)}, inset 0 0 20px ${hexToRgba(skillColor, 0.05)}` : "none",
                        transition: "all 0.18s ease",
                        textAlign: "left",
                        position: "relative",
                      }}
                    >
                      <span style={{ fontSize: 22, flexShrink: 0, marginTop: 1 }}>{skill.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: isOn ? "white" : "rgba(255,255,255,0.7)", marginBottom: 2 }}>
                          {skill.label}
                        </div>
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", lineHeight: 1.4 }}>
                          {skill.desc}
                        </div>
                      </div>
                      <AnimatePresence>
                        {isOn && (
                          <motion.div
                            initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
                            style={{
                              position: "absolute", top: 8, right: 8,
                              width: 18, height: 18, borderRadius: "50%",
                              background: skillColor,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              boxShadow: `0 0 8px ${skillColor}`,
                            }}
                          >
                            <Check size={11} color="white" />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          ) : step === "persona" ? (
            <motion.div key="persona-step" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 520, margin: "0 auto" }}>
                {/* Name field */}
                <div>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.6)", letterSpacing: "0.06em", marginBottom: 8 }}>
                    <User size={13} /> WHAT SHOULD I CALL YOU?
                  </label>
                  <input
                    type="text"
                    value={userName}
                    onChange={e => {
                      setUserName(e.target.value.slice(0, 40));
                      setNameError("");
                    }}
                    placeholder="e.g. Your_Name, Alex, or skip..."
                    maxLength={40}
                    style={{
                      width: "100%", padding: "12px 16px",
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 10, color: "white", fontSize: 14,
                      outline: "none", boxSizing: "border-box",
                      fontFamily: "inherit",
                      transition: "border-color 0.2s",
                    }}
                    onFocus={e => (e.target.style.borderColor = "#00D9FF")}
                    onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.12)")}
                  />
                  {nameError && <p style={{ fontSize: 11, color: "hsl(0,80%,60%)", margin: "4px 0 0" }}>{nameError}</p>}
                </div>

                {/* Custom prompt */}
                <div>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.6)", letterSpacing: "0.06em", marginBottom: 8 }}>
                    <MessageSquare size={13} /> CUSTOM INSTRUCTIONS <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "rgba(255,255,255,0.3)" }}> (optional)</span>
                  </label>
                  <textarea
                    value={customPrompt}
                    onChange={e => setCustomPrompt(e.target.value.slice(0, 500))}
                    placeholder="e.g. I prefer short, direct answers. Always respond in English. I'm a backend developer who uses Arch Linux..."
                    rows={5}
                    maxLength={500}
                    style={{
                      width: "100%", padding: "12px 16px", resize: "vertical",
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 10, color: "white", fontSize: 13,
                      outline: "none", boxSizing: "border-box",
                      fontFamily: "inherit", lineHeight: 1.6,
                      transition: "border-color 0.2s",
                    }}
                    onFocus={e => (e.target.style.borderColor = "#00FF66")}
                    onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.12)")}
                  />
                  <div style={{ textAlign: "right", fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 4 }}>
                    {customPrompt.length}/500
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="agent-step"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 580, margin: "0 auto" }}>
                
                {/* 1. Provider Grid */}
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.6)", letterSpacing: "0.06em", marginBottom: 10 }}>
                    1. AI ENGINE PROVIDER
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
                    {PROVIDER_OPTIONS.map((p) => {
                      const isSelected = provider === p.id;
                      return (
                        <motion.button
                          key={p.id}
                          type="button"
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => handleProviderSelect(p.id)}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "4px",
                            padding: "12px 8px",
                            borderRadius: "10px",
                            cursor: "pointer",
                            background: isSelected
                              ? "linear-gradient(135deg, rgba(0, 255, 102, 0.15), rgba(0, 217, 255, 0.05))"
                              : "rgba(255,255,255,0.03)",
                            border: `1px solid ${isSelected ? "#00FF66" : "rgba(255,255,255,0.08)"}`,
                            boxShadow: isSelected ? "0 4px 16px rgba(0, 255, 102, 0.15)" : "none",
                            transition: "all 0.2s",
                            textAlign: "center",
                          }}
                        >
                          <span style={{ fontSize: "16px" }}>{p.icon}</span>
                          <span style={{ fontSize: "11px", fontWeight: "bold", color: isSelected ? "#fff" : "rgba(255,255,255,0.8)" }}>
                            {p.name}
                          </span>
                          <span style={{ fontSize: "9px", color: "rgba(255,255,255,0.4)" }}>
                            {p.desc}
                          </span>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>

                {/* 2. API Endpoint & Credentials (Above Model Select) */}
                <motion.div
                  key={`${provider}-credentials`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15 }}
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.6)", letterSpacing: "0.06em" }}>
                    2. {isLocal ? "LOCAL SERVER ENDPOINT" : isCustomOpenai ? "API ENDPOINT & CREDENTIALS" : "API CREDENTIALS"}
                  </label>

                  {/* Custom OpenAI Base URL */}
                  {isCustomOpenai && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <label style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", display: "flex", alignItems: "center", gap: 6 }}>
                        <Globe size={12} style={{ color: "#00D9FF" }} />
                        API ENDPOINT / BASE URL (required)
                      </label>
                      <input
                        type="text"
                        value={customOpenaiBaseUrl}
                        onChange={(e) => {
                          setCustomOpenaiBaseUrl(e.target.value);
                          setTestKeyState("idle");
                          setTestKeyMessage("");
                        }}
                        placeholder="e.g. http://localhost:20128/v1 or http://127.0.0.1:8000/v1"
                        style={inputStyle}
                        onFocus={e => (e.target.style.borderColor = "#00D9FF")}
                        onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.12)")}
                      />
                    </div>
                  )}

                  {/* Custom OpenAI Provider Display Name */}
                  {isCustomOpenai && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <label style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", display: "flex", alignItems: "center", gap: 6 }}>
                        <Tag size={12} style={{ color: "#00D9FF" }} />
                        PROVIDER DISPLAY NAME (optional)
                      </label>
                      <input
                        type="text"
                        value={customOpenaiProviderName}
                        onChange={(e) => setCustomOpenaiProviderName(e.target.value)}
                        placeholder="e.g. OmniRoute, vLLM, LM Studio, LocalAI"
                        style={inputStyle}
                        onFocus={e => (e.target.style.borderColor = "#00D9FF")}
                        onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.12)")}
                      />
                    </div>
                  )}

                  {/* Ollama Server URL */}
                  {isLocal && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <label style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", display: "flex", alignItems: "center", gap: 6 }}>
                        <Globe size={12} style={{ color: "#00D9FF" }} />
                        OLLAMA SERVER URL
                      </label>
                      <input
                        type="text"
                        value={ollamaBaseUrl}
                        onChange={(e) => {
                          setOllamaBaseUrl(e.target.value);
                          setTestKeyState("idle");
                          setTestKeyMessage("");
                        }}
                        placeholder="http://127.0.0.1:11434"
                        style={inputStyle}
                        onFocus={e => (e.target.style.borderColor = "#00D9FF")}
                        onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.12)")}
                      />
                    </div>
                  )}

                  {/* API Key for Cloud or Custom OpenAI */}
                  {!isLocal && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <label style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span>{isCustomOpenai ? "API KEY (optional / required by server)" : (providerInfo.apiKeyLabel || "API KEY")}</span>
                        {apiKeys[provider] && (
                          <span style={{ color: "#00FF66", fontSize: 10, display: "flex", alignItems: "center", gap: 4 }}>
                            <CheckCircle2 size={11} /> READY
                          </span>
                        )}
                      </label>
                      <input
                        type="password"
                        value={apiKeys[provider] || ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          setApiKeys(prev => ({ ...prev, [provider]: val }));
                          setTestKeyState("idle");
                          setTestKeyMessage("");
                        }}
                        placeholder={isCustomOpenai ? "sk-... (leave blank if not required)" : (providerInfo.apiKeyPlaceholder || "Paste your secret API key...")}
                        style={inputStyle}
                        onFocus={e => (e.target.style.borderColor = "#00FF66")}
                        onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.12)")}
                      />
                    </div>
                  )}

                  {/* Test Key / Test Connection Row */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 2 }}>
                    <button
                      type="button"
                      id={`test-key-btn-${provider}`}
                      onClick={handleTestKey}
                      disabled={testKeyState === "checking" || (!apiKeys[provider] && !isCustomOpenai && !isLocal)}
                      style={{
                        padding: "7px 14px",
                        background: testKeyState === "valid" ? "rgba(0, 255, 102, 0.15)" : testKeyState === "invalid" ? "rgba(255, 50, 50, 0.15)" : "rgba(255, 255, 255, 0.08)",
                        border: `1px solid ${testKeyState === "valid" ? "#00FF66" : testKeyState === "invalid" ? "#ff4d4d" : "rgba(255, 255, 255, 0.15)"}`,
                        color: testKeyState === "valid" ? "#00FF66" : testKeyState === "invalid" ? "#ff4d4d" : "rgba(255, 255, 255, 0.8)",
                        borderRadius: "8px",
                        fontSize: "11px",
                        fontWeight: 600,
                        letterSpacing: "0.04em",
                        cursor: testKeyState === "checking" ? "wait" : "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        transition: "all 0.2s",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {testKeyState === "checking" ? (
                        <><RefreshCw size={11} style={{ animation: "spin 1s linear infinite" }} /> TESTING...</>
                      ) : testKeyState === "valid" ? (
                        <><CheckCircle2 size={11} /> VALID</>
                      ) : testKeyState === "invalid" ? (
                        <><X size={11} /> FAILED</>
                      ) : (
                        <>{isLocal || isCustomOpenai ? "TEST CONNECTION" : "TEST KEY"}</>
                      )}
                    </button>

                    {testKeyMessage && (
                      <span style={{
                        fontSize: "11px",
                        color: testKeyState === "valid" ? "#00FF66" : testKeyState === "invalid" ? "#ff4d4d" : "rgba(255,255,255,0.7)",
                        opacity: 0.9,
                      }}>
                        {testKeyMessage}
                      </span>
                    )}
                  </div>

                  {providerInfo.docsUrl && (
                    <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
                      Get your API key at: <span style={{ color: "#00D9FF", fontFamily: "var(--font-mono, monospace)" }}>{providerInfo.docsUrl}</span>
                    </span>
                  )}
                  <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.25)" }}>
                    * Your credentials are encrypted and stored solely in your local desktop configuration.
                  </span>
                </motion.div>

                {/* 3. Active Model Select (Below Credentials) */}
                <motion.div
                  key={`${provider}-model`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15 }}
                  style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.6)", letterSpacing: "0.06em" }}>
                      3. ACTIVE MODEL SELECT
                    </label>
                    {PROVIDER_LABELS[provider]?.supportsModelFetch && (
                      <button
                        type="button"
                        onClick={fetchDynamicModels}
                        disabled={modelFetchState === "loading"}
                        title="Fetch live models from provider"
                        style={{
                          background: "rgba(255, 255, 255, 0.05)",
                          border: "1px solid rgba(255, 255, 255, 0.1)",
                          borderRadius: 6,
                          padding: "4px 10px",
                          cursor: "pointer",
                          color: modelFetchState === "live" ? "#00FF66" : "rgba(255, 255, 255, 0.7)",
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                          fontSize: 10,
                          fontWeight: 600,
                          letterSpacing: "0.04em",
                          transition: "all 0.2s",
                        }}
                      >
                        <RefreshCw size={10} style={{ animation: modelFetchState === "loading" ? "spin 1s linear infinite" : "none" }} />
                        {modelFetchState === "live"
                          ? `LIVE (${dynamicModels.length})`
                          : modelFetchState === "loading"
                          ? "FETCHING…"
                          : "FETCH LIVE"}
                      </button>
                    )}
                  </div>

                  {isLocal ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {dynamicModels.length > 0 ? (
                        <select
                          value={localModel}
                          onChange={(e) => setLocalModel(e.target.value)}
                          style={selectStyle}
                        >
                          {dynamicModels.map((m) => (
                            <option key={m.value} value={m.value} style={{ background: "#0a0a12", color: "#fff" }}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <select
                          value={OLLAMA_ALL_SUGGESTIONS.some(m => m.value === localModel) ? localModel : "__custom__"}
                          onChange={(e) => { if (e.target.value !== "__custom__") setLocalModel(e.target.value); }}
                          style={selectStyle}
                        >
                          {OLLAMA_ALL_SUGGESTIONS.map((m) => (
                            <option key={m.value} value={m.value} style={{ background: "#0a0a12", color: "#fff" }}>
                              {formatModelLabel(m)}
                            </option>
                          ))}
                          <option value="__custom__" style={{ background: "#0a0a12", color: "rgba(255,255,255,0.5)" }}>── Custom (type below) ──</option>
                        </select>
                      )}
                      <input
                        placeholder="CUSTOM MODEL (e.g. llama3.1:8b, qwen2.5-coder:7b)"
                        value={localModel}
                        onChange={(e) => setLocalModel(e.target.value)}
                        style={inputStyle}
                        onFocus={e => (e.target.style.borderColor = "#00FF66")}
                        onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.12)")}
                      />
                      {dynamicModels.length > 0 && (
                        <span style={{ fontSize: 10, color: "#00FF66", opacity: 0.8 }}>
                          ✓ Live models loaded from local Ollama ({dynamicModels.length} models)
                        </span>
                      )}
                    </div>
                  ) : isCustomOpenai ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {dynamicModels.length > 0 && (
                        <select
                          value={cloudModel}
                          onChange={(e) => {
                            setCloudModel(e.target.value);
                            setLocalModel(e.target.value);
                          }}
                          style={selectStyle}
                        >
                          {dynamicModels.map((m) => (
                            <option key={m.value} value={m.value} style={{ background: "#0a0a12", color: "#fff" }}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      )}
                      <input
                        value={cloudModel}
                        onChange={(e) => {
                          setCloudModel(e.target.value);
                          setLocalModel(e.target.value);
                        }}
                        placeholder="Model ID: e.g. auto/fast, cw/claude-sonnet-4-6, gpt-4o"
                        style={inputStyle}
                        onFocus={e => (e.target.style.borderColor = "#00D9FF")}
                        onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.12)")}
                      />
                      {dynamicModels.length > 0 ? (
                        <span style={{ fontSize: 10, color: "#00D9FF", opacity: 0.8 }}>
                          ✓ Live model catalog from endpoint ({dynamicModels.length} models)
                        </span>
                      ) : (
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
                          Click &apos;Test Connection&apos; or &apos;Fetch Live&apos; to auto-discover models, or type model ID manually.
                        </span>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <select
                        value={cloudModel}
                        onChange={(e) => setCloudModel(e.target.value)}
                        style={selectStyle}
                      >
                        {(dynamicModels.length > 0
                          ? dynamicModels
                          : (PROVIDER_MODELS[provider] || []).map(m => ({ value: m.value, label: formatModelLabel(m) }))
                        ).map((m) => (
                          <option key={m.value} value={m.value} style={{ background: "#0a0a12", color: "#fff" }}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                      {dynamicModels.length > 0 && (
                        <span style={{ fontSize: 10, color: "#00FF66", opacity: 0.8 }}>
                          ✓ Live model list from {PROVIDER_LABELS[provider]?.label || provider} ({dynamicModels.length} models)
                        </span>
                      )}
                    </div>
                  )}
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer buttons */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 4 }}>
          <button
            onClick={step === "skills" ? handleSkip : step === "persona" ? () => setStep("skills") : () => setStep("persona")}
            style={{
              fontSize: 12, color: "rgba(255,255,255,0.35)", background: "transparent",
              border: "none", cursor: "pointer", padding: "8px 0",
              transition: "color 0.2s",
            }}
            onMouseOver={e => (e.currentTarget.style.color = "rgba(255,255,255,0.6)")}
            onMouseOut={e => (e.currentTarget.style.color = "rgba(255,255,255,0.35)")}
          >
            {step === "skills" ? "Skip setup → use defaults" : "← Back"}
          </button>

          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={step === "skills" ? handleSkillsContinue : step === "persona" ? handlePersonaContinue : handleFinish}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "11px 28px", borderRadius: 10, cursor: "pointer",
              background: "linear-gradient(135deg, #00FF66, #00D9FF)",
              border: "none", color: "#08080c",
              fontSize: 13, fontWeight: 700, letterSpacing: "0.04em",
              boxShadow: "0 4px 20px rgba(0, 217, 255, 0.4)",
              fontFamily: "inherit",
            }}
          >
            {step === "skills" || step === "persona" ? (
              <><span>CONTINUE</span><ChevronRight size={16} /></>
            ) : (
              <><Sparkles size={14} /><span>START WITH OPENSARTHI</span></>
            )}
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}
