import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { KeyRound, ShieldQuestion, Send, X } from "lucide-react";
import { usePermissionStore } from "../../stores/permissionStore";
import { wsClient } from "../../lib/ws";

export function InputDialog() {
  const { pendingInputRequest, setPendingInputRequest } = usePermissionStore();
  const [value, setValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    wsClient.send("input_response", { value });
    setValue("");
    setPendingInputRequest(null);
  };

  const handleCancel = () => {
    wsClient.send("input_response", { value: "" });
    setValue("");
    setPendingInputRequest(null);
  };

  return (
    <AnimatePresence>
      {pendingInputRequest && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.15)",
            backdropFilter: "blur(32px) saturate(180%)",
            WebkitBackdropFilter: "blur(32px) saturate(180%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 99999,
            padding: "16px",
          }}
        >
          <motion.div
            initial={{ scale: 0.92, y: 12, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.92, y: 12, opacity: 0 }}
            style={{
              width: "min(440px, 94vw)",
              background: "rgba(4, 8, 20, 0.92)",
              backdropFilter: "blur(24px) saturate(160%)",
              WebkitBackdropFilter: "blur(24px) saturate(160%)",
              border: "1px solid rgba(0, 230, 180, 0.25)",
              borderRadius: "12px",
              boxShadow: "0 32px 80px rgba(0,0,0,0.85), inset 0 0 30px rgba(0,230,180,0.05)",
              padding: "24px",
            }}
          >
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
              <div style={{
                background: "rgba(100, 108, 255, 0.15)",
                color: "var(--accent)",
                padding: "10px",
                borderRadius: "10px"
              }}>
                {pendingInputRequest.input_type === "password" ? <KeyRound size={22} /> : <ShieldQuestion size={22} />}
              </div>
              <div>
                <h3 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>
                  {pendingInputRequest.input_type === "password" ? "Authentication Required" : "Input Required"}
                </h3>
                <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: 0 }}>
                  Agent paused waiting for your response
                </p>
              </div>
            </div>

            {/* Prompt Message */}
            <p style={{
              fontSize: "13px",
              color: "var(--text-secondary)",
              marginBottom: "16px",
              lineHeight: 1.5,
              background: "rgba(255, 255, 255, 0.03)",
              padding: "10px 12px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)"
            }}>
              {pendingInputRequest.prompt}
            </p>

            {/* Form */}
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <input
                id="input-dialog-field"
                type={pendingInputRequest.input_type}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={pendingInputRequest.input_type === "password" ? "Sudo password..." : "Enter text..."}
                autoFocus
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  fontSize: "13px",
                  background: "var(--bg-primary)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--text-primary)",
                  outline: "none",
                  transition: "border-color 0.2s"
                }}
                onFocus={(e) => e.target.style.borderColor = "var(--accent)"}
                onBlur={(e) => e.target.style.borderColor = "var(--border)"}
              />

              {/* Buttons */}
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  id="input-dialog-cancel"
                  type="button"
                  onClick={handleCancel}
                  style={{
                    flex: 1,
                    padding: "10px",
                    background: "var(--bg-tertiary)",
                    borderRadius: "var(--radius-sm)",
                    fontSize: "13px",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    cursor: "pointer"
                  }}
                >
                  <X size={14} /> Cancel
                </button>
                <button
                  id="input-dialog-submit"
                  type="submit"
                  style={{
                    flex: 1,
                    padding: "10px",
                    background: "var(--accent)",
                    borderRadius: "var(--radius-sm)",
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    border: "none",
                    cursor: "pointer"
                  }}
                >
                  <Send size={14} /> Submit
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
