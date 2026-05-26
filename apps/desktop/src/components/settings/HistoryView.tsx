import { useEffect, useState } from "react";
import { X, MessageSquare, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { useAssistantStore } from "../../stores/assistantStore";
import { wsClient } from "../../lib/ws";

interface HistoryViewProps {
  onClose: () => void;
}

export function HistoryView({ onClose }: HistoryViewProps) {
  const { threads } = useAssistantStore();
  const [hoveredThreadId, setHoveredThreadId] = useState<string | null>(null);

  useEffect(() => {
    wsClient.send("get_history", {});
  }, []);

  const handleLoadThread = (id: string) => {
    wsClient.send("load_thread", { thread_id: id });
    onClose();
  };

  const handleDeleteThread = (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); // Avoid triggering load thread
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
      style={{
        position: "fixed",
        top: 0, left: 0, right: 0, bottom: 0,
        background: "var(--bg-glass)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        className="hud-panel"
        style={{
          width: "680px",
          height: "580px",
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
          background: "rgba(0, 0, 0, 0.4)",
          boxShadow: "0 10px 40px rgba(0, 0, 0, 0.5), inset 0 0 20px rgba(255,255,255,0.02)"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: "16px", color: "var(--accent)", letterSpacing: "0.1em", fontWeight: "bold", margin: 0 }}>
            // PAST THREADS
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {threads.length > 0 && (
              <button
                id="delete-all-threads"
                onClick={handleDeleteAll}
                title="Delete all threads"
                style={{
                  color: "var(--text-secondary)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  transition: "color 0.2s"
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = "var(--red)"}
                onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-secondary)"}
              >
                <Trash2 size={18} />
              </button>
            )}
            <button onClick={onClose} style={{ color: "var(--text-secondary)", background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center" }}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px", paddingRight: "4px" }}>
          {threads.length === 0 ? (
            <div style={{ color: "var(--text-secondary)", fontSize: "13px", textAlign: "center", marginTop: "40px" }}>
              NO PAST THREADS FOUND
            </div>
          ) : (
            threads.map((thread) => {
              const isHovered = hoveredThreadId === thread.id;
              return (
                <div
                  key={thread.id}
                  onClick={() => handleLoadThread(thread.id)}
                  onMouseEnter={() => setHoveredThreadId(thread.id)}
                  onMouseLeave={() => setHoveredThreadId(null)}
                  style={{
                    padding: "14px 18px",
                    background: isHovered ? "var(--accent-glow)" : "rgba(0,0,0,0.3)",
                    border: `1px solid ${isHovered ? "var(--border-accent)" : "var(--border)"}`,
                    borderRadius: "4px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "16px",
                    position: "relative",
                    transform: isHovered ? "translateY(-1px)" : "none",
                    boxShadow: isHovered ? "0 4px 12px var(--accent-glow)" : "none",
                    transition: "all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)"
                  }}
                  onFocus={() => setHoveredThreadId(thread.id)}
                  onBlur={() => setHoveredThreadId(null)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    handleDeleteThread(e as any, thread.id);
                  }}
                >
                  <MessageSquare size={16} style={{ color: isHovered ? "var(--accent)" : "var(--text-secondary)", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0, paddingRight: "28px" }}>
                    <div style={{ fontSize: "13px", color: isHovered ? "var(--text-primary)" : "var(--text-secondary)", fontWeight: "500", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {thread.first_message || "Empty Conversation"}
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--text-secondary)", opacity: 0.85, marginTop: "4px", fontFamily: "var(--font-mono)" }}>
                      {new Date(thread.created_at).toLocaleString()}
                    </div>
                  </div>

                  {isHovered && (
                    <button
                      className="delete-thread-btn"
                      onClick={(e) => handleDeleteThread(e, thread.id)}
                      title="Delete thread"
                      style={{
                        position: "absolute",
                        right: "16px",
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
                        transition: "color 0.2s"
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.color = "var(--red)"}
                      onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-secondary)"}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </motion.div>
  );
}
