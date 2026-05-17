import { motion, AnimatePresence } from "framer-motion";
import { Bot, User } from "lucide-react";
import type { Message } from "../../lib/schemas";

interface ResponseBubbleProps {
  message: Message;
}

export function ResponseBubble({ message }: ResponseBubbleProps) {
  const isUser = message.role === "user";

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
        }}
      >
        {message.content}
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
