import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Mic, MicOff, Settings, ChevronUp, ChevronDown,
  X, CheckCircle, AlertCircle, Clock, RefreshCw,
  Menu, User, Copy, Volume2, Zap,
} from "lucide-react";

// Animated robot avatar SVG for AI responses
function RobotAvatar() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="7" y="9" width="10" height="9" rx="2" fill="#000" stroke="none" />
      <rect x="9" y="11" width="2.5" height="2" rx="0.5" fill="#00e6a0">
        <animate attributeName="opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite" begin="0s" />
      </rect>
      <rect x="12.5" y="11" width="2.5" height="2" rx="0.5" fill="#00e6a0">
        <animate attributeName="opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite" begin="0.3s" />
      </rect>
      <rect x="10" y="14" width="4" height="1" rx="0.5" fill="#00e6a0" opacity="0.7" />
      <rect x="5" y="11" width="2" height="5" rx="1" fill="#000" />
      <rect x="17" y="11" width="2" height="5" rx="1" fill="#000" />
      <rect x="9" y="7" width="2" height="2" rx="0.5" fill="#000" />
      <rect x="13" y="7" width="2" height="2" rx="0.5" fill="#000" />
      <rect x="5" y="9" width="14" height="1" rx="0.5" fill="#000" opacity="0.3" />
    </svg>
  );
}
import { useAssistantStore } from "../../stores/assistantStore";
import { wsClient } from "../../lib/ws";
import type { VoiceState, PlanStep } from "../../lib/schemas";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { SplashScreen } from "./SplashScreen";
import { ParticleBackground } from "./ParticleBackground";

// ─── Step badge ───────────────────────────────────────────────────────────────
function StepBadge({ status }: { status: string }) {
  const map: Record<string, { icon: any; color: string }> = {
    pending: { icon: Clock, color: "#666" },
    running: { icon: RefreshCw, color: "var(--accent)" },
    success: { icon: CheckCircle, color: "#00e6a0" },
    error: { icon: AlertCircle, color: "#ff4f4f" },
    terminated: { icon: X, color: "#888" },
  };
  const cfg = map[status] || map.pending;
  const Icon = cfg.icon;
  return <Icon size={14} color={cfg.color} className={status === "running" ? "animate-spin" : undefined} style={{ flexShrink: 0 }} />;
}

// ─── Background Glow Animation (Google Assistant style) ──────────────────────
function BackgroundGlow({ voiceState }: { voiceState: VoiceState }) {
  const isListening = voiceState === "listening";
  const isSpeaking = voiceState === "speaking";
  const isProcessing = voiceState === "processing";
  const isActive = isListening || isSpeaking || isProcessing;

  if (!isActive) return null;

  // Faster animations when processing, slower/breathing animations when idle/listening/speaking
  const duration = isProcessing ? "1.6s" : isSpeaking ? "2.6s" : "3.6s";

  return (
    <>
      <style>{`
        @keyframes googleGlowBlue {
          0% { transform: translate(-30%, -20%) scale(1.2); opacity: 0.7; }
          33% { transform: translate(-15%, -10%) scale(1.5); opacity: 0.9; }
          66% { transform: translate(-35%, -25%) scale(1.0); opacity: 0.6; }
          100% { transform: translate(-30%, -20%) scale(1.2); opacity: 0.7; }
        }
        @keyframes googleGlowRed {
          0% { transform: translate(-10%, -15%) scale(1.4); opacity: 0.8; }
          33% { transform: translate(10%, -5%) scale(1.1); opacity: 0.6; }
          66% { transform: translate(-15%, -20%) scale(1.6); opacity: 0.9; }
          100% { transform: translate(-10%, -15%) scale(1.4); opacity: 0.8; }
        }
        @keyframes googleGlowYellow {
          0% { transform: translate(10%, -20%) scale(1.1); opacity: 0.6; }
          33% { transform: translate(-5%, -10%) scale(1.4); opacity: 0.9; }
          66% { transform: translate(25%, -15%) scale(1.2); opacity: 0.7; }
          100% { transform: translate(10%, -20%) scale(1.1); opacity: 0.6; }
        }
        @keyframes googleGlowGreen {
          0% { transform: translate(30%, -10%) scale(1.5); opacity: 0.8; }
          33% { transform: translate(35%, -20%) scale(1.1); opacity: 0.6; }
          66% { transform: translate(15%, -5%) scale(1.4); opacity: 0.9; }
          100% { transform: translate(30%, -10%) scale(1.5); opacity: 0.8; }
        }
      `}</style>
      <div
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          opacity: 0.28,
          pointerEvents: "none",
          zIndex: 1,
          filter: "blur(28px)",
          overflow: "hidden",
        }}
      >
        {/* Blue Blob */}
        <div
          style={{
            position: "absolute",
            width: "35%",
            height: "140%",
            left: "5%",
            borderRadius: "50%",
            background: "radial-gradient(circle, #4285F4 0%, transparent 80%)",
            animation: `googleGlowBlue ${duration} infinite ease-in-out`,
          }}
        />
        {/* Red Blob */}
        <div
          style={{
            position: "absolute",
            width: "35%",
            height: "140%",
            left: "30%",
            borderRadius: "50%",
            background: "radial-gradient(circle, #EA4335 0%, transparent 80%)",
            animation: `googleGlowRed ${duration} infinite ease-in-out`,
          }}
        />
        {/* Yellow Blob */}
        <div
          style={{
            position: "absolute",
            width: "35%",
            height: "140%",
            left: "55%",
            borderRadius: "50%",
            background: "radial-gradient(circle, #FBBC05 0%, transparent 80%)",
            animation: `googleGlowYellow ${duration} infinite ease-in-out`,
          }}
        />
        {/* Green Blob */}
        <div
          style={{
            position: "absolute",
            width: "35%",
            height: "140%",
            left: "80%",
            borderRadius: "50%",
            background: "radial-gradient(circle, #34A853 0%, transparent 80%)",
            animation: `googleGlowGreen ${duration} infinite ease-in-out`,
          }}
        />
      </div>
    </>
  );
}

