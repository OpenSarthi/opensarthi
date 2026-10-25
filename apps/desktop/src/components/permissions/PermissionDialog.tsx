import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, ShieldAlert, Shield, X, Check, ShieldCheck, Terminal, Clock } from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { usePermission } from "../../hooks/usePermission";
import { RISK_COLORS } from "../../lib/constants";
import type { RiskLevel } from "../../lib/schemas";
import { useModalFocusTrap } from "../../hooks/useModalFocusTrap";

const RISK_ICONS: Record<RiskLevel, React.ReactNode> = {
  safe:      <Shield size={18} />,
  moderate:  <Shield size={18} />,
  dangerous: <AlertTriangle size={18} />,
  forbidden: <ShieldAlert size={18} />,
};

export function PermissionDialog() {
  const { pendingRequest, respond } = usePermission();
  const [timeLeft, setTimeLeft] = useState(0);
  const allowButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useModalFocusTrap<HTMLDivElement>({
    onClose: () => respond(false),
    initialFocusRef: allowButtonRef,
    enabled: !!pendingRequest,
  });

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
  }, [pendingRequest, respond]);

  const color = pendingRequest ? RISK_COLORS[pendingRequest.risk_level] : undefined;

  // Extract full command or text parameter if available
  const getFullCommand = (): string | null => {
    if (!pendingRequest?.args) return null;
    const args = pendingRequest.args as Record<string, any>;
    if (typeof args.command === "string") return args.command;
    if (typeof args.cmd === "string") return args.cmd;
    if (typeof args.text === "string") return args.text;
    if (typeof args.script === "string") return args.script;
    if (typeof args.url === "string") return args.url;
    return null;
  };

  const fullCommand = getFullCommand();
  const rawArgs = pendingRequest?.args as Record<string, any> | undefined;

  return (
    <AnimatePresence>
      {pendingRequest && color && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="os-scrim"
          style={{ padding: "20px" }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="permission-dialog-title"
        >
          <motion.div
            ref={modalRef}
            initial={{ scale: 0.92, y: 16, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.92, y: 16, opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 360 }}
            className="os-dialog"
            style={{
              width: "min(580px, 94vw)",
              border: `1px solid ${color}55`,
              padding: "22px 24px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{
                  padding: "8px",
                  borderRadius: "8px",
                  background: `${color}18`,
                  border: `1px solid ${color}44`,
                  color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  {RISK_ICONS[pendingRequest.risk_level]}
                </div>
                <div>
                  <h3 id="permission-dialog-title" style={{ fontSize: "13px", fontWeight: "bold", color: "var(--text-primary)", letterSpacing: "0.08em", margin: 0, textTransform: "uppercase" }}>
                    {pendingRequest.risk_level} ACTION REQUIRED
                  </h3>
                  <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: "2px 0 0 0", fontFamily: "var(--font-mono)", display: "flex", alignItems: "center", gap: "4px" }}>
                    <Clock size={12} /> AUTO-DENYING IN {timeLeft}S
                  </p>
                </div>
              </div>

              {/* Tool badge */}
              <div style={{
                fontSize: "10px",
                fontFamily: "var(--font-mono)",
                fontWeight: "bold",
                padding: "4px 10px",
                borderRadius: "99px",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "var(--accent)",
                letterSpacing: "0.08em",
              }}>
                {pendingRequest.tool.toUpperCase()}
              </div>
            </div>

            {/* Description */}
            <p style={{
              fontSize: "11.5px",
              color: "rgba(255,255,255,0.75)",
              lineHeight: "1.5",
              margin: 0,
            }}>
              {pendingRequest.description}
            </p>

            {/* Full Command display box */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "9.5px", color: "var(--text-muted)", letterSpacing: "0.08em", fontWeight: "bold", display: "flex", alignItems: "center", gap: "5px" }}>
                  <Terminal size={11} color="var(--accent)" /> FULL REQUESTED COMMAND
                </span>
              </div>
              <div style={{
                background: "rgba(0, 0, 0, 0.65)",
                border: `1px solid ${color}44`,
                borderRadius: "8px",
                padding: "12px 14px",
                fontFamily: "var(--font-mono)",
                fontSize: "11.5px",
                color: "#00ff9f",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                lineHeight: "1.55",
                maxHeight: "180px",
                overflowY: "auto",
                boxShadow: "inset 0 0 20px rgba(0,0,0,0.6)",
              }}>
                {fullCommand ?? JSON.stringify(rawArgs, null, 2)}
              </div>
            </div>

            {/* Additional parameters if command was extracted separately */}
            {fullCommand && rawArgs && Object.keys(rawArgs).filter(k => k !== "command" && k !== "cmd").length > 0 && (
              <div style={{
                padding: "8px 12px",
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: "6px",
                fontSize: "10px",
                fontFamily: "var(--font-mono)",
                color: "var(--text-muted)",
                display: "flex",
                flexWrap: "wrap",
                gap: "10px",
              }}>
                {Object.entries(rawArgs)
                  .filter(([k]) => k !== "command" && k !== "cmd")
                  .map(([k, v]) => (
                    <span key={k}>
                      <strong style={{ color: "var(--text-secondary)" }}>{k}:</strong> {JSON.stringify(v)}
                    </span>
                  ))}
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "4px" }}>
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  ref={allowButtonRef}
                  id="permission-allow-once"
                  onClick={() => respond(true, false)}
                  style={{
                    flex: 1,
                    padding: "10px 14px",
                    background: "var(--accent-glow)",
                    border: "1px solid var(--border-accent)",
                    borderRadius: "6px",
                    fontSize: "11px",
                    fontWeight: "bold",
                    color: "var(--accent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    cursor: "pointer",
                    letterSpacing: "0.08em",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.filter = "brightness(1.2)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.filter = "none"; }}
                >
                  <Check size={14} /> ALLOW ONCE
                </button>

                <button
                  id="permission-deny"
                  onClick={() => respond(false)}
                  style={{
                    flex: 1,
                    padding: "10px 14px",
                    background: "rgba(255, 60, 60, 0.14)",
                    border: "1px solid rgba(255, 60, 60, 0.4)",
                    borderRadius: "6px",
                    fontSize: "11px",
                    fontWeight: "bold",
                    color: "#ff5555",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    cursor: "pointer",
                    letterSpacing: "0.08em",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255, 60, 60, 0.25)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255, 60, 60, 0.14)"; }}
                >
                  <X size={14} /> DENY
                </button>
              </div>

              <button
                id="permission-allow-always"
                onClick={() => respond(true, true)}
                style={{
                  padding: "9px 14px",
                  background: "var(--accent-glow-lg)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  fontSize: "11px",
                  fontWeight: "bold",
                  color: "var(--accent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  cursor: "pointer",
                  letterSpacing: "0.08em",
                  transition: "all 0.15s",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.filter = "brightness(1.2)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.filter = "none"; }}
              >
                <ShieldCheck size={14} /> ALLOW ALWAYS FOR THIS ACTION
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
