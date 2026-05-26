import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Settings, Activity, History, MessageSquarePlus } from "lucide-react";
import { VoiceButton } from "./VoiceButton";
import { Waveform } from "./Waveform";
import { ParticleBackground } from "./ParticleBackground";
import { TranscriptView } from "./TranscriptView";
import { MessageList } from "./ResponseBubble";
import { ActionLog } from "../execution/ActionLog";
import { TaskList } from "./TaskList";
import { useAssistantStore } from "../../stores/assistantStore";
import { wsClient } from "../../lib/ws";

interface AssistantOverlayProps {
  onOpenSettings: () => void;
  onOpenHistory: () => void;
  onNewChat?: () => void;
}

export function AssistantOverlay({ onOpenSettings, onOpenHistory, onNewChat }: AssistantOverlayProps) {
  const [textInput, setTextInput] = useState("");
  const [statusIdx, setStatusIdx] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  const {
    voiceState, isConnected, currentTranscript,
    messages, currentPlan, activeLocalModel, activeCloudModel, activeProvider,
    tokenUsage, taskPaused,
    setVoiceState, addMessage, clearMessages
  } = useAssistantStore();

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
    wsClient.send("user_message", { text: msg, source: "voice" });
    setTextInput("");
    setVoiceState("processing");
  }, [isConnected, setVoiceState, addMessage]);

  const handleTextSend = useCallback(() => {
    const msg = textInput.trim();
    if (!msg || !isConnected) return;
    lastSentSourceRef.current = "text";
    addMessage({ id: crypto.randomUUID(), role: "user", content: msg, timestamp: Date.now() });
    wsClient.send("user_message", { text: msg, source: "text" });
    setTextInput("");
    setVoiceState("processing");
  }, [textInput, isConnected, setVoiceState, addMessage]);

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
            wsClient.send("speak_text", { text: clean });
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
    clearMessages();
    onNewChat?.();
    wsClient.send("new_chat", {}); // Let backend generate a new thread
  };

  const getThreadTitle = () => {
    const firstUserMsg = messages.find(m => m.role === "user");
    if (!firstUserMsg) return "// ACTIVE THREAD - EMPTY";

    const prompt = firstUserMsg.content;
    const p = prompt.toLowerCase().trim();

    let title = "ACTIVE THREAD";
    if (p.includes("update") || p.includes("upgrade")) title = "SYSTEM UPDATE";
    else if (p.includes("install") || p.includes("pacman -s") || p.includes("yay -s")) title = "INSTALL PACKAGE";
    else if (p.includes("remove") || p.includes("uninstall")) title = "REMOVE PACKAGE";
    else if (p.includes("reboot") || p.includes("restart")) title = "SYSTEM REBOOT";
    else if (p.includes("shutdown") || p.includes("poweroff")) title = "SYSTEM SHUTDOWN";
    else if (p.includes("search") || p.includes("find") || p.includes("grep")) title = "FILE SEARCH";
    else if (p.includes("open") || p.includes("launch") || p.includes("start")) title = "LAUNCH APP";
    else if (p.includes("create") || p.includes("write") || p.includes("mkdir") || p.includes("touch")) title = "CREATE FILE";
    else if (p.includes("kill") || p.includes("pkill")) title = "KILL PROCESS";
    else if (p.includes("shell") || p.includes("command") || p.includes("run") || p.includes("sudo")) title = "SHELL COMMAND";
    else if (p.includes("chrome") || p.includes("firefox") || p.includes("browser")) title = "OPEN BROWSER";
    else if (p.includes("type") || p.includes("click") || p.includes("press")) title = "UI AUTOMATION";
    else if (p.includes("brightness") || p.includes("volume") || p.includes("screen")) title = "SYSTEM CONTROL";
    else {
      const words = prompt.trim().split(/\s+/).slice(0, 3).map(w => w.replace(/[^a-zA-Z]/g, "").toUpperCase()).filter(Boolean);
      title = words.join(" ") || "AGENT RUN";
    }

    return `// THREAD: ${title}`;
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
          <motion.button
            onClick={onOpenHistory}
            title="Past Threads"
            whileHover={{ scale: 1.08, color: "var(--accent)", borderColor: "var(--accent)", boxShadow: "0 0 8px var(--accent-glow)" }}
            whileTap={{ scale: 0.95 }}
            style={{
              width: "32px",
              height: "32px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "4px",
              background: "rgba(0,0,0,0.3)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              transition: "border-color 0.2s, color 0.2s"
            }}
          >
            <motion.div whileHover={{ rotate: -15 }}>
              <History size={15} />
            </motion.div>
          </motion.button>

          <motion.button
            onClick={handleNewThread}
            title="New Thread"
            whileHover={{ scale: 1.08, color: "var(--accent)", borderColor: "var(--accent)", boxShadow: "0 0 8px var(--accent-glow)" }}
            whileTap={{ scale: 0.95 }}
            style={{
              width: "32px",
              height: "32px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "4px",
              background: "rgba(0,0,0,0.3)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              transition: "border-color 0.2s, color 0.2s"
            }}
          >
            <motion.div whileHover={{ scale: 1.15, y: -1 }}>
              <MessageSquarePlus size={15} />
            </motion.div>
          </motion.button>

          <motion.button
            onClick={onOpenSettings}
            title="Settings"
            whileHover={{ scale: 1.08, color: "var(--accent)", borderColor: "var(--accent)", boxShadow: "0 0 8px var(--accent-glow)" }}
            whileTap={{ scale: 0.95 }}
            style={{
              width: "32px",
              height: "32px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "4px",
              background: "rgba(0,0,0,0.3)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              transition: "border-color 0.2s, color 0.2s"
            }}
          >
            <motion.div whileHover={{ rotate: 90 }} transition={{ type: "spring", stiffness: 200 }}>
              <Settings size={15} />
            </motion.div>
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
              <div className="hud-panel-title">// AGENT TASKS</div>
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
            <div className="hud-panel" style={{ height: "170px", display: "flex", flexDirection: "column", flexShrink: 0 }}>
              <div className="hud-panel-title">// AGENT STATUS & SYSTEMS</div>
              <div style={{ padding: "12px", fontSize: "12px", color: "var(--text-secondary)", flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                <div>PROVIDER: <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>{activeProvider}</span></div>
                <div>LLM: <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>{activeProvider === "ollama" ? activeLocalModel : activeCloudModel}</span></div>
                <div style={{ borderTop: "1px dashed rgba(255,255,255,0.08)", marginTop: "4px", paddingTop: "4px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>TOKEN USAGE:</span>
                    <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>{tokenUsage.totalTokens}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px" }}>
                    <span>SESSION TOTAL:</span>
                    <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>{tokenUsage.sessionTotalTokens}</span>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "auto", borderTop: "1px solid var(--border)", paddingTop: "6px" }}>
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
            <div className="hud-panel-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{getThreadTitle()}</span>
              {isTaskRunning && (
                <span className="animate-pulse" style={{ fontSize: "10px", color: "var(--accent)", fontWeight: "bold", flexShrink: 0 }}>● ACTIVE</span>
              )}
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
                  {/* Orbital loader — used for both connected and connecting states */}
                  <div
                    className="os-orbital-loader"
                    style={isConnected ? {} : { opacity: 0.45, animationDuration: "1.4s" }}
                  />

                  {/* Glitch title */}
                  <div
                    className="os-glitch"
                    data-text="OPENSARTHI"
                    style={{ fontSize: "15px" }}
                  >
                    OPENSARTHI
                  </div>

                  {/* Cycling status line */}
                  <div style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
                    color: "var(--text-secondary)",
                    letterSpacing: "0.15em",
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
                    <div style={{ width: "80px", height: "1px", background: "var(--accent)" }} />
                    <span style={{
                      fontSize: "9px",
                      color: "var(--accent)",
                      letterSpacing: "0.22em",
                      opacity: 0.7,
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
              {/* Task running indicator */}
              {isTaskRunning && (
                <div style={{
                  display: "flex", alignItems: "center", gap: "6px",
                  padding: "6px 8px", marginBottom: "8px",
                  background: taskPaused ? "rgba(255,180,0,0.08)" : "rgba(var(--accent-rgb, 255,60,60),0.08)",
                  border: `1px solid ${taskPaused ? "rgba(255,180,0,0.2)" : "rgba(var(--accent-rgb, 255,60,60),0.15)"}`,
                  borderRadius: "var(--radius-sm)",
                  fontSize: "10px", fontWeight: "bold", letterSpacing: "0.06em",
                  color: taskPaused ? "hsl(40, 100%, 60%)" : "var(--accent)",
                }}>
                  {taskPaused ? "⏸ TASK PAUSED" : "⚡ TASK IN PROGRESS — INPUT LOCKED"}
                </div>
              )}
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
              <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                SYSTEM BUILD
              </div>
              <div style={{ color: "var(--accent)", fontWeight: "bold", fontSize: "16px" }}>
                OPENSARTHI 1.0
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
