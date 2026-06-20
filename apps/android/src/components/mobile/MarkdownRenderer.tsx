import React, { useState, useEffect } from "react";
import { Copy, Check, ChevronDown, ChevronUp } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";


interface MarkdownProps {
  content: string;
  isUser?: boolean;
}

function parseThinking(content: string): { thinking: string; response: string; isComplete: boolean } {
  const thinkBlocks: string[] = [];
  let remaining = content;
  
  const completePattern = /<think>([\s\S]*?)<\/think>/g;
  let match;
  while ((match = completePattern.exec(content)) !== null) {
    thinkBlocks.push(match[1].trim());
  }
  remaining = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  
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

function ThinkingBlock({ thinking, isComplete }: { thinking: string; isComplete: boolean }) {
  const [isOpen, setIsOpen] = useState(!isComplete);

  useEffect(() => {
    if (isComplete) {
      setIsOpen(false);
    }
  }, [isComplete]);

  return (
    <div style={{
      border: "1px solid var(--border)",
      background: "rgba(255,255,255,0.02)",
      borderRadius: 8,
      marginBottom: 8,
      overflow: "hidden",
    }}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{
          padding: "8px 12px",
          background: "rgba(0,0,0,0.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          fontSize: 11,
          color: "var(--text-secondary)",
          fontWeight: 600,
          letterSpacing: "0.05em",
          userSelect: "none"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{
            width: 6, height: 6, borderRadius: "50%",
            background: isComplete ? "var(--text-muted)" : "var(--accent)",
            boxShadow: isComplete ? "none" : "0 0 8px var(--accent)",
          }} />
          <span>{isComplete ? "THINKING PROCESS" : "THINKING..."}</span>
        </div>
        {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </div>
      {isOpen && (
        <div style={{
          padding: "10px 12px",
          fontSize: 12,
          fontFamily: "monospace",
          color: "var(--text-secondary)",
          borderTop: "1px solid var(--border)",
          whiteSpace: "pre-wrap",
          background: "rgba(0,0,0,0.1)",
          lineHeight: 1.4,
          maxHeight: 150,
          overflowY: "auto"
        }}>
          {thinking.trim()}
        </div>
      )}
    </div>
  );
}

function CodeBlock({ lang, codeText, isUser }: { lang: string; codeText: string; isUser: boolean }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(codeText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const accentColor = isUser ? "#000" : "var(--accent)";
  const codeBg = isUser ? "rgba(0,0,0,0.15)" : "rgba(0,0,0,0.4)";

  return (
    <div style={{ margin: "8px 0", borderRadius: 8, overflow: "hidden", border: `1px solid ${isUser ? "rgba(0,0,0,0.2)" : "var(--border)"}` }}>
      <div style={{
        background: isUser ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.05)",
        padding: "4px 12px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center"
      }}>
        <span style={{ fontSize: 10, color: accentColor, fontFamily: "monospace", letterSpacing: "0.05em", fontWeight: 600 }}>
          {lang ? lang.toUpperCase() : "CODE"}
        </span>
        <button onClick={handleCopy} style={{ background: "transparent", border: "none", color: copied ? "var(--accent)" : "var(--text-secondary)", cursor: "pointer", display: "flex", alignItems: "center", gap: 3, padding: 0 }}>
          {copied ? <Check size={10} /> : <Copy size={10} />}
          <span style={{ fontSize: 9, fontFamily: "monospace" }}>{copied ? "COPIED" : "COPY"}</span>
        </button>
      </div>
      <pre style={{ margin: 0, padding: "12px", background: codeBg, overflowX: "auto", fontSize: 12, lineHeight: 1.5, color: isUser ? "#000" : "var(--text-primary)", fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
        <code>{codeText}</code>
      </pre>
    </div>
  );
}

export function MarkdownRenderer({ content, isUser = false }: MarkdownProps) {
  if (!content) return null;

  const { thinking, response } = parseThinking(content);
  
  const textColor = isUser ? "#000" : "var(--text-primary)";
  const accentColor = isUser ? "#000" : "var(--accent)";
  const borderColor = isUser ? "rgba(0,0,0,0.2)" : "var(--border)";
  const bgOpacity = isUser ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.03)";

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
          display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontFamily: "monospace", 
          color: isHeal ? "var(--warning)" : (isUser ? "#000" : "var(--success, #00e6b4)"), 
          background: isHeal ? "rgba(255, 170, 0, 0.05)" : (isUser ? "rgba(0,0,0,0.05)" : "rgba(0, 230, 180, 0.04)"), 
          border: isHeal ? "1px dashed rgba(255, 170, 0, 0.25)" : (isUser ? "1px solid rgba(0,0,0,0.15)" : "1px solid rgba(0, 230, 180, 0.15)"),
          borderRadius: 4, padding: "4px 8px", margin: "4px 0" 
        }}>
          <span>{isHeal ? "🩹" : "✓"}</span>
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
          display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontFamily: "monospace", 
          color: isUser ? "#c00" : "var(--danger)", 
          background: isUser ? "rgba(200,0,0,0.05)" : "rgba(255, 60, 60, 0.04)", 
          border: isHeal ? "1px dashed rgba(255, 60, 60, 0.25)" : (isUser ? "1px solid rgba(200,0,0,0.15)" : "1px solid rgba(255, 60, 60, 0.15)"),
          borderRadius: 4, padding: "4px 8px", margin: "4px 0" 
        }}>
          <span>❌</span>
          <span>{modifiedChildren}</span>
        </div>
      );
    }

    return <p style={{ margin: "2px 0", color: textColor, fontSize: 14, lineHeight: 1.5 }}>{children}</p>;
  };

  const markdownComponents = {
    p: renderParagraph,
    
    h1: ({ children }: any) => (
      <h1 style={{ fontSize: 18, margin: "10px 0 4px 0", color: accentColor, fontWeight: "bold" }}>
        {children}
      </h1>
    ),
    h2: ({ children }: any) => (
      <h2 style={{ fontSize: 16, margin: "8px 0 4px 0", color: accentColor, fontWeight: "bold" }}>
        {children}
      </h2>
    ),
    h3: ({ children }: any) => (
      <h3 style={{ fontSize: 14, margin: "6px 0 4px 0", color: accentColor, fontWeight: "bold" }}>
        {children}
      </h3>
    ),
    h4: ({ children }: any) => (
      <h4 style={{ fontSize: 13, margin: "4px 0 2px 0", color: accentColor, fontWeight: "bold" }}>
        {children}
      </h4>
    ),
    
    li: ({ children }: any) => (
      <div style={{ display: "flex", gap: 6, marginBottom: 2 }}>
        <span style={{ color: accentColor, flexShrink: 0, marginTop: 1 }}>•</span>
        <span style={{ color: textColor, fontSize: 14, lineHeight: 1.5 }}>{children}</span>
      </div>
    ),
    
    hr: () => (
      <hr style={{ border: "0", borderTop: `1px solid ${borderColor}`, margin: "12px 0", opacity: 0.6 }} />
    ),
    
    pre: ({ children }: any) => {
      const codeEl = React.Children.only(children) as React.ReactElement<any>;
      const className = codeEl.props.className || "";
      const match = /language-(\w+)/.exec(className);
      const lang = match ? match[1] : "";
      const codeText = String(codeEl.props.children).replace(/\n$/, "");
      return <CodeBlock lang={lang} codeText={codeText} isUser={isUser} />;
    },
    
    code: ({ children, ...props }: any) => {
      return (
        <code style={{ 
          fontFamily: "monospace", 
          fontSize: "0.9em", 
          background: isUser ? "rgba(0,0,0,0.1)" : "rgba(255, 255, 255, 0.08)", 
          padding: "2px 4px", 
          borderRadius: 3,
          border: `1px solid ${borderColor}`,
          color: accentColor
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
          border: `1px solid ${borderColor}`,
          fontSize: "12px",
          fontFamily: "monospace"
        }}>
          {children}
        </table>
      </div>
    ),
    thead: ({ children }: any) => (
      <thead style={{ background: bgOpacity, borderBottom: `2px solid ${borderColor}` }}>
        {children}
      </thead>
    ),
    tbody: ({ children }: any) => (
      <tbody>{children}</tbody>
    ),
    tr: ({ children }: any) => (
      <tr style={{ borderBottom: `1px solid ${borderColor}` }}>{children}</tr>
    ),
    th: ({ children }: any) => (
      <th style={{ 
        padding: "6px 8px", 
        fontWeight: "bold", 
        textAlign: "left", 
        color: accentColor, 
        borderRight: `1px solid ${borderColor}` 
      }}>{children}</th>
    ),
    td: ({ children }: any) => (
      <td style={{ 
        padding: "4px 8px", 
        color: textColor, 
        borderRight: `1px solid ${borderColor}` 
      }}>{children}</td>
    ),

    a: ({ href, children }: any) => (
      <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: "underline" }}>
        {children}
      </a>
    ),

    blockquote: ({ children }: any) => (
      <blockquote style={{ 
        borderLeft: `3px solid ${accentColor}`, 
        paddingLeft: "10px", 
        margin: "8px 0", 
        color: textColor, 
        background: bgOpacity 
      }}>
        {children}
      </blockquote>
    )
  };

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {thinking && <ThinkingBlock thinking={thinking} isComplete={!content.includes("<think>")} />}
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {response}
      </ReactMarkdown>
    </div>
  );
}
