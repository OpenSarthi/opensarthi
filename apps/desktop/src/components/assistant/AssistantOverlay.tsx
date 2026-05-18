import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Settings, Activity, History, MessageSquarePlus } from "lucide-react";
import { VoiceButton } from "./VoiceButton";
import { Waveform } from "./Waveform";
import { TranscriptView } from "./TranscriptView";
import { MessageList } from "./ResponseBubble";
import { ActionLog } from "../execution/ActionLog";
import { useAssistantStore } from "../../stores/assistantStore";
import { wsClient } from "../../lib/ws";

interface AssistantOverlayProps {
  onOpenSettings: () => void;
  onOpenHistory: () => void;
}

export function AssistantOverlay({ onOpenSettings, onOpenHistory }: AssistantOverlayProps) {
  const [textInput, setTextInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const {
    voiceState, isConnected, currentTranscript,
    messages, currentPlan, activeLocalModel, activeCloudModel,
    setVoiceState, addMessage, clearMessages
  } = useAssistantStore();

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
    } else if (voiceState === "listening") {
      setVoiceState("idle");
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
          // Strip markdown elements, code blocks, bullet formatting, for crystal clear voice reading
          const clean = String(lastMsg.content)
            .replace(/```[\s\S]*?```/g, "")
            .replace(/`([^`]+)`/g, "$1")
            .replace(/[*#_\-]/g, "")
            .trim();
          
          if (clean && typeof window !== "undefined" && window.speechSynthesis) {
            window.speechSynthesis.cancel(); // kill active speaking
            const utterance = new SpeechSynthesisUtterance(clean);
            utterance.rate = 1.0;
            utterance.pitch = 1.0;
            window.speechSynthesis.speak(utterance);
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

  const handleNewChat = () => {
    clearMessages();
    wsClient.send("new_chat", {}); // Let backend generate a new thread
  };

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
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={onOpenHistory} title="History" style={{ padding: "4px 8px" }}>
            <History size={14} />
          </button>
          <button onClick={handleNewChat} title="New Chat" style={{ padding: "4px 8px" }}>
            <MessageSquarePlus size={14} />
          </button>
          <button onClick={onOpenSettings} title="Settings" style={{ padding: "4px 8px" }}>
            <Settings size={14} />
          </button>
        </div>
      </div>

      {/* ─── Main Content HUD ─── */}
      <AnimatePresence>
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1, flex: 1 }}
          exit={{ height: 0, opacity: 0 }}
          style={{ display: "flex", gap: "16px", overflow: "hidden", flex: 1 }}
        >
          {/* LEFT PANEL */}
          <div style={{ flex: "0 0 25%", minWidth: "220px", maxWidth: "300px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <div className="hud-panel" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <div className="hud-panel-title">// TASKS - ACTIVE</div>
              <div style={{ padding: "12px", overflowY: "auto", flex: 1 }}>
                <ActionLog plan={currentPlan} />
              </div>
            </div>
            <div className="hud-panel" style={{ height: "160px", display: "flex", flexDirection: "column" }}>
              <div className="hud-panel-title">// AGENT STATUS & SYSTEMS</div>
              <div style={{ padding: "12px", fontSize: "12px", color: "var(--text-secondary)", flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                <div>LOCAL LLM: <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>{activeLocalModel}</span></div>
                <div>CLOUD LLM: <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>{activeCloudModel}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "auto", borderTop: "1px solid var(--border)", paddingTop: "6px" }}>
                  <span>VOICE INPUT:</span>
                  <span style={{ color: voiceState !== "idle" ? "var(--accent)" : "var(--text-secondary)" }}>{voiceState.toUpperCase()}</span>
                </div>
              </div>
            </div>
          </div>

          {/* CENTER PANEL */}
          <div className="hud-panel" style={{ flex: "1 1 auto", minWidth: "400px", display: "flex", flexDirection: "column" }}>
            <div style={{
              position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
              opacity: 0.05, pointerEvents: "none", display: "flex", flexDirection: "column", alignItems: "center"
            }}>
              <Activity size={180} color="var(--accent)" />
            </div>
            
            <div style={{ flex: 1, overflowY: "auto", padding: "16px", zIndex: 1 }}>
              {messages.length === 0 && (
                <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.6 }}>
                  <p style={{ color: "var(--text-secondary)", letterSpacing: "0.1em", whiteSpace: "pre-line", textAlign: "center" }}>
                    {isConnected ? "// OPENSARTHI INITIALIZED\nWAITING FOR COMMAND //" : "// INITIALIZING OPENSARTHI PROTOCOL..."}
                  </p>
                </div>
              )}
              <MessageList messages={messages} />
              <div ref={bottomRef} />
            </div>

            {/* INPUT BAR */}
            <div style={{
              padding: "16px", borderTop: "1px solid var(--border)",
              display: "flex", alignItems: "center", gap: "16px", background: "rgba(0,0,0,0.4)", zIndex: 1
            }}>
              <VoiceButton voiceState={voiceState} onClick={handleVoiceClick} disabled={!isConnected} />
              <Waveform voiceState={voiceState} />
              <input
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isConnected ? "ENTER COMMAND..." : "CONNECTING..."}
                disabled={!isConnected}
                style={{
                  flex: 1, background: "transparent", border: "none", borderBottom: "1px solid var(--border-accent)",
                  color: "var(--text-primary)", fontSize: "14px", fontFamily: "var(--font-mono)",
                  padding: "8px 4px", outline: "none", textTransform: "uppercase"
                }}
              />
              <button
                onClick={handleTextSend}
                disabled={!textInput.trim() || !isConnected}
                style={{
                  padding: "8px 16px", background: "var(--accent)", color: "#000", border: "none",
                  fontWeight: "bold", opacity: (!textInput.trim() || !isConnected) ? 0.4 : 1
                }}
              >
                <Send size={16} />
              </button>
            </div>
          </div>

          {/* RIGHT PANEL */}
          <div style={{ flex: "0 0 20%", minWidth: "200px", maxWidth: "260px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <div className="hud-panel" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <div className="hud-panel-title">// LIVE ACTIVITY</div>
              <div style={{ padding: "12px", overflowY: "auto", flex: 1 }}>
                <TranscriptView transcript={currentTranscript} />
              </div>
            </div>
            <div className="hud-panel" style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
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
