import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { User, Volume2, Copy, Check, XCircle, Terminal, Play, RotateCcw } from "lucide-react";
import type { Message } from "../../lib/schemas";
import { wsClient } from "../../lib/ws";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAssistantStore } from "../../stores/assistantStore";


interface ResponseBubbleProps {
  message: Message;
}

function parseThinking(content: string): { thinking: string; response: string; isComplete: boolean } {
  // Collect all <think>...</think> blocks
  const thinkBlocks: string[] = [];
  let remaining = content;
  
  // Extract all complete <think>...</think> blocks
  const completePattern = /<think>([\s\S]*?)<\/think>/g;
  let match;
  while ((match = completePattern.exec(content)) !== null) {
    thinkBlocks.push(match[1].trim());
  }
  remaining = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  
  // Check for unclosed <think> tag (still thinking)
  const unclosedIdx = remaining.indexOf("<think>");
  if (unclosedIdx !== -1) {
    const partialThinking = remaining.slice(unclosedIdx + 7);
    thinkBlocks.push(partialThinking.trim());
    remaining = remaining.slice(0, unclosedIdx).trim();
    return { thinking: thinkBlocks.join("\n\n"), response: remaining, isComplete: false };
  }
  
  const thinking = thinkBlocks.join("\n\n");
  return { thinking, response: remaining, isComplete: thinkBlocks.length > 0 };
}

