import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Settings, Minimize2, WifiOff } from "lucide-react";
import { VoiceButton } from "./VoiceButton";
import { Waveform } from "./Waveform";
import { TranscriptView } from "./TranscriptView";
import { MessageList } from "./ResponseBubble";
import { ActionLog } from "../execution/ActionLog";
import { useAssistantStore } from "../../stores/assistantStore";
import { wsClient } from "../../lib/ws";

interface AssistantOverlayProps {
  onOpenSettings: () => void;
}

export function AssistantOverlay({ onOpenSettings }: AssistantOverlayProps) {
  const [textInput, setTextInput] = useState("");
  const [minimized, setMinimized] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const {
    voiceState, isConnected, currentTranscript,
    messages, currentPlan,
    setVoiceState,
  } = useAssistantStore();

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentTranscript]);

  const handleVoiceClick = useCallback(() => {
    if (voiceState === "idle" || voiceState === "error") {
      wsClient.send("session_state", { active: true });
      setVoiceState("listening");
    } else if (voiceState === "listening") {
      wsClient.send("session_state", { active: false });
      setVoiceState("idle");
    }
  }, [voiceState, setVoiceState]);

  const handleTextSend = useCallback(() => {
    const msg = textInput.trim();
    if (!msg || !isConnected) return;
    wsClient.send("user_message", { text: msg, source: "text" });
    setTextInput("");
    setVoiceState("processing");
  }, [textInput, isConnected, setVoiceState]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleTextSend(); }
  };

  return (
    <div
      style={{
        width: "100vw", height: "100vh",
        display: "flex", flexDirection: "column",
        background: "var(--bg-primary)",
        overflow: "hidden",
      }}
    >
      {/* ─── Title Bar (drag region) ─── */}
      <div
        data-tauri-drag-region
        style={{
          padding: "12px 16px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
          cursor: "move",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* Status dot */}
          <div style={{
            width: "8px", height: "8px", borderRadius: "50%",
            background: isConnected ? "var(--success)" : "var(--danger)",
            boxShadow: isConnected ? "0 0 6px var(--success)" : "none",
          }} />
          <span style={{ fontSize: "13px", fontWeight: 600, letterSpacing: "-0.01em" }}>
            OpenSarthi
          </span>
          {!isConnected && (
            <span style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", color: "var(--text-muted)" }}>
              <WifiOff size={11} /> Connecting…
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: "4px" }}>
          <button
            id="minimize-btn"
            onClick={() => setMinimized((m) => !m)}
            style={{ padding: "4px", borderRadius: "var(--radius-sm)", color: "var(--text-muted)" }}
            title={minimized ? "Expand" : "Minimize"}
          >
            <Minimize2 size={14} />
          </button>
          <button
            id="settings-btn"
            onClick={onOpenSettings}
            style={{ padding: "4px", borderRadius: "var(--radius-sm)", color: "var(--text-muted)" }}
            title="Settings"
          >
            <Settings size={14} />
          </button>
        </div>
      </div>

      {/* ─── Main Content ─── */}
      <AnimatePresence>
        {!minimized && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1, flex: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ display: "flex", flexDirection: "column", overflow: "hidden", flex: 1 }}
          >
            {/* Message area */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "8px" }}>
              {messages.length === 0 && (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "8px", opacity: 0.4 }}>
                  <p style={{ fontSize: "13px", color: "var(--text-muted)", textAlign: "center" }}>
                    Say <em>"Hey Sarthi"</em> or type below
                  </p>
                </div>
              )}
              <MessageList messages={messages} />
              <TranscriptView transcript={currentTranscript} />
              <ActionLog plan={currentPlan} />
              <div ref={bottomRef} />
            </div>

            {/* ─── Input Bar ─── */}
            <div style={{
              padding: "12px 14px",
              borderTop: "1px solid var(--border)",
              display: "flex", alignItems: "center", gap: "10px",
              background: "var(--bg-secondary)", flexShrink: 0,
            }}>
              <VoiceButton voiceState={voiceState} onClick={handleVoiceClick} disabled={!isConnected} />
              <Waveform voiceState={voiceState} />
              <input
                id="text-input"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isConnected ? "Type a command…" : "Connecting to runtime…"}
                disabled={!isConnected || voiceState === "listening"}
                style={{
                  flex: 1,
                  background: "var(--bg-tertiary)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  padding: "9px 12px",
                  fontSize: "13px",
                  color: "var(--text-primary)",
                  outline: "none",
                  fontFamily: "var(--font-sans)",
                  transition: "border-color var(--transition-fast)",
                }}
                onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
                onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
              />
              <button
                id="send-btn"
                onClick={handleTextSend}
                disabled={!textInput.trim() || !isConnected}
                style={{
                  width: "36px", height: "36px", borderRadius: "var(--radius-sm)",
                  background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, transition: "opacity var(--transition-fast)",
                }}
                title="Send"
              >
                <Send size={15} style={{ color: "#fff" }} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
