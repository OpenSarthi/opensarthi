import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, XCircle, Loader2, Circle, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import type { Plan, PlanStep } from "../../lib/schemas";

const STEP_ICON: Record<PlanStep["status"], React.ReactNode> = {
  pending:  <Circle size={14} style={{ color: "var(--text-muted)" }} />,
  running:  <Loader2 size={14} className="animate-spin" style={{ color: "var(--accent)" }} />,
  success:  <CheckCircle2 size={14} style={{ color: "var(--success)" }} />,
  error:    <XCircle size={14} style={{ color: "var(--danger)" }} />,
  skipped:  <Circle size={14} style={{ color: "var(--text-muted)", opacity: 0.4 }} />,
};

function StepRow({ step }: { step: PlanStep }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = step.error || step.result;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      style={{
        padding: "8px 10px",
        borderRadius: "var(--radius-sm)",
        background: step.status === "running" ? "var(--accent-glow)" : "transparent",
        border: `1px solid ${step.status === "running" ? "var(--border-accent)" : "transparent"}`,
        cursor: hasDetails ? "pointer" : "default",
        transition: "background var(--transition-fast)",
      }}
      onClick={() => hasDetails && setExpanded((e) => !e)}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {STEP_ICON[step.status]}
        <span style={{ fontSize: "12px", flex: 1, color: "var(--text-secondary)" }}>
          <span style={{ color: "var(--text-muted)", marginRight: "4px" }}>{step.tool}</span>
          {step.description}
        </span>
        {hasDetails && (
          expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />
        )}
      </div>
      <AnimatePresence>
        {expanded && hasDetails && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{
              marginTop: "6px",
              padding: "6px 8px",
              background: "var(--bg-primary)",
              borderRadius: "var(--radius-sm)",
              fontSize: "11px",
              fontFamily: "var(--font-mono)",
              color: step.error ? "var(--danger)" : "var(--text-secondary)",
              overflow: "hidden",
              wordBreak: "break-all",
            }}
          >
            {step.error ?? JSON.stringify(step.result, null, 2)}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

interface ActionLogProps {
  plan: Plan | null;
}

export function ActionLog({ plan }: ActionLogProps) {
  if (!plan) return null;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      style={{
        background: "var(--bg-secondary)",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border)",
        padding: "10px",
        overflow: "hidden",
      }}
    >
      <p style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        Execution Plan
      </p>
      <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px" }}>
        {plan.goal}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {plan.steps.map((step) => (
          <StepRow key={step.index} step={step} />
        ))}
      </div>
    </motion.div>
  );
}
