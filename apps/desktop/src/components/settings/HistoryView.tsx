import { useEffect, useRef, useState } from "react";
import { X, MessageSquare, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { useAssistantStore } from "../../stores/assistantStore";
import { wsClient } from "../../lib/ws";
import { useModalFocusTrap } from "../../hooks/useModalFocusTrap";
import { HudCorners } from "../assistant/HudCorners";

interface HistoryViewProps {
  onClose: () => void;
}

export function HistoryView({ onClose }: HistoryViewProps) {
  const { threads } = useAssistantStore();
  const [hoveredThreadId, setHoveredThreadId] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useModalFocusTrap<HTMLDivElement>({ onClose, initialFocusRef: closeButtonRef });

  useEffect(() => {
    wsClient.send("get_history", {});
  }, []);

  const handleLoadThread = (id: string) => {
    wsClient.send("load_thread", { thread_id: id });
    onClose();
  };

  const handleDeleteThread = (e: React.MouseEvent | React.KeyboardEvent, id: string) => {
    e.stopPropagation();
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
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-dialog-title"
      className="os-scrim"
      style={{ zIndex: 50 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        ref={modalRef}
        className="hud-panel os-dialog"
        initial={{ scale: 0.93, y: 15, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.93, y: 15, opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 350 }}
        style={{
          width: "680px",
          height: "580px",
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
          position: "relative",
        }}
      >
        <HudCorners />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 id="history-dialog-title" style={{ fontSize: "16px", color: "var(--accent)", letterSpacing: "0.1em", fontWeight: "bold", margin: 0 }}>
            // PAST THREADS
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {threads.length > 0 && (
              <button
                id="delete-all-threads"
                onClick={handleDeleteAll}
                title="Delete all threads"
                aria-label="Delete all threads"
                style={{
                  color: "var(--text-secondary)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  minWidth: "28px",
                  minHeight: "28px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "color 0.2s"
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = "var(--danger)"}
                onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-secondary)"}
              >
                <Trash2 size={18} />
              </button>
            )}
            <button
              ref={closeButtonRef}
              onClick={onClose}
              aria-label="Close history"
              style={{
                color: "var(--text-secondary)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                minWidth: "28px",
                minHeight: "28px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div
          role="list"
          aria-label="Conversation threads"
          style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px", paddingRight: "4px", paddingBottom: "24px" }}
        >
          {threads.length === 0 ? (
            <div role="status" style={{ color: "var(--text-secondary)", fontSize: "13px", textAlign: "center", marginTop: "40px" }}>
              NO PAST THREADS FOUND
            </div>
          ) : (
            threads.map((thread) => {
              const isHovered = hoveredThreadId === thread.id;
              return (
                <div
                  key={thread.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Load thread: ${thread.first_message || "Empty Conversation"}`}
                  onClick={() => handleLoadThread(thread.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleLoadThread(thread.id);
                    } else if (e.key === "Delete") {
                      e.preventDefault();
                      handleDeleteThread(e, thread.id);
                    }
                  }}
                  onMouseEnter={() => setHoveredThreadId(thread.id)}
                  onMouseLeave={() => setHoveredThreadId(null)}
                  onFocus={() => setHoveredThreadId(thread.id)}
                  onBlur={() => setHoveredThreadId(null)}
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
                    transition: "all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)",
                    outline: "none", // focus ring provided by :focus-visible in globals.css
                  }}
                >
                  <MessageSquare size={16} style={{ color: isHovered ? "var(--accent)" : "var(--text-secondary)", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0, paddingRight: "36px" }}>
                    <div style={{ fontSize: "13px", color: isHovered ? "var(--text-primary)" : "var(--text-secondary)", fontWeight: "500", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {thread.first_message || "Empty Conversation"}
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--text-secondary)", opacity: 0.85, marginTop: "4px", fontFamily: "var(--font-mono)" }}>
                      {new Date(thread.created_at).toLocaleString()}
                    </div>
                  </div>

                  <button
                    className="delete-thread-btn"
                    onClick={(e) => handleDeleteThread(e, thread.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleDeleteThread(e, thread.id); } }}
                    title="Delete thread"
                    aria-label={`Delete thread: ${thread.first_message || "Empty Conversation"}`}
                    tabIndex={0}
                    style={{
                      position: "absolute",
                      right: "16px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: isHovered ? "var(--text-secondary)" : "transparent",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      padding: "4px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "color 0.2s",
                      // Always rendered (not conditionally mounted) so screen readers see it;
                      // visually transparent when row is not focused/hovered
                      pointerEvents: isHovered ? "auto" : "none",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.color = "var(--danger)"}
                    onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-secondary)"}
                    onFocus={(e) => { e.currentTarget.style.color = "var(--danger)"; setHoveredThreadId(thread.id); }}
                    onBlur={(e) => { e.currentTarget.style.color = "transparent"; }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

