import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Plan, Message } from "../../lib/schemas";
import { useAssistantStore } from "../../stores/assistantStore";

interface ActionLogProps {
  plan: Plan | null;
  selectedTaskId: string | null;
  messages: Message[];
}

export interface ParsedToolAction {
  tool: string;
  description: string;
  status: "pending" | "running" | "success" | "error" | "skipped" | "terminated" | "divider";
  result?: string;
  timestamp?: number;
  args?: Record<string, any>;
}

export function parseRawLine(descText: string) {
  let tool = "step";
  let args: any = undefined;
  
  const knownTools = [
    "click", "type_text", "press_key", "open_app", "focus_window", "click_element", "observe_desktop", 
    "shell", "wait_for_window", "wait_for_text", "self_fix", "search_web", "get_weather", "set_timer", 
    "list_timers", "cancel_timer", "list_files", "open_path", "read_file", "set_volume", "get_battery", 
    "toggle_wifi", "save_note", "remember", "recall", "forget_memory", "media_control"
  ];
  
  const words = descText.split(/\s+/);
  const firstWord = words[0]?.toLowerCase().replace(/:$/, "");
  if (knownTools.includes(firstWord)) {
    tool = firstWord;
  }
  
  const startIdx = descText.indexOf('{');
  const endIdx = descText.lastIndexOf('}');
  if (startIdx !== -1 && endIdx > startIdx) {
    try {
      const jsonStr = descText.substring(startIdx, endIdx + 1);
      args = JSON.parse(jsonStr);
    } catch (e) {
      // Not valid JSON
    }
  }
  
  // Extra parsing fallback for shell command without JSON
  if (tool === "shell" && !args) {
    const colonIdx = descText.indexOf(":");
    if (colonIdx !== -1) {
      args = { command: descText.substring(colonIdx + 1).trim() };
    }
  }
  
  return { tool, args };
}

