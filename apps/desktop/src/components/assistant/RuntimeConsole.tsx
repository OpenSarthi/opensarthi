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
  const { sidecarLogs, clearSidecarLogs, activeTheme } = useAssistantStore();
  const consoleScrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const isLightTheme = activeTheme.includes("light")
    || activeTheme.includes("white")
    || (typeof document !== "undefined" && (
      document.body.classList.contains("theme-light-emerald")
      || document.body.classList.contains("theme-light-cobalt")
      || document.body.classList.contains("theme-light-crimson")
      || document.body.classList.contains("theme-light-clean")
      || document.body.classList.contains("theme-light-slate")
      || document.body.classList.contains("theme-light-sakura")
      || document.body.className.includes("white")
      || document.body.className.includes("light")
    ));

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
          role="region"
          aria-label="Runtime Console Logcat"
          className="runtime-console-drawer hud-panel"
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "100%", opacity: 0 }}
          transition={{ type: "spring", damping: 28, stiffness: 240 }}
          style={{
            position: "absolute",
            bottom: 0,
            left: 8,
            right: 8,
            height: `${height}px`,
            background: isLightTheme ? "rgba(255, 255, 255, 0.98)" : "rgba(14, 18, 16, 0.97)",
            backdropFilter: "blur(28px)",
            WebkitBackdropFilter: "blur(28px)",
            border: `1.5px solid var(--border-focus, ${isLightTheme ? "rgba(0, 0, 0, 0.18)" : "rgba(255, 255, 255, 0.14)"})`,
            borderBottom: "none",
            borderTopLeftRadius: "var(--radius-xl)",
            borderTopRightRadius: "var(--radius-xl)",
            boxShadow: isLightTheme
              ? "0 2px 6px rgba(0, 0, 0, 0.06), 0 -12px 32px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 1)"
              : "0 0 1px 1px rgba(255, 255, 255, 0.12), 0 2px 8px rgba(255, 255, 255, 0.04), 0 -16px 44px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255, 255, 255, 0.22)",
            zIndex: 900, // Above splitters and scrollbars, below onboarding (9999)
            display: "flex",
            flexDirection: "column",
            boxSizing: "border-box",
            overflow: "hidden",
          }}
        >
          {/* Tactical curved corner brackets on top-left and top-right */}
          <div className="hud-corner hud-corner-tl" style={{ borderTopLeftRadius: "var(--radius-xl)" }} />
          <div className="hud-corner hud-corner-tr" style={{ borderTopRightRadius: "var(--radius-xl)" }} />
          {/* Horizontal drag resizer handle */}
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize runtime console height"
            tabIndex={0}
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
            padding: "10px 16px",
            borderBottom: isLightTheme ? "1px solid rgba(0, 0, 0, 0.08)" : "1px solid var(--line-soft)",
            background: isLightTheme ? "rgba(0, 0, 0, 0.02)" : "transparent",
            userSelect: "none"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Terminal size={13} color="var(--accent)" />
              <span style={{
                fontSize: "11px",
                fontWeight: "bold",
                color: "var(--accent)",
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.08em"
              }}>
                ⚙️ RUNTIME CONSOLE LOGCAT
              </span>
              <span style={{
                fontSize: "11px",
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
                background: isLightTheme ? "rgba(0, 0, 0, 0.06)" : "rgba(255, 255, 255, 0.06)",
                padding: "2px 6px",
                borderRadius: "var(--radius-sm)"
              }}>
                {sidecarLogs.length}/150 LINES
              </span>
            </div>
            
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <button
                onClick={handleCopy}
                disabled={sidecarLogs.length === 0}
                aria-label="Copy runtime logs to clipboard"
                style={{
                  background: "transparent",
                  border: "none",
                  color: copied ? "var(--success, #00e6b4)" : "var(--text-secondary)",
                  fontSize: "11px",
                  fontFamily: "var(--font-mono)",
                  cursor: sidecarLogs.length === 0 ? "not-allowed" : "pointer",
                  transition: "color 0.15s",
                  fontWeight: copied ? "bold" : "normal",
                  minHeight: "28px",
                  minWidth: "28px",
                  padding: "4px 8px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center"
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
                aria-label="Clear runtime logs"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--text-secondary)",
                  fontSize: "11px",
                  fontFamily: "var(--font-mono)",
                  cursor: "pointer",
                  transition: "color 0.15s",
                  minHeight: "28px",
                  minWidth: "28px",
                  padding: "4px 8px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = "var(--accent)"}
                onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-secondary)"}
              >
                [ CLEAR ]
              </button>
              <button
                onClick={onClose}
                aria-label="Hide runtime console"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--accent)",
                  fontSize: "11px",
                  fontFamily: "var(--font-mono)",
                  fontWeight: "bold",
                  cursor: "pointer",
                  minHeight: "28px",
                  minWidth: "28px",
                  padding: "4px 8px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center"
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
              <div style={{ color: "var(--text-muted)", opacity: 0.8 }}>Runtime console ready. Standard output will stream here.</div>
            ) : (
              sidecarLogs.map((log, idx) => {
                const isErr = log.includes("[ERR]");
                const isWarn = log.includes("[WARN") || log.toLowerCase().includes("warning");
                return (
                  <div
                    key={idx}
                    style={{
                      color: isErr
                        ? "var(--danger, #dc2626)"
                        : isWarn
                          ? (isLightTheme ? "#b45309" : "#f59e0b")
                          : (isLightTheme ? "var(--text-primary, #0f172a)" : "var(--accent)"),
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
