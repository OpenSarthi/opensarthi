import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Settings, Activity, History, MessageSquarePlus, Wrench, Cpu, Plus, X, Minimize2 } from "lucide-react";
import { VoiceButton } from "./VoiceButton";
import { Waveform } from "./Waveform";
import { ParticleBackground } from "./ParticleBackground";
import { TranscriptView } from "./TranscriptView";
import { MessageList } from "./ResponseBubble";
import { ActionLog } from "../execution/ActionLog";
import { TaskList } from "./TaskList";
import { useAssistantStore } from "../../stores/assistantStore";
import { wsClient } from "../../lib/ws";
import pkg from "../../../package.json";

const getBuildTarget = (): string => {
  const userAgent = window.navigator.userAgent.toLowerCase();
  const platform = window.navigator.platform?.toLowerCase() || "";

  if (userAgent.includes("win") || platform.includes("win")) return "WINDOWS BUILD";
  if (userAgent.includes("mac") || platform.includes("mac")) return "MACOS BUILD";
  if (userAgent.includes("android")) return "ANDROID BUILD";
  if (userAgent.includes("iphone") || userAgent.includes("ipad")) return "IOS BUILD";
  if (userAgent.includes("linux") || platform.includes("linux")) return "LINUX BUILD";
  if (userAgent.includes("web") || platform.includes("web")) return "WEB BUILD";
  return "SYSTEM BUILD";
};

interface AssistantOverlayProps {
  onOpenSettings: () => void;
  onOpenHistory: () => void;
  onOpenCustomizer: () => void;
  onOpenMcpSettings: () => void;
  onOpenJsonImport: () => void;
  onOpenContext: () => void;
  onNewChat?: () => void;
}

