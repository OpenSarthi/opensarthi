import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, User, Volume2 } from "lucide-react";
import type { Message } from "../../lib/schemas";
import { wsClient } from "../../lib/ws";

interface ResponseBubbleProps {
  message: Message;
}

function parseThinking(content: string): { thinking: string; response: string; isComplete: boolean } {
  // Collect all <think>...</think> blocks
  const thinkBlocks: string[] = [];
  let remaining = content;
  
  // Extract all complete <think>...</think> blocks
  const completePattern = /<think>([\s\S]*?)<\/think>/g;
  let match;
  while ((match = completePattern.exec(content)) !== null) {
    thinkBlocks.push(match[1].trim());
  }
  remaining = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  
  // Check for unclosed <think> tag (still thinking)
  const unclosedIdx = remaining.indexOf("<think>");
  if (unclosedIdx !== -1) {
    const partialThinking = remaining.slice(unclosedIdx + 7);
    thinkBlocks.push(partialThinking.trim());
    remaining = remaining.slice(0, unclosedIdx).trim();
    return { thinking: thinkBlocks.join("\n\n"), response: remaining, isComplete: false };
  }
  
  const thinking = thinkBlocks.join("\n\n");
  return { thinking, response: remaining, isComplete: thinkBlocks.length > 0 };
}

function ThinkingBlock({ thinking, isComplete }: { thinking: string; isComplete: boolean }) {
  const [isOpen, setIsOpen] = useState(!isComplete);

  useEffect(() => {
    // Auto collapse after thinking completes
    if (isComplete) {
      setIsOpen(false);
    }
  }, [isComplete]);

  return (
    <div style={{
      border: "1px solid var(--border)",
      background: "rgba(255,255,255,0.02)",
      borderRadius: "var(--radius-md)",
      marginBottom: "8px",
      overflow: "hidden"
    }}>
      <style>{`
        @keyframes pulseDot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.85); }
        }
      `}</style>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{
          padding: "8px 12px",
          background: "rgba(0,0,0,0.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          fontSize: "11px",
          color: "var(--text-secondary)",
          fontWeight: 600,
          letterSpacing: "0.05em",
          userSelect: "none"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: isComplete ? "var(--text-muted)" : "var(--accent)",
            boxShadow: isComplete ? "none" : "0 0 8px var(--accent)",
            animation: isComplete ? "none" : "pulseDot 1.5s infinite"
          }} />
          <span style={{ opacity: 0.8 }}>{isComplete ? "THINKING PROCESS" : "THINKING..."}</span>
        </div>
        <span style={{ fontSize: "9px", opacity: 0.6 }}>{isOpen ? "COLLAPSE ▲" : "EXPAND ▼"}</span>
      </div>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 0.8 }}
            exit={{ height: 0, opacity: 0 }}
            style={{
              padding: "10px 12px",
              fontSize: "12px",
              fontFamily: "var(--font-mono)",
              color: "var(--text-secondary)",
              borderTop: "1px solid var(--border)",
              whiteSpace: "pre-wrap",
              background: "rgba(0,0,0,0.15)",
              lineHeight: 1.5,
              maxHeight: "150px",
              overflowY: "auto"
            }}
          >
            {thinking.trim()}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ResponseBubble({ message }: ResponseBubbleProps) {
  const isUser = message.role === "user";
  const [displayedContent, setDisplayedContent] = useState("");

  useEffect(() => {
    if (isUser) {
      setDisplayedContent(message.content);
      return;
    }

    const ageMs = Date.now() - message.timestamp;
    if (ageMs > 4000) {
      setDisplayedContent(message.content);
      return;
    }

    const words = message.content.split(" ");
    let currentIdx = 0;

    const timer = setInterval(() => {
      if (currentIdx >= words.length) {
        clearInterval(timer);
        setDisplayedContent(message.content);
      } else {
        setDisplayedContent(words.slice(0, currentIdx + 1).join(" "));
        currentIdx++;
      }
    }, 75);

    return () => clearInterval(timer);
  }, [message.content, message.timestamp, isUser]);

  const renderContent = (content: string) => {
    if (!content) return null;
    const parts = content.split(/(```[\s\S]*?```)/g);
    return parts.map((part, index) => {
      if (part.startsWith("```") && part.endsWith("```")) {
        const lines = part.slice(3, -3).trim().split("\n");
        let lang = "";
        let codeLines = lines;
        if (lines.length > 0 && /^[a-zA-Z0-9_-]+$/.test(lines[0])) {
          lang = lines[0];
          codeLines = lines.slice(1);
        }
        const codeText = codeLines.join("\n");
        return (
          <pre
            key={index}
            style={{
              background: "rgba(0,0,0,0.6)",
              border: "1px solid var(--border)",
              padding: "10px",
              borderRadius: "var(--radius-md)",
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              color: "var(--text-secondary)",
              overflowX: "auto",
              margin: "6px 0",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {lang && (
              <div
                style={{
                  fontSize: "9px",
                  color: "var(--accent)",
                  borderBottom: "1px solid var(--border)",
                  paddingBottom: "4px",
                  marginBottom: "6px",
                  textTransform: "uppercase",
                }}
              >
                {lang}
              </div>
            )}
            <code>{codeText}</code>
          </pre>
        );
      }
      return <span key={index} style={{ whiteSpace: "pre-wrap" }}>{part}</span>;
    });
  };

  const { thinking, response, isComplete } = parseThinking(displayedContent);

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
        {thinking && (
          <ThinkingBlock thinking={thinking} isComplete={isComplete} />
        )}
        
        {response && (
          <div>{renderContent(response)}</div>
        )}
        
        {!isUser && response && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "2px" }}>
            <button
              onClick={() => {
                // Strip thinking tag before TTS read-out
                const clean = response
                  .replace(/```[\s\S]*?```/g, "")
                  .replace(/`([^`]+)`/g, "$1")
                  .replace(/[*#_\-]/g, "")
                  .trim();
                if (clean) {
                  wsClient.send("speak_text", { text: clean });
                }
              }}
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
