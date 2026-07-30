import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Cpu, Brain, Database, Activity, MessageSquare,
  ChevronDown, ChevronUp, Zap, GitBranch, Shield, RefreshCcw,
  Terminal, Layers, Clock, Hash, Network, Box, CheckCircle2
} from "lucide-react";
import { useAssistantStore } from "../../stores/assistantStore";
import { wsClient } from "../../lib/ws";

interface ContextModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AVAILABLE_SKILLS = [
  { id: "general", label: "General Assistance", desc: "Conversational chat, general logic", icon: "💬" },
  { id: "desktop_automation", label: "Desktop Automation", desc: "Controls desktop apps, clicks, keystrokes", icon: "🖱️" },
  { id: "developer", label: "Developer Tools", desc: "Enforces syntax formatting, explains shell calls", icon: "⚙️" },
  { id: "system_admin", label: "System Administration", desc: "Performs system tasks, safe read verification", icon: "🔧" },
  { id: "media", label: "Media Controls", desc: "Automates multimedia app execution & keyboard shortcuts", icon: "🎵" },
  { id: "writing", label: "Content Writer", desc: "Drafting essays, text revision, matching tones", icon: "✏️" },
  { id: "research", label: "Researcher", desc: "Fact checking, structured explanations", icon: "🔬" },
  { id: "web", label: "Web Browser", desc: "Orchestrates browsers and monitors loads", icon: "🌐" },
  { id: "privacy", label: "Privacy Enforcement", desc: "Local sandbox focus, external alerts", icon: "🔒" }
];

type TabId = "context" | "memory" | "graph" | "settings";

interface SectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string | number;
  badgeColor?: string;
}

function Section({ title, icon, children, defaultOpen = true, badge, badgeColor }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{
      borderRadius: "8px",
      border: "1px solid rgba(255,255,255,0.06)",
      overflow: "hidden",
      background: "rgba(0,0,0,0.25)",
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "10px 14px",
          background: "rgba(255,255,255,0.03)",
          border: "none",
          cursor: "pointer",
          color: "var(--text-primary)",
          textAlign: "left",
          borderBottom: open ? "1px solid rgba(255,255,255,0.06)" : "none",
          transition: "background 0.2s",
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.03)"; }}
      >
        <span style={{ color: "var(--accent)", display: "flex" }}>{icon}</span>
        <span style={{ fontSize: "11px", fontWeight: "bold", letterSpacing: "0.08em", flex: 1, color: "var(--accent)" }}>
          {title}
        </span>
        {badge !== undefined && (
          <span style={{
            fontSize: "9px",
            padding: "2px 6px",
            borderRadius: "99px",
            background: badgeColor ?? "rgba(255,255,255,0.08)",
            color: "var(--text-secondary)",
            fontFamily: "var(--font-mono)",
            marginRight: "4px",
          }}>
            {badge}
          </span>
        )}
        {open ? <ChevronUp size={12} style={{ color: "var(--text-muted)" }} /> : <ChevronDown size={12} style={{ color: "var(--text-muted)" }} />}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: open ? "visible" : "hidden" }}
          >
            <div style={{ padding: "12px 14px" }}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MonoBlock({ children, maxH }: { children: React.ReactNode; maxH?: number }) {
  return (
    <div style={{
      maxHeight: maxH ? `${maxH}px` : undefined,
      overflowY: maxH ? "auto" : "visible",
      padding: "10px 12px",
      fontFamily: "var(--font-mono)",
      fontSize: "10.5px",
      color: "rgba(255,255,255,0.65)",
      lineHeight: "1.55",
      background: "rgba(0,0,0,0.35)",
      borderRadius: "6px",
      border: "1px solid rgba(255,255,255,0.06)",
      whiteSpace: "pre-wrap",
      wordBreak: "break-all",
    }}>
      {children}
    </div>
  );
}

