import React, { useRef, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Terminal } from "lucide-react";
import { useAssistantStore } from "../../stores/assistantStore";

interface RuntimeConsoleProps {
  isOpen: boolean;
  onClose: () => void;
  height: number;
  onResizeStart: (e: React.MouseEvent) => void;
}

export function RuntimeConsole({ isOpen, onClose, height, onResizeStart }: RuntimeConsoleProps) {
  const { sidecarLogs, clearSidecarLogs } = useAssistantStore();
  const consoleScrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  // Auto scroll to bottom when new logs arrive
  useEffect(() => {
    if (isOpen && consoleScrollRef.current) {
      consoleScrollRef.current.scrollTop = consoleScrollRef.current.scrollHeight;
    }
  }, [sidecarLogs, isOpen]);

  const handleCopy = () => {
    if (sidecarLogs.length > 0) {
      navigator.clipboard.writeText(sidecarLogs.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "100%", opacity: 0 }}
          transition={{ type: "spring", damping: 28, stiffness: 240 }}
          style={{
            position: "absolute",
            bottom: "-12px",
            left: "-12px",
            right: "-12px",
            height: `${height}px`,
            background: "#08080a",
            borderTop: "1.5px solid var(--border-accent)",
            boxShadow: "0 -10px 30px rgba(0,0,0,0.85)",
            zIndex: 900, // Above splitters and scrollbars, below onboarding (9999)
            display: "flex",
            flexDirection: "column",
            boxSizing: "border-box"
          }}
        >
          {/* Horizontal drag resizer handle */}
          <div
            onMouseDown={onResizeStart}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: "4px",
              cursor: "row-resize",
              zIndex: 11,
              background: "transparent",
              transition: "background 0.2s"
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--accent)"}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
          />

          {/* Console Header */}
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "8px 16px",
            borderBottom: "1px solid rgba(0, 230, 180, 0.15)",
            background: "rgba(0,0,0,0.3)",
            userSelect: "none"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Terminal size={12} color="var(--accent)" />
              <span style={{
                fontSize: "10px",
                fontWeight: "bold",
                color: "var(--accent)",
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.08em"
              }}>
                ⚙️ RUNTIME CONSOLE LOGCAT
              </span>
              <span style={{
                fontSize: "9px",
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
                background: "rgba(255,255,255,0.04)",
                padding: "1px 6px",
                borderRadius: "3px"
              }}>
                {sidecarLogs.length}/150 LINES
              </span>
            </div>
            
            <div style={{ display: "flex", gap: "14px", alignItems: "center" }}>
              <button
                onClick={handleCopy}
                disabled={sidecarLogs.length === 0}
                style={{
                  background: "transparent",
                  border: "none",
                  color: copied ? "var(--success, #00e6b4)" : "var(--text-secondary)",
                  fontSize: "9px",
                  fontFamily: "var(--font-mono)",
                  cursor: sidecarLogs.length === 0 ? "not-allowed" : "pointer",
                  transition: "color 0.15s",
                  fontWeight: copied ? "bold" : "normal"
                }}
                onMouseEnter={(e) => {
                  if (sidecarLogs.length > 0 && !copied) e.currentTarget.style.color = "var(--accent)";
                }}
                onMouseLeave={(e) => {
                  if (!copied) e.currentTarget.style.color = "var(--text-secondary)";
                }}
              >
                {copied ? "[ COPIED! ]" : "[ COPY LOGS ]"}
              </button>
              <button
                onClick={clearSidecarLogs}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--text-secondary)",
                  fontSize: "9px",
                  fontFamily: "var(--font-mono)",
                  cursor: "pointer",
                  transition: "color 0.15s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = "var(--accent)"}
                onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-secondary)"}
              >
                [ CLEAR ]
              </button>
              <button
                onClick={onClose}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--accent)",
                  fontSize: "9px",
                  fontFamily: "var(--font-mono)",
                  fontWeight: "bold",
                  cursor: "pointer"
                }}
              >
                [ HIDE × ]
              </button>
            </div>
          </div>

          {/* Console Log stream */}
          <div
            ref={consoleScrollRef}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "10px 16px 20px",
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              lineHeight: "1.5",
              display: "flex",
              flexDirection: "column",
              gap: "3.5px",
              scrollBehavior: "auto"
            }}
          >
            {sidecarLogs.length === 0 ? (
              <div style={{ color: "var(--text-muted)", opacity: 0.5 }}>// System runtime console active. Standard output streams will display here.</div>
            ) : (
              sidecarLogs.map((log, idx) => {
                const isErr = log.includes("[ERR]");
                return (
                  <div
                    key={idx}
                    style={{
                      color: isErr ? "var(--danger)" : "rgba(0, 230, 180, 0.85)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all"
                    }}
                  >
                    {log}
                  </div>
                );
              })
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
