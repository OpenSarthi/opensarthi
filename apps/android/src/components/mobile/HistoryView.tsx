import { useEffect, useState } from "react";
import { X, MessageSquare, Trash2, Plus, AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";
import { useAssistantStore } from "../../stores/assistantStore";
import { wsClient } from "../../lib/ws";

interface HistoryViewProps {
  onClose: () => void;
  onNewChat: () => void;
}

export function HistoryView({ onClose, onNewChat }: HistoryViewProps) {
  const { threads, activeThreadId } = useAssistantStore();
  const [hoveredThreadId, setHoveredThreadId] = useState<string | null>(null);

  useEffect(() => {
    // Fetch latest history from backend on mount
    wsClient.send("get_history", {});
  }, []);

  const handleLoadThread = (id: string) => {
    wsClient.send("load_thread", { thread_id: id });
    onClose();
  };

  const handleDeleteThread = (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); // Avoid loading thread
    if (window.confirm("Are you sure you want to delete this thread?")) {
      wsClient.send("delete_thread", { thread_id: id });
    }
  };

  const handleDeleteAll = () => {
    if (window.confirm("Are you sure you want to delete ALL threads? This cannot be undone.")) {
      wsClient.send("delete_all_threads", {});
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      style={{
        position: "fixed",
        top: 0, left: 0, right: 0, bottom: 0,
        background: "rgba(0, 0, 0, 0.5)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        zIndex: 90,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ x: "-100%" }}
        animate={{ x: 0 }}
        exit={{ x: "-100%" }}
        transition={{ type: "spring", damping: 24, stiffness: 220 }}
        style={{
          position: "absolute",
          top: 0, left: 0, bottom: 0,
          width: "80%",
          maxWidth: "320px",
          background: "var(--bg-primary)",
          borderRight: "1px solid var(--border)",
          boxShadow: "10px 0 30px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
          fontFamily: "var(--font-mono)",
        }}
      >
        {/* Drawer Header */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 20px",
          borderBottom: "1px solid var(--border)",
          background: "rgba(0,0,0,0.2)",
        }}>
          <span style={{ fontSize: "14px", color: "var(--accent)", fontWeight: "bold", letterSpacing: "0.05em" }}>
            // HISTORY
          </span>
          <button onClick={onClose} style={{ color: "var(--text-secondary)", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", padding: "4px" }}>
            <X size={20} />
          </button>
        </div>

        {/* Action Button: New Thread */}
        <div style={{ padding: "16px" }}>
          <button
            onClick={() => {
              onNewChat();
              onClose();
            }}
            style={{
              width: "100%",
              padding: "12px",
              background: "var(--accent-glow)",
              border: "1px dashed var(--accent)",
              borderRadius: "8px",
              color: "white",
              fontSize: "13px",
              fontWeight: "bold",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
              boxShadow: "0 0 8px rgba(0,255,160,0.1)",
            }}
          >
            <Plus size={16} color="var(--accent)" /> NEW CHAT
          </button>
        </div>

        {/* Threads List */}
        <div style={{
          flex: 1,
          overflowY: "auto",
          padding: "0 16px 16px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          WebkitOverflowScrolling: "touch",
        }}>
          {threads.length === 0 ? (
            <div style={{ color: "var(--text-secondary)", fontSize: "12px", textAlign: "center", marginTop: "40px", opacity: 0.6 }}>
              NO CONVERSATIONS FOUND
            </div>
          ) : (
            threads.map((thread) => {
              const isActive = thread.id === activeThreadId;
              const isHovered = hoveredThreadId === thread.id;
              return (
                <div
                  key={thread.id}
                  onClick={() => handleLoadThread(thread.id)}
                  onMouseEnter={() => setHoveredThreadId(thread.id)}
                  onMouseLeave={() => setHoveredThreadId(null)}
                  style={{
                    padding: "12px 14px",
                    background: isActive ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.3)",
                    border: `1px solid ${isActive ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: "8px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    position: "relative",
                    boxShadow: isActive ? "0 0 10px rgba(0,255,160,0.15)" : "none",
                  }}
                >
                  <MessageSquare size={16} style={{ color: isActive ? "var(--accent)" : "var(--text-secondary)", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0, paddingRight: "20px" }}>
                    <div style={{
                      fontSize: "12px",
                      color: "white",
                      fontWeight: isActive ? "bold" : "normal",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis"
                    }}>
                      {thread.first_message || "Empty Conversation"}
                    </div>
                    <div style={{ fontSize: "10px", color: "var(--text-secondary)", opacity: 0.6, marginTop: "4px" }}>
                      {new Date(thread.created_at).toLocaleDateString()}
                    </div>
                  </div>

                  <button
                    onClick={(e) => handleDeleteThread(e, thread.id)}
                    style={{
                      position: "absolute",
                      right: "10px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "var(--text-secondary)",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      padding: "4px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Delete All Footer */}
        {threads.length > 0 && (
          <div style={{
            padding: "16px",
            borderTop: "1px solid var(--border)",
            background: "rgba(0,0,0,0.2)",
          }}>
            <button
              onClick={handleDeleteAll}
              style={{
                width: "100%",
                padding: "12px",
                background: "rgba(255, 79, 79, 0.1)",
                border: "1px solid rgba(255, 79, 79, 0.4)",
                borderRadius: "8px",
                color: "#ff4f4f",
                fontSize: "12px",
                fontWeight: "bold",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
              }}
            >
              <Trash2 size={14} /> DELETE ALL HISTORY
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