export function getArgsFromAction(action: ParsedToolAction): Record<string, any> | null {
  if (action.args && typeof action.args === 'object' && Object.keys(action.args).length > 0) {
    return action.args;
  }
  
  const desc = action.description;
  if (!desc) return null;
  
  const startIdx = desc.indexOf('{');
  const endIdx = desc.lastIndexOf('}');
  if (startIdx !== -1 && endIdx > startIdx) {
    try {
      const jsonStr = desc.substring(startIdx, endIdx + 1);
      const parsed = JSON.parse(jsonStr);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch (e) {
      // ignore
    }
  }
  
  return null;
}

const limitLength = (str: string, maxLen: number = 40) => {
  if (typeof str !== 'string') return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
};

const renderActionDetails = (action: ParsedToolAction) => {
  const args = getArgsFromAction(action);
  const toolName = action.tool?.toLowerCase();
  
  if (!args && !toolName) return null;
  
  let detailsText = "";
  let isCommandLine = false;
  
  if (toolName === "shell" && args?.command) {
    detailsText = args.command;
    isCommandLine = true;
  } else if (toolName === "click" && args?.x !== undefined && args?.y !== undefined) {
    detailsText = `X: ${args.x}, Y: ${args.y}${args.button ? ` | BUTTON: ${args.button}` : ""}`;
  } else if (toolName === "type_text" && args?.text) {
    detailsText = `"${limitLength(args.text, 50)}"`;
  } else if (toolName === "press_key" && args?.key) {
    detailsText = `"${args.key}"`;
  } else if (toolName === "click_element" && args?.name) {
    detailsText = `Role: ${args.role || "any"} | Name: "${args.name}"`;
  } else if (toolName === "open_app" && args?.name) {
    detailsText = `"${args.name}"`;
  } else if (toolName === "focus_window" && args?.title) {
    detailsText = `Title: "${limitLength(args.title, 40)}"`;
  } else if (toolName === "search_web" && args?.query) {
    detailsText = `Query: "${limitLength(args.query, 50)}"`;
  } else if (toolName === "get_weather" && args?.location) {
    detailsText = `Location: "${args.location}"`;
  } else if (toolName === "set_timer" && args?.duration_minutes !== undefined) {
    detailsText = `Duration: ${args.duration_minutes}m${args.label ? ` | Label: "${args.label}"` : ""}`;
  } else if (toolName === "save_note" && args?.title) {
    detailsText = `Title: "${args.title}"${args.content ? ` | Content: "${limitLength(args.content, 40)}"` : ""}`;
  } else if (toolName === "remember" && args?.fact) {
    detailsText = `Fact: "${limitLength(args.fact, 50)}"`;
  } else if (toolName === "wait_for_window" && args?.title) {
    detailsText = `Title: "${args.title}" | Timeout: ${args.timeout || 30}s`;
  } else if (toolName === "wait_for_text" && args?.text) {
    detailsText = `Text: "${limitLength(args.text, 40)}" | Timeout: ${args.timeout || 30}s`;
  } else if (args) {
    const pairs = Object.entries(args)
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : limitLength(String(v), 30)}`)
      .join(" | ");
    if (pairs) {
      detailsText = pairs;
    }
  }

  if (!detailsText) return null;

  return (
    <div style={{
      marginTop: "4px",
      padding: "4px 8px",
      background: "rgba(0, 255, 120, 0.03)",
      borderLeft: "2px solid var(--accent)",
      fontSize: "9px",
      fontFamily: "var(--font-mono)",
      color: "var(--accent)",
      display: "flex",
      flexDirection: "column",
      gap: "2px",
      borderRadius: "0 var(--radius-sm) var(--radius-sm) 0",
      letterSpacing: "0.03em"
    }}>
      <div style={{ textTransform: "uppercase", fontSize: "8px", opacity: 0.5, fontWeight: "bold" }}>
        {isCommandLine ? "EXECUTE COMMAND" : `${toolName} params`}
      </div>
      {isCommandLine ? (
        <div style={{ 
          background: "rgba(0,0,0,0.3)", 
          padding: "4px 6px", 
          borderRadius: "3px", 
          border: "1px solid rgba(0, 255, 120, 0.15)",
          color: "#00ff88", 
          whiteSpace: "pre-wrap", 
          wordBreak: "break-all",
          marginTop: "2px"
        }}>
          $ {detailsText}
        </div>
      ) : (
        <div style={{ color: "rgba(0, 255, 120, 0.9)" }}>
          {detailsText}
        </div>
      )}
    </div>
  );
};

export function getActionTitle(action: ParsedToolAction): string {
  const toolName = action.tool?.toLowerCase();
  const args = getArgsFromAction(action);
  
  if (toolName === "shell" && args?.command) {
    const cmd = args.command;
    const shortCmd = cmd.length > 25 ? cmd.slice(0, 25) + "..." : cmd;
    return `Ran: ${shortCmd}`;
  }
  if (toolName === "click" && args?.x !== undefined && args?.y !== undefined) {
    return `Clicked at (${args.x}, ${args.y})`;
  }
  if (toolName === "type_text" && args?.text) {
    const truncated = args.text.length > 20 ? args.text.slice(0, 20) + "..." : args.text;
    return `Typed: "${truncated}"`;
  }
  if (toolName === "press_key" && args?.key) {
    return `Pressed Key: ${args.key}`;
  }
  if (toolName === "click_element" && args?.name) {
    const truncated = args.name.length > 20 ? args.name.slice(0, 20) + "..." : args.name;
    return `Clicked Element: "${truncated}"`;
  }
  if (toolName === "open_app" && args?.name) {
    const truncated = args.name.length > 20 ? args.name.slice(0, 20) + "..." : args.name;
    return `Opened App: "${truncated}"`;
  }
  if (toolName === "focus_window" && args?.title) {
    const truncated = args.title.length > 20 ? args.title.slice(0, 20) + "..." : args.title;
    return `Focused Window: "${truncated}"`;
  }
  if (toolName === "search_web" && args?.query) {
    const truncated = args.query.length > 20 ? args.query.slice(0, 20) + "..." : args.query;
    return `Searched Web: "${truncated}"`;
  }
  if (toolName === "get_weather" && args?.location) {
    return `Checked Weather: "${args.location}"`;
  }
  if (toolName === "set_timer" && args?.duration_minutes !== undefined) {
    return `Set ${args.duration_minutes}m Timer`;
  }
  if (toolName === "save_note" && args?.title) {
    const truncated = args.title.length > 20 ? args.title.slice(0, 20) + "..." : args.title;
    return `Saved Note: "${truncated}"`;
  }
  if (toolName === "remember" && args?.fact) {
    return `Remembered Fact`;
  }
  if (toolName === "get_battery") {
    return "Checked Battery Status";
  }
  if (toolName === "list_files") {
    return "Listed Files";
  }
  if (toolName === "open_path") {
    return "Opened Path";
  }
  if (toolName === "read_file") {
    return "Read File";
  }
  if (toolName === "set_volume") {
    return "Set Volume";
  }
  if (toolName === "toggle_wifi") {
    return "Toggled Wifi";
  }
  if (toolName === "wait_for_window") {
    return "Waiting for Window";
  }
  if (toolName === "wait_for_text") {
    return "Waiting for Text";
  }
  if (toolName === "self_fix") {
    return "Running Self Fix";
  }
  if (action.tool && action.tool !== "step") {
    const capitalized = action.tool
      .split(/[-_]/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    return capitalized;
  }
  return "Execute Step";
}

export function parseToolActionsFromContent(content: string, timestamp?: number): ParsedToolAction[] {
  const toolActions: ParsedToolAction[] = [];
  
  // 1. Try to parse as JSON first (as fallback)
  try {
    const trimmed = content.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      const parsed = JSON.parse(trimmed);
      const steps = Array.isArray(parsed) ? parsed : parsed.steps || [];
      if (Array.isArray(steps) && steps.length > 0) {
        return steps.map((step: any) => {
          const toolName = step.tool || step.action || "step";
          const desc = step.description || `${toolName} ${JSON.stringify(step.args || {})}`;
          return {
            tool: toolName,
            description: desc,
            status: "success",
            result: step.result || step.observation,
            timestamp: timestamp,
            args: step.args || step.params || step.arguments || step.parameters || {},
          };
        });
      }
    }
  } catch (e) {
    // Fall back to line parsing
  }

  // 2. Parse details blocks and line-by-line checkmarks
  const lines = content.split("\n");
  let currentAction: ParsedToolAction | null = null;
  let inDetails = false;
  let detailsLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("<details>")) {
      inDetails = true;
      detailsLines = [];
      continue;
    }

    if (trimmed.startsWith("</details>")) {
      inDetails = false;
      if (currentAction) {
        let resultText = detailsLines.join("\n").trim();
        if (resultText.startsWith("```")) {
          const firstNewline = resultText.indexOf("\n");
          if (firstNewline !== -1) {
            resultText = resultText.substring(firstNewline + 1);
          }
          if (resultText.endsWith("```")) {
            resultText = resultText.substring(0, resultText.length - 3);
          }
        }
        currentAction.result = resultText.trim();
        toolActions.push(currentAction);
        currentAction = null;
      }
      continue;
    }

    if (inDetails) {
      if (trimmed.startsWith("<summary>")) {
        const summaryText = trimmed.replace("<summary>", "").replace("</summary>", "").trim();
        let status: ParsedToolAction["status"] = "success";
        let desc = summaryText;
        if (summaryText.startsWith("✓ ")) {
          status = "success";
          desc = summaryText.slice(2);
        } else if (summaryText.startsWith("❌")) {
          status = summaryText.includes("(Reason: Terminated)") ? "terminated" : "error";
          desc = summaryText.startsWith("❌ ") ? summaryText.slice(2) : summaryText.slice(1);
        }
        const isHeal = desc.toLowerCase().includes("self-healing") || desc.toLowerCase().includes("self_heal");
        const parsedLine = parseRawLine(desc);
        currentAction = {
          tool: isHeal ? "self_heal" : parsedLine.tool,
          description: desc,
          status,
          timestamp,
          args: parsedLine.args,
        };
      } else {
        detailsLines.push(line);
      }
      continue;
    }

    // 3. Detect replan divider lines: --- text ---
    if (trimmed.startsWith("---") && trimmed.endsWith("---") && trimmed.length > 6) {
      const dividerText = trimmed.replace(/^---\s*/, "").replace(/\s*---$/, "").trim();
      toolActions.push({
        tool: "divider",
        description: dividerText,
        status: "divider",
        timestamp,
      });
      continue;
    }

    // Standard non-collapsible lines
    if (trimmed.startsWith("✓ ")) {
      const desc = trimmed.slice(2);
      const isHeal = desc.toLowerCase().includes("self-healing") || desc.toLowerCase().includes("self_heal");
      const parsedLine = parseRawLine(desc);
      toolActions.push({
        tool: isHeal ? "self_heal" : parsedLine.tool,
        description: desc,
        status: "success",
        timestamp,
        args: parsedLine.args,
      });
    } else if (trimmed.startsWith("❌")) {
      const cleanDesc = trimmed.startsWith("❌ ") ? trimmed.slice(2) : trimmed.slice(1);
      const status = cleanDesc.includes("(Reason: Terminated)") ? "terminated" : "error";
      const isHeal = cleanDesc.toLowerCase().includes("self-healing") || cleanDesc.toLowerCase().includes("self_heal");
      const parsedLine = parseRawLine(cleanDesc);
      toolActions.push({
        tool: isHeal ? "self_heal" : parsedLine.tool,
        description: cleanDesc,
        status,
        timestamp,
        args: parsedLine.args,
      });
    }
  }

  return toolActions;
}

