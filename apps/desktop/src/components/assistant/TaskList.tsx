import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, CheckCircle2, XCircle, Clock, Pause, Play, Square, X, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import type { Message, Plan } from "../../lib/schemas";
import { useAssistantStore } from "../../stores/assistantStore";
import { wsClient } from "../../lib/ws";

interface AgenticTask {
  id: string;           // user message id
  userMsgId: string;
  title: string;
  icon: string;
  prompt: string;
  status: "running" | "success" | "error" | "pending" | "terminated";
  timestamp: number;
  toolActions: Array<{
    tool: string;
    description: string;
    status: "pending" | "running" | "success" | "error" | "skipped" | "terminated";
    result?: any;
    timestamp?: number;
  }>;
}

interface TaskListProps {
  messages: Message[];
  voiceState: string;
  hasActivePlan: boolean;
  currentPlan: Plan | null;
  onScrollToMessage?: (msgId: string) => void;
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;
  taskRefsMap?: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  showJsonImport: boolean;
  setShowJsonImport: (v: boolean) => void;
}

/** Returns true if the assistant response indicates it ran tool calls */
function responseHasToolCalls(content: string): boolean {
  return (
    content.includes("✓ ") ||
    content.includes("Task completed successfully") ||
    content.includes("❌ Failed at step") ||
    content.includes("Execution cancelled by user.")
  );
}

/** Infer task title from the prompt */
function parseTask(prompt: string): { title: string; icon: string } {
  const p = prompt.toLowerCase().trim();

  if (p.includes("update") || p.includes("upgrade")) return { title: "SYSTEM UPDATE", icon: "🔄" };
  if (p.includes("install") || p.includes("pacman -s") || p.includes("yay -s")) return { title: "INSTALL PACKAGE", icon: "📦" };
  if (p.includes("remove") || p.includes("uninstall")) return { title: "REMOVE PACKAGE", icon: "🗑️" };
  if (p.includes("reboot") || p.includes("restart")) return { title: "SYSTEM REBOOT", icon: "⚡" };
  if (p.includes("shutdown") || p.includes("poweroff")) return { title: "SYSTEM SHUTDOWN", icon: "🔌" };
  if (p.includes("search") || p.includes("find") || p.includes("grep")) return { title: "FILE SEARCH", icon: "🔍" };
  if (p.includes("open") || p.includes("launch") || p.includes("start")) return { title: "LAUNCH APP", icon: "🚀" };
  if (p.includes("create") || p.includes("write") || p.includes("mkdir") || p.includes("touch")) return { title: "CREATE FILE", icon: "📁" };
  if (p.includes("kill") || p.includes("pkill")) return { title: "KILL PROCESS", icon: "🚫" };
  if (p.includes("shell") || p.includes("command") || p.includes("run") || p.includes("sudo")) return { title: "SHELL COMMAND", icon: "🐚" };
  if (p.includes("chrome") || p.includes("firefox") || p.includes("browser")) return { title: "OPEN BROWSER", icon: "🌐" };
  if (p.includes("type") || p.includes("click") || p.includes("press")) return { title: "UI AUTOMATION", icon: "🖱️" };
  if (p.includes("brightness") || p.includes("volume") || p.includes("screen")) return { title: "SYSTEM CONTROL", icon: "🎛️" };

  const words = prompt.trim().split(/\s+/).slice(0, 3).map(w => w.replace(/[^a-zA-Z]/g, "").toUpperCase()).filter(Boolean);
  return { title: words.join(" ") || "AGENT TASK", icon: "🤖" };
}