export function AssistantOverlay({ onOpenSettings, onOpenHistory, onOpenCustomizer, onOpenMcpSettings, onOpenJsonImport, onOpenContext, onNewChat }: AssistantOverlayProps) {
  const [textInput, setTextInput] = useState("");
  const [statusIdx, setStatusIdx] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  const {
    voiceState, isConnected, currentTranscript,
    messages, currentPlan, activeLocalModel, activeCloudModel, activeProvider,
    tokenUsage, globalSessionTokens, taskPaused, isOverlayMode, snapAlign,
    setVoiceState, addMessage,
    tabs, activeThreadId, addTab, removeTab, setActiveThreadId
  } = useAssistantStore();

  const modelKey = activeProvider === "ollama" || activeProvider === "local" ? activeLocalModel : activeCloudModel;
  const globalSessionCount = globalSessionTokens[modelKey] || 0;

  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const setupListener = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const appWindow = getCurrentWindow();
        const max = await appWindow.isMaximized();
        setIsMaximized(max);

        const unsub = await appWindow.onResized(async () => {
          const m = await appWindow.isMaximized();
          setIsMaximized(m);
        });
        unlisten = unsub;
      } catch (err) {
        console.warn("Failed to check or listen to window maximized state", err);
      }
    };
    setupListener();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Ref map: message id → DOM element for scroll-to
  const messageRefsMap = useRef<Record<string, HTMLDivElement | null>>({});
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const taskRefsMap = useRef<Record<string, HTMLDivElement | null>>({});

  // Leetcode-style Draggable Panel Resizing State
  const [leftWidth, setLeftWidth] = useState(260); // Default Left panel width in px
  const [rightWidth, setRightWidth] = useState(240); // Default Right panel width in px

  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingLeft = useRef(false);
  const isDraggingRight = useRef(false);

  const resizeLeft = useCallback((e: MouseEvent) => {
    if (!isDraggingLeft.current) return;
    if (!containerRef.current) return;
    const containerWidth = containerRef.current.clientWidth;
    const maxAllowed = Math.floor(containerWidth * 0.4);
    const newWidth = Math.max(250, Math.min(maxAllowed, e.clientX - 12)); // bounds: min 250px, max 40% of container
    setLeftWidth(newWidth);
  }, []);

  const stopResizeLeft = useCallback(() => {
    isDraggingLeft.current = false;
    document.removeEventListener("mousemove", resizeLeft);
    document.removeEventListener("mouseup", stopResizeLeft);
  }, [resizeLeft]);

  const startResizeLeft = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingLeft.current = true;
    document.addEventListener("mousemove", resizeLeft);
    document.addEventListener("mouseup", stopResizeLeft);
  }, [resizeLeft, stopResizeLeft]);

  const resizeRight = useCallback((e: MouseEvent) => {
    if (!isDraggingRight.current) return;
    if (!containerRef.current) return;
    const containerWidth = containerRef.current.clientWidth;
    const maxAllowed = Math.floor(containerWidth * 0.35);
    const newWidth = Math.max(230, Math.min(maxAllowed, containerWidth - e.clientX - 12)); // bounds: min 230px, max 35% of container
    setRightWidth(newWidth);
  }, []);

  const stopResizeRight = useCallback(() => {
    isDraggingRight.current = false;
    document.removeEventListener("mousemove", resizeRight);
    document.removeEventListener("mouseup", stopResizeRight);
  }, [resizeRight]);

  const startResizeRight = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRight.current = true;
    document.addEventListener("mousemove", resizeRight);
    document.addEventListener("mouseup", stopResizeRight);
  }, [resizeRight, stopResizeRight]);

  // Handle window resizing to dynamically constrain sidepanels
  useEffect(() => {
    const handleWindowResize = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth;
      setLeftWidth(prev => Math.max(250, Math.min(prev, Math.floor(w * 0.38))));
      setRightWidth(prev => Math.max(230, Math.min(prev, Math.floor(w * 0.33))));
    };
    window.addEventListener("resize", handleWindowResize);
    // Debounce/delay initial call slightly to ensure DOM is fully ready
    const timer = setTimeout(handleWindowResize, 60);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
      clearTimeout(timer);
    };
  }, []);

  // Clean up global listeners on unmount
  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", resizeLeft);
      document.removeEventListener("mouseup", stopResizeLeft);
      document.removeEventListener("mousemove", resizeRight);
      document.removeEventListener("mouseup", stopResizeRight);
    };
  }, [resizeLeft, stopResizeLeft, resizeRight, stopResizeRight]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentTranscript]);

  const lastSentSourceRef = useRef<"text" | "voice">("text");

  const handleVoiceClick = useCallback(() => {
    if (voiceState === "idle" || voiceState === "error") {
      setVoiceState("listening");
      // Clean slate on toggle
      setTextInput("");
      useAssistantStore.getState().setTranscript("");
      wsClient.send("voice_state", { state: "listening" });
    } else if (voiceState === "listening") {
      setVoiceState("idle");
      wsClient.send("voice_state", { state: "idle" });
    } else if (voiceState === "speaking") {
      wsClient.send("stop_speech", {});
      const { continuousListening } = useAssistantStore.getState();
      setVoiceState(continuousListening ? "listening" : "idle");
    }
  }, [voiceState, setVoiceState]);

  const handleVoiceSend = useCallback((msg: string) => {
    if (!msg || !isConnected) return;
    lastSentSourceRef.current = "voice";
    addMessage({ id: crypto.randomUUID(), role: "user", content: msg, timestamp: Date.now() });
    wsClient.send("user_message", { text: msg, source: "voice", thread_id: activeThreadId });
    setTextInput("");
    setVoiceState("processing");
  }, [isConnected, setVoiceState, addMessage, activeThreadId]);

  const handleTextSend = useCallback(() => {
    const msg = textInput.trim();
    if (!msg || !isConnected) return;
    lastSentSourceRef.current = "text";
    addMessage({ id: crypto.randomUUID(), role: "user", content: msg, timestamp: Date.now() });
    wsClient.send("user_message", { text: msg, source: "text", thread_id: activeThreadId });
    setTextInput("");
    setVoiceState("processing");
  }, [textInput, isConnected, setVoiceState, addMessage, activeThreadId]);

  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Synchronize dynamic voice transcripts to the text prompt and auto-send on silence
  useEffect(() => {
    if (voiceState === "listening") {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

      if (currentTranscript && currentTranscript.trim()) {
        setTextInput(currentTranscript);
      }

      silenceTimerRef.current = setTimeout(() => {
        const finalMsg = currentTranscript ? currentTranscript.trim() : "";
        if (finalMsg) {
          handleVoiceSend(finalMsg);
        } else {
          setVoiceState("idle");
        }
      }, (currentTranscript && currentTranscript.trim()) ? 1500 : 10000); // 10s wait for STT lag after wake word, 1.5s for snappy speech silence!
    } else {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    }

    return () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    };
  }, [currentTranscript, voiceState, handleVoiceSend, setVoiceState]);

  // Native Text-to-Speech (TTS) for voice input replies
  useEffect(() => {
    try {
      if (messages && messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        if (
          lastMsg &&
          lastMsg.role === "assistant" &&
          lastSentSourceRef.current === "voice" &&
          lastMsg.content
        ) {
          let textToSpeak = String(lastMsg.content);

          // Strip <think>...</think> block completely
          textToSpeak = textToSpeak.replace(/<think>[\s\S]*?<\/think>/g, "");

          // If there's an unclosed <think>, the model is still thinking — wait
          if (textToSpeak.includes("<think>")) {
            return;
          }

          // Strip markdown code blocks (including JSON plans)
          let clean = textToSpeak.replace(/```[\s\S]*?```/g, "");

          // Strip raw JSON array blocks (in case LLM output JSON without backticks)
          clean = clean.replace(/\[\s*\{[\s\S]*\}\s*\]/g, "");

          // Strip inline code, markdown formatting
          clean = clean
            .replace(/`([^`]+)`/g, "$1")
            .replace(/[*#_\-]/g, "")
            .replace(/^\s*[✓✗❌⚠️]+\s*/gm, "")  // Strip status emojis/bullets
            .trim();

          if (clean) {
            wsClient.send("speak_text", { text: clean, manual: false });
          }
          lastSentSourceRef.current = "text"; // reset expectation
        }
      }
    } catch (err) {
      console.error("Speech Synthesis error caught safely:", err);
    }
  }, [messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleTextSend(); }
  };

  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const getFormattedTime = () => {
    return time.toLocaleTimeString('en-US', { hour12: false });
  };

  const handleNewThread = () => {
    onNewChat?.();
    const newId = crypto.randomUUID();
    addTab(newId);
    wsClient.send("load_thread", { thread_id: newId });
  };



  const isTaskRunning = !!currentPlan;

  const STATUS_LINES = [
    "SYSTEM READY",
    "NEURAL CORE ONLINE",
    "ALL SYSTEMS NOMINAL",
    "AWAITING YOUR COMMAND",
    "AGENT PROTOCOLS ACTIVE",
    "VOICE INTERFACE STANDBY",
    "AI ENGINE INITIALIZED",
  ];

  useEffect(() => {
    if (messages.length > 0 || !isConnected) return;
    const t = setInterval(() => setStatusIdx((i) => (i + 1) % STATUS_LINES.length), 2200);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, isConnected]);

  if (isOverlayMode) {
    return (
      <div
        className="hud-panel animate-fade-in"
        style={{
          width: "100vw",
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-glass)",
          backdropFilter: "var(--blur-glass)",
          WebkitBackdropFilter: "var(--blur-glass)",
          border: "1.5px solid var(--border-accent)",
          boxShadow: "0 0 20px var(--accent-glow), inset 0 0 12px rgba(255,255,255,0.02)",
          padding: "12px",
          gap: "10px",
          overflow: "hidden",
          borderTopLeftRadius: snapAlign === "right" || snapAlign === "none" ? "16px" : "0px",
          borderBottomLeftRadius: snapAlign === "right" || snapAlign === "none" ? "16px" : "0px",
          borderTopRightRadius: snapAlign === "left" || snapAlign === "none" ? "16px" : "0px",
          borderBottomRightRadius: snapAlign === "left" || snapAlign === "none" ? "16px" : "0px",
        }}
      >
        {/* Drag handle header / top bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
            cursor: "grab",
            paddingBottom: "8px",
            borderBottom: "1px solid var(--border)",
            userSelect: "none",
          }}
          onMouseDown={async () => {
            try {
              const { getCurrentWindow } = await import("@tauri-apps/api/window");
              getCurrentWindow().startDragging();
            } catch (err) {
              console.warn("Drag error:", err);
            }
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {/* Grab Dots Indicator */}
            <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginRight: "4px", opacity: 0.5 }}>
              <div style={{ display: "flex", gap: "2px" }}>
                <div style={{ width: "3px", height: "3px", borderRadius: "50%", background: "var(--text-secondary)" }} />
                <div style={{ width: "3px", height: "3px", borderRadius: "50%", background: "var(--text-secondary)" }} />
              </div>
              <div style={{ display: "flex", gap: "2px" }}>
                <div style={{ width: "3px", height: "3px", borderRadius: "50%", background: "var(--text-secondary)" }} />
                <div style={{ width: "3px", height: "3px", borderRadius: "50%", background: "var(--text-secondary)" }} />
              </div>
              <div style={{ display: "flex", gap: "2px" }}>
                <div style={{ width: "3px", height: "3px", borderRadius: "50%", background: "var(--text-secondary)" }} />
                <div style={{ width: "3px", height: "3px", borderRadius: "50%", background: "var(--text-secondary)" }} />
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--accent)" }}>
              <Activity size={14} className="animate-glow" />
              <span style={{ fontSize: "12px", fontWeight: "bold", letterSpacing: "0.08em" }}>
                SARTHI ACTIVE
              </span>
            </div>
          </div>

          <div style={{ display: "flex", gap: "6px", alignItems: "center" }} onMouseDown={(e) => e.stopPropagation()}>
            {/* Expand / Restore Button */}
            <button
              onClick={() => useAssistantStore.getState().setOverlayMode(false)}
              title="Expand to Full View"
              style={{
                width: "24px",
                height: "24px",
                borderRadius: "3px",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
              }}
            >
              {/* Maximize/Expand Icon */}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
            </button>
          </div>
        </div>

        {/* Token Tracking Dashboard */}
        <div style={{
          background: "rgba(0, 0, 0, 0.4)",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          padding: "8px 10px",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          fontSize: "11px",
          fontFamily: "var(--font-mono)",
          boxShadow: "inset 0 1px 5px rgba(0,0,0,0.5)",
          flexShrink: 0
        }}>
          {/* <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-secondary)", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "4px" }}>
            <span>📊 RESOURCE MONITOR</span>
            <span className="animate-pulse" style={{ color: "var(--accent)" }}>● LIVE</span>
          </div> */}
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--text-muted)" }}>Run Tokens:</span>
            <span style={{ color: "var(--accent)", fontWeight: "bold" }}>{tokenUsage.totalTokens.toLocaleString()}</span>
          </div>
          {/* <div style={{ display: "flex", gap: "12px", color: "var(--text-secondary)" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: "9px", color: "var(--text-muted)", textTransform: "uppercase" }}>Prompt</span>
              <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{tokenUsage.requestTokens.toLocaleString()}</span>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: "9px", color: "var(--text-muted)", textTransform: "uppercase" }}>Completion</span>
              <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{tokenUsage.responseTokens.toLocaleString()}</span>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: "9px", color: "var(--text-muted)", textTransform: "uppercase" }}>Session</span>
              <span style={{ color: "var(--accent)", fontWeight: 500 }}>{globalSessionCount.toLocaleString()}</span>
            </div>
          </div> */}
        </div>

        {/* Plan / Execution Steps View */}
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px", minHeight: 0 }}>
          <div className="hud-panel-title" style={{ fontSize: "11px", borderBottom: "none", padding: "2px 4px" }}>
            // PROGRESS & ACTIVITY
          </div>

          {currentPlan ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "4px" }}>
              {/* Goal Card */}
              <div style={{
                background: "rgba(255, 255, 255, 0.02)",
                border: "1px solid rgba(255, 255, 255, 0.05)",
                borderRadius: "6px",
                padding: "8px 10px",
                display: "flex",
                flexDirection: "column",
                gap: "4px"
              }}>
                <span style={{ fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Current Directive</span>
                <div className="selectable" style={{ fontSize: "12px", color: "var(--accent)", fontWeight: 600, lineHeight: "1.4" }}>
                  {currentPlan.goal}
                </div>
              </div>

              {/* Execution action log timeline */}
              <ActionLog plan={currentPlan} selectedTaskId={null} messages={messages} />
            </div>
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", fontSize: "12px", textAlign: "center", padding: "16px" }}>
              Waiting for tasks to execute...
            </div>
          )}
        </div>

        {/* Live Audio / TTS visualizer visual */}
        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: "8px", borderTop: "1px solid var(--border)", paddingTop: "8px" }}>
          {isTaskRunning && (
            <div style={{ display: "flex", gap: "8px" }}>
              {/* Pause/Resume button */}
              <button
                onClick={() => {
                  if (taskPaused) {
                    wsClient.send("resume_execution", { thread_id: activeThreadId });
                  } else {
                    wsClient.send("pause_execution", { thread_id: activeThreadId });
                  }
                }}
                style={{
                  flex: 1,
                  padding: "6px",
                  fontSize: "11px",
                  fontWeight: "bold",
                  borderColor: taskPaused ? "var(--success)" : "var(--warning)",
                  color: taskPaused ? "var(--success)" : "var(--warning)",
                }}
              >
                {taskPaused ? "▶ RESUME" : "⏸ PAUSE"}
              </button>

              {/* Stop/Cancel button */}
              <button
                onClick={() => {
                  wsClient.send("cancel_execution", { thread_id: activeThreadId });
                }}
                style={{
                  flex: 1,
                  padding: "6px",
                  fontSize: "11px",
                  fontWeight: "bold",
                  borderColor: "var(--danger)",
                  color: "var(--danger)",
                }}
              >
                ■ STOP
              </button>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", color: "var(--text-secondary)" }}>
            <span>ONLINE: <span style={{ color: isConnected ? "var(--accent)" : "var(--text-muted)", fontWeight: "bold" }}>{isConnected ? "YES" : "NO"}</span></span>
            <span style={{ fontFamily: "var(--font-mono)" }}>{getFormattedTime()}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        width: "100vw", height: "100vh",
        display: "flex", flexDirection: "column",
        background: "var(--bg-primary)",
        padding: "12px",
        gap: "12px",
      }}
    >
      {/* ─── Top Bar ─── */}
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", color: "var(--accent)" }}>
          <Activity size={16} className={isConnected ? "animate-glow" : ""} />
          <span style={{ fontSize: "14px", fontWeight: "bold", letterSpacing: "0.1em", display: "flex", gap: "8px" }}>
            // OPENSARTHI - AN AI POWERED DESKTOP ASSISTANT AND AGENT
          </span>
          {/* State badge */}
          {voiceState === "listening" && (
            <span className="os-listen-ear" title="Listening" />
          )}
          {(voiceState === "processing" || isTaskRunning) && voiceState !== "listening" && (
            <span className="os-badge-pulse" style={{ fontSize: "10px", color: "var(--accent)", letterSpacing: "0.1em" }}>
              {isTaskRunning ? "AGENT ACTIVE" : "PROCESSING"}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {/* New Thread Button */}
          <motion.button
            onClick={handleNewThread}
            title="New Thread"
            whileHover={{ scale: 1.05, color: "var(--accent)", borderColor: "var(--accent)", boxShadow: "0 0 8px var(--accent-glow)" }}
            whileTap={{ scale: 0.95 }}
            style={{
              height: "32px",
              width: isMaximized ? "auto" : "32px",
              padding: isMaximized ? "0 12px" : "0",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: isMaximized ? "6px" : "0",
              borderRadius: "4px",
              background: "rgba(0,0,0,0.3)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              transition: "all 0.2s"
            }}
          >
            <motion.div whileHover={{ scale: 1.15, y: -1 }} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <MessageSquarePlus size={14} />
            </motion.div>
            {isMaximized && <span style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.02em" }}>New Thread</span>}
          </motion.button>

          {/* History Button */}
          <motion.button
            onClick={onOpenHistory}
            title="Past Threads"
            whileHover={{ scale: 1.05, color: "var(--accent)", borderColor: "var(--accent)", boxShadow: "0 0 8px var(--accent-glow)" }}
            whileTap={{ scale: 0.95 }}
            style={{
              height: "32px",
              width: isMaximized ? "auto" : "32px",
              padding: isMaximized ? "0 12px" : "0",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: isMaximized ? "6px" : "0",
              borderRadius: "4px",
              background: "rgba(0,0,0,0.3)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              transition: "all 0.2s"
            }}
          >
            <motion.div whileHover={{ rotate: -15 }} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <History size={14} />
            </motion.div>
            {isMaximized && <span style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.02em" }}>Past Threads</span>}
          </motion.button>

          {/* Customise Persona Button */}
          <motion.button
            onClick={onOpenCustomizer}
            title="Customise Persona"
            whileHover={{ scale: 1.05, color: "var(--accent)", borderColor: "var(--accent)", boxShadow: "0 0 8px var(--accent-glow)" }}
            whileTap={{ scale: 0.95 }}
            style={{
              height: "32px",
              width: isMaximized ? "auto" : "32px",
              padding: isMaximized ? "0 12px" : "0",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: isMaximized ? "6px" : "0",
              borderRadius: "4px",
              background: "rgba(0,0,0,0.3)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              transition: "all 0.2s"
            }}
          >
            <motion.div whileHover={{ rotate: 30 }} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Wrench size={14} />
            </motion.div>
            {isMaximized && <span style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.02em" }}>Customise</span>}
          </motion.button>



          {/* MCP Settings Button */}
          <motion.button
            onClick={onOpenMcpSettings}
            title="MCP Settings"
            whileHover={{ scale: 1.05, color: "var(--accent)", borderColor: "var(--accent)", boxShadow: "0 0 8px var(--accent-glow)" }}
            whileTap={{ scale: 0.95 }}
            style={{
              height: "32px",
              width: isMaximized ? "auto" : "32px",
              padding: isMaximized ? "0 12px" : "0",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: isMaximized ? "6px" : "0",
              borderRadius: "4px",
              background: "rgba(0,0,0,0.3)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              transition: "all 0.2s"
            }}
          >
            <motion.div whileHover={{ scale: 1.15 }} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Cpu size={14} />
            </motion.div>
            {isMaximized && <span style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.02em" }}>MCP Settings</span>}
          </motion.button>

          {/* Settings Button */}
          <motion.button
            onClick={onOpenSettings}
            title="Settings"
            whileHover={{ scale: 1.05, color: "var(--accent)", borderColor: "var(--accent)", boxShadow: "0 0 8px var(--accent-glow)" }}
            whileTap={{ scale: 0.95 }}
            style={{
              height: "32px",
              width: isMaximized ? "auto" : "32px",
              padding: isMaximized ? "0 12px" : "0",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: isMaximized ? "6px" : "0",
              borderRadius: "4px",
              background: "rgba(0,0,0,0.3)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              transition: "all 0.2s"
            }}
          >
            <motion.div whileHover={{ rotate: 90 }} transition={{ type: "spring", stiffness: 200 }} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Settings size={14} />
            </motion.div>
            {isMaximized && <span style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.02em" }}>Settings</span>}
          </motion.button>

          {/* Minimise to Sidebar Button */}
          <motion.button
            onClick={() => useAssistantStore.getState().setOverlayMode(true)}
            title="Minimise to Sidebar Overlay"
            whileHover={{ scale: 1.05, color: "var(--accent)", borderColor: "var(--accent)", boxShadow: "0 0 8px var(--accent-glow)" }}
            whileTap={{ scale: 0.95 }}
            style={{
              height: "32px",
              width: isMaximized ? "auto" : "32px",
              padding: isMaximized ? "0 12px" : "0",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: isMaximized ? "6px" : "0",
              borderRadius: "4px",
              background: "rgba(0,0,0,0.3)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              transition: "all 0.2s"
            }}
          >
            <motion.div whileHover={{ scale: 1.15 }} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Minimize2 size={14} />
            </motion.div>
            {isMaximized && <span style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.02em" }}>Minimise</span>}
          </motion.button>
        </div>
      </div>

      {/* ─── Main Content HUD ─── */}
      <AnimatePresence>
        <motion.div
          ref={containerRef}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1, flex: 1 }}
          exit={{ height: 0, opacity: 0 }}
          style={{ display: "flex", gap: "0px", overflow: "visible", flex: 1, position: "relative", minHeight: 0 }}
        >
          {/* LEFT PANEL */}
          <div style={{ width: `${leftWidth}px`, flexShrink: 0, display: "flex", flexDirection: "column", gap: "16px" }}>
            <div className="hud-panel" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div className="hud-panel-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>// AGENT TASKS</span>
                <button
                  id="json-import-btn"
                  title="Import JSON Task Plan"
                  onClick={onOpenJsonImport}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 20, height: 20, borderRadius: 4,
                    background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)",
                    color: "rgba(255,255,255,0.5)", cursor: "pointer",
                    padding: 0, transition: "all 0.15s",
                  }}
                  onMouseOver={e => { e.currentTarget.style.background = "rgba(255,255,255,0.14)"; e.currentTarget.style.color = "white"; }}
                  onMouseOut={e => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; e.currentTarget.style.color = "rgba(255,255,255,0.5)"; }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                </button>
              </div>
              <div style={{ padding: "10px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column" }}>
                <TaskList
                  messages={messages}
                  voiceState={voiceState}
                  hasActivePlan={!!currentPlan}
                  currentPlan={currentPlan}
                  selectedTaskId={selectedTaskId}
                  setSelectedTaskId={setSelectedTaskId}
                  taskRefsMap={taskRefsMap}
                  onScrollToMessage={(msgId) => {
                    const el = messageRefsMap.current[msgId];
                    if (el) {
                      el.scrollIntoView({ behavior: "smooth", block: "start" });
                      el.style.outline = "1px solid var(--accent)";
                      setTimeout(() => { el.style.outline = "none"; }, 1500);
                    }
                  }}
                />
              </div>
            </div>
            <div className="hud-panel" style={{ height: "180px", display: "flex", flexDirection: "column", flexShrink: 0 }}>
              <div className="hud-panel-title">// AGENT STATUS & SYSTEMS</div>
              <div style={{ padding: "12px", fontSize: "12px", color: "var(--text-secondary)", flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                <div>PROVIDER: <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>{activeProvider}</span></div>
                <div>LLM: <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>{activeProvider === "ollama" ? activeLocalModel : activeCloudModel}</span></div>
                <div style={{ borderTop: "1px dashed rgba(255,255,255,0.08)", marginTop: "4px", paddingTop: "4px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>TOKEN USAGE:</span>
                    <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>{tokenUsage.sessionTotalTokens}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px" }}>
                    <span>SESSION TOTAL:</span>
                    <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>{globalSessionCount}</span>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "auto", borderTop: "1px solid var(--border)", paddingTop: "6px", marginBottom: "10px" }}>
                  <span>VOICE INPUT:</span>
                  <span style={{ color: voiceState !== "idle" ? "var(--accent)" : "var(--text-secondary)" }}>{voiceState.toUpperCase()}</span>
                </div>
              </div>
            </div>
          </div>

          {/* LEFT PANEL DRAG HANDLE */}
          <div
            onMouseDown={startResizeLeft}
            style={{
              width: "12px",
              cursor: "col-resize",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10,
              position: "relative",
              flexShrink: 0,
            }}
            className="panel-splitter"
          >
            <div
              style={{
                width: "2px",
                height: "36px",
                background: "var(--border)",
                borderRadius: "1px",
                transition: "all 0.2s",
              }}
              className="splitter-bar"
            />
          </div>

          {/* CENTER PANEL */}
          <div className="hud-panel" style={{ flex: "1 1 0%", minWidth: "320px", display: "flex", flexDirection: "column" }}>
            <div className="hud-panel-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 8px 0 0", height: "36px", overflow: "visible", gap: "8px" }}>
              {/* Scrollable Tabs Wrapper */}
              <div 
                style={{ 
                  display: "flex", 
                  alignItems: "flex-end", 
                  flex: 1, 
                  minWidth: 0,
                  height: "100%", 
                  overflowX: "auto", 
                  scrollbarWidth: "none", 
                  gap: "6px",
                  paddingLeft: "16px"
                }}
                className="chrome-tabs-container"
                onWheel={(e) => {
                  e.currentTarget.scrollLeft += e.deltaY;
                }}
              >
                {tabs.map((tab) => {
                  const isActive = tab.id === activeThreadId;
                  const isRunning = !!tab.currentPlan;
                  return (
                    <div
                      key={tab.id}
                      onClick={() => setActiveThreadId(tab.id)}
                      className={`chrome-tab ${isActive ? "active" : ""}`}
                      style={{
                        height: "30px",
                        display: "flex",
                        alignItems: "center",
                        padding: "0 16px",
                        cursor: "pointer",
                        color: isActive ? "var(--accent)" : "var(--text-secondary)",
                        fontWeight: isActive ? "bold" : "normal",
                        fontSize: "11px",
                        letterSpacing: "0.02em",
                        position: "relative",
                        minWidth: "120px",
                        maxWidth: "180px",
                        gap: "8px",
                        justifyContent: "space-between",
                        flexShrink: 0
                      }}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, zIndex: 2 }}>
                        {isRunning ? "⚡ " : ""}// {tab.title.replace(/^\/\/\s*/, "").toUpperCase()}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTab(tab.id);
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "inherit",
                          padding: "2px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: "50%",
                          cursor: "pointer",
                          opacity: isActive ? 0.95 : 0.6,
                          transition: "opacity 0.15s, background-color 0.15s",
                          zIndex: 2
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.opacity = "1";
                          e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.15)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.opacity = isActive ? "0.95" : "0.6";
                          e.currentTarget.style.backgroundColor = "transparent";
                        }}
                      >
                        <X size={10} style={{ strokeWidth: 2.5 }} />
                      </button>
                    </div>
                  );
                })}

                {/* Chrome plus icon button */}
                <button
                  onClick={handleNewThread}
                  title="New Tab"
                  style={{
                    height: "26px",
                    width: "26px",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid var(--border)",
                    color: "var(--text-secondary)",
                    cursor: "pointer",
                    marginLeft: "6px",
                    marginBottom: "3px",
                    transition: "all 0.2s",
                    flexShrink: 0
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--accent)";
                    e.currentTarget.style.color = "#000";
                    e.currentTarget.style.boxShadow = "0 0 8px var(--accent)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                    e.currentTarget.style.color = "var(--text-secondary)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  <Plus size={14} />
                </button>
              </div>

              {/* Divider left to Context Button */}
              <div style={{
                width: "1px",
                height: "22px",
                background: "rgba(255, 255, 255, 0.15)",
                margin: "0 4px 0 4px",
                flexShrink: 0
              }} />

              {/* Right Most - Context Button (Icon only, larger) */}
              <div style={{ display: "flex", alignItems: "center", paddingLeft: "2px", flexShrink: 0 }}>
                {isTaskRunning && (
                  <span className="animate-pulse" style={{ fontSize: "10px", color: "var(--accent)", fontWeight: "bold", marginRight: "8px" }}>● ACTIVE</span>
                )}
                <button
                  onClick={onOpenContext}
                  title="Agent System Context"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "28px",
                    height: "28px",
                    background: "rgba(0, 230, 180, 0.1)",
                    color: "var(--accent)",
                    border: "1px solid rgba(0, 230, 180, 0.2)",
                    borderRadius: "4px",
                    cursor: "pointer",
                    transition: "all 0.2s"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(0, 230, 180, 0.2)";
                    e.currentTarget.style.borderColor = "var(--accent)";
                    e.currentTarget.style.boxShadow = "0 0 8px var(--accent-glow)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(0, 230, 180, 0.1)";
                    e.currentTarget.style.borderColor = "rgba(0, 230, 180, 0.2)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  <Cpu size={16} />
                </button>
              </div>
            </div>
            <ParticleBackground voiceState={voiceState} />
            {/* Slow scan line sweep across the panel */}
            <div className="os-scan-line" />

            <div style={{ flex: 1, overflowY: "auto", padding: "16px", zIndex: 1 }} ref={chatScrollRef}>
              {messages.length === 0 && (
                <div style={{
                  height: "100%", display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: "28px",
                  userSelect: "none",
                }}>
                  {/* Orbital loader — only show when not connected */}
                  {!isConnected && (
                    <div
                      className="os-orbital-loader"
                      style={{ opacity: 0.45, animationDuration: "1.4s" }}
                    />
                  )}

                  {/* Glitch title */}
                  <div
                    className="os-glitch"
                    data-text="OPENSARTHI"
                    style={{ fontSize: "18px" }}
                  >
                    OPENSARTHI
                  </div>

                  {/* Cycling status line */}
                  <div style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
                    color: "var(--text-secondary)",
                    letterSpacing: "0.22em",
                    textAlign: "center",
                    lineHeight: 1.8,
                  }}>
                    {isConnected ? (
                      <span key={statusIdx} className="os-status-fade">
                        // {STATUS_LINES[statusIdx]}
                      </span>
                    ) : (
                      <span className="os-proc-dots">// INITIALIZING PROTOCOL</span>
                    )}
                  </div>

                  {/* Subtle divider + hint */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", opacity: 0.55 }}>
                    <div style={{ width: "120px", height: "1px", background: "var(--accent)" }} />
                    <span style={{
                      fontSize: "11px",
                      color: "var(--accent)",
                      letterSpacing: "0.22em",
                      opacity: 0.8,
                    }}>
                      SPEAK OR TYPE TO BEGIN
                    </span>
                  </div>
                </div>
              )}
              <MessageList
                messages={messages}
                messageRefsMap={messageRefsMap}
                onSelectMessage={(msgId) => {
                  const idx = messages.findIndex(m => m.id === msgId);
                  if (idx === -1) return;

                  let userMsgId = "";
                  if (messages[idx].role === "user") {
                    userMsgId = messages[idx].id;
                  } else {
                    for (let j = idx; j >= 0; j--) {
                      if (messages[j].role === "user") {
                        userMsgId = messages[j].id;
                        break;
                      }
                    }
                  }

                  if (userMsgId) {
                    setSelectedTaskId(userMsgId);
                    const taskEl = taskRefsMap.current[userMsgId];
                    if (taskEl) {
                      taskEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
                      taskEl.style.outline = "1px solid var(--accent)";
                      setTimeout(() => {
                        if (taskEl) taskEl.style.outline = "none";
                      }, 1500);
                    }
                  }
                }}
              />
              <div ref={bottomRef} />
            </div>

            {/* INPUT BAR */}
            <div style={{
              padding: "16px", borderTop: "1px solid var(--border)",
              display: "flex", flexDirection: "column", gap: "0px", background: "rgba(0,0,0,0.4)", zIndex: 1
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                <VoiceButton voiceState={voiceState} onClick={handleVoiceClick} disabled={!isConnected} />
                <Waveform voiceState={voiceState} />
                <input
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={!isConnected ? "CONNECTING..." : isTaskRunning ? "TASK RUNNING..." : "ENTER COMMAND..."}
                  disabled={!isConnected || isTaskRunning}
                  style={{
                    flex: 1, background: "transparent", border: "none", borderBottom: "1px solid var(--border-accent)",
                    color: "var(--text-primary)", fontSize: "14px", fontFamily: "var(--font-mono)",
                    padding: "8px 4px", outline: "none",
                    opacity: isTaskRunning ? 0.4 : 1,
                  }}
                />
                <motion.button
                  onClick={handleTextSend}
                  disabled={!textInput.trim() || !isConnected || isTaskRunning}
                  whileHover={textInput.trim() && isConnected && !isTaskRunning ? { scale: 1.08, boxShadow: "0 0 10px var(--accent)" } : {}}
                  whileTap={textInput.trim() && isConnected && !isTaskRunning ? { scale: 0.94 } : {}}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "38px",
                    height: "38px",
                    borderRadius: "50%",
                    background: textInput.trim() && isConnected && !isTaskRunning ? "var(--accent)" : "rgba(255,255,255,0.05)",
                    color: textInput.trim() && isConnected && !isTaskRunning ? "#000" : "var(--text-muted)",
                    border: `1.5px solid ${textInput.trim() && isConnected && !isTaskRunning ? "var(--accent)" : "var(--border)"}`,
                    transition: "background 0.2s, color 0.2s, border-color 0.2s",
                    cursor: (!textInput.trim() || !isConnected || isTaskRunning) ? "not-allowed" : "pointer",
                    position: "relative",
                    overflow: "hidden",
                    flexShrink: 0,
                  }}
                >
                  <motion.div
                    animate={textInput.trim() && isConnected && !isTaskRunning ? { x: [0, 2, 0], y: [0, -2, 0] } : {}}
                    transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                    style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
                  >
                    <Send size={15} style={{ transform: "rotate(-15deg)" }} />
                  </motion.div>
                </motion.button>
              </div>
            </div>
          </div>

          {/* RIGHT PANEL DRAG HANDLE */}
          <div
            onMouseDown={startResizeRight}
            style={{
              width: "12px",
              cursor: "col-resize",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10,
              position: "relative",
              flexShrink: 0,
            }}
            className="panel-splitter"
          >
            <div
              style={{
                width: "2px",
                height: "36px",
                background: "var(--border)",
                borderRadius: "1px",
                transition: "all 0.2s",
              }}
              className="splitter-bar"
            />
          </div>

          {/* RIGHT PANEL */}
          <div style={{ width: `${rightWidth}px`, flexShrink: 0, display: "flex", flexDirection: "column", gap: "16px" }}>
            <div className="hud-panel" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div className="hud-panel-title">// LIVE PLAN & ACTIVITY</div>
              <div style={{ padding: "12px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: "12px" }}>
                <TranscriptView transcript={currentTranscript} />
                <ActionLog plan={currentPlan} selectedTaskId={selectedTaskId} messages={messages} />
              </div>
            </div>
            <div className="hud-panel" style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "8px", flexShrink: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                    {getBuildTarget()}
                  </div>
                  <div style={{ color: "var(--accent)", fontWeight: "bold", fontSize: "14px" }}>
                    OPENSARTHI V{pkg.version}
                  </div>
                </div>
                {/* Orbital loader animation in the empty space */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minWidth: "40px", minHeight: "14px", paddingRight: "4px" }}>
                  <div className="os-orbital-loader" style={{ width: "40px", height: "14px" }} />
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border)", paddingTop: "8px", marginTop: "4px" }}>
                <span style={{ fontSize: "12px", fontWeight: "bold", color: isConnected ? "var(--accent)" : "var(--text-secondary)" }}>
                  {isConnected ? "ONLINE" : "OFFLINE"}
                </span>
                <span style={{ fontSize: "14px", color: "var(--text-primary)", fontWeight: "bold", fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>
                  {getFormattedTime()}
                </span>
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
