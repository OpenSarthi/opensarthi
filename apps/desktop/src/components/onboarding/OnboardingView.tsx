import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronRight, Sparkles, User, MessageSquare, X, Wrench } from "lucide-react";
import { useAssistantStore } from "../../stores/assistantStore";

const SKILLS = [
  { id: "general",           icon: "🤖", label: "General Assistant",    desc: "Balanced chat & everyday help" },
  { id: "desktop_automation",icon: "🖥️", label: "Desktop Automation",   desc: "Control apps, click, type on screen" },
  { id: "developer",         icon: "💻", label: "Developer & Coding",   desc: "Code, debug, terminal & Git" },
  { id: "system_admin",      icon: "🔧", label: "System Admin",         desc: "System management & shell commands" },
  { id: "media",             icon: "🎵", label: "Media & Music",        desc: "Spotify, YouTube & media controls" },
  { id: "writing",           icon: "✍️", label: "Writing & Content",    desc: "Drafts, blogs, emails & editing" },
  { id: "research",          icon: "🔬", label: "Research & Analysis",  desc: "Deep analysis & smart summaries" },
  { id: "web",               icon: "🌐", label: "Web & Browser",        desc: "Browser automation & web tasks" },
  { id: "files",             icon: "📂", label: "Files & Data",         desc: "File management & data processing" },
  { id: "privacy",           icon: "🔒", label: "Privacy Mode",         desc: "Local model preferred, minimal data" },
  { id: "home_user",         icon: "🏠", label: "Home User",            desc: "Friendly, simple & approachable" },
  { id: "gaming",            icon: "🎮", label: "Gaming & Fun",         desc: "Gaming tips & entertainment" },
];

