import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Play, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { wsClient } from "../../lib/ws";
import { useAssistantStore } from "../../stores/assistantStore";

interface JsonImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function JsonImportModal({ isOpen, onClose }: JsonImportModalProps) {
  const [jsonInput, setJsonInput] = useState("");
  const [jsonError, setJsonError] = useState("");
  const [parsedSteps, setParsedSteps] = useState<any[] | null>(null);
  const [goalInput, setGoalInput] = useState("Custom JSON Task");
  const [showPreview, setShowPreview] = useState(false);
  const addMessage = useAssistantStore((s) => s.addMessage);

  const validateJson = (raw: string) => {
    if (!raw.trim()) {
      setJsonError("");
      setParsedSteps(null);
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : parsed.steps ? parsed.steps : [parsed];
      const bad = arr.find((s: any) => !s.tool);
      if (bad) {
        setJsonError('Each step must have a "tool" field.');
        setParsedSteps(null);
        return;
      }
      setParsedSteps(arr);
      setJsonError("");
    } catch (e: any) {
      setJsonError(e.message);
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
            background: "rgba(0,0,0,0.8)",
            backdropFilter: "blur(12px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 16 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(560px, 92vw)",
              background: "rgba(10,10,18,0.97)",
              border: "1.5px solid var(--border-accent)",
              borderRadius: 16,
              padding: 24,
              display: "flex",
              flexDirection: "column",
              gap: 16,
              boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)",
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
                placeholder={
                  '[\n  {"tool": "open_app", "args": {"app": "firefox"}, "description": "Open Firefox"},\n  {"tool": "wait_for_window", "args": {"title": "Firefox"}, "description": "Wait for Firefox"}\n]'
                }
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
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 6,
                    marginTop: 6,
                    padding: "7px 10px",
                    background: "rgba(255,80,80,0.08)",
                    border: "1px solid rgba(255,80,80,0.2)",
                    borderRadius: 6,
                  }}
                >
                  <AlertCircle size={12} color="rgba(255,100,100,1)" style={{ flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 10, color: "rgba(255,120,120,1)", lineHeight: 1.5 }}>
                    {jsonError}
                  </span>
                </div>
              )}
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