// ─── Execution Sheet ──────────────────────────────────────────────────────────
function ExecutionSheet({ plan, taskPaused, activeThreadId, isLive = true, onClose }: {
  plan: import("../../lib/schemas").Plan | null;
  taskPaused: boolean;
  activeThreadId: string;
  isLive?: boolean;
  onClose?: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  if (!plan) return null;
  const done = plan.steps.filter((s: PlanStep) => s.status === "success").length;
  const total = plan.steps.length;

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.25 }}
      style={{
        position: "relative", zIndex: 15, width: "100%", flexShrink: 0,
        background: "transparent", borderBottom: "1.5px solid rgba(255, 255, 255, 0.08)",
        maxHeight: expanded ? "50vh" : "48px",
        transition: "max-height 0.3s ease", overflow: "hidden",
      }}
    >
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 20px",
        borderBottom: expanded ? "1px solid rgba(255,255,255,0.05)" : "none",
      }}>
        <div onClick={() => setExpanded(e => !e)} style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, cursor: "pointer", userSelect: "none" }}>
          <span className="os-badge-pulse" style={{ width: 8, height: 8, borderRadius: "50%", background: isLive ? "var(--accent)" : "var(--text-muted)", display: "inline-block" }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: isLive ? "var(--accent)" : "var(--text-secondary)", fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}>
            {isLive ? "AGENT ACTIVE" : "TASK RUN LOG"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>{done}/{total}</span>
          <button onClick={() => setExpanded(e => !e)} style={{ background: "transparent", border: "none", color: "var(--text-secondary)", display: "flex", padding: 4 }}>
            {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
          {!isLive && onClose && (
            <button onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--danger)", display: "flex", padding: 4, cursor: "pointer" }}>
              <X size={16} />
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <>
          <div style={{ padding: "8px 20px 2px", fontSize: 12, color: "var(--text-secondary)", fontStyle: "italic" }}>{plan.goal}</div>
          <div style={{ margin: "4px 20px 8px", height: 2, background: "rgba(255,255,255,0.08)", borderRadius: 1 }}>
            <motion.div style={{ height: "100%", background: isLive ? "var(--accent)" : "var(--text-muted)", borderRadius: 1 }}
              animate={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }} transition={{ duration: 0.4 }} />
          </div>
          <div style={{ overflowY: "auto", maxHeight: isLive ? "calc(55vh - 130px)" : "calc(55vh - 85px)", padding: "0 20px 8px" }}>
            {plan.steps.map((step: PlanStep, idx: number) => (
              <div key={idx} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                <StepBadge status={step.status} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    color: step.status === "success" ? "var(--text-primary)" : step.status === "error" ? "var(--danger)" : step.status === "running" ? "var(--accent)" : "var(--text-secondary)",
                    fontWeight: step.status === "running" ? 600 : 400,
                  }}>{step.description}</div>
                  {step.error && <div style={{ fontSize: 10, color: "var(--danger)", marginTop: 2, opacity: 0.8 }}>{step.error}</div>}
                  {(step as any).result && step.status === "success" && (
                    <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 2, opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String((step as any).result).slice(0, 100)}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {isLive && (
            <div style={{ display: "flex", gap: 10, padding: "10px 20px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              <button onClick={() => wsClient.send(taskPaused ? "resume_execution" : "pause_execution", { thread_id: activeThreadId })}
                style={{ flex: 1, padding: "8px 0", fontSize: 12, fontWeight: 700, borderRadius: 8, border: `1px solid ${taskPaused ? "var(--success)" : "var(--warning)"}`, color: taskPaused ? "var(--success)" : "var(--warning)", background: "transparent" }}>
                {taskPaused ? "▶ RESUME" : "⏸ PAUSE"}
              </button>
              <button onClick={() => wsClient.send("cancel_execution", { thread_id: activeThreadId })}
                style={{ flex: 1, padding: "8px 0", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "1px solid var(--danger)", color: "var(--danger)", background: "transparent" }}>
                ■ STOP
              </button>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}

// ─── Helper to parse task plans from messages ──────────────────────────────────
function getPlanFromMessage(msg: any, messages: any[]): import("../../lib/schemas").Plan | null {
  let userMsg = null;
  let assistantMsg = null;

  if (msg.role === "user") {
    userMsg = msg;
    const idx = messages.findIndex(m => m.id === msg.id);
    if (idx !== -1) {
      assistantMsg = messages.slice(idx + 1).find(m => m.role === "assistant");
    }
  } else {
    assistantMsg = msg;
    const idx = messages.findIndex(m => m.id === msg.id);
    if (idx !== -1) {
      for (let i = idx - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          userMsg = messages[i];
          break;
        }
      }
    }
  }

  if (!assistantMsg || !assistantMsg.content) return null;
  const content = assistantMsg.content;
  const hasTools = content.includes("✓ ") || content.includes("❌") || content.includes("Task completed successfully") || content.includes("Execution cancelled by user.");
  if (!hasTools) return null;

  const steps: any[] = [];
  const lines = content.split("\n");
  let stepIdx = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("✓ ")) {
      const desc = trimmed.slice(2);
      steps.push({ index: stepIdx++, tool: "step", args: {}, description: desc, status: "success" });
    } else if (trimmed.startsWith("❌")) {
      const cleanDesc = trimmed.startsWith("❌ ") ? trimmed.slice(2) : trimmed.slice(1);
      const stepStatus = cleanDesc.includes("Terminated") ? "terminated" : "error";
      steps.push({ index: stepIdx++, tool: "step", args: {}, description: cleanDesc, status: stepStatus, error: stepStatus === "error" ? cleanDesc : undefined });
    }
  }

  if (steps.length === 0) return null;

  return {
    id: crypto.randomUUID(),
    goal: userMsg ? userMsg.content : "Agent Task",
    steps,
    recovery_hint: null
  };
}

// ─── Message Bubble ───────────────────────────────────────────────────────────
function MobileBubble({ msg, onTapForPlan, hasPlan }: {
  msg: import("../../lib/schemas").Message;
  onTapForPlan?: () => void;
  hasPlan?: boolean;
}) {
  const isUser = msg.role === "user";
  const [copied, setCopied] = useState(false);
  const displayContent = msg.content;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const cleanContent = msg.content
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .replace(/<think>[\s\S]*/g, "")
      .trim();
    navigator.clipboard.writeText(cleanContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleListen = (e: React.MouseEvent) => {
    e.stopPropagation();
    const cleanContent = msg.content
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .replace(/<think>[\s\S]*/g, "")
      .trim();
    const clean = cleanContent
      .replace(/```[\s\S]*?```/g, " code block. ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/[*#_\-]/g, "")
      .trim();
    wsClient.send("speak_text", { text: clean, manual: true });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", marginBottom: 14, padding: "0 4px" }}
    >
      {!isUser && (
        <div style={{
          width: 30, height: 30, borderRadius: "50%",
          background: "linear-gradient(135deg, var(--accent) 0%, rgba(0,200,140,0.5) 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          marginRight: 8, flexShrink: 0, marginTop: 2,
          boxShadow: "0 0 8px var(--accent-glow)",
        }}>
          <RobotAvatar />
        </div>
      )}
      <div style={{ maxWidth: "80%", display: "flex", flexDirection: "column", gap: 4 }}>
        <div
          onClick={hasPlan ? onTapForPlan : undefined}
          style={{
            padding: "10px 14px",
            borderRadius: isUser ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
            background: isUser
              ? "linear-gradient(135deg, var(--accent) 0%, rgba(0,200,130,0.8) 100%)"
              : "rgba(255,255,255,0.05)",
            border: isUser ? "none" : `1px solid ${hasPlan ? "var(--accent)" : "rgba(255,255,255,0.08)"}`,
            cursor: hasPlan ? "pointer" : "default",
            wordBreak: "break-word",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {hasPlan && (
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
              <Zap size={10} color="var(--accent)" />
              <span style={{ fontSize: 9, color: "var(--accent)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em", opacity: 0.7 }}>AGENT TASK</span>
            </div>
          )}
          <MarkdownRenderer content={displayContent} isUser={isUser} />

          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 4,
            borderTop: isUser ? "1px solid rgba(0,0,0,0.12)" : "1px solid rgba(255,255,255,0.05)",
            paddingTop: 6,
            gap: 10
          }}>
            <span style={{
              fontSize: 9,
              color: isUser ? "rgba(0,0,0,0.55)" : "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              fontWeight: 500
            }}>
              [ {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })} ]
            </span>

            {!isUser && (
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={handleCopy} style={{
                  display: "flex", alignItems: "center", gap: 3, padding: "2px 6px",
                  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 8, cursor: "pointer", color: copied ? "var(--accent)" : "var(--text-secondary)",
                }}>
                  <Copy size={10} />
                  <span style={{ fontSize: 8, fontFamily: "var(--font-mono)", fontWeight: "bold" }}>{copied ? "COPIED" : "COPY"}</span>
                </button>
                <button onClick={handleListen} style={{
                  display: "flex", alignItems: "center", gap: 3, padding: "2px 6px",
                  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 8, cursor: "pointer", color: "var(--text-secondary)",
                }}>
                  <Volume2 size={10} />
                  <span style={{ fontSize: 8, fontFamily: "var(--font-mono)", fontWeight: "bold" }}>LISTEN</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Voice Indicator (Gemini / Google Assistant style) ──────────────────────
function VoiceIndicator({ state, transcript }: { state: VoiceState; transcript: string | null }) {
  if (state === "idle" || state === "error") return null;
  const colors = ["#4285f4", "#ea4335", "#fbbc05", "#34a853", "#4285f4", "#ea4335", "#34a853"];
  const labelMap: Record<string, string> = {
    listening: "Listening…",
    processing: "Thinking…",
    speaking: "Speaking…",
  };
  return (
    <motion.div
      initial={{ y: 140, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 140, opacity: 0 }}
      transition={{ type: "spring", damping: 22, stiffness: 220 }}
      style={{
        position: "fixed", bottom: 82, left: 12, right: 12, zIndex: 80,
        background: "rgba(8,12,10,0.97)",
        border: "1px solid rgba(255,255,255,0.09)",
        borderRadius: 28, padding: "20px 24px 14px",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
        backdropFilter: "blur(20px)",
        boxShadow: "0 -8px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)",
      }}
    >
      <div style={{ display: "flex", gap: 5, alignItems: "center", height: 44 }}>
        {colors.map((color, i) => (
          <motion.div
            key={i}
            animate={{ scaleY: [0.15, 1, 0.4, 0.8, 0.2] }}
            transition={{ duration: 0.7, delay: i * 0.08, repeat: Infinity, ease: "easeInOut" }}
            style={{ width: 5, height: 38, borderRadius: 3, background: color, transformOrigin: "center", opacity: 0.92 }}
          />
        ))}
      </div>
      <span style={{ fontSize: 15, color: "rgba(255,255,255,0.85)", fontWeight: 500 }}>
        {labelMap[state] || state}
      </span>
      {state === "listening" && transcript && (
        <span style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", fontStyle: "italic", textAlign: "center", maxWidth: "85%", lineHeight: 1.4 }}>
          "{transcript}"
        </span>
      )}
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", letterSpacing: "0.1em", marginTop: 2 }}>
        TAP MIC TO CANCEL
      </div>
    </motion.div>
  );
}


// ─── Wake Word Detector ───────────────────────────────────────────────────────
function useWakeWord(transcript: string | null, wakeWords: string[], wakeWordEnabled: boolean, onDetected: (clean: string) => void) {
  const firedRef = useRef(false);
  useEffect(() => {
    if (!wakeWordEnabled || !transcript || !wakeWords.length) { firedRef.current = false; return; }
    const lower = transcript.toLowerCase();
    const matched = wakeWords.some(w => lower.includes(w.toLowerCase()));
    if (matched && !firedRef.current) {
      firedRef.current = true;
      const clean = wakeWords.reduce((t, w) => t.replace(new RegExp(w, "gi"), ""), transcript).replace(/^[\s,;:.!?]+/, "").trim();
      onDetected(clean);
    }
    if (!matched) firedRef.current = false;
  }, [transcript, wakeWords, wakeWordEnabled]);
}

// ─── Main Component ───────────────────────────────────────────────────────────
interface MobileAssistantProps {
  onOpenSettings: () => void;
  onOpenHistory: () => void;
  onOpenCustomizer: () => void;
}

export function MobileAssistant({ onOpenSettings, onOpenHistory, onOpenCustomizer }: MobileAssistantProps) {
  const {
    messages, voiceState, isConnected, currentTranscript,
    currentPlan, taskPaused, activeThreadId, tabs,
    wakeWords, wakeWordEnabled, setVoiceState, addMessage, setTranscript,
  } = useAssistantStore();

  const [textInput, setTextInput] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<import("../../lib/schemas").Plan | null>(null);
  const [showSplash, setShowSplash] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastSentSourceRef = useRef<"text" | "voice">("text");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeTab = tabs.find((t: any) => t.id === activeThreadId);
  const isTaskRunning = !!activeTab?.currentPlan;

  // Clear selected plan when switching threads
  useEffect(() => {
    setSelectedPlan(null);
  }, [activeThreadId]);

  // Hide splash after connection or 5s timeout
  useEffect(() => {
    if (isConnected) setTimeout(() => setShowSplash(false), 600);
    const t = setTimeout(() => setShowSplash(false), 5000);
    return () => clearTimeout(t);
  }, [isConnected]);

  // Auto-scroll
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Auto-send after silence
  useEffect(() => {
    if (voiceState !== "listening") {
      if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
      return;
    }
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (currentTranscript?.trim()) setTextInput(currentTranscript);
    silenceTimerRef.current = setTimeout(() => {
      const final = currentTranscript?.trim() ?? "";
      if (final) handleVoiceSend(final);
      else setVoiceState("idle");
    }, currentTranscript?.trim() ? 1800 : 12000);
    return () => { if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current); };
  }, [currentTranscript, voiceState]);

  // Auto TTS on assistant messages after voice input
  useEffect(() => {
    if (!messages.length) return;
    const last = messages[messages.length - 1];
    if (last?.role === "assistant" && lastSentSourceRef.current === "voice" && last.content) {
      let text = last.content.replace(/<think>[\s\S]*?<\/think>/g, "");
      if (text.includes("<think>")) return;
      text = text.replace(/```[\s\S]*?```/g, " ").replace(/`([^`]+)`/g, "$1").replace(/[*#_\-]/g, "").trim();
      if (text) wsClient.send("speak_text", { text, manual: false });
      lastSentSourceRef.current = "text";
    }
  }, [messages]);

  const handleTextSend = useCallback(() => {
    const msg = textInput.trim();
    if (!msg || !isConnected || isTaskRunning) return;
    lastSentSourceRef.current = "text";
    addMessage({ id: crypto.randomUUID(), role: "user", content: msg, timestamp: Date.now() });
    wsClient.send("user_message", { text: msg, source: "text", thread_id: activeThreadId });
    setTextInput("");
    setTranscript("");
    setVoiceState("processing");
  }, [textInput, isConnected, isTaskRunning, addMessage, activeThreadId, setVoiceState, setTranscript]);

  const handleVoiceSend = useCallback((msg: string) => {
    if (!msg || !isConnected) return;
    lastSentSourceRef.current = "voice";
    addMessage({ id: crypto.randomUUID(), role: "user", content: msg, timestamp: Date.now() });
    wsClient.send("user_message", { text: msg, source: "voice", thread_id: activeThreadId });
    setTextInput("");
    setTranscript("");
    setVoiceState("processing");
  }, [isConnected, addMessage, activeThreadId, setVoiceState, setTranscript]);

  const toggleVoice = useCallback(() => {
    if (voiceState === "idle" || voiceState === "error") {
      setVoiceState("listening");
      setTextInput("");
      setTranscript("");
      wsClient.send("voice_state", { state: "listening" });
    } else if (voiceState === "listening") {
      setVoiceState("idle");
      wsClient.send("voice_state", { state: "idle" });
    } else if (voiceState === "speaking") {
      wsClient.send("stop_speech", {});
      const { continuousListening } = useAssistantStore.getState();
      setVoiceState(continuousListening ? "listening" : "idle");
    }
  }, [voiceState, setVoiceState, setTranscript]);

  const isListening = voiceState === "listening";

  return (
    <>
      <AnimatePresence>{showSplash && <SplashScreen isConnected={isConnected} />}</AnimatePresence>

      <div style={{ width: "100vw", height: "100dvh", display: "flex", flexDirection: "column", background: "var(--bg-primary)", overflow: "hidden", position: "relative" }}>
        {/* Particle / ambient background */}
        <ParticleBackground voiceState={voiceState} />

        {/* Top Bar */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          paddingTop: "max(env(safe-area-inset-top), 12px)", paddingBottom: 10,
          paddingLeft: 12, paddingRight: 12,
          background: "rgba(8,12,10,0.97)", borderBottom: "1px solid var(--border)",
          flexShrink: 0, zIndex: 10,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={onOpenHistory} style={{ background: "transparent", border: "none", color: "var(--text-secondary)", padding: 6, display: "flex" }}>
              <Menu size={20} />
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <img src="/icon.png" alt="" style={{ width: 22, height: 22, borderRadius: 6 }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              <span style={{ fontSize: 14, fontWeight: 800, color: "var(--accent)", letterSpacing: "0.08em", fontFamily: "var(--font-mono)" }}>OPENSARTHI</span>
            </div>
            {isTaskRunning && <span className="os-badge-pulse" style={{ fontSize: 9, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>● TASK</span>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={onOpenCustomizer} style={{ background: "transparent", border: "none", color: "var(--text-secondary)", padding: 6, display: "flex" }}>
              <User size={18} />
            </button>
            <button onClick={onOpenSettings} style={{ background: "transparent", border: "none", color: "var(--text-secondary)", padding: 6, display: "flex" }}>
              <Settings size={18} />
            </button>
          </div>
        </div>

        {/* Chat Area */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 10px", paddingBottom: "8px", WebkitOverflowScrolling: "touch" }}>
          {messages.length === 0 && (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, color: "var(--text-secondary)", paddingBottom: 60 }}>
              <img src="/icon.png" alt="" style={{ width: 60, height: 60, borderRadius: 18, opacity: 0.6 }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              <div className="os-glitch" data-text="OPENSARTHI" style={{ fontSize: 20, color: "var(--accent)" }}>OPENSARTHI</div>
              <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.2em", textAlign: "center" }}>
                {isConnected ? "SPEAK OR TYPE TO BEGIN" : <span className="os-proc-dots">CONNECTING...</span>}
              </div>
              {!isConnected && <div className="os-orbital-loader" style={{ width: 44, height: 44 }} />}
            </div>
          )}
          {messages.map((msg: any) => {
            const plan = getPlanFromMessage(msg, messages);
            const hasPlan = plan !== null;
            return (
              <MobileBubble
                key={msg.id}
                msg={msg}
                hasPlan={hasPlan}
                onTapForPlan={() => {
                  if (plan) setSelectedPlan(plan);
                }}
              />
            );
          })}
          <div ref={chatEndRef} />
        </div>

        {/* Pinned Bottom Bar Container */}
        <div style={{
          position: "relative",
          flexShrink: 0,
          zIndex: 20,
          display: "flex",
          flexDirection: "column",
          background: (isTaskRunning || selectedPlan) ? "rgba(8,12,10,0.97)" : "rgba(8,12,10,0.72)",
          borderTop: (isTaskRunning || selectedPlan) ? "1.5px solid var(--border-accent)" : "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: (isTaskRunning || selectedPlan) ? "20px 20px 0 0" : "0",
          boxShadow: (isTaskRunning || selectedPlan) ? "0 -4px 32px rgba(0,230,160,0.12)" : "none",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          overflow: "hidden",
          paddingBottom: "max(env(safe-area-inset-bottom), 10px)",
          transition: "background 0.3s ease, border-radius 0.3s ease, box-shadow 0.3s ease, border-top 0.3s ease",
        }}>
          {/* Execution Sheet inside the bottom bar container to merge them */}
          <AnimatePresence>
            {(isTaskRunning || selectedPlan) && (
              <ExecutionSheet
                plan={isTaskRunning ? (activeTab?.currentPlan ?? null) : selectedPlan}
                taskPaused={taskPaused}
                activeThreadId={activeThreadId}
                isLive={isTaskRunning}
                onClose={() => setSelectedPlan(null)}
              />
            )}
          </AnimatePresence>

          {/* Background glowing blurred waveform */}
          <BackgroundGlow voiceState={voiceState} />

          {/* Voice State / Transcript Text (inline inside bottom bar) */}
          <AnimatePresence>
            {(isListening || voiceState === "processing" || voiceState === "speaking") && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                style={{
                  position: "relative",
                  zIndex: 2,
                  padding: "10px 16px 2px 16px",
                  display: "flex",
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 10, color: "var(--accent)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em", fontWeight: "bold" }}>
                    {voiceState === "listening" ? "// LISTENING" : voiceState === "processing" ? "// THINKING" : "// SPEAKING"}
                  </div>
                  {voiceState === "listening" && currentTranscript && (
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontStyle: "italic" }}>
                      "{currentTranscript}"
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 8, color: "var(--text-muted)", fontFamily: "var(--font-mono)", flexShrink: 0, marginLeft: 8 }}>TAP MIC TO STOP</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Main input row as a form to enable autocomplete suggestions */}
          <form
            onSubmit={(e) => { e.preventDefault(); handleTextSend(); }}
            style={{
              position: "relative",
              zIndex: 2,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px 0 12px",
              margin: 0,
              width: "100%",
              boxSizing: "border-box",
            }}
          >
            <motion.button type="button" onClick={toggleVoice} whileTap={{ scale: 0.9 }} style={{
              width: 44, height: 44, borderRadius: "50%",
              background: isListening ? "var(--accent)" : voiceState === "speaking" ? "rgba(66,133,244,0.2)" : "rgba(255,255,255,0.06)",
              border: `1.5px solid ${isListening ? "var(--accent)" : voiceState === "speaking" ? "#4285f4" : "var(--border)"}`,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              boxShadow: isListening ? "0 0 16px var(--accent-glow)" : "none",
            }}>
              {isListening ? <MicOff size={18} color="#000" /> : <Mic size={18} color={voiceState === "speaking" ? "#4285f4" : "var(--text-secondary)"} />}
            </motion.button>

            <input
              ref={inputRef}
              type="text"
              autoComplete="on"
              autoCorrect="on"
              spellCheck={true}
              autoCapitalize="sentences"
              value={isListening ? (currentTranscript || "") : textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleTextSend(); } }}
              placeholder={
                !isConnected ? "Connecting..." :
                  isTaskRunning ? "Task running..." :
                    voiceState === "listening" ? "Listening..." :
                      voiceState === "processing" ? "Thinking..." :
                        voiceState === "speaking" ? "Speaking..." :
                          "Message OpenSarthi..."
              }
              disabled={!isConnected || isTaskRunning || isListening}
              style={{
                flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)",
                borderRadius: 22, padding: "10px 16px", fontSize: 14,
                color: "var(--text-primary)", fontFamily: "inherit", outline: "none",
                opacity: (isTaskRunning || isListening) ? 0.5 : 1,
              }}
            />

            <motion.button type="submit" disabled={!textInput.trim() || !isConnected || isTaskRunning} whileTap={{ scale: 0.88 }} style={{
              width: 44, height: 44, borderRadius: "50%",
              background: textInput.trim() && isConnected && !isTaskRunning ? "var(--accent)" : "rgba(255,255,255,0.05)",
              border: `1.5px solid ${textInput.trim() && isConnected && !isTaskRunning ? "var(--accent)" : "var(--border)"}`,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              cursor: (!textInput.trim() || !isConnected || isTaskRunning) ? "not-allowed" : "pointer",
            }}>
              <Send size={16} color={textInput.trim() && isConnected && !isTaskRunning ? "#000" : "var(--text-muted)"} style={{ transform: "rotate(-15deg)" }} />
            </motion.button>
          </form>
        </div>
      </div>
    </>
  );
}