function ThinkingBlock({ thinking, isComplete, timestamp }: { thinking: string; isComplete: boolean; timestamp?: number }) {
  const [isOpen, setIsOpen] = useState(!isComplete);

  useEffect(() => {
    // Auto collapse after thinking completes
    if (isComplete) {
      setIsOpen(false);
    }
  }, [isComplete]);

  return (
    <div className="os-thought-block">
      <style>{`
        @keyframes pulseDot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.85); }
        }
      `}</style>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="os-thought-head"
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div
            className="os-task-dot"
            style={{
              background: isComplete ? "var(--text-muted)" : "var(--accent)",
              boxShadow: isComplete ? "none" : "0 0 0 3px var(--accent-glow-lg)",
              animation: isComplete ? "none" : "pulseDot 1.8s infinite",
            }}
          />
          <span className="os-thought-label">
            {isComplete ? "Thought process" : "Thinking…"}
            {timestamp && (
              <span className="os-task-time">
                {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
              </span>
            )}
          </span>
        </div>
        <span className="os-thought-toggle">{isOpen ? "Hide" : "Show"}</span>
      </div>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 0.8 }}
            exit={{ height: 0, opacity: 0 }}
            className="os-thought-body"
          >
            {thinking.trim()}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ReasoningBlock({ text, attempt }: { text: string; attempt?: number }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="os-thought-block">
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{
          padding: "8px 12px",
          background: "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          fontSize: "var(--text-label)",
          color: "var(--text-secondary)",
          fontWeight: 600,
          letterSpacing: 0,
          userSelect: "none"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: "var(--accent)",
            boxShadow: "0 0 0 3px var(--accent-glow-lg)",
          }} />
          <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            Plan reasoning {attempt !== undefined && attempt > 0 ? `· attempt ${attempt + 1}` : ""}
          </span>
        </div>
        <span className="os-thought-toggle">{isOpen ? "Hide" : "Show"}</span>
      </div>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 0.9 }}
            exit={{ height: 0, opacity: 0 }}
            className="os-thought-body"
            style={{ borderTop: "1px solid var(--line-soft)" }}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {text.trim()}
            </ReactMarkdown>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CodeBlock({ lang, codeText }: { lang: string; codeText: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(codeText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div
      className="os-code-block"
      style={{ margin: "8px 0" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "10px",
          color: "var(--text-secondary)",
          borderBottom: "1px solid var(--border)",
          padding: "6px 10px",
          background: "rgba(0,0,0,0.15)",
          fontFamily: "var(--font-mono)",
          fontWeight: 600,
        }}
      >
        <span style={{ color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {lang || "CODE"}
        </span>
        <button
          onClick={handleCopy}
          style={{
            background: "transparent",
            border: "none",
            color: copied ? "var(--success, #00e6b4)" : "var(--text-secondary)",
            cursor: "pointer",
            fontSize: "10px",
            fontFamily: "var(--font-mono)",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            padding: "2px 6px",
            borderRadius: "2px",
            transition: "all 0.2s",
          }}
        >
          {copied ? <Check size={10} /> : <Copy size={10} />}
          {copied ? "COPIED" : "COPY CODE"}
        </button>
      </div>
      <pre
        style={{
          padding: "10px",
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          color: "var(--text-secondary)",
          overflowX: "auto",
          margin: 0,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          background: "transparent",
        }}
      >
        <code>{codeText}</code>
      </pre>
    </div>
  );
}

const renderParagraph = ({ children }: any) => {
  let text = "";
  if (typeof children === "string") {
    text = children;
  } else if (Array.isArray(children)) {
    text = children.map(c => typeof c === "string" ? c : "").join("");
  }

  const trimmed = text.trim();
  if (trimmed.startsWith("✓ ")) {
    const isHeal = trimmed.toLowerCase().includes("self-healing") || trimmed.toLowerCase().includes("self_heal");
    let modifiedChildren = children;
    if (typeof children === "string") {
      modifiedChildren = children.slice(2);
    } else if (Array.isArray(children) && typeof children[0] === "string") {
      modifiedChildren = [children[0].slice(2), ...children.slice(1)];
    }

    return (
      <div style={{ 
        display: "flex", 
        alignItems: "center", 
        gap: "6px", 
        fontSize: "11px", 
        fontFamily: "var(--font-mono)", 
        color: isHeal ? "var(--warning)" : "var(--success, #00e6b4)", 
        background: isHeal ? "rgba(255, 170, 0, 0.05)" : "rgba(0, 230, 180, 0.04)", 
        border: isHeal ? "1px dashed rgba(255, 170, 0, 0.25)" : "1px solid rgba(0, 230, 180, 0.15)",
        borderRadius: "var(--radius-sm)", 
        padding: "4px 8px", 
        margin: "4px 0" 
      }}>
        <Check size={13} style={{ flexShrink: 0 }} />
        <span>{modifiedChildren}</span>
      </div>
    );
  }

  if (trimmed.startsWith("❌")) {
    const isHeal = trimmed.toLowerCase().includes("self-healing") || trimmed.toLowerCase().includes("self_heal");
    const prefixLength = trimmed.startsWith("❌ ") ? 2 : 1;
    let modifiedChildren = children;
    if (typeof children === "string") {
      modifiedChildren = children.slice(prefixLength);
    } else if (Array.isArray(children) && typeof children[0] === "string") {
      modifiedChildren = [children[0].slice(prefixLength), ...children.slice(1)];
    }

    return (
      <div style={{ 
        display: "flex", 
        alignItems: "center", 
        gap: "6px", 
        fontSize: "11px", 
        fontFamily: "var(--font-mono)", 
        color: "var(--danger)", 
        background: "rgba(255, 60, 60, 0.04)", 
        border: isHeal ? "1px dashed rgba(255, 60, 60, 0.25)" : "1px solid rgba(255, 60, 60, 0.15)",
        borderRadius: "var(--radius-sm)", 
        padding: "4px 8px", 
        margin: "4px 0" 
      }}>
        <XCircle size={13} style={{ flexShrink: 0 }} />
        <span>{modifiedChildren}</span>
      </div>
    );
  }

  return <p style={{ margin: "4px 0", lineHeight: "1.5" }}>{children}</p>;
};

const markdownComponents = {
  p: renderParagraph,
  
  h1: ({ children }: any) => (
    <h1 style={{ fontSize: "1.35em", margin: "14px 0 8px 0", color: "var(--text-primary)", paddingBottom: "6px", borderBottom: "1px solid var(--line-soft)", fontWeight: 600, letterSpacing: "-0.02em" }}>
      {children}
    </h1>
  ),
  h2: ({ children }: any) => (
    <h2 style={{ fontSize: "1.22em", margin: "12px 0 6px 0", color: "var(--text-primary)", fontWeight: 600, letterSpacing: "-0.015em" }}>
      {children}
    </h2>
  ),
  h3: ({ children }: any) => (
    <h3 style={{ fontSize: "1.08em", margin: "10px 0 5px 0", color: "var(--text-primary)", fontWeight: 600 }}>
      {children}
    </h3>
  ),
  h4: ({ children }: any) => (
    <h4 style={{ fontSize: "1em", margin: "8px 0 4px 0", color: "var(--text-secondary)", fontWeight: 600 }}>
      {children}
    </h4>
  ),
  
  li: ({ children }: any) => (
    <li style={{ marginLeft: "18px", marginBottom: "5px", listStyleType: "disc" }}>
      {children}
    </li>
  ),
  
  hr: () => (
    <hr style={{ border: "0", borderTop: "1px solid var(--border)", margin: "16px 0", opacity: 0.6 }} />
  ),
  
  pre: ({ children }: any) => {
    const codeEl = React.Children.only(children) as React.ReactElement<any>;
    const className = codeEl.props.className || "";
    const match = /language-(\w+)/.exec(className);
    const lang = match ? match[1] : "";
    const codeText = String(codeEl.props.children).replace(/\n$/, "");
    return <CodeBlock lang={lang} codeText={codeText} />;
  },
  
  code: ({ children, ...props }: any) => {
    return (
      <code style={{ 
        fontFamily: "var(--font-mono)", 
        fontSize: "0.9em", 
        background: "rgba(255, 255, 255, 0.08)", 
        padding: "2px 4px", 
        borderRadius: "3px",
        border: "1px solid var(--border)",
        color: "var(--accent)"
      }} {...props}>
        {children}
      </code>
    );
  },

  table: ({ children }: any) => (
    <div style={{ overflowX: "auto", margin: "12px 0", width: "100%" }}>
      <table style={{ 
        width: "100%", 
        borderCollapse: "collapse", 
        border: "1px solid var(--border)",
        fontSize: "13px",
        fontFamily: "var(--font-mono, monospace)"
      }}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children }: any) => (
    <thead style={{ background: "rgba(255,255,255,0.03)", borderBottom: "2px solid var(--border)" }}>
      {children}
    </thead>
  ),
  tbody: ({ children }: any) => (
    <tbody>{children}</tbody>
  ),
  tr: ({ children }: any) => (
    <tr style={{ borderBottom: "1px solid var(--border)" }}>{children}</tr>
  ),
  th: ({ children }: any) => (
    <th style={{ 
      padding: "8px 10px", 
      fontWeight: "bold", 
      textAlign: "left", 
      color: "var(--accent)", 
      borderRight: "1px solid var(--border)" 
    }}>{children}</th>
  ),
  td: ({ children }: any) => (
    <td style={{ 
      padding: "6px 10px", 
      color: "var(--text-secondary)", 
      borderRight: "1px solid var(--border)" 
    }}>{children}</td>
  ),

  a: ({ href, children }: any) => {
    const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      if (!href) return;
      // Dynamically import and use plugin-shell's open to launch in default browser
      import("@tauri-apps/plugin-shell")
        .then(({ open }) => open(href))
        .catch((err) => {
          console.error("Tauri shell open failed:", err);
          window.open(href, "_blank", "noopener,noreferrer");
        });
    };
    return (
      <a
        href={href}
        onClick={handleClick}
        style={{
          color: "var(--accent)",
          textDecoration: "underline",
          cursor: "pointer",
        }}
      >
        {children}
      </a>
    );
  },

  blockquote: ({ children }: any) => (
    <blockquote style={{ 
      borderLeft: "3px solid var(--accent)", 
      paddingLeft: "10px", 
      margin: "8px 0", 
      color: "var(--text-secondary)", 
      background: "rgba(255,255,255,0.01)" 
    }}>
      {children}
    </blockquote>
  )
};

interface ResponseBlock {
  type: "markdown" | "details" | "execute" | "next_action";
  content: string;
  summary?: string;
}

function parseResponseBlocks(text: string): ResponseBlock[] {
  const blocks: ResponseBlock[] = [];
  
  // Robust case-insensitive tags matches
  const detailsRegex = /<details[^>]*>([\s\S]*?)<\/details>/gi;
  const executeRegex = /<execute[^>]*>([\s\S]*?)<\/execute>/gi;
  const nextActionRegex = /<next_action[^>]*>([\s\S]*?)<\/next_action>/gi;
  const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/gi;
  
  interface MatchItem {
    type: "details" | "execute" | "next_action";
    start: number;
    end: number;
    content: string;
  }
  
  const matches: MatchItem[] = [];
  
  let match;
  detailsRegex.lastIndex = 0;
  while ((match = detailsRegex.exec(text)) !== null) {
    matches.push({
      type: "details",
      start: match.index,
      end: detailsRegex.lastIndex,
      content: match[1]
    });
  }
  
  executeRegex.lastIndex = 0;
  while ((match = executeRegex.exec(text)) !== null) {
    matches.push({
      type: "execute",
      start: match.index,
      end: executeRegex.lastIndex,
      content: match[1]
    });
  }

  nextActionRegex.lastIndex = 0;
  while ((match = nextActionRegex.exec(text)) !== null) {
    matches.push({
      type: "next_action",
      start: match.index,
      end: nextActionRegex.lastIndex,
      content: match[1]
    });
  }

  jsonBlockRegex.lastIndex = 0;
  while ((match = jsonBlockRegex.exec(text)) !== null) {
    matches.push({
      type: "execute",
      start: match.index,
      end: jsonBlockRegex.lastIndex,
      content: match[1]
    });
  }
  
  matches.sort((a, b) => a.start - b.start);
  
  let lastIdx = 0;
  for (const m of matches) {
    if (m.start > lastIdx) {
      const preceding = text.substring(lastIdx, m.start);
      if (preceding) {
        blocks.push({ type: "markdown", content: preceding });
      }
    }
    
    if (m.type === "details") {
      const inside = m.content;
      const summaryStart = inside.indexOf("<summary>");
      const summaryEnd = inside.indexOf("</summary>");
      
      let summaryText = "Details";
      let bodyText = inside;
      
      if (summaryStart !== -1 && summaryEnd !== -1 && summaryEnd > summaryStart) {
        summaryText = inside.substring(summaryStart + 9, summaryEnd).trim();
        bodyText = inside.substring(0, summaryStart) + inside.substring(summaryEnd + 10);
      }
      
      blocks.push({
        type: "details",
        summary: summaryText,
        content: bodyText.trim()
      });
    } else if (m.type === "execute") {
      blocks.push({
        type: "execute",
        content: m.content.trim()
      });
    } else {
      blocks.push({
        type: "next_action",
        content: m.content.trim()
      });
    }
    
    lastIdx = m.end;
  }
  
  if (lastIdx < text.length) {
    const remaining = text.substring(lastIdx);
    if (remaining) {
      blocks.push({ type: "markdown", content: remaining });
    }
  }
  
  return blocks;
}

function ExecuteBlock({ actionJson }: { actionJson: string }) {
  try {
    let cleanJson = actionJson.trim();
    if (cleanJson.startsWith("```json")) {
      cleanJson = cleanJson.substring(7);
    } else if (cleanJson.startsWith("```")) {
      cleanJson = cleanJson.substring(3);
    }
    if (cleanJson.endsWith("```")) {
      cleanJson = cleanJson.substring(0, cleanJson.length - 3);
    }
    cleanJson = cleanJson.trim();
    
    const parsed = JSON.parse(cleanJson);
    let steps: any[] = [];
    if (Array.isArray(parsed)) {
      steps = parsed;
    } else if (parsed && typeof parsed === "object" && Array.isArray(parsed.steps)) {
      steps = parsed.steps;
    } else if (parsed && typeof parsed === "object") {
      steps = [parsed];
    }

    if (steps.length === 0) {
      throw new Error("No steps found");
    }

    const getStepToolAndArgs = (s: any) => {
      if (!s || typeof s !== "object") return { tool: "step", args: {} };
      const tool = s.tool || s.action;
      if (tool) {
        return { tool, args: s.args || s.params || {} };
      }
      const reserved = ["description", "comment", "params", "arguments", "parameters", "verify_with", "wait_after", "depends_on"];
      const toolKey = Object.keys(s).find(k => !reserved.includes(k));
      if (toolKey) {
        const val = s[toolKey];
        const args = typeof val === "object" && val !== null ? val : { [toolKey]: val };
        return { tool: toolKey, args };
      }
      return { tool: "step", args: {} };
    };

    return (
      <div style={{
        margin: "12px 0",
        padding: "12px 14px",
        background: "var(--surface-hover)",
        border: "1px solid var(--line-soft)",
        borderLeft: "2px solid var(--accent)",
        borderRadius: "var(--radius-md)",
        fontSize: "12px",
        color: "var(--text-primary)",
        display: "flex",
        flexDirection: "column",
        gap: "10px"
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 600, fontSize: "var(--text-label)", color: "var(--text-secondary)" }}>
            <Terminal size={12} />
            <span>Execution plan</span>
          </div>
          <span style={{ fontSize: "var(--text-micro)", background: "var(--accent-glow-lg)", color: "var(--accent)", padding: "2px 7px", borderRadius: "var(--radius-full)", fontWeight: 600 }}>
            {steps.length} {steps.length === 1 ? "step" : "steps"}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {steps.map((s, idx) => {
            const { tool, args } = getStepToolAndArgs(s);
            const detailText = Object.entries(args)
              .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
              .join(" | ");
            return (
              <div key={idx} style={{ display: "flex", flexDirection: "column", gap: "2px", paddingLeft: "8px", borderLeft: "1px solid var(--line-strong)" }}>
                <div style={{ display: "flex", gap: "6px", alignItems: "baseline" }}>
                  <span style={{ fontSize: "var(--text-micro)", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{idx + 1}</span>
                  <span style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: "var(--text-meta)" }}>{tool}</span>
                </div>
                {detailText && (
                  <div style={{ display: "flex", gap: "6px", paddingLeft: "14px" }}>
                    <span style={{ color: "var(--text-muted)", wordBreak: "break-all", fontSize: "var(--text-label)", fontFamily: "var(--font-mono)" }}>{detailText}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <button
          onClick={() => {
            wsClient.send("run_json_plan", { steps, goal: "Custom task from response" });
          }}
          className="os-btn os-btn-primary os-btn-xs"
          style={{ marginTop: "4px", alignSelf: "flex-start" }}
        >
          <Play size={11} fill="currentColor" />
          Run task
        </button>
      </div>
    );
  } catch (e) {
    return (
      <div style={{
        margin: "12px 0",
        padding: "10px 14px",
        background: "rgba(255, 60, 60, 0.02)",
        border: "1px solid rgba(255, 60, 60, 0.15)",
        borderLeft: "3px solid var(--danger)",
        borderRadius: "var(--radius-md)",
        fontFamily: "var(--font-mono)",
        fontSize: "12px",
        color: "var(--text-primary)",
        display: "flex",
        flexDirection: "column",
        gap: "6px"
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 600, fontSize: "var(--text-label)", color: "var(--danger)" }}>
            <Terminal size={12} />
            <span>Raw directive</span>
          </div>
          <span style={{ fontSize: "var(--text-micro)", background: "color-mix(in srgb, var(--danger) 14%, transparent)", color: "var(--danger)", padding: "2px 7px", borderRadius: "var(--radius-full)", fontWeight: 600 }}>
            Unparsed
          </span>
        </div>
        <pre style={{
          background: "rgba(0, 0, 0, 0.25)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          padding: "8px 10px",
          fontSize: "11px",
          fontFamily: "var(--font-mono)",
          color: "var(--text-secondary)",
          margin: 0,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all"
        }}>
          <code>{actionJson}</code>
        </pre>
      </div>
    );
  }
}

function NextActionBlock({ content }: { content: string }) {
  return (
    <div style={{
      margin: "12px 0",
      padding: "10px 14px",
      background: "color-mix(in srgb, var(--warning) 6%, transparent)",
      border: "1px solid color-mix(in srgb, var(--warning) 20%, transparent)",
      borderLeft: "2px solid var(--warning)",
      borderRadius: "var(--radius-md)",
      fontSize: "12px",
      color: "var(--text-primary)",
      display: "flex",
      flexDirection: "column",
      gap: "6px"
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 600, fontSize: "var(--text-label)", color: "var(--warning)" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <span>Awaiting your input</span>
        </div>
        <span style={{ fontSize: "var(--text-micro)", background: "color-mix(in srgb, var(--warning) 14%, transparent)", color: "var(--warning)", padding: "2px 7px", borderRadius: "var(--radius-full)", fontWeight: 600 }}>
          Action needed
        </span>
      </div>
      <div style={{ color: "var(--text-secondary)", lineHeight: "1.5" }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {content.trim()}
        </ReactMarkdown>
      </div>
    </div>
  );
}

function CustomDetailsBlock({ summary, content }: { summary: string; content: string }) {
  const isShell = summary.toLowerCase().includes("shell");
  const [isOpen, setIsOpen] = useState(isShell);
  const isHeal = summary.toLowerCase().includes("self-healing") || summary.toLowerCase().includes("self_heal");
  const isSuccess = summary.includes("✓") || summary.toLowerCase().includes("success") || summary.toLowerCase().includes("completed");
  const isError = summary.includes("❌") || summary.toLowerCase().includes("fail") || summary.toLowerCase().includes("error");
  
  let headerColor = "var(--text-secondary)";
  let headerBg = "rgba(0,0,0,0.2)";
  let borderStyle = "1px solid var(--border)";
  
  if (isSuccess) {
    headerColor = isHeal ? "var(--warning)" : "var(--success, #00e6b4)";
    headerBg = isHeal ? "rgba(255, 170, 0, 0.06)" : "rgba(0, 230, 180, 0.05)";
    borderStyle = isHeal ? "1px dashed rgba(255, 170, 0, 0.25)" : "1px solid rgba(0, 230, 180, 0.15)";
  } else if (isError) {
    headerColor = "var(--danger)";
    headerBg = "rgba(255, 60, 60, 0.04)";
    borderStyle = "1px solid rgba(255, 60, 60, 0.15)";
  }

  return (
    <div style={{
      border: borderStyle,
      background: "var(--surface-hover)",
      borderRadius: "var(--radius-md)",
      margin: "8px 0",
      overflow: "hidden",
    }}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{
          padding: "8px 12px",
          background: headerBg,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          fontSize: "11.5px",
          color: headerColor,
          fontWeight: 600,
          userSelect: "none",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.03em"
        }}
      >
        <span>{summary}</span>
        <span style={{ fontSize: "9px", opacity: 0.6 }}>
          {isOpen ? "COLLAPSE ▲" : "EXPAND ▼"}
        </span>
      </div>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{
              borderTop: borderStyle,
              background: "rgba(0,0,0,0.18)",
              padding: "2px 12px 10px 12px"
            }}
          >
            <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {content}
              </ReactMarkdown>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const EMPTY_REASONINGS: any[] = [];

export function ResponseBubble({ message }: ResponseBubbleProps) {
  const isUser = message.role === "user";
  const userName = useAssistantStore((s) => s.userName);
  const userInitial = userName?.trim() ? userName.trim().charAt(0).toUpperCase() : null;
  const planReasonings = useAssistantStore((s) => s.planReasonings[s.activeThreadId] || EMPTY_REASONINGS);
  const activeThreadId = useAssistantStore((s) => s.activeThreadId);
  const messages = useAssistantStore((s) => s.messages);
  const [displayedContent, setDisplayedContent] = useState("");
  const [copied, setCopied] = useState(false);
  const hasAnimated = React.useRef(false);

  useEffect(() => {
    setDisplayedContent(message.content);
    hasAnimated.current = true;
  }, [message.content]);



  const { thinking, response, isComplete } = parseThinking(displayedContent);

  const handleCopyResponse = () => {
    if (response) {
      navigator.clipboard.writeText(response);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRetry = () => {
    const currentMsgIndex = messages.findIndex((m) => m.id === message.id);
    const precedingUserMsg = messages
      .slice(0, currentMsgIndex >= 0 ? currentMsgIndex : undefined)
      .reverse()
      .find((m) => m.role === "user");

    const promptText = precedingUserMsg?.content || message.content;
    if (promptText) {
      wsClient.send("user_message", { text: promptText, source: "text", thread_id: activeThreadId });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      style={{
        display: "flex",
        gap: "10px",
        alignItems: "flex-start",
        flexDirection: isUser ? "row-reverse" : "row",
        position: "relative",
      }}
    >
      {/* Avatar */}
      <div className={`os-avatar ${isUser ? "is-user" : "is-agent"}`}>
        {isUser ? (
          userInitial ? (
            <span
              style={{
                fontSize: "12px",
                fontWeight: 700,
                color: "var(--text-primary)",
                lineHeight: 1,
                fontFamily: "var(--font-sans)",
                textTransform: "uppercase",
              }}
            >
              {userInitial}
            </span>
          ) : (
            <User size={14} />
          )
        ) : (
          <span className="os-bot-icon" aria-hidden="true" />
        )}
      </div>

      {/* Bubble */}
      <div style={{ position: "relative", maxWidth: "80%", display: "flex", flexDirection: "column" }}>
        <div
          className={`selectable os-bubble ${isUser ? "is-user" : "is-agent"}`}
        >
          {thinking && (
            <ThinkingBlock thinking={thinking} isComplete={isComplete} timestamp={message.timestamp} />
          )}

          {!isUser && planReasonings.length > 0 && planReasonings.map((r, rIdx) => (
            <ReasoningBlock key={rIdx} text={r.text} attempt={r.attempt} />
          ))}
          
          {response && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
              {parseResponseBlocks(response).map((block, idx) => {
                if (block.type === "details") {
                  return (
                    <CustomDetailsBlock 
                      key={idx} 
                      summary={block.summary || "Details"} 
                      content={block.content} 
                    />
                  );
                }
                if (block.type === "execute") {
                  return (
                    <ExecuteBlock 
                      key={idx} 
                      actionJson={block.content} 
                    />
                  );
                }
                if (block.type === "next_action") {
                  return (
                    <NextActionBlock 
                      key={idx} 
                      content={block.content} 
                    />
                  );
                }
                return (
                  <ReactMarkdown key={idx} remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {block.content}
                  </ReactMarkdown>
                );
              })}
            </div>
          )}

          <div className="os-bubble-meta">
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span className="os-bubble-time">
                {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
              </span>
              {!isUser && message.token_total && message.token_total > 0 ? (
                <span
                  className="os-bubble-tokens"
                  title={`Total tokens: ${message.token_total.toLocaleString()}\nInput: ${message.token_request?.toLocaleString()}\nOutput: ${message.token_response?.toLocaleString()}`}
                >
                  {message.token_total.toLocaleString()} tokens
                </span>
              ) : null}
            </div>
            <div style={{ display: "flex", gap: "4px" }}>
              {!isUser && response && (
                <>
                  <button
                    onClick={handleRetry}
                    className="os-btn os-btn-ghost os-btn-xs"
                    title="Regenerate response"
                    aria-label="Regenerate response"
                  >
                    <RotateCcw size={12} />
                    Retry
                  </button>
                  <button
                    onClick={handleCopyResponse}
                    className="os-btn os-btn-ghost os-btn-xs"
                    style={{ color: copied ? "var(--success)" : undefined }}
                    title="Copy response text"
                    aria-label="Copy response text"
                  >
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <button
                    onClick={() => {
                      // Strip thinking tag and next_action XML tags before TTS read-out
                      const clean = response
                        .replace(/<\/?next_action>/gi, "")
                        .replace(/```[\s\S]*?```/g, "")
                        .replace(/`([^`]+)`/g, "$1")
                        .replace(/[*#_\-]/g, "")
                        .trim();
                      if (clean) {
                        wsClient.send("speak_text", { text: clean, manual: true });
                      }
                    }}
                    className="os-btn os-btn-ghost os-btn-xs"
                    style={{ color: "var(--accent)" }}
                    title="Listen to response"
                    aria-label="Listen to response"
                  >
                    <Volume2 size={12} />
                    Listen
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

interface MessageListProps {
  messages: Message[];
  messageRefsMap?: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  onSelectMessage?: (msgId: string) => void;
}

export function MessageList({ messages, messageRefsMap, onSelectMessage }: MessageListProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        padding: "4px 0",
      }}
    >
      <AnimatePresence initial={false}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            ref={(el) => {
              if (messageRefsMap) messageRefsMap.current[msg.id] = el;
            }}
            onClick={() => onSelectMessage?.(msg.id)}
            style={{ transition: "outline 0.3s", cursor: onSelectMessage ? "pointer" : "default" }}
          >
            <ResponseBubble message={msg} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}
