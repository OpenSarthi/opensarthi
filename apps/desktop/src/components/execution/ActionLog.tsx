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
    <div className="os-action-details">
      <div className="os-action-details-label">
        {isCommandLine ? "Command" : `${toolName} params`}
      </div>
      {isCommandLine ? (
        <div className="os-action-cmd">$ {detailsText}</div>
      ) : (
        <div className="os-action-details-value">{detailsText}</div>
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
  // Find the index of the latest user message (same robust check as TaskList.tsx)
  let lastUserMsgIdx = -1;
  for (let k = messages.length - 1; k >= 0; k--) {
    if (messages[k].role === "user") { lastUserMsgIdx = k; break; }
  }

  const agenticTasks: any[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "user") continue;

    const nextAssistant = messages.slice(i + 1).find(m => m.role === "assistant");
    if (!nextAssistant) {
      // Use lastUserMsgIdx instead of messages.length-1 to handle any trailing non-user messages
      if (hasActivePlan && i === lastUserMsgIdx) {
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

    const isTask = !!nextAssistant.plan ||
                   nextAssistant.content.includes("✓ ") ||
                   nextAssistant.content.includes("Task completed successfully") ||
                   nextAssistant.content.includes("❌ Failed at step") ||
                   nextAssistant.content.includes("Execution cancelled by user.") ||
                   nextAssistant.content.trim().startsWith("[") ||
                   nextAssistant.content.trim().startsWith("{");
    if (!isTask) continue;

    let toolActions: ParsedToolAction[] = [];
    if (nextAssistant.plan) {
      toolActions = nextAssistant.plan.steps.map(s => ({
        tool: s.tool,
        description: s.description || s.tool,
        status: s.status || "pending",
        result: typeof s.result === "string" ? s.result : s.result ? JSON.stringify(s.result) : undefined,
        timestamp: s.timestamp,
        args: s.args,
      }));
    } else {
      toolActions = parseToolActionsFromContent(nextAssistant.content, nextAssistant.timestamp);
    }

    let taskStatus = "success";
    if (nextAssistant.content.includes("Execution cancelled by user.")) {
      taskStatus = "terminated";
    } else if (nextAssistant.content.includes("❌") || (nextAssistant.plan && nextAssistant.plan.steps.some(s => s.status === "error"))) {
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
      <div className="os-empty" style={{ minHeight: 140 }}>
        <p className="os-empty-title">No activity yet</p>
        <p className="os-empty-hint">Tool calls and results will stream in here.</p>
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
                <div className="os-action-divider-line" />
                <span className="os-action-divider-label">
                  {action.description}
                </span>
                <div className="os-action-divider-line" />
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
          let statusText = "Queued";

          if (isHeal) {
            statusColor = isRunning ? "var(--warning)" : isSuccess ? "var(--success)" : "var(--danger)";
            statusText = isRunning ? "Diagnosing…" : isSuccess ? "Healed" : "Heal failed";
          } else if (isRunning) {
            statusColor = "var(--accent)";
            statusText = "Running";
          } else if (isSuccess) {
            statusColor = "var(--success)";
            statusText = "Success";
          } else if (isError) {
            statusColor = "var(--danger)";
            statusText = "Failed";
          } else if (isTerminated) {
            statusColor = "var(--text-muted)";
            statusText = "Stopped";
          }

          const hasResult = !!action.result;
          const isExpanded = expandedIndex === idx || isRunning;
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
                setExpandedIndex(expandedIndex === idx ? null : idx);
              }}
              role="button"
              tabIndex={0}
              aria-expanded={isExpanded}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setExpandedIndex(expandedIndex === idx ? null : idx);
                }
              }}
              className={`os-action-card${isHeal ? " is-heal" : ""}${isRunning ? " is-running" : ""}${isSuccess ? " is-success" : ""}${isError ? " is-error" : ""}${isTerminated ? " is-terminated" : ""}`}
            >
              <div className="os-action-head">
                <div className="os-action-title-wrap">
                  <div className="os-action-title">
                    {getActionTitle(action)}
                  </div>
                  <span className="os-action-toggle">
                    {isExpanded ? "Hide details" : "Show details"}
                  </span>
                </div>
                <div className="os-action-meta">
                  <span className="os-action-status" style={{ color: statusColor }}>
                    {statusText}
                  </span>
                  {action.timestamp && (
                    <span className="os-action-time">
                      {new Date(action.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                    </span>
                  )}
                </div>
              </div>
              
              {isExpanded && (
                <>
                  <div className="os-action-desc">
                    {action.description}
                  </div>
                  {renderActionDetails(action)}
                </>
              )}

              {/* Streaming Output for Running Shell OR Collapsible Result for Finished Tool */}
              {((isRunning && isShell && shellOutputLines.length > 0) || (hasResult && isExpanded)) && (
                <div className="os-action-output">
                  {isShell && args?.command && (
                    <div className="os-action-output-cmd">
                      $ {args.command}
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
