import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Cpu, CheckCircle2, Terminal } from "lucide-react";
import { useAssistantStore } from "../../stores/assistantStore";
import { wsClient } from "../../lib/ws";

interface ContextModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AVAILABLE_SKILLS = [
  { id: "general", label: "General Assistance", desc: "Conversational chat, general logic" },
  { id: "desktop_automation", label: "Desktop Automation", desc: "Controls desktop apps, clicks, keystrokes" },
  { id: "developer", label: "Developer Tools", desc: "Enforces syntax formatting, explains shell calls" },
  { id: "system_admin", label: "System Administration", desc: "Performs system tasks, safe read verification" },
  { id: "media", label: "Media Controls", desc: "Automates multimedia app execution & keyboard shortcuts" },
  { id: "writing", label: "Content Writer", desc: "Drafting essays, text revision, matching tones" },
  { id: "research", label: "Researcher", desc: "Fact checking, structured explanations" },
  { id: "web", label: "Web Browser", desc: "Orchestrates browsers and monitors loads" },
  { id: "privacy", label: "Privacy Enforcement", desc: "Local sandbox focus, external alerts" }
];

export function ContextModal({ isOpen, onClose }: ContextModalProps) {
  const {
    userName,
    userSkills,
    customPrompt,
    lastClassification,
    shellOutputLines,
    messages,
    setPersonalization,
  } = useAssistantStore();

  const [localName, setLocalName] = useState(userName);
  const [localSkills, setLocalSkills] = useState<string[]>(userSkills);
  const [localPrompt, setLocalPrompt] = useState(customPrompt);
  const [saved, setSaved] = useState(false);

  // Sync state with store values when modal opens
  useEffect(() => {
    if (isOpen) {
      setLocalName(userName);
      setLocalSkills(userSkills);
      setLocalPrompt(customPrompt);
    }
  }, [isOpen, userName, userSkills, customPrompt]);

  const toggleSkill = (id: string) => {
    if (localSkills.includes(id)) {
      setLocalSkills(localSkills.filter(s => s !== id));
    } else {
      setLocalSkills([...localSkills, id]);
    }
  };

  const handleSave = () => {
    // 1. Update the local Zustand store
    setPersonalization(localName, localSkills, localPrompt);

    // 2. Transmit the configuration updates to the backend WebSocket
    wsClient.send("update_settings", {
      user_name: localName,
      user_skills: localSkills,
      custom_prompt: localPrompt
    });

    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 850);
  };

  // Helper to build a preview of the system prompt
  const getPromptPreview = () => {
    const hasDesktop = localSkills.includes("desktop_automation");
    const nameStr = localName ? `The user's name is ${localName}. Address them occasionally.` : "";
    const customStr = localPrompt ? `\n\nUSER CUSTOM INSTRUCTIONS:\n${localPrompt}` : "";
    
    return `You are OpenSarthi, a precise and reliable AI desktop assistant for Linux.
${nameStr}${customStr}

━━━ THINKING PROTOCOL ━━━
Before every response, think inside <think>...</think> tags...

━━━ OUTPUT FORMAT ━━━
${hasDesktop ? `For desktop tasks: output a single JSON array...` : `Conversational replies: plain markdown...`}

━━━ ACTIVE CONTEXT ━━━
${localSkills.map(s => `• ${s.toUpperCase()}_CONTEXT: enabled`).join("\n")}`;
  };

  const textareaStyle: React.CSSProperties = {
    background: "rgba(0, 0, 0, 0.45)",
    border: "1px solid var(--border)",
    padding: "10px 12px",
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono)",
    fontSize: "12px",
    outline: "none",
    borderRadius: "6px",
    width: "100%",
    boxSizing: "border-box",
    minHeight: "100px",
    resize: "vertical",
    lineHeight: "1.5",
    transition: "border-color 0.2s"
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{
            position: "fixed",
            top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0, 0, 0, 0.5)",
            backdropFilter: "blur(18px) saturate(140%)",
            WebkitBackdropFilter: "blur(18px) saturate(140%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            className="hud-panel"
            initial={{ scale: 0.94, y: 15, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.94, y: 15, opacity: 0 }}
            transition={{ type: "spring", damping: 26, stiffness: 340 }}
            style={{
              width: "720px",
              maxHeight: "85vh",
              display: "flex",
              flexDirection: "column",
              gap: "0",
              overflow: "hidden",
              background: "rgba(0, 0, 0, 0.55)",
              border: "1px solid var(--border)",
              boxShadow: "0 25px 60px rgba(0, 0, 0, 0.75), inset 0 0 25px rgba(255,255,255,0.02)",
            }}
          >
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid var(--border)", background: "rgba(0, 0, 0, 0.2)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <Cpu size={16} color="var(--accent)" />
                <h2 style={{ fontSize: "13px", color: "var(--accent)", letterSpacing: "0.1em", fontWeight: "bold", margin: 0 }}>
                  AGENT SYSTEM CONTEXT & PROMPT BUILDER
                </h2>
              </div>
              <button onClick={onClose} style={{ color: "var(--text-secondary)", cursor: "pointer", background: "none", border: "none", display: "flex", alignItems: "center" }}>
                <X size={18} />
              </button>
            </div>

            {/* Scrollable Container */}
            <div style={{ overflowY: "auto", flex: 1, padding: "20px 24px", display: "flex", flexDirection: "column", gap: "20px" }}>
              
              {/* Intent and Classification Status Panel */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", borderRadius: "8px", padding: "12px 16px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ fontSize: "10px", color: "var(--text-muted)", letterSpacing: "0.05em" }}>ROUTER CLASSIFICATION STATE</span>
                  <span style={{ fontSize: "12px", fontWeight: "bold", color: "var(--text-primary)" }}>LAST DETERMINED INTENT:</span>
                </div>
                <div style={{
                  padding: "5px 12px",
                  borderRadius: "4px",
                  fontSize: "11px",
                  fontWeight: "bold",
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.06em",
                  background: lastClassification === "TASK" ? "rgba(255,60,60,0.15)" : lastClassification === "CHAT" ? "rgba(0,230,180,0.15)" : "rgba(255,255,255,0.05)",
                  color: lastClassification === "TASK" ? "var(--danger)" : lastClassification === "CHAT" ? "var(--success)" : "var(--text-secondary)",
                  border: `1px solid ${lastClassification === "TASK" ? "rgba(255,60,60,0.25)" : lastClassification === "CHAT" ? "rgba(0,230,180,0.25)" : "rgba(255,255,255,0.1)"}`
                }}>
                  {lastClassification || "UNKNOWN (IDLE)"}
                </div>
              </div>

              {/* Identity Options */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "12px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "11px", color: "var(--text-secondary)", letterSpacing: "0.05em" }}>USER IDENTIFICATION NAME</label>
                  <input
                    type="text"
                    value={localName}
                    onChange={(e) => setLocalName(e.target.value)}
                    placeholder="E.g., Kartik"
                    style={{
                      background: "rgba(0,0,0,0.45)",
                      border: "1px solid var(--border)",
                      padding: "8px 12px",
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "12px",
                      outline: "none",
                      borderRadius: "6px",
                      width: "100%",
                      boxSizing: "border-box"
                    }}
                  />
                </div>
              </div>

              {/* Skills Selector */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "11px", color: "var(--text-secondary)", letterSpacing: "0.05em" }}>ACTIVE CAPABILITIES & SKILLS</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  {AVAILABLE_SKILLS.map((skill) => {
                    const active = localSkills.includes(skill.id);
                    return (
                      <div
                        key={skill.id}
                        onClick={() => toggleSkill(skill.id)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          background: active ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.15)",
                          border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
                          borderRadius: "8px",
                          padding: "10px 12px",
                          cursor: "pointer",
                          transition: "all 0.2s",
                          opacity: active ? 1 : 0.65
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={active}
                          readOnly
                          style={{ accentColor: "var(--accent)", cursor: "pointer" }}
                        />
                        <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
                          <span style={{ fontSize: "11.5px", fontWeight: "bold", color: active ? "var(--accent)" : "var(--text-primary)" }}>{skill.label.toUpperCase()}</span>
                          <span style={{ fontSize: "9.5px", color: "var(--text-muted)", textTransform: "none" }}>{skill.desc}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Custom Instructions Editor */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "11px", color: "var(--text-secondary)", letterSpacing: "0.05em" }}>CUSTOM PROMPT INSTRUCTIONS</label>
                <textarea
                  value={localPrompt}
                  onChange={(e) => setLocalPrompt(e.target.value)}
                  placeholder="Enter system custom directives here..."
                  style={textareaStyle}
                />
              </div>

              {/* System Prompt Code Preview */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "11px", color: "var(--text-secondary)", letterSpacing: "0.05em" }}>SYSTEM PROMPT PREVIEW</label>
                <div style={{
                  maxHeight: "120px",
                  overflowY: "auto",
                  padding: "10px 12px",
                  fontFamily: "var(--font-mono)",
                  fontSize: "10px",
                  color: "rgba(255,255,255,0.55)",
                  lineHeight: "1.4",
                  background: "rgba(0,0,0,0.45)",
                  borderRadius: "6px",
                  border: "1px solid var(--border)",
                  whiteSpace: "pre-wrap"
                }}>
                  {getPromptPreview()}
                </div>
              </div>

              {/* Active Conversation History Context */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "11px", color: "var(--text-secondary)", letterSpacing: "0.05em" }}>ACTIVE CONVERSATION HISTORY CONTEXT</label>
                <div style={{
                  maxHeight: "130px",
                  overflowY: "auto",
                  padding: "10px 12px",
                  fontSize: "11px",
                  background: "rgba(0,0,0,0.45)",
                  borderRadius: "6px",
                  border: "1px solid var(--border)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px"
                }}>
                  {messages.length === 0 ? (
                    <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: "11px" }}>No past messages in the current thread.</span>
                  ) : (
                    messages.map((msg, i) => (
                      <div key={i} style={{ display: "flex", gap: "6px", fontSize: "11px" }}>
                        <span style={{
                          fontWeight: "bold",
                          color: msg.role === "user" ? "var(--accent)" : "var(--text-secondary)",
                          fontFamily: "var(--font-mono)",
                          fontSize: "10px",
                          width: "80px",
                          flexShrink: 0
                        }}>
                          [{msg.role.toUpperCase()}]:
                        </span>
                        <span style={{
                          color: "rgba(255,255,255,0.75)",
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere"
                        }}>
                          {msg.content.length > 120 ? `${msg.content.slice(0, 120)}...` : msg.content}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Shell output preview if present */}
              {shellOutputLines.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: "var(--text-secondary)", letterSpacing: "0.05em" }}>
                    <Terminal size={12} /> LIVE TERMINAL OUTPUT BUFFER
                  </div>
                  <div style={{
                    maxHeight: "110px",
                    overflowY: "auto",
                    padding: "8px 10px",
                    fontFamily: "var(--font-mono)",
                    fontSize: "9px",
                    color: "rgba(180, 255, 180, 0.8)",
                    lineHeight: "1.4",
                    background: "rgba(0,0,0,0.6)",
                    borderRadius: "6px",
                    border: "1px solid rgba(0,255,0,0.15)",
                  }}>
                    {shellOutputLines.slice(-10).map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: "14px 20px", borderTop: "1px solid var(--border)", background: "rgba(0,0,0,0.3)", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                onClick={onClose}
                style={{
                  background: "transparent",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border)",
                  padding: "8px 16px",
                  fontSize: "11px",
                  fontWeight: "bold",
                  cursor: "pointer",
                  borderRadius: "6px",
                  letterSpacing: "0.05em"
                }}
              >
                CANCEL
              </button>
              <button
                onClick={handleSave}
                style={{
                  background: saved ? "var(--success)" : "var(--accent)",
                  color: "#000",
                  border: "none",
                  padding: "8px 20px",
                  fontWeight: "bold",
                  fontSize: "11px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  cursor: "pointer",
                  borderRadius: "6px",
                  letterSpacing: "0.05em"
                }}
              >
                {saved ? <><CheckCircle2 size={13} /> CONTEXT APPLIED!</> : <>SAVE & APPLY CONTEXT</>}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