function KVRow({ label, value, accent = false }: { label: string; value: string | number | undefined | null; accent?: boolean }) {
  return (
    <div style={{ display: "flex", gap: "8px", padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", alignItems: "flex-start" }}>
      <span style={{ fontSize: "9.5px", color: "var(--text-muted)", fontFamily: "var(--font-mono)", width: "130px", flexShrink: 0, paddingTop: "1px" }}>
        {label}
      </span>
      <span style={{
        fontSize: "11px",
        fontFamily: "var(--font-mono)",
        color: accent ? "var(--accent)" : "var(--text-primary)",
        flex: 1,
        wordBreak: "break-all",
      }}>
        {value ?? "—"}
      </span>
    </div>
  );
}

export function ContextModal({ isOpen, onClose }: ContextModalProps) {
  const {
    userName,
    userSkills,
    customPrompt,
    lastClassification,
    shellOutputLines,
    messages,
    currentPlan,
    executingStepIndex,
    activeThreadId,
    tabs,
    activeProvider,
    activeCloudModel,
    activeLocalModel,
    tokenUsage,
    planReasonings,
    longTermMemories,
    nodeStatuses,
    setPersonalization,
  } = useAssistantStore();

  const [activeTab, setActiveTab] = useState<TabId>("context");
  const [localSkills, setLocalSkills] = useState<string[]>(userSkills);
  const [localPrompt, setLocalPrompt] = useState(customPrompt);
  const [saved, setSaved] = useState(false);
  const [copyFlash, setCopyFlash] = useState<string | null>(null);

  const activeTab_ = tabs.find(t => t.id === activeThreadId);

  useEffect(() => {
    if (isOpen) {
      setLocalSkills(userSkills);
      setLocalPrompt(customPrompt);
      wsClient.send("get_memories", { thread_id: activeThreadId });
    }
  }, [isOpen, activeThreadId, userSkills, customPrompt]);

  const toggleSkill = (id: string) => {
    setLocalSkills(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  };

  const handleSave = () => {
    setPersonalization(userName, localSkills, localPrompt);
    wsClient.send("update_settings", {
      user_name: userName,
      user_skills: localSkills,
      custom_prompt: localPrompt
    });
    setSaved(true);
    setTimeout(() => { setSaved(false); }, 1500);
  };

  const copyToClipboard = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopyFlash(key);
      setTimeout(() => setCopyFlash(null), 1200);
    });
  }, []);

  // Build system prompt preview
  const systemPromptPreview = (() => {
    const customStr = localPrompt ? `\n\nUSER CUSTOM INSTRUCTIONS:\n${localPrompt}` : "";
    const skillsList = localSkills.map(s => `• ${s.toUpperCase()}_CONTEXT: ENABLED`).join("\n");
    return `[SYSTEM IDENTITY]
You are OpenSarthi, a precise AI desktop agent for Linux.
User: ${userName || "Anonymous"}${customStr}

[THINKING PROTOCOL]
Before every response, think inside <think>...</think> tags.
For desktop tasks: output a single JSON array of steps.
For chat: plain markdown prose.

[ACTIVE SKILL CONTEXTS]
${skillsList || "(none)"}

[RUNTIME CONTEXT]
Provider: ${activeProvider?.toUpperCase() ?? "GROQ"}
Model: ${activeProvider === "local" ? activeLocalModel : activeCloudModel}
Thread: ${activeThreadId?.slice(0, 8)}...`;
  })();

  // LangGraph node status
  const graphNodes = [
    { name: "CLASSIFY", desc: "Intent router — TASK / CHAT / CLARIFY", status: nodeStatuses["CLASSIFY"] || (lastClassification === null ? "idle" : "done") },
    { name: "OBSERVE", desc: "Desktop observation & AT-SPI context", status: nodeStatuses["OBSERVE"] || (currentPlan ? "done" : "idle") },
    { name: "PLAN", desc: "LangGraph plan creation & step generation", status: nodeStatuses["PLAN"] || (currentPlan ? "done" : "idle") },
    { name: "EXECUTE", desc: "Tool dispatcher — calls tools sequentially", status: nodeStatuses["EXECUTE"] || (executingStepIndex != null ? "running" : currentPlan ? "done" : "idle") },
    { name: "HEAL", desc: "Error recovery — retry failed steps", status: nodeStatuses["HEAL"] || "idle" },
    { name: "REVIEW", desc: "Post-execution summary & lesson store", status: nodeStatuses["REVIEW"] || "idle" },
    { name: "CHAT", desc: "Direct conversational response handler", status: nodeStatuses["CHAT"] || (lastClassification === "CHAT" ? "done" : "idle") },
  ];

  const statusColor = (s: string) =>
    s === "running" ? "var(--warning)" : s === "done" ? "var(--success)" : "var(--text-muted)";

  const currentReasonings = planReasonings[activeThreadId] ?? [];

  const tabs_: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "context", label: "LLM CONTEXT", icon: <MessageSquare size={12} /> },
    { id: "graph", label: "GRAPH STATE", icon: <GitBranch size={12} /> },
    { id: "memory", label: "MEMORY", icon: <Database size={12} /> },
    { id: "settings", label: "CAPABILITIES", icon: <Shield size={12} /> },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          style={{
            position: "fixed",
            top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0, 0, 0, 0.15)",
            backdropFilter: "blur(28px) saturate(160%)",
            WebkitBackdropFilter: "blur(28px) saturate(160%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
          }}
          onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ scale: 0.92, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.92, y: 20, opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 360 }}
            style={{
              width: "min(860px, 94vw)",
              height: "80vh",
              maxHeight: "720px",
              minHeight: "450px",
              display: "flex",
              flexDirection: "column",
              background: "rgba(4, 8, 20, 0.88)",
              backdropFilter: "blur(24px) saturate(150%)",
              WebkitBackdropFilter: "blur(24px) saturate(150%)",
              border: "1px solid rgba(0, 230, 180, 0.22)",
              borderRadius: "12px",
              boxShadow: `
                0 0 0 1px rgba(0, 230, 180, 0.1),
                0 32px 80px rgba(0, 0, 0, 0.85),
                inset 0 0 60px rgba(0, 200, 160, 0.03),
                0 0 80px rgba(0, 200, 160, 0.05)
              `,
              overflow: "hidden",
            }}
          >
            {/* ── Header ── */}
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "14px 20px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              background: "rgba(0, 230, 180, 0.04)",
              flexShrink: 0,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{
                  width: "28px", height: "28px", borderRadius: "6px",
                  background: "rgba(0, 230, 180, 0.12)",
                  border: "1px solid rgba(0, 230, 180, 0.25)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Cpu size={14} color="var(--accent)" />
                </div>
                <div>
                  <h2 style={{ fontSize: "12px", color: "var(--accent)", letterSpacing: "0.12em", fontWeight: "bold", margin: 0 }}>
                    AGENT CONTEXT DEBUGGER
                  </h2>
                  <span style={{ fontSize: "9px", color: "var(--text-muted)", letterSpacing: "0.05em" }}>
                    THREAD: {activeThreadId?.slice(0, 16)}... · {messages.length} MESSAGES
                  </span>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                {/* Live status badge */}
                <div style={{
                  display: "flex", alignItems: "center", gap: "5px",
                  padding: "4px 10px",
                  borderRadius: "99px",
                  background: lastClassification === "TASK" ? "rgba(255,100,50,0.12)" :
                    lastClassification === "CHAT" ? "rgba(0,230,180,0.1)" : "rgba(255,255,255,0.05)",
                  border: `1px solid ${lastClassification === "TASK" ? "rgba(255,100,50,0.3)" :
                    lastClassification === "CHAT" ? "rgba(0,230,180,0.25)" : "rgba(255,255,255,0.1)"}`,
                }}>
                  <Activity size={9} color={lastClassification === "TASK" ? "#ff6432" : lastClassification === "CHAT" ? "var(--accent)" : "var(--text-muted)"} />
                  <span style={{
                    fontSize: "9px", fontWeight: "bold", letterSpacing: "0.1em",
                    color: lastClassification === "TASK" ? "#ff6432" : lastClassification === "CHAT" ? "var(--accent)" : "var(--text-muted)"
                  }}>
                    {lastClassification ?? "IDLE"}
                  </span>
                </div>

                <button
                  onClick={onClose}
                  style={{
                    color: "var(--text-secondary)",
                    cursor: "pointer",
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "6px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "28px",
                    height: "28px",
                    padding: 0,
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,60,60,0.12)"; (e.currentTarget as HTMLButtonElement).style.color = "#ff4444"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)"; }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* ── Tabs ── */}
            <div style={{
              display: "flex",
              gap: "2px",
              padding: "8px 20px 0",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              flexShrink: 0,
              background: "rgba(0,0,0,0.15)",
            }}>
              {tabs_.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: "5px",
                    padding: "6px 14px 8px",
                    fontSize: "10px", fontWeight: "bold", letterSpacing: "0.08em",
                    background: "transparent", border: "none",
                    color: activeTab === tab.id ? "var(--accent)" : "var(--text-muted)",
                    cursor: "pointer",
                    borderBottom: activeTab === tab.id ? "2px solid var(--accent)" : "2px solid transparent",
                    transition: "all 0.15s",
                    borderRadius: "0",
                  }}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>

            {/* ── Scrollable Body ── */}
            <div style={{ overflowY: "auto", flex: 1, minHeight: 0, padding: "16px 20px 48px", display: "flex", flexDirection: "column", gap: "14px" }}>

              {/* ═══════════ TAB: LLM CONTEXT ═══════════ */}
              {activeTab === "context" && (
                <>
                  {/* System Prompt */}
                  <Section title="ACTIVE SYSTEM PROMPT" icon={<Zap size={12} />} badge="LIVE">
                    <div style={{ position: "relative" }}>
                      <MonoBlock maxH={300}>
                        {systemPromptPreview}
                      </MonoBlock>
                      <button
                        onClick={() => copyToClipboard(systemPromptPreview, "sysprompt")}
                        style={{
                          position: "absolute", top: "6px", right: "6px",
                          fontSize: "9px", padding: "2px 7px", borderRadius: "4px",
                          background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)",
                          color: copyFlash === "sysprompt" ? "var(--accent)" : "var(--text-muted)",
                          cursor: "pointer",
                        }}
                      >
                        {copyFlash === "sysprompt" ? "COPIED!" : "COPY"}
                      </button>
                    </div>
                  </Section>

                  {/* Conversation History */}
                  <Section
                    title="CONVERSATION HISTORY (ACTIVE THREAD)"
                    icon={<MessageSquare size={12} />}
                    badge={messages.length}
                    defaultOpen={true}
                  >
                    {messages.length === 0 ? (
                      <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: "11px" }}>
                        No messages in this thread yet.
                      </span>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "350px", overflowY: "auto", paddingRight: "4px" }}>
                        {messages.map((msg, i) => (
                          <div key={i} style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "3px",
                            padding: "8px 10px",
                            background: msg.role === "user" ? "rgba(0,200,160,0.05)" : "rgba(255,255,255,0.02)",
                            borderRadius: "6px",
                            border: `1px solid ${msg.role === "user" ? "rgba(0,230,180,0.12)" : "rgba(255,255,255,0.05)"}`,
                          }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <span style={{
                                fontSize: "9px", fontWeight: "bold", letterSpacing: "0.1em",
                                color: msg.role === "user" ? "var(--accent)" : "var(--text-secondary)",
                                fontFamily: "var(--font-mono)",
                              }}>
                                [{msg.role.toUpperCase()}]
                              </span>
                              <span style={{ fontSize: "8px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                                {new Date(msg.timestamp).toLocaleTimeString()}
                              </span>
                              {msg.token_total && (
                                <span style={{ fontSize: "8px", color: "var(--text-muted)", marginLeft: "auto" }}>
                                  {msg.token_total} tokens
                                </span>
                              )}
                            </div>
                            <span style={{
                              fontSize: "11px",
                              color: "rgba(255,255,255,0.7)",
                              lineHeight: "1.5",
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                            }}>
                              {msg.content}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Section>

                  {/* Plan Reasonings (LLM Thinking) */}
                  {currentReasonings.length > 0 && (
                    <Section title="AI PLAN REASONINGS (LAST RUN)" icon={<Brain size={12} />} badge={currentReasonings.length}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "300px", overflowY: "auto", paddingRight: "4px" }}>
                        {currentReasonings.map((r, i) => (
                          <div key={i} style={{
                            padding: "8px 10px",
                            background: "rgba(120, 60, 255, 0.06)",
                            border: "1px solid rgba(120, 60, 255, 0.15)",
                            borderRadius: "6px",
                          }}>
                            <div style={{ fontSize: "9px", color: "rgba(180,140,255,0.8)", marginBottom: "4px", fontFamily: "var(--font-mono)" }}>
                              REASONING ATTEMPT {r.attempt + 1}
                            </div>
                            <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.65)", lineHeight: "1.5", whiteSpace: "pre-wrap" }}>
                              {r.text}
                            </span>
                          </div>
                        ))}
                      </div>
                    </Section>
                  )}

                  {/* Active Plan Steps */}
                  {currentPlan && (
                    <Section title="ACTIVE EXECUTION PLAN" icon={<Layers size={12} />} badge={`${currentPlan.steps.length} STEPS`}>
                      <div style={{ marginBottom: "6px" }}>
                        <KVRow label="GOAL" value={currentPlan.goal} accent />
                        <KVRow label="PLAN ID" value={currentPlan.id?.slice(0, 16) + "..."} />
                        <KVRow label="EXECUTING STEP" value={executingStepIndex != null ? `Step ${executingStepIndex + 1}` : "—"} />
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "300px", overflowY: "auto", paddingRight: "4px" }}>
                        {currentPlan.steps.map((step, si) => (
                          <div key={si} style={{
                            display: "flex", alignItems: "center", gap: "8px",
                            padding: "5px 8px",
                            background: si === executingStepIndex ? "rgba(0,230,180,0.06)" : "rgba(255,255,255,0.02)",
                            borderRadius: "4px",
                            border: `1px solid ${si === executingStepIndex ? "rgba(0,230,180,0.2)" : "rgba(255,255,255,0.04)"}`,
                          }}>
                            <span style={{
                              fontSize: "8px", width: "14px", height: "14px",
                              borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                              background: step.status === "success" ? "rgba(0,230,60,0.2)" :
                                step.status === "running" ? "rgba(255,180,0,0.2)" :
                                step.status === "error" ? "rgba(255,60,60,0.2)" : "rgba(255,255,255,0.06)",
                              color: step.status === "success" ? "#00e63c" :
                                step.status === "running" ? "#ffb400" :
                                step.status === "error" ? "#ff3c3c" : "var(--text-muted)",
                              fontFamily: "var(--font-mono)",
                              flexShrink: 0,
                            }}>
                              {si + 1}
                            </span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <span style={{ fontSize: "10px", fontFamily: "var(--font-mono)", color: "var(--accent)", display: "block" }}>
                                {step.tool}
                              </span>
                              <span style={{ fontSize: "9px", color: "var(--text-muted)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {step.description || JSON.stringify(step.args)}
                              </span>
                            </div>
                            <span style={{
                              fontSize: "8px", padding: "1px 5px", borderRadius: "3px",
                              background: step.status === "success" ? "rgba(0,230,60,0.12)" : "rgba(255,255,255,0.05)",
                              color: step.status === "success" ? "#00e63c" : "var(--text-muted)",
                              fontFamily: "var(--font-mono)",
                            }}>
                              {step.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </Section>
                  )}

                  {/* Shell Output */}
                  {shellOutputLines.length > 0 && (
                    <Section title="LIVE TERMINAL OUTPUT BUFFER" icon={<Terminal size={12} />} badge={shellOutputLines.length} defaultOpen={true}>
                      <MonoBlock maxH={300}>
                        <span style={{ color: "rgba(130,255,130,0.85)" }}>
                          {shellOutputLines.slice(-25).join("\n")}
                        </span>
                      </MonoBlock>
                    </Section>
                  )}
                </>
              )}

              {/* ═══════════ TAB: GRAPH STATE ═══════════ */}
              {activeTab === "graph" && (
                <>
                  <Section title="LANGGRAPH NODE PIPELINE" icon={<GitBranch size={12} />}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      {graphNodes.map((node, ni) => (
                        <div key={ni} style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          padding: "8px 12px",
                          background: node.status === "running" ? "rgba(255,180,0,0.06)" : "rgba(255,255,255,0.02)",
                          border: `1px solid ${node.status === "running" ? "rgba(255,180,0,0.2)" : node.status === "done" ? "rgba(0,200,100,0.12)" : "rgba(255,255,255,0.05)"}`,
                          borderRadius: "6px",
                        }}>
                          {/* Node connector line */}
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px", flexShrink: 0 }}>
                            <div style={{
                              width: "10px", height: "10px", borderRadius: "50%",
                              background: statusColor(node.status),
                              boxShadow: node.status === "running" ? `0 0 8px ${statusColor(node.status)}` :
                                node.status === "done" ? `0 0 4px ${statusColor(node.status)}` : "none",
                              flexShrink: 0,
                            }} />
                            {ni < graphNodes.length - 1 && (
                              <div style={{ width: "1px", height: "10px", background: "rgba(255,255,255,0.06)" }} />
                            )}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <span style={{ fontSize: "11px", fontWeight: "bold", fontFamily: "var(--font-mono)", color: statusColor(node.status) }}>
                                {node.name}
                              </span>
                              <span style={{
                                fontSize: "8px", padding: "1px 6px", borderRadius: "3px",
                                background: node.status === "running" ? "rgba(255,180,0,0.15)" :
                                  node.status === "done" ? "rgba(0,200,100,0.12)" : "rgba(255,255,255,0.05)",
                                color: statusColor(node.status),
                                fontFamily: "var(--font-mono)",
                              }}>
                                {node.status.toUpperCase()}
                              </span>
                            </div>
                            <span style={{ fontSize: "9.5px", color: "var(--text-muted)" }}>
                              {node.desc}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>

                  {/* Runtime Information */}
                  <Section title="RUNTIME INFO" icon={<Activity size={12} />}>
                    <div>
                      <KVRow label="ACTIVE THREAD ID" value={activeThreadId} />
                      <KVRow label="PROVIDER" value={activeProvider?.toUpperCase()} accent />
                      <KVRow label="MODEL" value={activeProvider === "local" ? activeLocalModel : activeCloudModel} />
                      <KVRow label="LAST INTENT" value={lastClassification ?? "IDLE"} />
                      <KVRow label="EXECUTING STEP" value={executingStepIndex != null ? `${executingStepIndex}` : "none"} />
                      <KVRow label="THREAD MSGS" value={messages.length} />
                      <KVRow label="PLAN STEPS" value={currentPlan?.steps.length ?? 0} />
                      <KVRow label="PLAN GOAL" value={currentPlan?.goal} />
                    </div>
                  </Section>

                  {/* Token Usage */}
                  <Section title="TOKEN USAGE (CURRENT THREAD)" icon={<Hash size={12} />} defaultOpen={false}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                      {[
                        { label: "REQUEST TOKENS", val: activeTab_?.tokenUsage.requestTokens ?? tokenUsage.requestTokens },
                        { label: "RESPONSE TOKENS", val: activeTab_?.tokenUsage.responseTokens ?? tokenUsage.responseTokens },
                        { label: "TOTAL TOKENS", val: activeTab_?.tokenUsage.totalTokens ?? tokenUsage.totalTokens },
                        { label: "SESSION TOTAL", val: activeTab_?.tokenUsage.sessionTotalTokens ?? tokenUsage.sessionTotalTokens },
                      ].map(({ label, val }) => (
                        <div key={label} style={{
                          padding: "10px",
                          background: "rgba(0,230,180,0.04)",
                          border: "1px solid rgba(0,230,180,0.1)",
                          borderRadius: "6px",
                        }}>
                          <div style={{ fontSize: "8px", color: "var(--text-muted)", marginBottom: "4px" }}>{label}</div>
                          <div style={{ fontSize: "16px", fontFamily: "var(--font-mono)", color: "var(--accent)", fontWeight: "bold" }}>
                            {val?.toLocaleString() ?? "0"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>
                </>
              )}

              {/* ═══════════ TAB: MEMORY ═══════════ */}
              {activeTab === "memory" && (
                <>
                  <Section title="SHORT-TERM MEMORY (CONVERSATION CONTEXT)" icon={<Clock size={12} />} badge={`${(activeTab_?.messages ?? messages).length} turns`}>
                    <p style={{ fontSize: "10.5px", color: "var(--text-secondary)", marginBottom: "10px", lineHeight: "1.5" }}>
                      Short-term memory is the full conversation history sent with every LLM call.
                      Each message below contributes to the context window.
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "300px", overflowY: "auto", paddingRight: "4px" }}>
                      {(activeTab_?.messages ?? messages).length === 0 ? (
                        <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>No messages yet.</span>
                      ) : (activeTab_?.messages ?? messages).map((msg, i) => (
                        <div key={i} style={{
                          display: "flex",
                          gap: "8px",
                          padding: "6px 8px",
                          background: "rgba(255,255,255,0.02)",
                          borderRadius: "5px",
                          border: "1px solid rgba(255,255,255,0.04)",
                        }}>
                          <span style={{
                            fontSize: "9px", fontWeight: "bold",
                            color: msg.role === "user" ? "var(--accent)" : "#a0a0ff",
                            fontFamily: "var(--font-mono)",
                            width: "70px", flexShrink: 0,
                          }}>
                            {msg.role.toUpperCase()}
                          </span>
                          <span style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.62)", flex: 1, lineHeight: "1.45", wordBreak: "break-word" }}>
                            {msg.content}
                          </span>
                          <span style={{ fontSize: "8px", color: "var(--text-muted)", flexShrink: 0 }}>
                            {msg.token_total ?? "?"}t
                          </span>
                        </div>
                      ))}
                    </div>
                  </Section>

                  <Section title="LONG-TERM MEMORY (PASSIVE FACTS)" icon={<Database size={12} />} badge={longTermMemories?.length ?? 0} defaultOpen={true}>
                    <p style={{ fontSize: "10.5px", color: "var(--text-secondary)", marginBottom: "8px", lineHeight: "1.5" }}>
                      Passively extracted facts from conversations. Stored in persistent memory. Injected into future prompts.
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "300px", overflowY: "auto", paddingRight: "4px" }}>
                      {!longTermMemories || longTermMemories.length === 0 ? (
                        <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>No passive memories extracted yet.</span>
                      ) : longTermMemories.map((mem, i) => (
                        <div key={i} style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px",
                          padding: "8px 10px",
                          background: "rgba(0, 230, 180, 0.03)",
                          borderRadius: "6px",
                          border: "1px solid rgba(0, 230, 180, 0.08)",
                        }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{
                              fontSize: "8.5px", fontWeight: "bold",
                              color: "var(--accent)",
                              fontFamily: "var(--font-mono)",
                              textTransform: "uppercase",
                            }}>
                              Source: {mem.source || "self_review"}
                            </span>
                            <span style={{
                              fontSize: "8px",
                              color: "var(--text-muted)",
                              fontFamily: "var(--font-mono)",
                            }}>
                              Importance: {typeof mem.importance === 'number' ? (mem.importance * 100).toFixed(0) : "50"}%
                            </span>
                          </div>
                          <span style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.72)", lineHeight: "1.55", wordBreak: "break-word" }}>
                            {mem.content}
                          </span>
                        </div>
                      ))}
                    </div>
                  </Section>

                  <Section title="PLAN REASONING HISTORY" icon={<Brain size={12} />} badge={currentReasonings.length} defaultOpen={true}>
                    {currentReasonings.length === 0 ? (
                      <span style={{ fontSize: "10.5px", color: "var(--text-muted)" }}>No reasoning recorded for this thread yet.</span>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "300px", overflowY: "auto", paddingRight: "4px" }}>
                        {currentReasonings.map((r, i) => (
                          <div key={i} style={{
                            padding: "8px 10px",
                            background: "rgba(120,60,255,0.05)",
                            border: "1px solid rgba(120,60,255,0.15)",
                            borderRadius: "6px",
                          }}>
                            <span style={{ fontSize: "8px", color: "rgba(180,140,255,0.7)", display: "block", marginBottom: "4px", fontFamily: "var(--font-mono)" }}>
                              REASONING #{i + 1} · ATTEMPT {r.attempt}
                            </span>
                            <span style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.6)", lineHeight: "1.5", whiteSpace: "pre-wrap" }}>
                              {r.text}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Section>
                </>
              )}

              {/* ═══════════ TAB: CAPABILITIES ═══════════ */}
              {activeTab === "settings" && (
                <>
                  <Section title="ACTIVE SKILL CONTEXTS" icon={<Box size={12} />}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                      {AVAILABLE_SKILLS.map(skill => {
                        const active = localSkills.includes(skill.id);
                        return (
                          <div
                            key={skill.id}
                            onClick={() => toggleSkill(skill.id)}
                            style={{
                              display: "flex", alignItems: "flex-start", gap: "10px",
                              padding: "10px 12px",
                              background: active ? "rgba(0,230,180,0.05)" : "rgba(0,0,0,0.2)",
                              border: active ? "1px solid rgba(0,230,180,0.25)" : "1px solid rgba(255,255,255,0.06)",
                              borderRadius: "8px", cursor: "pointer",
                              transition: "all 0.2s",
                              opacity: active ? 1 : 0.6,
                            }}
                          >
                            <span style={{ fontSize: "16px", flexShrink: 0, marginTop: "1px" }}>{skill.icon}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "2px" }}>
                                <span style={{ fontSize: "10.5px", fontWeight: "bold", color: active ? "var(--accent)" : "var(--text-secondary)" }}>
                                  {skill.label.toUpperCase()}
                                </span>
                                {active && <CheckCircle2 size={10} color="var(--accent)" />}
                              </div>
                              <span style={{ fontSize: "9px", color: "var(--text-muted)", lineHeight: "1.35" }}>{skill.desc}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Section>

                  <Section title="CUSTOM PROMPT DIRECTIVES" icon={<Network size={12} />}>
                    <textarea
                      value={localPrompt}
                      onChange={e => setLocalPrompt(e.target.value)}
                      placeholder="Enter custom system instructions (e.g. 'Always respond concisely. I am a developer on Arch Linux.')..."
                      style={{
                        background: "rgba(0,0,0,0.35)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        padding: "10px 12px",
                        color: "var(--text-primary)",
                        fontFamily: "var(--font-mono)",
                        fontSize: "11.5px",
                        outline: "none",
                        borderRadius: "6px",
                        width: "100%",
                        boxSizing: "border-box",
                        minHeight: "100px",
                        resize: "vertical",
                        lineHeight: "1.5",
                      }}
                    />
                  </Section>

                  <Section title="SYSTEM PROMPT PREVIEW" icon={<RefreshCcw size={12} />} defaultOpen={true}>
                    <div style={{ position: "relative" }}>
                      <MonoBlock maxH={300}>
                        {systemPromptPreview}
                      </MonoBlock>
                      <button
                        onClick={() => copyToClipboard(systemPromptPreview, "preview")}
                        style={{
                          position: "absolute", top: "6px", right: "6px",
                          fontSize: "9px", padding: "2px 7px", borderRadius: "4px",
                          background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)",
                          color: copyFlash === "preview" ? "var(--accent)" : "var(--text-muted)",
                          cursor: "pointer",
                        }}
                      >
                        {copyFlash === "preview" ? "COPIED!" : "COPY"}
                      </button>
                    </div>
                  </Section>
                </>
              )}
            </div>

            {/* ── Footer ── */}
            {activeTab === "settings" && (
              <div style={{
                padding: "12px 20px",
                borderTop: "1px solid rgba(255,255,255,0.06)",
                background: "rgba(0,0,0,0.2)",
                display: "flex",
                justifyContent: "flex-end",
                gap: "10px",
                flexShrink: 0,
              }}>
                <button
                  onClick={onClose}
                  style={{
                    background: "transparent",
                    color: "var(--text-secondary)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    padding: "7px 16px",
                    fontSize: "10px",
                    fontWeight: "bold",
                    cursor: "pointer",
                    borderRadius: "6px",
                    letterSpacing: "0.08em",
                  }}
                >
                  CLOSE
                </button>
                <button
                  onClick={handleSave}
                  style={{
                    background: saved ? "rgba(0,200,100,0.2)" : "rgba(0,230,180,0.15)",
                    color: saved ? "#00e064" : "var(--accent)",
                    border: `1px solid ${saved ? "rgba(0,200,100,0.4)" : "rgba(0,230,180,0.35)"}`,
                    padding: "7px 20px",
                    fontWeight: "bold",
                    fontSize: "10px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    cursor: "pointer",
                    borderRadius: "6px",
                    letterSpacing: "0.08em",
                    transition: "all 0.2s",
                  }}
                >
                  {saved ? <><CheckCircle2 size={12} /> CONTEXT APPLIED</> : <>SAVE & APPLY</>}
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
