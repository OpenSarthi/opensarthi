import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Play, AlertCircle, ChevronDown, ChevronUp, Book } from "lucide-react";
import { wsClient } from "../../lib/ws";
import { useAssistantStore } from "../../stores/assistantStore";

const KNOWN_TOOLS = [
  { name: "click",           args: "x, y" },
  { name: "type_text",       args: "text" },
  { name: "press_key",       args: "key" },
  { name: "open_app",        args: "app" },
  { name: "focus_window",    args: "title" },
  { name: "click_element",   args: "role, name" },
  { name: "observe_desktop", args: "(none)" },
  { name: "search_web",      args: "query" },
  { name: "get_weather",     args: "location" },
  { name: "set_timer",       args: "duration_seconds, label" },
  { name: "list_timers",     args: "(none)" },
  { name: "cancel_timer",    args: "label" },
  { name: "list_files",      args: "path" },
  { name: "open_path",       args: "path" },
  { name: "read_file",       args: "path" },
  { name: "set_volume",      args: "level" },
  { name: "get_battery",     args: "(none)" },
  { name: "toggle_wifi",     args: "(none)" },
  { name: "update_settings", args: "updates (object)" },
];
const KNOWN_TOOL_NAMES = new Set(KNOWN_TOOLS.map(t => t.name));

interface JsonImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function JsonImportModal({ isOpen, onClose }: JsonImportModalProps) {
  const [jsonInput, setJsonInput] = useState("");
  const [jsonError, setJsonError] = useState("");
  const [jsonWarning, setJsonWarning] = useState("");
  const [parsedSteps, setParsedSteps] = useState<any[] | null>(null);
  const [goalInput, setGoalInput] = useState("Custom JSON Task");
  const [showPreview, setShowPreview] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const addMessage = useAssistantStore((s) => s.addMessage);

  const validateJson = (raw: string) => {
    if (!raw.trim()) {
      setJsonError(""); setJsonWarning(""); setParsedSteps(null);
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : parsed.steps ? parsed.steps : [parsed];
      const bad = arr.find((s: any) => !s.tool);
      if (bad) {
        setJsonError('Each step must have a "tool" field.');
        setJsonWarning("");
        setParsedSteps(null);
        return;
      }
      const unknown = arr.filter((s: any) => !KNOWN_TOOL_NAMES.has(s.tool)).map((s: any) => s.tool);
      if (unknown.length > 0) {
        setJsonWarning(`Unknown tool(s): ${[...new Set(unknown)].join(", ")}. These may fail at runtime.`);
      } else {
        setJsonWarning("");
      }
      setParsedSteps(arr);
      setJsonError("");
    } catch (e: any) {
      setJsonError(e.message);
      setJsonWarning("");
      setParsedSteps(null);
    }
  };

