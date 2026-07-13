import { useRef, useEffect, useState } from "react";
import { Mic, MicOff, Send, MessageSquare } from "lucide-react";
import type { Message } from "../../lib/schemas";

interface OverlayIdleViewProps {
  voiceState: string;
  currentTranscript: string | null;
  messages: Message[];
  streamingResponse: string | null;
  isConnected: boolean;
  textInput: string;
  setTextInput: (v: string) => void;
  handleTextSend: () => void;
  handleVoiceClick: () => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
}

/** Strip markdown so it's readable in the compact strip */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*#_]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const VOICE_STATE_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  idle:       { label: "IDLE",       color: "rgba(255,255,255,0.3)",  dot: "rgba(255,255,255,0.3)" },
  listening:  { label: "LISTENING",  color: "rgb(60,220,100)",        dot: "rgb(60,220,100)" },
  processing: { label: "PROCESSING", color: "rgb(255,180,30)",        dot: "rgb(255,180,30)" },
  speaking:   { label: "SPEAKING",   color: "rgb(100,160,255)",       dot: "rgb(100,160,255)" },
  error:      { label: "ERROR",      color: "rgb(255,80,80)",         dot: "rgb(255,80,80)" },
};

export function OverlayIdleView({
  voiceState,
  currentTranscript,
  messages,
  streamingResponse,
  isConnected,
  textInput,
  setTextInput,
  handleTextSend,
  handleVoiceClick,
  handleKeyDown,
}: OverlayIdleViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expandedReply, setExpandedReply] = useState(false);

  // Scroll to bottom when new messages or transcript arrives
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, currentTranscript, streamingResponse]);

  // Reset expand state when a new assistant message comes in
  useEffect(() => {
    setExpandedReply(false);
  }, [messages.length]);

  const vsCfg = VOICE_STATE_CONFIG[voiceState] ?? VOICE_STATE_CONFIG.idle;

  // Gather chat messages — show last 8, interleaved user/assistant
  const chatMessages = messages.slice(-8);

  // The latest assistant reply (for special highlighting)
  const latestAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const latestAssistantId = latestAssistant?.id;

  const isListening   = voiceState === "listening";
  const isProcessing  = voiceState === "processing";
  const isSpeaking    = voiceState === "speaking";
  const isVoiceActive = isListening || isProcessing || isSpeaking;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* ── Voice State Badge ─────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: "8px",
        padding: "8px 14px 6px",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        flexShrink: 0,
      }}>
        {/* Animated status dot */}
        <div style={{
          width: "7px", height: "7px", borderRadius: "50%",
          background: vsCfg.dot,
          boxShadow: `0 0 ${isVoiceActive ? "8px" : "4px"} ${vsCfg.dot}`,
          animation: isVoiceActive ? "pulse 1.2s ease-in-out infinite" : "none",
          flexShrink: 0,
        }} />
        <span style={{
          fontSize: "9px", fontWeight: 700, letterSpacing: "0.12em",
          color: vsCfg.color, fontFamily: "var(--font-mono)",
          textTransform: "uppercase",
        }}>
          {vsCfg.label}
        </span>

        {/* Waveform bars when listening */}
        {isListening && (
          <div style={{ display: "flex", gap: "2px", alignItems: "center", marginLeft: "2px" }}>
            {[0.4, 0.7, 1.0, 0.7, 0.4, 0.8, 0.6].map((h, i) => (
              <div
                key={i}
                style={{
                  width: "2px",
                  height: `${8 * h}px`,
                  borderRadius: "1px",
                  background: "rgb(60,220,100)",
                  animation: `waveBar${(i % 3) + 1} ${0.6 + i * 0.08}s ease-in-out infinite alternate`,
                  opacity: 0.75,
                }}
              />
            ))}
          </div>
        )}

        {/* Processing spinner */}
        {isProcessing && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgb(255,180,30)" strokeWidth="3"
            style={{ animation: "spin 1s linear infinite", marginLeft: "2px" }}>
            <circle cx="12" cy="12" r="9" strokeOpacity="0.25" />
            <path d="M12 3 A9 9 0 0 1 21 12" />
          </svg>
        )}

        {!isConnected && (
          <span style={{
            marginLeft: "auto", fontSize: "9px",
            color: "rgba(255,80,80,0.7)", fontFamily: "var(--font-mono)",
          }}>
            OFFLINE
          </span>
        )}
      </div>

      {/* ── Scrollable message area ───────────────────────────────── */}
      <div
        ref={scrollRef}
        style={{
          flex: 1, overflowY: "auto", display: "flex", flexDirection: "column",
          gap: "6px", padding: "10px 10px 4px", minHeight: 0,
        }}
      >
        {chatMessages.length === 0 && !currentTranscript && !streamingResponse ? (
          /* Empty state */
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            gap: "10px", padding: "20px",
          }}>
            <div style={{
              width: "40px", height: "40px", borderRadius: "50%",
              border: "1.5px solid rgba(255,255,255,0.1)",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(255,255,255,0.03)",
            }}>
              <MessageSquare size={16} style={{ opacity: 0.3 }} />
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>
                I&apos;m listening
              </div>
              <div style={{
                fontSize: "10px", color: "rgba(255,255,255,0.25)",
                marginTop: "4px", lineHeight: "1.5",
              }}>
                Speak or type a message.<br />I can help while you work.
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Chat bubbles */}
            {chatMessages.map((msg) => {
              const isUser = msg.role === "user";
              const isLatestAI = msg.id === latestAssistantId;
              const rawText = typeof msg.content === "string" ? msg.content : "";
              const clean = stripMarkdown(rawText);
              const MAX_CHARS = 200;
              const truncated = isLatestAI && !expandedReply && clean.length > MAX_CHARS;
              const displayText = truncated ? clean.slice(0, MAX_CHARS) + "…" : clean;

              return (
                <div
                  key={msg.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: isUser ? "flex-end" : "flex-start",
                    gap: "2px",
                    flexShrink: 0,
                  }}
                >
                  <div style={{
                    maxWidth: "94%",
                    padding: isUser ? "6px 10px" : "7px 10px",
                    borderRadius: isUser ? "12px 12px 3px 12px" : "12px 12px 12px 3px",
                    background: isUser
                      ? "linear-gradient(135deg, rgba(0,200,120,0.18), rgba(0,200,120,0.1))"
                      : isLatestAI
                        ? "rgba(255,255,255,0.07)"
                        : "rgba(255,255,255,0.04)",
                    border: isUser
                      ? "1px solid rgba(0,200,120,0.3)"
                      : isLatestAI
                        ? "1px solid rgba(255,255,255,0.1)"
                        : "1px solid rgba(255,255,255,0.06)",
                    fontSize: "11px",
                    lineHeight: "1.5",
                    color: isUser ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.8)",
                    wordBreak: "break-word",
                    whiteSpace: "pre-wrap",
                  }}>
                    {displayText}
                    {truncated && (
                      <button
                        onClick={() => setExpandedReply(true)}
                        style={{
                          display: "block", marginTop: "4px",
                          fontSize: "9px", color: "var(--accent)",
                          background: "none", border: "none",
                          cursor: "pointer", padding: 0,
                          fontFamily: "var(--font-mono)", letterSpacing: "0.06em",
                        }}
                      >
                        SHOW MORE ↓
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Live transcript bubble (user is speaking right now) */}
            {currentTranscript && isListening && (
              <div style={{
                display: "flex", flexDirection: "column",
                alignItems: "flex-end", gap: "2px", flexShrink: 0,
              }}>
                <div style={{
                  maxWidth: "94%", padding: "6px 10px",
                  borderRadius: "12px 12px 3px 12px",
                  background: "rgba(60,220,100,0.08)",
                  border: "1px solid rgba(60,220,100,0.25)",
                  fontSize: "11px", lineHeight: "1.5",
                  color: "rgba(255,255,255,0.7)",
                  wordBreak: "break-word", whiteSpace: "pre-wrap",
                  fontStyle: "italic",
                }}>
                  {currentTranscript}
                  <span style={{
                    display: "inline-block", width: "6px", height: "11px",
                    background: "rgba(60,220,100,0.7)", marginLeft: "2px",
                    verticalAlign: "text-bottom", borderRadius: "1px",
                    animation: "blink 1s step-end infinite",
                  }} />
                </div>
              </div>
            )}

            {/* Streaming response bubble */}
            {streamingResponse && (
              <div style={{
                display: "flex", flexDirection: "column",
                alignItems: "flex-start", gap: "2px", flexShrink: 0,
              }}>
                <div style={{
                  maxWidth: "94%", padding: "7px 10px",
                  borderRadius: "12px 12px 12px 3px",
                  background: "rgba(255,255,255,0.07)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  fontSize: "11px", lineHeight: "1.5",
                  color: "rgba(255,255,255,0.85)",
                  wordBreak: "break-word", whiteSpace: "pre-wrap",
                }}>
                  {stripMarkdown(streamingResponse).slice(-300)}
                  <span style={{
                    display: "inline-block", width: "6px", height: "11px",
                    background: "rgba(100,160,255,0.8)", marginLeft: "2px",
                    verticalAlign: "text-bottom", borderRadius: "1px",
                    animation: "blink 0.8s step-end infinite",
                  }} />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Mini input bar ────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        borderTop: "1px solid rgba(255,255,255,0.06)",
        padding: "8px 10px",
        display: "flex", gap: "6px", alignItems: "center",
        background: "rgba(0,0,0,0.15)",
      }}>
        {/* Mic toggle */}
        <button
          onClick={handleVoiceClick}
          title={isListening ? "Stop listening" : isSpeaking ? "Stop speaking" : "Start listening"}
          style={{
            flexShrink: 0,
            width: "30px", height: "30px",
            borderRadius: "8px",
            background: isListening
              ? "rgba(60,220,100,0.15)"
              : isSpeaking
              ? "rgba(100,160,255,0.15)"
              : "rgba(255,255,255,0.05)",
            border: isListening
              ? "1px solid rgba(60,220,100,0.4)"
              : isSpeaking
              ? "1px solid rgba(100,160,255,0.4)"
              : "1px solid rgba(255,255,255,0.1)",
            color: isListening
              ? "rgb(60,220,100)"
              : isSpeaking
              ? "rgb(100,160,255)"
              : "rgba(255,255,255,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer",
            transition: "all 0.15s",
            animation: isListening ? "pulse 1.4s ease-in-out infinite" : "none",
          }}
        >
          {isListening ? <Mic size={13} /> : <MicOff size={13} />}
        </button>

        {/* Text input */}
        <input
          type="text"
          placeholder={
            isListening  ? "Listening…"  :
            isProcessing ? "Processing…" :
            isSpeaking   ? "Speaking…"   :
            "Type a message…"
          }
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!isConnected}
          style={{
            flex: 1,
            height: "30px",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "8px",
            padding: "0 10px",
            fontSize: "11px",
            color: "rgba(255,255,255,0.85)",
            fontFamily: "var(--font-sans, sans-serif)",
            outline: "none",
            transition: "border-color 0.15s",
          }}
          onFocus={(e) => { e.target.style.borderColor = "rgba(0,200,120,0.5)"; }}
          onBlur={(e)  => { e.target.style.borderColor = "rgba(255,255,255,0.1)"; }}
        />

        {/* Send button */}
        <button
          onClick={handleTextSend}
          disabled={!textInput.trim() || !isConnected}
          style={{
            flexShrink: 0,
            width: "30px", height: "30px",
            borderRadius: "8px",
            background: textInput.trim() && isConnected
              ? "rgba(0,200,120,0.2)"
              : "rgba(255,255,255,0.04)",
            border: textInput.trim() && isConnected
              ? "1px solid rgba(0,200,120,0.4)"
              : "1px solid rgba(255,255,255,0.08)",
            color: textInput.trim() && isConnected
              ? "var(--accent)"
              : "rgba(255,255,255,0.25)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: textInput.trim() && isConnected ? "pointer" : "not-allowed",
            transition: "all 0.15s",
          }}
        >
          <Send size={12} />
        </button>
      </div>

      {/* Inline keyframes for waveform and blink */}
      <style>{`
        @keyframes waveBar1 { from { transform: scaleY(0.4); } to { transform: scaleY(1.0); } }
        @keyframes waveBar2 { from { transform: scaleY(0.6); } to { transform: scaleY(0.9); } }
        @keyframes waveBar3 { from { transform: scaleY(0.3); } to { transform: scaleY(0.8); } }
        @keyframes blink    { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        @keyframes spin     { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
