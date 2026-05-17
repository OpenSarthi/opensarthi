import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, ShieldAlert, Shield, X, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { usePermission } from "../../hooks/usePermission";
import { RISK_COLORS } from "../../lib/constants";
import type { RiskLevel } from "../../lib/schemas";

const RISK_ICONS: Record<RiskLevel, React.ReactNode> = {
  safe:      <Shield size={20} />,
  moderate:  <Shield size={20} />,
  dangerous: <AlertTriangle size={20} />,
  forbidden: <ShieldAlert size={20} />,
};

export function PermissionDialog() {
  const { pendingRequest, respond } = usePermission();
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    if (!pendingRequest) { setTimeLeft(0); return; }
    setTimeLeft(pendingRequest.timeout_seconds);
    const interval = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) { respond(false); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [pendingRequest]);

  if (!pendingRequest) return null;
  const color = RISK_COLORS[pendingRequest.risk_level];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: "fixed", inset: 0,
          background: "hsla(0,0%,0%,0.6)",
          backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: "var(--z-modal)",
          padding: "16px",
        }}
      >
        <motion.div
          initial={{ scale: 0.92, y: 12 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.92, y: 12 }}
          className="glass"
          style={{ width: "100%", maxWidth: "360px", padding: "20px" }}
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
            <div style={{ color }}>
              {RISK_ICONS[pendingRequest.risk_level]}
            </div>
            <div>
              <p style={{ fontSize: "13px", fontWeight: 600, textTransform: "capitalize" }}>
                {pendingRequest.risk_level} Action Required
              </p>
              <p style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                Auto-denying in {timeLeft}s
              </p>
            </div>
          </div>

          {/* Description */}
          <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "12px", lineHeight: 1.5 }}>
            {pendingRequest.description}
          </p>

          {/* Tool + args */}
          <div style={{
            background: "var(--bg-primary)", borderRadius: "var(--radius-sm)", padding: "10px 12px",
            fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-secondary)",
            marginBottom: "16px", border: "1px solid var(--border)",
          }}>
            <span style={{ color }}>{pendingRequest.tool}</span>
            {" "}
            {JSON.stringify(pendingRequest.args)}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: "8px", flexDirection: "column" }}>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                id="permission-allow-once"
                onClick={() => respond(true, false)}
                style={{
                  flex: 1, padding: "10px",
                  background: "var(--accent)", borderRadius: "var(--radius-sm)",
                  fontSize: "13px", fontWeight: 500, color: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                }}
              >
                <Check size={14} /> Allow Once
              </button>
              <button
                id="permission-deny"
                onClick={() => respond(false)}
                style={{
                  flex: 1, padding: "10px",
                  background: "var(--bg-tertiary)", borderRadius: "var(--radius-sm)",
                  fontSize: "13px", color: "var(--text-secondary)", border: "1px solid var(--border)",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                }}
              >
                <X size={14} /> Deny
              </button>
            </div>
            <button
              id="permission-allow-always"
              onClick={() => respond(true, true)}
              style={{
                padding: "8px",
                background: "transparent", border: "1px solid var(--border-accent)",
                borderRadius: "var(--radius-sm)", fontSize: "12px", color: "var(--accent)",
              }}
            >
              Allow Always for this action
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
