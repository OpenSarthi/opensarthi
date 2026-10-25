import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, CheckCircle2, XCircle, Clock, Pause, Play, Square, Terminal } from "lucide-react";
import type { Message, Plan } from "../../lib/schemas";
import { useAssistantStore } from "../../stores/assistantStore";
import { wsClient } from "../../lib/ws";
import { parseToolActionsFromContent } from "../execution/ActionLog";

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
    status: "pending" | "running" | "success" | "error" | "skipped" | "terminated" | "divider";
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
}

/** Returns true if the assistant response indicates it ran tool calls */
function responseHasToolCalls(content: string): boolean {
  const c = content.trim();
  return (
    content.includes("✓ ") ||
    content.includes("Task completed successfully") ||
    content.includes("❌ Failed at step") ||
    content.includes("Execution cancelled by user.") ||
    content.includes("<summary>✓") ||
    content.includes("<summary>❌") ||
    c.startsWith("[") ||
    c.startsWith("{")
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
}: TaskListProps) {

  const taskPaused = useAssistantStore((s) => s.taskPaused);
  const shellOutputLines = useAssistantStore((s) => s.shellOutputLines);
  const activeThreadId = useAssistantStore((s) => s.activeThreadId);

  const shellEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll shell output to bottom
  useEffect(() => {
    shellEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [shellOutputLines]);

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

    const isTask = !!nextAssistant.plan || responseHasToolCalls(nextAssistant.content);
    if (!isTask) continue;

    const { title, icon } = parseTask(msg.content);
    let status: AgenticTask["status"] = "success";
    if (nextAssistant.content.includes("Execution cancelled by user.")) {
      status = "terminated";
    } else if (nextAssistant.content.includes("❌") || (nextAssistant.plan && nextAssistant.plan.steps.some(s => s.status === "error"))) {
      status = "error";
    }

    let toolActions = [];
    if (nextAssistant.plan) {
      toolActions = nextAssistant.plan.steps.map(s => ({
        tool: s.tool,
        description: s.description || s.tool,
        status: s.status || "pending",
        result: s.result,
        timestamp: s.timestamp,
      }));
    } else {
      toolActions = parseToolActionsFromContent(nextAssistant.content, nextAssistant.timestamp);
    }

    agenticTasks.push({
      id: msg.id, userMsgId: msg.id, title, icon,
      prompt: msg.content, status, timestamp: msg.timestamp, toolActions,
    });
  }

  // Auto-select latest running task whenever plan changes (using plan reference not bool so it fires on mount too)
  useEffect(() => {
    const running = agenticTasks.find(t => t.status === "running");
    if (running) setSelectedTaskId(running.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPlan]);

  const reversedTasks = [...agenticTasks].reverse();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", gap: "6px" }}>



      {agenticTasks.length === 0 ? (
        <div className="os-empty">
          <span className="os-empty-mark" aria-hidden="true">
            <CheckCircle2 size={15} />
          </span>
          <p className="os-empty-title">No tasks yet</p>
          <p className="os-empty-hint">Tasks you ask OpenSarthi to run will appear here.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", overflowY: "auto", flex: 1, minHeight: 0, paddingBottom: "24px" }}>
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
                role="button"
                tabIndex={0}
                aria-selected={task.id === selectedTaskId}
                aria-label={`Task: ${task.title}, status: ${task.status}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedTaskId(task.id === selectedTaskId ? null : task.id);
                    onScrollToMessage?.(task.userMsgId);
                  }
                }}
                onClick={() => {
                  setSelectedTaskId(task.id === selectedTaskId ? null : task.id);
                  onScrollToMessage?.(task.userMsgId);
                }}
                className={`os-task-card${task.id === selectedTaskId ? " is-selected" : ""}${task.status === "running" ? " is-running" : ""}`}
            >
              {/* Header row: dot + title + timestamp + status */}
              <div className="os-task-head">
                <div className="os-task-heading">
                  <span className={`os-task-dot is-${task.status}`} aria-hidden="true" />
                  <span className="os-task-title">{task.title}</span>
                  <span className="os-task-time">
                    {new Date(task.timestamp ?? Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  {task.status === "running" && (
                    <span className="os-task-status" style={{ color: taskPaused ? "var(--warning)" : "var(--accent)" }}>
                      <AnimatePresence mode="wait">
                        {taskPaused ? (
                          <motion.span key="paused" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }} transition={{ duration: 0.12 }}>
                            <Pause size={11} />
                          </motion.span>
                        ) : (
                          <motion.span key="running" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }} transition={{ duration: 0.12 }}>
                            <Loader2 size={11} className="animate-spin" />
                          </motion.span>
                        )}
                      </AnimatePresence>
                      {taskPaused ? "Paused" : "Running"}
                    </span>
                  )}
                  {task.status === "success" && (
                    <span className="os-task-status" style={{ color: "var(--success)" }}>
                      <CheckCircle2 size={11} /> Done
                    </span>
                  )}
                  {task.status === "error" && (
                    <span className="os-task-status" style={{ color: "var(--danger)" }}>
                      <XCircle size={11} /> Failed
                    </span>
                  )}
                  {task.status === "pending" && (
                    <span className="os-task-status" style={{ color: "var(--text-muted)" }}>
                      <Clock size={11} /> Queued
                    </span>
                  )}
                  {task.status === "terminated" && (
                    <span className="os-task-status" style={{ color: "var(--text-muted)" }}>
                      <Square size={11} /> Stopped
                    </span>
                  )}
                </div>
              </div>

              {/* Prompt preview */}
              <div className="os-task-prompt">
                {task.prompt}
              </div>

              {/* Task Controls: Stop / Pause / Resume — only for running tasks */}
              {task.status === "running" && (
                <div className="os-task-controls" onClick={(e) => e.stopPropagation()}>
                  <AnimatePresence mode="wait">
                    {taskPaused ? (
                      <motion.button
                        key="resume"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={{ duration: 0.15 }}
                        onClick={() => wsClient.send("resume_execution", { thread_id: activeThreadId })}
                        title="Resume Task"
                        aria-label="Resume task execution"
                        className="os-btn os-btn-ghost os-btn-xs"
                        style={{ color: "var(--success)" }}
                      >
                        <Play size={11} /> Resume
                      </motion.button>
                    ) : (
                      <motion.button
                        key="pause"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={{ duration: 0.15 }}
                        onClick={() => wsClient.send("pause_execution", { thread_id: activeThreadId })}
                        title="Pause Task"
                        aria-label="Pause task execution"
                        className="os-btn os-btn-ghost os-btn-xs"
                        style={{ color: "var(--warning)" }}
                      >
                        <Pause size={11} /> Pause
                      </motion.button>
                    )}
                  </AnimatePresence>
                  <button
                    onClick={() => wsClient.send("cancel_execution", { thread_id: activeThreadId })}
                    title="Stop Task"
                    aria-label="Stop task execution"
                    className="os-btn os-btn-ghost os-btn-xs"
                    style={{ color: "var(--danger)" }}
                  >
                    <Square size={11} /> Stop
                  </button>
                </div>
              )}
              {/* Shell output terminal — shown when task is selected/running and shell lines are streaming */}
              {(task.status === "running" || task.id === selectedTaskId) && shellOutputLines.length > 0 && (
                <div className="os-task-shell">
                  <div className="os-task-shell-head">
                    <Terminal size={11} /> Shell output
                  </div>
                  <div className="os-task-shell-body">
                    {shellOutputLines.map((line, i) => (
                      <div key={i} style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                        {line}
                      </div>
                    ))}
                    <div ref={shellEndRef} />
                  </div>
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
