import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, User, Volume2 } from "lucide-react";
import type { Message } from "../../lib/schemas";
import { wsClient } from "../../lib/ws";

interface ResponseBubbleProps {
  message: Message;
}

export function ResponseBubble({ message }: ResponseBubbleProps) {
  const isUser = message.role === "user";
  const [displayedContent, setDisplayedContent] = useState("");

  useEffect(() => {
    if (isUser) {
      setDisplayedContent(message.content);
      return;
    }

    // Bypass typewriter effect for old historical messages (older than 4 seconds) to keep UI snaps instant
    const ageMs = Date.now() - message.timestamp;
    if (ageMs > 4000) {
      setDisplayedContent(message.content);
      return;
    }

    const words = message.content.split(" ");
    let currentIdx = 0;

    // Fast, latency-free word-by-word rendering (approx 10 words per second)
    // Completed exactly in line with or slightly ahead of high-speed TTS playback
    const timer = setInterval(() => {
      if (currentIdx >= words.length) {
        clearInterval(timer);
        setDisplayedContent(message.content);
      } else {
        setDisplayedContent(words.slice(0, currentIdx + 1).join(" "));
        currentIdx++;
      }
    }, 75); // Snappy 75ms word-by-word progression to match 1.35x TTS speed

    return () => clearInterval(timer);
  }, [message.content, message.timestamp, isUser]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      style={{
        display: "flex",
        gap: "10px",
        alignItems: "flex-start",
        flexDirection: isUser ? "row-reverse" : "row",
      }}
    >
      {/* Avatar */}
      <div
        style={{
          width: "28px",
          height: "28px",
          borderRadius: "var(--radius-full)",
          background: isUser ? "var(--bg-tertiary)" : "var(--accent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          border: "1px solid var(--border)",
        }}
      >
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>

      {/* Bubble */}
      <div
        className="selectable"
        style={{
          maxWidth: "80%",
          padding: "10px 14px",
          borderRadius: isUser
            ? "var(--radius-lg) var(--radius-sm) var(--radius-lg) var(--radius-lg)"
            : "var(--radius-sm) var(--radius-lg) var(--radius-lg) var(--radius-lg)",
          background: isUser ? "var(--bg-tertiary)" : "var(--bg-glass)",
          border: `1px solid ${isUser ? "var(--border)" : "var(--border-accent)"}`,
          fontSize: "13.5px",
          lineHeight: 1.6,
          color: "var(--text-primary)",
          backdropFilter: isUser ? "none" : "var(--blur-glass)",
          WebkitBackdropFilter: isUser ? "none" : "var(--blur-glass)",
          wordBreak: "break-word",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        <div>{displayedContent}</div>
        
        {!isUser && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "2px" }}>
            <button
              onClick={() => wsClient.send("speak_text", { text: message.content })}
              style={{
                background: "rgba(255, 0, 0, 0.1)",
                border: "1px solid var(--border-accent)",
                borderRadius: "var(--radius-sm)",
                color: "var(--accent)",
                padding: "2px 6px",
                fontSize: "10px",
                fontFamily: "var(--font-mono)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                transition: "all 0.2s ease",
              }}
              className="hover-glow"
              title="Listen to response"
            >
              <Volume2 size={12} />
              LISTEN
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

interface MessageListProps {
  messages: Message[];
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        padding: "4px 0",
        overflowY: "auto",
        flex: 1,
      }}
    >
      <AnimatePresence initial={false}>
        {messages.map((msg) => (
          <ResponseBubble key={msg.id} message={msg} />
        ))}
      </AnimatePresence>
    </div>
  );
}