const ALL_SKILL_IDS = SKILLS.map(s => s.id);

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
  ],
  openrouter: [
    { value: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B (Free)" },
    { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "deepseek/deepseek-chat", label: "DeepSeek V3" },
  ],
  ollama: [
    { value: "llama3", label: "Llama 3 (Local)" },
    { value: "phi3", label: "Phi 3 (Local)" },
    { value: "mistral", label: "Mistral (Local)" },
    { value: "custom", label: "Custom (Type below...)" },
  ]
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
  const [nameError, setNameError] = useState("");

  // Agent Settings local states
  const [provider, setProvider] = useState("google");
  const [cloudModel, setCloudModel] = useState("gemini-2.5-flash");
  const [localModel, setLocalModel] = useState("llama3");
  const [customLocalModel, setCustomLocalModel] = useState("");
  const [apiKey, setApiKey] = useState("");

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
    const finalLocalModel = localModel === "custom" ? customLocalModel.trim() : localModel;
    onComplete({
      skills,
      userName: userName.trim(),
      customPrompt: customPrompt.trim(),
      provider,
      cloudModel,
      localModel: finalLocalModel,
      apiKey: apiKey.trim()
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
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0, 0, 0, 0.45)",
          backdropFilter: "blur(20px) saturate(150%)",
          WebkitBackdropFilter: "blur(20px) saturate(150%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "var(--font-sans, 'Inter', sans-serif)",
        }}
        onClick={onClose}
      >
        <motion.div
          className="hud-panel"
          initial={{ scale: 0.93, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.93, opacity: 0, y: 20 }}
          transition={{ type: "spring", stiffness: 350, damping: 25 }}
          onClick={e => e.stopPropagation()}
          style={{
            width: "min(720px, 94vw)",
            maxHeight: "85vh",
            background: "rgba(0, 0, 0, 0.45)",
            backdropFilter: "blur(28px) saturate(160%)",
            WebkitBackdropFilter: "blur(28px) saturate(160%)",
            padding: 24,
            display: "flex", flexDirection: "column", gap: 16,
            boxShadow: "0 20px 50px rgba(0, 0, 0, 0.6), inset 0 0 20px rgba(255,255,255,0.03)",
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
        background: "radial-gradient(ellipse at 20% 50%, hsl(270,60%,8%) 0%, hsl(230,40%,4%) 60%, hsl(0,0%,2%) 100%)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--font-sans, 'Inter', sans-serif)",
        overflow: "hidden",
      }}
    >
      {/* Background glow orbs */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: "10%", left: "15%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, hsla(280,80%,50%,0.12) 0%, transparent 70%)", filter: "blur(40px)" }} />
        <div style={{ position: "absolute", bottom: "10%", right: "15%", width: 350, height: 350, borderRadius: "50%", background: "radial-gradient(circle, hsla(200,80%,50%,0.1) 0%, transparent 70%)", filter: "blur(40px)" }} />
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 500, height: 200, borderRadius: "50%", background: "radial-gradient(circle, hsla(340,70%,40%,0.08) 0%, transparent 70%)", filter: "blur(60px)" }} />
      </div>

      <div style={{
        position: "relative", width: "100%", maxWidth: 820,
        maxHeight: "92vh", overflowY: "auto",
        padding: "40px 48px",
        display: "flex", flexDirection: "column", gap: 32,
      }}>
        {/* Header */}
        <div style={{ textAlign: "center" }}>
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, type: "spring", stiffness: 200 }}
            style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 12 }}
          >
            <div style={{
              width: 44, height: 44, borderRadius: "50%",
              background: "linear-gradient(135deg, hsl(280,80%,60%), hsl(200,80%,55%))",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 0 24px hsla(280,80%,60%,0.5)",
            }}>
              <Sparkles size={22} color="white" />
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
              background: step === s ? "hsl(280,80%,60%)" : "rgba(255,255,255,0.15)",
              transition: "width 0.3s ease, background 0.3s ease",
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
                    color: allSelected ? "hsl(280,80%,70%)" : "rgba(255,255,255,0.5)",
                    background: allSelected ? "hsla(280,80%,60%,0.12)" : "transparent",
                    border: `1px solid ${allSelected ? "hsla(280,80%,60%,0.3)" : "rgba(255,255,255,0.1)"}`,
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
                          ? "linear-gradient(135deg, hsla(280,80%,60%,0.15), hsla(200,80%,55%,0.1))"
                          : "rgba(255,255,255,0.04)",
                        border: `1px solid ${isOn ? "hsla(280,70%,60%,0.4)" : "rgba(255,255,255,0.08)"}`,
                        boxShadow: isOn ? "0 0 16px hsla(280,70%,60%,0.12), inset 0 0 20px hsla(280,70%,60%,0.05)" : "none",
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
                              background: "hsl(280,80%,60%)",
                              display: "flex", alignItems: "center", justifyContent: "center",
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
                    onFocus={e => (e.target.style.borderColor = "hsla(280,80%,60%,0.5)")}
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
                    onFocus={e => (e.target.style.borderColor = "hsla(280,80%,60%,0.5)")}
                    onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.12)")}
                  />
                  <div style={{ textAlign: "right", fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 4 }}>
                    {customPrompt.length}/500
                  </div>
                </div>

                {/* Skills summary */}
                <div style={{
                  padding: "12px 16px", borderRadius: 10,
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.07)",
                }}>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", margin: "0 0 8px", fontWeight: 600, letterSpacing: "0.05em" }}>SELECTED SKILLS ({selected.size})</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {SKILLS.filter(s => selected.has(s.id)).map(s => (
                      <span key={s.id} style={{
                        fontSize: 11, padding: "3px 8px", borderRadius: 20,
                        background: "hsla(280,80%,60%,0.15)",
                        border: "1px solid hsla(280,80%,60%,0.25)",
                        color: "hsla(280,80%,80%,1)",
                      }}>
                        {s.icon} {s.label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div key="agent-step" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 520, margin: "0 auto" }}>
                
                {/* Provider Grid */}
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.6)", letterSpacing: "0.06em", marginBottom: 10 }}>
                    1. AI ENGINE PROVIDER
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                    {[
                      { id: "google", name: "Google Gemini", desc: "Best Vision" },
                      { id: "openai", name: "OpenAI GPT", desc: "Industry Standard" },
                      { id: "anthropic", name: "Claude AI", desc: "Intelligent Agent" },
                      { id: "groq", name: "Groq Cloud", desc: "Ultra Fast" },
                      { id: "openrouter", name: "OpenRouter", desc: "Flexible Core" },
                      { id: "ollama", name: "Ollama (Local)", desc: "100% Private" }
                    ].map((p) => {
                      const isSelected = provider === p.id;
                      return (
                        <motion.button
                          key={p.id}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => {
                            setProvider(p.id);
                            // Auto select first model
                            const models = PROVIDER_MODELS[p.id] || [];
                            if (models.length > 0) {
                              if (p.id === "ollama") setLocalModel(models[0].value);
                              else setCloudModel(models[0].value);
                            }
                          }}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "4px",
                            padding: "14px 10px",
                            borderRadius: "10px",
                            cursor: "pointer",
                            background: isSelected
                              ? "linear-gradient(135deg, hsla(280,80%,60%,0.16), hsla(200,80%,55%,0.1))"
                              : "rgba(255,255,255,0.03)",
                            border: `1px solid ${isSelected ? "hsla(280,80%,60%,0.4)" : "rgba(255,255,255,0.08)"}`,
                            boxShadow: isSelected ? "0 4px 16px hsla(280,80%,60%,0.15)" : "none",
                            transition: "all 0.2s"
                          }}
                        >
                          <span style={{ fontSize: "12px", fontWeight: "bold", color: isSelected ? "#fff" : "rgba(255,255,255,0.7)" }}>
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

                {/* Model dropdown */}
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.6)", letterSpacing: "0.06em", marginBottom: 8 }}>
                    2. ACTIVE MODEL SELECT
                  </label>
                  {provider === "ollama" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      <select
                        value={localModel}
                        onChange={(e) => setLocalModel(e.target.value)}
                        style={{
                          width: "100%", padding: "12px 16px",
                          background: "rgba(255,255,255,0.05)",
                          border: "1px solid rgba(255,255,255,0.12)",
                          borderRadius: 10, color: "white", fontSize: 13,
                          outline: "none", boxSizing: "border-box",
                          fontFamily: "inherit",
                        }}
                      >
                        {PROVIDER_MODELS.ollama.map((m) => (
                          <option key={m.value} value={m.value} style={{ background: "#0a0a12", color: "#fff" }}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                      {localModel === "custom" && (
                        <input
                          placeholder="ENTER LOCAL MODEL IDENTIFIER (e.g. llama3.1:8b)"
                          value={customLocalModel}
                          onChange={(e) => setCustomLocalModel(e.target.value)}
                          style={{
                            width: "100%", padding: "12px 16px",
                            background: "rgba(255,255,255,0.05)",
                            border: "1px solid rgba(255,255,255,0.12)",
                            borderRadius: 10, color: "white", fontSize: 13,
                            outline: "none", boxSizing: "border-box",
                            fontFamily: "inherit",
                          }}
                        />
                      )}
                    </div>
                  ) : (
                    <select
                      value={cloudModel}
                      onChange={(e) => setCloudModel(e.target.value)}
                      style={{
                        width: "100%", padding: "12px 16px",
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 10, color: "white", fontSize: 13,
                        outline: "none", boxSizing: "border-box",
                        fontFamily: "inherit",
                      }}
                    >
                      {(PROVIDER_MODELS[provider] || []).map((m) => (
                        <option key={m.value} value={m.value} style={{ background: "#0a0a12", color: "#fff" }}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* API Key input */}
                {provider !== "ollama" && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.6)", letterSpacing: "0.06em", marginBottom: 8 }}>
                      3. API AUTHORIZATION KEY
                    </label>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={`Paste your secret API key for ${provider.toUpperCase()}`}
                      style={{
                        width: "100%", padding: "12px 16px",
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 10, color: "white", fontSize: 13,
                        outline: "none", boxSizing: "border-box",
                        fontFamily: "inherit",
                      }}
                    />
                    <span style={{ display: "block", fontSize: "10px", color: "rgba(255,255,255,0.3)", marginTop: "6px", textTransform: "none" }}>
                      * Your key is securely stored in your local computer settings and never sent anywhere except directly to the AI service endpoints.
                    </span>
                  </motion.div>
                )}
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
              background: "linear-gradient(135deg, hsl(280,80%,55%), hsl(200,80%,50%))",
              border: "none", color: "white",
              fontSize: 13, fontWeight: 700, letterSpacing: "0.04em",
              boxShadow: "0 4px 20px hsla(280,80%,55%,0.4)",
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