export function TaskList({
  messages,
  voiceState,
  hasActivePlan,
  currentPlan,
  onScrollToMessage,
  selectedTaskId,
  setSelectedTaskId,
  taskRefsMap,
  showJsonImport,
  setShowJsonImport,
}: TaskListProps) {

  const taskPaused = useAssistantStore((s) => s.taskPaused);

  // Derive agentic tasks from messages
  const agenticTasks: AgenticTask[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "user") continue;

    const nextAssistant = messages.slice(i + 1).find(m => m.role === "assistant");
    if (!nextAssistant) {
      let lastUserIdx = -1;
      for (let j = messages.length - 1; j >= 0; j--) {
        if (messages[j].role === "user") { lastUserIdx = j; break; }
      }
      const isLatest = i === lastUserIdx;
      if (isLatest && (voiceState === "processing" || hasActivePlan)) {
        const { title, icon } = parseTask(msg.content);
        if (hasActivePlan && currentPlan) {
          agenticTasks.push({
            id: msg.id, userMsgId: msg.id, title, icon,
            prompt: msg.content, status: "running", timestamp: msg.timestamp,
            toolActions: currentPlan.steps.map(s => ({
              tool: s.tool,
              description: s.description || s.tool,
              status: s.status || "pending",
              result: s.result,
            })),
          });
        }
      }
      continue;
    }

    const isTask = responseHasToolCalls(nextAssistant.content);
    if (!isTask) continue;

    const { title, icon } = parseTask(msg.content);
    let status: AgenticTask["status"] = "success";
    if (nextAssistant.content.includes("Execution cancelled by user.")) {
      status = "terminated";
    } else if (nextAssistant.content.includes("❌")) {
      status = "error";
    }

    const toolActions: AgenticTask["toolActions"] = [];
    const lines = nextAssistant.content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("✓ ")) {
        toolActions.push({ tool: "step", description: trimmed.slice(2), status: "success", timestamp: nextAssistant.timestamp });
      } else if (trimmed.startsWith("❌")) {
        const cleanDesc = trimmed.startsWith("❌ ") ? trimmed.slice(2) : trimmed.slice(1);
        const stepStatus = cleanDesc.includes("(Reason: Terminated)") ? "terminated" : "error";
        toolActions.push({ tool: "step", description: cleanDesc, status: stepStatus, timestamp: nextAssistant.timestamp });
      }
    }

    agenticTasks.push({
      id: msg.id, userMsgId: msg.id, title, icon,
      prompt: msg.content, status, timestamp: msg.timestamp, toolActions,
    });
  }

  // Auto-select latest running task
  useEffect(() => {
    const running = agenticTasks.find(t => t.status === "running");
    if (running) setSelectedTaskId(running.id);
  }, [hasActivePlan]);

  const reversedTasks = [...agenticTasks].reverse();

  // ── JSON Import Modal state ────────────────────────────────────
  const [jsonInput, setJsonInput] = useState("");
  const [jsonError, setJsonError] = useState("");
  const [parsedSteps, setParsedSteps] = useState<any[] | null>(null);
  const [goalInput, setGoalInput] = useState("Custom JSON Task");
  const [showPreview, setShowPreview] = useState(false);

  const validateJson = (raw: string) => {
    if (!raw.trim()) { setJsonError(""); setParsedSteps(null); return; }
    try {
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : parsed.steps ? parsed.steps : [parsed];
      const bad = arr.find((s: any) => !s.tool);
      if (bad) { setJsonError('Each step must have a "tool" field.'); setParsedSteps(null); return; }
      setParsedSteps(arr);
      setJsonError("");
    } catch (e: any) {
      setJsonError(e.message);
      setParsedSteps(null);
    }
  };

  const handleRunJson = () => {
    if (!parsedSteps) return;
    wsClient.send("run_json_plan", { steps: parsedSteps, goal: goalInput || "Custom JSON Task" });
    setShowJsonImport(false);
    setJsonInput("");
    setParsedSteps(null);
    setGoalInput("Custom JSON Task");
    setShowPreview(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* ── JSON Import Modal ───────────────────────────────────── */}
      <AnimatePresence>
        {showJsonImport && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: "fixed", inset: 0, zIndex: 9999,
              background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
            onClick={() => setShowJsonImport(false)}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 16 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 16 }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
              onClick={e => e.stopPropagation()}
              style={{
                width: "min(560px, 92vw)",
                background: "rgba(10,10,18,0.97)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 16,
                padding: 24,
                display: "flex", flexDirection: "column", gap: 16,
                boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "white", letterSpacing: "0.03em" }}>Import JSON Task Plan</span>
                <button onClick={() => setShowJsonImport(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", padding: 4 }}><X size={16} /></button>
              </div>

              {/* Goal input */}
              <div>
                <label style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>TASK GOAL</label>
                <input
                  type="text"
                  value={goalInput}
                  onChange={e => setGoalInput(e.target.value)}
                  placeholder="Describe what this plan does..."
                  style={{
                    width: "100%", padding: "9px 12px", background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8,
                    color: "white", fontSize: 12, outline: "none", boxSizing: "border-box",
                    fontFamily: "inherit",
                  }}
                />
              </div>

              {/* JSON textarea */}
              <div>
                <label style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>JSON PLAN (steps array)</label>
                <textarea
                  value={jsonInput}
                  onChange={e => { setJsonInput(e.target.value); validateJson(e.target.value); }}
                  placeholder={'[\n  {"tool": "open_app", "args": {"app": "firefox"}, "description": "Open Firefox"},\n  {"tool": "wait_for_window", "args": {"title": "Firefox"}, "description": "Wait for Firefox"}\n]'}
                  rows={8}
                  style={{
                    width: "100%", padding: "10px 12px", resize: "vertical",
                    background: "rgba(255,255,255,0.04)",
                    border: `1px solid ${jsonError ? "rgba(255,80,80,0.4)" : parsedSteps ? "rgba(0,200,120,0.3)" : "rgba(255,255,255,0.1)"}`,
                    borderRadius: 8, color: "white", fontSize: 11,
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    outline: "none", boxSizing: "border-box", lineHeight: 1.6,
                    transition: "border-color 0.2s",
                  }}
                />
                {jsonError && (
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 6, padding: "7px 10px", background: "rgba(255,80,80,0.08)", border: "1px solid rgba(255,80,80,0.2)", borderRadius: 6 }}>
                    <AlertCircle size={12} color="rgba(255,100,100,1)" style={{ flexShrink: 0, marginTop: 1 }} />
                    <span style={{ fontSize: 10, color: "rgba(255,120,120,1)", lineHeight: 1.5 }}>{jsonError}</span>
                  </div>
                )}
              </div>

              {/* Preview toggle */}
              {parsedSteps && parsedSteps.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowPreview(p => !p)}
                    style={{
                      display: "flex", alignItems: "center", gap: 6, fontSize: 10,
                      fontWeight: 600, color: "rgba(0,200,120,0.9)",
                      background: "rgba(0,200,120,0.08)", border: "1px solid rgba(0,200,120,0.2)",
                      borderRadius: 6, padding: "5px 10px", cursor: "pointer",
                    }}
                  >
                    {showPreview ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    {parsedSteps.length} STEPS VALIDATED {showPreview ? "— HIDE" : "— SHOW"}
                  </button>
                  <AnimatePresence>
                    {showPreview && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        style={{ overflow: "hidden" }}
                      >
                        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflowY: "auto" }}>
                          {parsedSteps.map((s, i) => (
                            <div key={i} style={{
                              display: "flex", alignItems: "center", gap: 8,
                              padding: "5px 10px", borderRadius: 6,
                              background: "rgba(255,255,255,0.04)",
                              fontSize: 11,
                            }}>
                              <span style={{ color: "rgba(255,255,255,0.3)", fontFamily: "monospace", width: 18, flexShrink: 0 }}>{i + 1}.</span>
                              <span style={{ color: "var(--accent, hsl(280,80%,70%))", fontFamily: "monospace" }}>{s.tool}</span>
                              <span style={{ color: "rgba(255,255,255,0.4)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.description || JSON.stringify(s.args)}</span>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Actions */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 4 }}>
                <button
                  onClick={() => setShowJsonImport(false)}
                  style={{
                    padding: "8px 16px", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
                    background: "transparent", border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 8, color: "rgba(255,255,255,0.5)", cursor: "pointer",
                  }}
                >CANCEL</button>
                <motion.button
                  whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                  onClick={handleRunJson}
                  disabled={!parsedSteps || parsedSteps.length === 0}
                  style={{
                    padding: "8px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.05em",
                    background: parsedSteps ? "linear-gradient(135deg, hsl(280,80%,55%), hsl(200,80%,50%))" : "rgba(255,255,255,0.08)",
                    border: "none", borderRadius: 8,
                    color: parsedSteps ? "white" : "rgba(255,255,255,0.3)",
                    cursor: parsedSteps ? "pointer" : "not-allowed",
                    boxShadow: parsedSteps ? "0 4px 16px hsla(280,80%,55%,0.35)" : "none",
                    display: "flex", alignItems: "center", gap: 6,
                  }}
                >
                  <Play size={11} /> RUN NOW
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>


      {agenticTasks.length === 0 ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.5 }}>
          <p style={{ color: "var(--text-secondary)", fontSize: "11px", letterSpacing: "0.05em", textAlign: "center" }}>
            // NO AGENT TASKS YET
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", overflowY: "auto", flex: 1 }}>
          <AnimatePresence initial={false}>
            {reversedTasks.map((task) => (
              <motion.div
                key={task.id}
                ref={(el) => {
                  if (taskRefsMap) taskRefsMap.current[task.id] = el as HTMLDivElement;
                }}
                layout
                initial={{ opacity: 0, scale: 0.95, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -12 }}
                transition={{ type: "spring", damping: 26, stiffness: 360 }}
                onClick={() => {
                  setSelectedTaskId(task.id === selectedTaskId ? null : task.id);
                  onScrollToMessage?.(task.userMsgId);
                }}
                style={{
                  padding: "9px 11px",
                  borderRadius: "var(--radius-md)",
                  border: `1px solid ${task.id === selectedTaskId ? "var(--border-accent)" : task.status === "running" ? "var(--border-accent)" : "var(--border)"}`,
                  background: task.id === selectedTaskId
                    ? "var(--accent-glow)"
                    : task.status === "running"
                    ? "var(--accent-glow)"
                    : "rgba(0,0,0,0.2)",
                display: "flex",
                flexDirection: "column",
                gap: "5px",
                cursor: "pointer",
                boxShadow: task.status === "running" ? "0 0 8px var(--accent-glow)" : "none",
                transition: "all 0.15s",
              }}
            >
              {/* Header row: icon + title + timestamp + status */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "7px", fontWeight: "bold", fontSize: "11px", color: "var(--text-primary)" }}>
                  <span>{task.icon}</span>
                  <span style={{ letterSpacing: "0.04em" }}>{task.title}</span>
                  <span style={{ fontSize: "9px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontWeight: "normal", opacity: 0.85 }}>
                    [{new Date(task.timestamp ?? Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}]
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  {task.status === "running" && (
                    <span style={{ fontSize: "9px", color: taskPaused ? "hsl(40, 100%, 60%)" : "var(--accent)", display: "flex", alignItems: "center", gap: "3px", fontWeight: "bold" }}>
                      <AnimatePresence mode="wait">
                        {taskPaused ? (
                          <motion.span key="paused" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }} transition={{ duration: 0.12 }}>
                            <Pause size={10} />
                          </motion.span>
                        ) : (
                          <motion.span key="running" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }} transition={{ duration: 0.12 }}>
                            <Loader2 size={10} className="animate-spin" />
                          </motion.span>
                        )}
                      </AnimatePresence>
                      {taskPaused ? "PAUSED" : "RUNNING"}
                    </span>
                  )}
                  {task.status === "success" && (
                    <span style={{ fontSize: "9px", color: "var(--success)", display: "flex", alignItems: "center", gap: "3px" }}>
                      <CheckCircle2 size={10} /> DONE
                    </span>
                  )}
                  {task.status === "error" && (
                    <span style={{ fontSize: "9px", color: "var(--danger)", display: "flex", alignItems: "center", gap: "3px" }}>
                      <XCircle size={10} /> FAILED
                    </span>
                  )}
                  {task.status === "pending" && (
                    <span style={{ fontSize: "9px", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "3px" }}>
                      <Clock size={10} /> QUEUED
                    </span>
                  )}
                  {task.status === "terminated" && (
                    <span style={{ fontSize: "9px", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "3px" }}>
                      <Square size={10} /> STOPPED
                    </span>
                  )}
                </div>
              </div>

              {/* Prompt preview */}
              <div style={{ fontSize: "10px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)", opacity: 0.75, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {task.prompt}
              </div>

              {/* Task Controls: Stop / Pause / Resume — only for running tasks */}
              {task.status === "running" && (
                <div
                  style={{
                    display: "flex", gap: "6px", marginTop: "3px",
                    borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "6px",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <AnimatePresence mode="wait">
                    {taskPaused ? (
                      <motion.button
                        key="resume"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={{ duration: 0.15 }}
                        onClick={() => wsClient.send("resume_execution", {})}
                        title="Resume Task"
                        style={{
                          display: "flex", alignItems: "center", gap: "4px",
                          padding: "4px 10px", fontSize: "9px", fontWeight: "bold",
                          letterSpacing: "0.05em",
                          background: "rgba(0, 230, 180, 0.12)", color: "var(--success)",
                          border: "1px solid rgba(0, 230, 180, 0.25)", borderRadius: "var(--radius-sm)",
                          cursor: "pointer",
                        }}
                      >
                        <Play size={10} /> RESUME
                      </motion.button>
                    ) : (
                      <motion.button
                        key="pause"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={{ duration: 0.15 }}
                        onClick={() => wsClient.send("pause_execution", {})}
                        title="Pause Task"
                        style={{
                          display: "flex", alignItems: "center", gap: "4px",
                          padding: "4px 10px", fontSize: "9px", fontWeight: "bold",
                          letterSpacing: "0.05em",
                          background: "rgba(255, 180, 0, 0.1)", color: "hsl(40, 100%, 60%)",
                          border: "1px solid rgba(255, 180, 0, 0.25)", borderRadius: "var(--radius-sm)",
                          cursor: "pointer",
                        }}
                      >
                        <Pause size={10} /> PAUSE
                      </motion.button>
                    )}
                  </AnimatePresence>
                  <button
                    onClick={() => wsClient.send("cancel_execution", {})}
                    title="Stop Task"
                    style={{
                      display: "flex", alignItems: "center", gap: "4px",
                      padding: "4px 10px", fontSize: "9px", fontWeight: "bold",
                      letterSpacing: "0.05em",
                      background: "rgba(255, 60, 60, 0.1)", color: "var(--danger)",
                      border: "1px solid rgba(255, 60, 60, 0.2)", borderRadius: "var(--radius-sm)",
                      cursor: "pointer",
                    }}
                  >
                    <Square size={10} /> STOP
                  </button>
                </div>
              )}
            </motion.div>
          ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