export function ActionLog({ plan, selectedTaskId, messages }: ActionLogProps) {
  const hasActivePlan = !!plan;
  const shellOutputLines = useAssistantStore((s) => s.shellOutputLines);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

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
            args: s.args,
          })) : []
        });
      }
      continue;
    }

    const isTask = nextAssistant.content.includes("✓ ") ||
                   nextAssistant.content.includes("Task completed successfully") ||
                   nextAssistant.content.includes("❌ Failed at step") ||
                   nextAssistant.content.includes("Execution cancelled by user.") ||
                   nextAssistant.content.trim().startsWith("[") ||
                   nextAssistant.content.trim().startsWith("{");
    if (!isTask) continue;

    const toolActions = parseToolActionsFromContent(nextAssistant.content, nextAssistant.timestamp);

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
        args: s.args,
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
      args: s.args,
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
      <AnimatePresence initial={false}>
        {reversedActions.map((action, idx) => {
          // ─── Divider Rendering ──────────────────────────────────────────
          if (action.status === "divider") {
            return (
              <motion.div
                layout
                key={`divider-${idx}`}
                initial={{ opacity: 0, scaleX: 0.8 }}
                animate={{ opacity: 1, scaleX: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", damping: 28, stiffness: 300 }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "4px 0",
                  margin: "2px 0",
                }}
              >
                <div style={{ flex: 1, height: "1px", background: "linear-gradient(to right, transparent, rgba(0,255,120,0.3), transparent)" }} />
                <span style={{
                  fontSize: "8px",
                  fontFamily: "var(--font-mono)",
                  color: "rgba(0,255,120,0.6)",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                  padding: "2px 6px",
                  border: "1px solid rgba(0,255,120,0.2)",
                  borderRadius: "var(--radius-sm)",
                  background: "rgba(0,255,120,0.04)",
                }}>
                  ↺ {action.description}
                </span>
                <div style={{ flex: 1, height: "1px", background: "linear-gradient(to left, transparent, rgba(0,255,120,0.3), transparent)" }} />
              </motion.div>
            );
          }

          const isRunning = action.status === "running";
          const isSuccess = action.status === "success";
          const isError = action.status === "error" || action.status === "failed";
          const isTerminated = action.status === "terminated";
          const isHeal = action.tool === "self_heal" || action.tool?.toLowerCase().includes("heal");
          const args = getArgsFromAction(action);
          
          let statusColor = "var(--text-muted)";
          let statusText = "QUEUED";
          let cardBg = "rgba(0, 0, 0, 0.25)";
          let cardBorder = "1px solid var(--border)";
          let glow = "none";
          
          if (isHeal) {
            statusColor = isRunning ? "var(--warning)" : isSuccess ? "var(--success)" : "var(--danger)";
            statusText = isRunning ? "DIAGNOSING..." : isSuccess ? "HEALED" : "HEAL FAILED";
            cardBg = isRunning 
              ? "rgba(255, 170, 0, 0.08)" 
              : isSuccess 
              ? "rgba(0, 230, 180, 0.06)" 
              : "rgba(255, 60, 60, 0.06)";
            cardBorder = isRunning 
              ? "1px dashed var(--warning)" 
              : isSuccess 
              ? "1px dashed var(--success)" 
              : "1px dashed var(--danger)";
            glow = isRunning ? "0 0 10px rgba(255, 170, 0, 0.2)" : "none";
          } else if (isRunning) {
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

          const hasResult = !!action.result;
          const isExpanded = expandedIndex === idx;
          const isShell = action.tool?.toLowerCase() === "shell";

          return (
            <motion.div
              layout
              key={idx}
              initial={{ opacity: 0, scale: 0.95, y: -12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ type: "spring", damping: 26, stiffness: 360 }}
              onClick={() => {
                if (hasResult) {
                  setExpandedIndex(isExpanded ? null : idx);
                }
              }}
              style={{
                padding: "10px 12px",
                borderRadius: "var(--radius-md)",
                background: cardBg,
                border: cardBorder,
                boxShadow: glow,
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                cursor: hasResult ? "pointer" : "default",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                <div style={{ 
                  fontSize: "10px", 
                  fontWeight: "bold", 
                  fontFamily: "var(--font-mono)", 
                  color: isHeal ? "var(--warning)" : "var(--accent)", 
                  textTransform: "none",
                  display: "flex",
                  flexDirection: "column",
                  gap: "2px",
                  minWidth: 0,
                  flex: 1
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
                    {isHeal ? "🩹 " : ""}{getActionTitle(action)}
                  </div>
                  {hasResult && (
                    <span style={{ fontSize: "8px", opacity: 0.5, fontWeight: "normal" }}>
                      {isExpanded ? "▼ Click to collapse" : "▶ Click to view output"}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                  <span style={{ fontSize: "9px", color: statusColor, fontWeight: "bold", letterSpacing: "0.05em" }}>
                    {statusText}
                  </span>
                  {action.timestamp && (
                    <span style={{ fontSize: "9px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)", opacity: 0.8 }}>
                      [{new Date(action.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}]
                    </span>
                  )}
                </div>
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-secondary)", lineHeight: "1.4", fontFamily: "var(--font-mono)" }}>
                {action.description}
              </div>
              {renderActionDetails(action)}

              {/* Streaming Output for Running Shell OR Collapsible Result for Finished Tool */}
              {((isRunning && isShell && shellOutputLines.length > 0) || (hasResult && isExpanded)) && (
                <div style={{
                  marginTop: "6px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(0,0,0,0.45)",
                  padding: "6px 8px",
                  fontFamily: "var(--font-mono)",
                  fontSize: "9px",
                  color: "rgba(180, 255, 180, 0.85)",
                  lineHeight: "1.5",
                  maxHeight: "150px",
                  overflowY: "auto",
                }}>
                  {isShell && args?.command && (
                    <div style={{ 
                      color: "#00ff66", 
                      opacity: 0.75, 
                      marginBottom: "6px", 
                      borderBottom: "1px solid rgba(0, 255, 100, 0.15)", 
                      paddingBottom: "4px",
                      fontWeight: "bold"
                    }}>
                      sarthi-shell ~ $ {args.command}
                    </div>
                  )}
                  {isRunning ? (
                    shellOutputLines.map((line, i) => (
                      <div key={i} style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                        {line}
                      </div>
                    ))
                  ) : (
                    <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                      {action.result}
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
