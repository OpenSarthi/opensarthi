import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, User, Volume2, Copy, Check } from "lucide-react";
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

function ThinkingBlock({ thinking, isComplete, timestamp }: { thinking: string; isComplete: boolean; timestamp?: number }) {
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
      background: "rgba(255,255,255,0.01)",
      borderRadius: "var(--radius-md)",
      marginBottom: "8px",
      overflow: "hidden",
      backdropFilter: "blur(6px)",
      WebkitBackdropFilter: "blur(6px)"
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
          background: "rgba(0,0,0,0.15)",
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
          <span style={{ opacity: 0.8, display: "flex", alignItems: "center", gap: "4px" }}>
            {isComplete ? "THINKING PROCESS" : "THINKING..."}
            {timestamp && (
              <span style={{ fontSize: "9px", color: "var(--text-secondary)", fontWeight: "normal", fontFamily: "var(--font-mono)", opacity: 0.8 }}>
                [{new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}]
              </span>
            )}
          </span>
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
              background: "rgba(0,0,0,0.1)",
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

function CodeBlock({ lang, codeText }: { lang: string; codeText: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(codeText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div
      style={{
        background: "rgba(0, 0, 0, 0.25)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        margin: "8px 0",
        overflow: "hidden",
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "10px",
          color: "var(--text-secondary)",
          borderBottom: "1px solid var(--border)",
          padding: "6px 10px",
          background: "rgba(0,0,0,0.15)",
          fontFamily: "var(--font-mono)",
          fontWeight: 600,
        }}
      >
        <span style={{ color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {lang || "CODE"}
        </span>
        <button
          onClick={handleCopy}
          style={{
            background: "transparent",
            border: "none",
            color: copied ? "var(--success, #00e6b4)" : "var(--text-secondary)",
            cursor: "pointer",
            fontSize: "10px",
            fontFamily: "var(--font-mono)",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            padding: "2px 6px",
            borderRadius: "2px",
            transition: "all 0.2s",
          }}
        >
          {copied ? <Check size={10} /> : <Copy size={10} />}
          {copied ? "COPIED" : "COPY CODE"}
        </button>
      </div>
      <pre
        style={{
          padding: "10px",
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          color: "var(--text-secondary)",
          overflowX: "auto",
          margin: 0,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          background: "transparent",
        }}
      >
        <code>{codeText}</code>
      </pre>
    </div>
  );
}

function parseInlineMarkdown(text: string) {
  // Simple regex matching for bold and code
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} style={{ color: "var(--text-primary)", fontWeight: "bold" }}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} style={{ 
          fontFamily: "var(--font-mono)", 
          fontSize: "0.9em", 
          background: "rgba(255, 255, 255, 0.08)", 
          padding: "2px 4px", 
          borderRadius: "3px",
          border: "1px solid rgba(255,255,255,0.05)",
          color: "var(--accent)"
        }}>
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

function parseMarkdownLine(line: string, lineIndex: number) {
  const trimmed = line.trim();
  
  // Headers
  if (trimmed.startsWith("# ")) {
    return <h1 key={lineIndex} style={{ fontSize: "1.4em", margin: "12px 0 6px 0", color: "var(--accent)", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "4px", fontWeight: "bold" }}>{parseInlineMarkdown(trimmed.slice(2))}</h1>;
  }
  if (trimmed.startsWith("## ")) {
    return <h2 key={lineIndex} style={{ fontSize: "1.25em", margin: "10px 0 5px 0", color: "var(--accent)", fontWeight: "bold" }}>{parseInlineMarkdown(trimmed.slice(3))}</h2>;
  }
  if (trimmed.startsWith("### ")) {
    return <h3 key={lineIndex} style={{ fontSize: "1.1em", margin: "8px 0 4px 0", color: "var(--accent)", fontWeight: "bold" }}>{parseInlineMarkdown(trimmed.slice(4))}</h3>;
  }
  
  // Lists
  if (trimmed.startsWith("* ") || trimmed.startsWith("- ")) {
    return (
      <li key={lineIndex} style={{ marginLeft: "16px", marginBottom: "4px", listStyleType: "square" }}>
        {parseInlineMarkdown(trimmed.slice(2))}
      </li>
    );
  }
  
  // Empty line
  if (line === "") {
    return <div key={lineIndex} style={{ height: "6px" }} />;
  }

  // Normal paragraph
  return (
    <p key={lineIndex} style={{ margin: "4px 0", lineHeight: "1.5" }}>
      {parseInlineMarkdown(line)}
    </p>
  );
}

export function ResponseBubble({ message }: ResponseBubbleProps) {
  const isUser = message.role === "user";
  const [displayedContent, setDisplayedContent] = useState("");
  const [copied, setCopied] = useState(false);

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
        return <CodeBlock key={index} lang={lang} codeText={codeText} />;
      }
      
      const lines = part.split("\n");
      return (
        <div key={index} style={{ display: "flex", flexDirection: "column" }}>
          {lines.map((line, lineIdx) => parseMarkdownLine(line, lineIdx))}
        </div>
      );
    });
  };

  const { thinking, response, isComplete } = parseThinking(displayedContent);

  const handleCopyResponse = () => {
    if (response) {
      navigator.clipboard.writeText(response);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

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
        position: "relative",
      }}
    >
      {/* Avatar */}
      <div
        style={{
          width: "28px",
          height: "28px",
          borderRadius: "var(--radius-full)",
          background: isUser ? "rgba(var(--accent-rgb, 255, 255, 255), 0.08)" : "var(--accent-glow)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          border: `1px solid ${isUser ? "rgba(255, 255, 255, 0.2)" : "var(--border-accent)"}`,
          boxShadow: isUser ? "none" : "0 0 8px var(--accent-glow)",
          color: isUser ? "var(--text-primary)" : "var(--accent)",
        }}
      >
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>

      {/* Bubble Wrapper with Speech Arrow */}
      <div style={{ position: "relative", maxWidth: "80%", display: "flex", flexDirection: "column" }}>
        {/* Speech Bubble Arrow */}
        <div
          style={{
            position: "absolute",
            top: "12px",
            [isUser ? "right" : "left"]: "-4px",
            width: "8px",
            height: "8px",
            background: isUser ? "rgba(255, 255, 255, 0.02)" : "rgba(0, 0, 0, 0.12)",
            borderLeft: isUser ? "none" : "1px solid var(--border-accent)",
            borderBottom: isUser ? "none" : "1px solid var(--border-accent)",
            borderRight: isUser ? "1px solid rgba(255, 255, 255, 0.12)" : "none",
            borderTop: isUser ? "1px solid rgba(255, 255, 255, 0.12)" : "none",
            transform: "rotate(45deg)",
            zIndex: 2,
            pointerEvents: "none",
            backdropFilter: "blur(3px)",
            WebkitBackdropFilter: "blur(3px)",
          }}
        />

        {/* Bubble */}
        <div
          className="selectable"
          style={{
            padding: "10px 14px",
            borderRadius: isUser
              ? "var(--radius-lg) var(--radius-sm) var(--radius-lg) var(--radius-lg)"
              : "var(--radius-sm) var(--radius-lg) var(--radius-lg) var(--radius-lg)",
            background: isUser ? "rgba(255, 255, 255, 0.02)" : "rgba(0, 0, 0, 0.12)",
            border: `1px solid ${isUser ? "rgba(255, 255, 255, 0.12)" : "var(--border-accent)"}`,
            fontSize: "13.5px",
            lineHeight: 1.6,
            color: "var(--text-primary)",
            backdropFilter: "blur(3px)",
            WebkitBackdropFilter: "blur(3px)",
            wordBreak: "break-word",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            boxShadow: isUser ? "none" : "0 4px 20px rgba(0, 0, 0, 0.2)",
            position: "relative",
            zIndex: 1,
          }}
        >
          {thinking && (
            <ThinkingBlock thinking={thinking} isComplete={isComplete} timestamp={message.timestamp} />
          )}
          
          {response && (
            <div style={{ flex: 1 }}>{renderContent(response)}</div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px", borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: "4px", gap: "10px" }}>
            <span style={{ fontSize: "9px", color: "var(--text-secondary)", opacity: 0.85, fontFamily: "var(--font-mono)", letterSpacing: "0.03em" }}>
              [ {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })} ]
            </span>
            <div style={{ display: "flex", gap: "6px" }}>
              {!isUser && response && (
                <>
                  <button
                    onClick={handleCopyResponse}
                    style={{
                      background: "rgba(255, 255, 255, 0.05)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)",
                      color: copied ? "var(--success, #00e6b4)" : "var(--text-secondary)",
                      padding: "2px 6px",
                      fontSize: "10px",
                      fontFamily: "var(--font-mono)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      transition: "all 0.2s ease",
                    }}
                    title="Copy response text"
                  >
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                    {copied ? "COPIED!" : "COPY"}
                  </button>
                  <button
                    onClick={() => {
                      // Strip thinking tag before TTS read-out
                      const clean = response
                        .replace(/```[\s\S]*?```/g, "")
                        .replace(/`([^`]+)`/g, "$1")
                        .replace(/[*#_\-]/g, "")
                        .trim();
                      if (clean) {
                        wsClient.send("speak_text", { text: clean, manual: true });
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
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

interface MessageListProps {
  messages: Message[];
  messageRefsMap?: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  onSelectMessage?: (msgId: string) => void;
}

export function MessageList({ messages, messageRefsMap, onSelectMessage }: MessageListProps) {
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
          <div
            key={msg.id}
            ref={(el) => {
              if (messageRefsMap) messageRefsMap.current[msg.id] = el;
            }}
            onClick={() => onSelectMessage?.(msg.id)}
            style={{ transition: "outline 0.3s", cursor: onSelectMessage ? "pointer" : "default" }}
          >
            <ResponseBubble message={msg} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}