  const handleRunJson = () => {
    if (!parsedSteps) return;
    const goal = goalInput || "Custom JSON Task";

    // Add user message locally so it displays instantly in the chat panel
    addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: `[JSON Plan] ${goal}`,
      timestamp: Date.now()
    });

    wsClient.send("run_json_plan", { steps: parsedSteps, goal });
    onClose();
    setJsonInput("");
    setParsedSteps(null);
    setGoalInput("Custom JSON Task");
    setShowPreview(false);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99999, // Ensure it sits above overlay containers
            background: "rgba(0, 0, 0, 0.05)",
            display: "flex",
            justifyContent: "flex-start",
            alignItems: "flex-start",
            padding: "54px 12px 12px 12px",
          }}
          onClick={onClose}
        >
          <motion.div
            initial={{ x: -250, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -250, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "560px",
              background: "rgba(10, 10, 10, 0.98)",
              border: "1px solid var(--border)",
              boxShadow: "0 15px 50px rgba(0, 0, 0, 0.8), inset 0 0 1px 1px rgba(255,255,255,0.03)",
              display: "flex",
              flexDirection: "column",
              gap: 16,
              padding: 24,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "white", letterSpacing: "0.03em" }}>Import JSON Task Plan</span>
              <button
                onClick={onClose}
                style={{
                  background: "none",
                  border: "none",
                  color: "rgba(255,255,255,0.4)",
                  cursor: "pointer",
                  padding: 4,
                }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Goal input */}
            <div>
              <label
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.4)",
                  letterSpacing: "0.06em",
                  display: "block",
                  marginBottom: 6,
                }}
              >
                TASK GOAL
              </label>
              <input
                type="text"
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                placeholder="Describe what this plan does..."
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  color: "white",
                  fontSize: 12,
                  outline: "none",
                  boxSizing: "border-box",
                  fontFamily: "inherit",
                }}
              />
            </div>

            {/* JSON textarea */}
            <div>
              <label
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.4)",
                  letterSpacing: "0.06em",
                  display: "block",
                  marginBottom: 6,
                }}
              >
                JSON PLAN (steps array)
              </label>
              <textarea
                value={jsonInput}
                onChange={(e) => {
                  setJsonInput(e.target.value);
                  validateJson(e.target.value);
                }}
                placeholder={'[\n  {"tool": "open_app", "args": {"app": "firefox"}, "description": "Open Firefox"},\n  {"tool": "type_text", "args": {"text": "hello world"}, "description": "Type text"},\n  {"tool": "press_key", "args": {"key": "Return"}, "description": "Press Enter"}\n]'}
                rows={8}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  resize: "vertical",
                  background: "rgba(255,255,255,0.04)",
                  border: `1px solid ${
                    jsonError
                      ? "rgba(255,80,80,0.4)"
                      : parsedSteps
                      ? "rgba(0,200,120,0.3)"
                      : "rgba(255,255,255,0.1)"
                  }`,
                  borderRadius: 8,
                  color: "white",
                  fontSize: 11,
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  outline: "none",
                  boxSizing: "border-box",
                  lineHeight: 1.6,
                  transition: "border-color 0.2s",
                }}
              />
              {jsonError && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 6, padding: "7px 10px", background: "rgba(255,80,80,0.08)", border: "1px solid rgba(255,80,80,0.2)", borderRadius: 6 }}>
                  <AlertCircle size={12} color="rgba(255,100,100,1)" style={{ flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 10, color: "rgba(255,120,120,1)", lineHeight: 1.5 }}>{jsonError}</span>
                </div>
              )}
              {jsonWarning && !jsonError && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 6, padding: "7px 10px", background: "rgba(255,200,0,0.07)", border: "1px solid rgba(255,200,0,0.2)", borderRadius: 6 }}>
                  <AlertCircle size={12} color="rgba(255,200,0,0.9)" style={{ flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 10, color: "rgba(255,200,80,0.9)", lineHeight: 1.5 }}>{jsonWarning}</span>
                </div>
              )}
            </div>

            {/* Available Tools Reference */}
            <div>
              <button
                onClick={() => setShowTools(p => !p)}
                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, padding: "5px 10px", cursor: "pointer", width: "100%" }}
              >
                <Book size={11} />
                {showTools ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                AVAILABLE TOOLS REFERENCE
              </button>
              <AnimatePresence>
                {showTools && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    style={{ overflow: "hidden" }}
                  >
                    <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, maxHeight: 180, overflowY: "auto", padding: "4px 0" }}>
                      {KNOWN_TOOLS.map(t => (
                        <div key={t.name} style={{ padding: "4px 8px", borderRadius: 4, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                          <div style={{ fontSize: 10, fontFamily: "monospace", color: "var(--accent)", fontWeight: 600 }}>{t.name}</div>
                          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>{t.args}</div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Preview toggle */}
            {parsedSteps && parsedSteps.length > 0 && (
              <div>
                <button
                  onClick={() => setShowPreview((p) => !p)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 10,
                    fontWeight: 600,
                    color: "rgba(0,200,120,0.9)",
                    background: "rgba(0,200,120,0.08)",
                    border: "1px solid rgba(0,200,120,0.2)",
                    borderRadius: 6,
                    padding: "5px 10px",
                    cursor: "pointer",
                  }}
                >
                  {showPreview ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  {parsedSteps.length} STEPS VALIDATED {showPreview ? "— HIDE" : "— SHOW"}
                </button>
                <AnimatePresence>
                  {showPreview && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      style={{ overflow: "hidden" }}
                    >
                      <div
                        style={{
                          marginTop: 8,
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                          maxHeight: 160,
                          overflowY: "auto",
                        }}
                      >
                        {parsedSteps.map((s, i) => (
                          <div
                            key={i}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "5px 10px",
                              borderRadius: 6,
                              background: "rgba(255,255,255,0.04)",
                              fontSize: 11,
                            }}
                          >
                            <span
                              style={{
                                color: "rgba(255,255,255,0.3)",
                                fontFamily: "monospace",
                                width: 18,
                                flexShrink: 0,
                              }}
                            >
                              {i + 1}.
                            </span>
                            <span style={{ color: "var(--accent)", fontFamily: "monospace" }}>
                              {s.tool}
                            </span>
                            <span
                              style={{
                                color: "rgba(255,255,255,0.4)",
                                flex: 1,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {s.description || JSON.stringify(s.args)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 4 }}>
              <button
                onClick={onClose}
                style={{
                  padding: "8px 16px",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 8,
                  color: "rgba(255,255,255,0.5)",
                  cursor: "pointer",
                }}
              >
                CANCEL
              </button>
              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.97 }}
                onClick={handleRunJson}
                disabled={!parsedSteps || parsedSteps.length === 0}
                style={{
                  padding: "8px 20px",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  background: parsedSteps
                    ? "var(--accent)"
                    : "rgba(255,255,255,0.08)",
                  border: "none",
                  borderRadius: 8,
                  color: parsedSteps ? "black" : "rgba(255,255,255,0.3)",
                  cursor: parsedSteps ? "pointer" : "not-allowed",
                  boxShadow: parsedSteps ? "0 4px 16px var(--accent-glow)" : "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Play size={11} fill="currentColor" /> RUN NOW
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
