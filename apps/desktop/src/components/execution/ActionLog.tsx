import { motion } from "framer-motion";
import type { Plan, Message } from "../../lib/schemas";

interface ActionLogProps {
  plan: Plan | null;
  selectedTaskId: string | null;
  messages: Message[];
}

export function ActionLog({ plan, selectedTaskId, messages }: ActionLogProps) {
  const hasActivePlan = !!plan;

  // Derive agentic tasks to locate the selected task's tool actions
  const agenticTasks: any[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "user") continue;

    const nextAssistant = messages.slice(i + 1).find(m => m.role === "assistant");
    if (!nextAssistant) {
      if (hasActivePlan && i === messages.length - 1) {
        agenticTasks.push({
          id: msg.id,
          status: "running",
          toolActions: plan ? plan.steps.map(s => ({
            tool: s.tool,
            description: s.description || s.tool,
            status: s.status || "pending",
            result: s.result,
            timestamp: s.timestamp,
          })) : []
        });
      }
      continue;
    }

    const isTask = nextAssistant.content.includes("✓ ") ||
                   nextAssistant.content.includes("Task completed successfully") ||
                   nextAssistant.content.includes("❌ Failed at step") ||
                   nextAssistant.content.includes("Execution cancelled by user.");
    if (!isTask) continue;

    const toolActions: any[] = [];
    const lines = nextAssistant.content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("✓ ")) {
        toolActions.push({ tool: "step", description: trimmed.slice(2), status: "success", timestamp: nextAssistant.timestamp });
      } else if (trimmed.startsWith("❌")) {
        const cleanDesc = trimmed.startsWith("❌ ") ? trimmed.slice(2) : trimmed.slice(1);
        const stepStatus = cleanDesc.includes("(Reason: Terminated)") ? "terminated" : "error";
        toolActions.push({ tool: "step", description: cleanDesc, status: stepStatus, timestamp: nextAssistant.timestamp });
      }
    }

    let taskStatus = "success";
    if (nextAssistant.content.includes("Execution cancelled by user.")) {
      taskStatus = "terminated";
    } else if (nextAssistant.content.includes("❌")) {
      taskStatus = "error";
    }

    agenticTasks.push({
      id: msg.id,
      status: taskStatus,
      toolActions,
    });
  }

  // Get actions to display
  let actions: any[] = [];
  const selectedTask = agenticTasks.find(t => t.id === selectedTaskId);
  
  if (selectedTask) {
    if (selectedTask.status === "running" && plan) {
      actions = plan.steps.map(s => ({
        tool: s.tool,
        description: s.description || s.tool,
        status: s.status || "pending",
        result: s.result,
        timestamp: s.timestamp,
      }));
    } else {
      actions = selectedTask.toolActions || [];
    }
  } else if (plan) {
    // If no task is selected, but a plan is currently running, show it
    actions = plan.steps.map(s => ({
      tool: s.tool,
      description: s.description || s.tool,
      status: s.status || "pending",
      result: s.result,
      timestamp: s.timestamp,
    }));
  }

  // Sort: newest at top (reverse order of execution/indices)
  const reversedActions = [...actions].reverse();

  if (reversedActions.length === 0) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.5, minHeight: "120px" }}>
        <p style={{ color: "var(--text-secondary)", fontSize: "11px", letterSpacing: "0.05em", textAlign: "center" }}>
          // NO ACTIVE ACTIVITY LOGS
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
      {reversedActions.map((action, idx) => {
        const isRunning = action.status === "running";
        const isSuccess = action.status === "success";
        const isError = action.status === "error" || action.status === "failed";
        const isTerminated = action.status === "terminated";
        
        let statusColor = "var(--text-muted)";
        let statusText = "QUEUED";
        let cardBg = "rgba(0, 0, 0, 0.25)";
        let cardBorder = "1px solid var(--border)";
        let glow = "none";
        
        if (isRunning) {
          statusColor = "var(--accent)";
          statusText = "RUNNING";
          cardBg = "rgba(255, 0, 0, 0.15)";
          cardBorder = "1px solid var(--accent)";
          glow = "0 0 10px var(--accent-glow)";
        } else if (isSuccess) {
          statusColor = "var(--success)";
          statusText = "SUCCESS";
          cardBg = "rgba(0, 230, 180, 0.04)";
          cardBorder = "1px solid rgba(0, 230, 180, 0.15)";
        } else if (isError) {
          statusColor = "var(--danger)";
          statusText = "FAILED";
          cardBg = "rgba(255, 60, 60, 0.04)";
          cardBorder = "1px solid rgba(255, 60, 60, 0.15)";
        } else if (isTerminated) {
          statusColor = "var(--text-muted)";
          statusText = "TERMINATED";
          cardBg = "rgba(255, 255, 255, 0.02)";
          cardBorder = "1px solid rgba(255, 255, 255, 0.08)";
        }

        return (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
              padding: "10px 12px",
              borderRadius: "var(--radius-md)",
              background: cardBg,
              border: cardBorder,
              boxShadow: glow,
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              transition: "all 0.15s ease-in-out",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: "10px", fontWeight: "bold", fontFamily: "var(--font-mono)", color: "var(--accent)", textTransform: "uppercase" }}>
                {action.tool}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "9px", color: statusColor, fontWeight: "bold", letterSpacing: "0.05em" }}>
                  {statusText}
                </span>
                {action.timestamp && (
                  <span style={{ fontSize: "9px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)", opacity: 0.85 }}>
                    [{new Date(action.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}]
                  </span>
                )}
              </div>
            </div>
            <div style={{ fontSize: "11px", color: "var(--text-secondary)", lineHeight: "1.4", fontFamily: "var(--font-mono)" }}>
              {action.description}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
