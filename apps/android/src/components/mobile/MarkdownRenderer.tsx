import React, { useState, useEffect } from "react";
import { Copy, Check, ChevronDown, ChevronUp } from "lucide-react";

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

function parseInlineMarkdown(text: string) {
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} style={{ fontWeight: "bold" }}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} style={{ 
          fontFamily: "monospace", 
          fontSize: "0.9em", 
          background: "rgba(255, 255, 255, 0.08)", 
          padding: "2px 4px", 
          borderRadius: 3,
          border: "1px solid rgba(255,255,255,0.05)",
          color: "var(--accent)"
        }}>
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

function parseMarkdownLine(line: string, lineIndex: number, isUser: boolean) {
  const trimmed = line.trim();
  const textColor = isUser ? "#000" : "var(--text-primary)";
  const accentColor = isUser ? "#000" : "var(--accent)";

  if (trimmed.startsWith("✓ ")) {
    const desc = trimmed.slice(2);
    const isHeal = desc.toLowerCase().includes("self-healing") || desc.toLowerCase().includes("self_heal");
    return (
      <div key={lineIndex} style={{ 
        display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontFamily: "monospace", 
        color: isHeal ? "var(--warning)" : "var(--success, #00e6b4)", 
        background: isHeal ? "rgba(255, 170, 0, 0.05)" : "rgba(0, 230, 180, 0.04)", 
        border: isHeal ? "1px dashed rgba(255, 170, 0, 0.25)" : "1px solid rgba(0, 230, 180, 0.15)",
        borderRadius: 4, padding: "4px 8px", margin: "4px 0" 
      }}>
        <span>{isHeal ? "🩹" : "✓"}</span>
        <span>{parseInlineMarkdown(desc)}</span>
      </div>
    );
  }
  if (trimmed.startsWith("❌")) {
    const isHeal = trimmed.toLowerCase().includes("self-healing") || trimmed.toLowerCase().includes("self_heal");
    const contentText = trimmed.startsWith("❌ ") ? trimmed.slice(2) : trimmed.slice(1);
    return (
      <div key={lineIndex} style={{ 
        display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontFamily: "monospace", 
        color: "var(--danger)", background: "rgba(255, 60, 60, 0.04)", 
        border: isHeal ? "1px dashed rgba(255, 60, 60, 0.25)" : "1px solid rgba(255, 60, 60, 0.15)",
        borderRadius: 4, padding: "4px 8px", margin: "4px 0" 
      }}>
        <span>❌</span>
        <span>{parseInlineMarkdown(contentText)}</span>
      </div>
    );
  }

  if (trimmed.startsWith("# ")) {
    return <h1 key={lineIndex} style={{ fontSize: 18, margin: "10px 0 4px 0", color: accentColor, fontWeight: "bold" }}>{parseInlineMarkdown(trimmed.slice(2))}</h1>;
  }
  if (trimmed.startsWith("## ")) {
    return <h2 key={lineIndex} style={{ fontSize: 16, margin: "8px 0 4px 0", color: accentColor, fontWeight: "bold" }}>{parseInlineMarkdown(trimmed.slice(3))}</h2>;
  }
  if (trimmed.startsWith("### ")) {
    return <h3 key={lineIndex} style={{ fontSize: 14, margin: "6px 0 4px 0", color: accentColor, fontWeight: "bold" }}>{parseInlineMarkdown(trimmed.slice(4))}</h3>;
  }
  if (trimmed.startsWith("#### ")) {
    return <h4 key={lineIndex} style={{ fontSize: 13, margin: "4px 0 2px 0", color: accentColor, fontWeight: "bold" }}>{parseInlineMarkdown(trimmed.slice(5))}</h4>;
  }
  
  if (trimmed.startsWith("* ") || trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
    return (
      <div key={lineIndex} style={{ display: "flex", gap: 6, marginBottom: 2 }}>
        <span style={{ color: accentColor, flexShrink: 0, marginTop: 1 }}>•</span>
        <span style={{ color: textColor, fontSize: 14, lineHeight: 1.5 }}>{parseInlineMarkdown(trimmed.slice(2))}</span>
      </div>
    );
  }
  
  if (line === "") {
    return <div key={lineIndex} style={{ height: 6 }} />;
  }

  return (
    <p key={lineIndex} style={{ margin: "2px 0", color: textColor, fontSize: 14, lineHeight: 1.5 }}>
      {parseInlineMarkdown(line)}
    </p>
  );
}

export function MarkdownRenderer({ content, isUser = false }: MarkdownProps) {
  if (!content) return null;

  const { thinking, response } = parseThinking(content);

  const parts = response.split(/(```[\s\S]*?```)/g);
  const elements = parts.map((part, index) => {
    if (part.startsWith("```") && part.endsWith("```")) {
      const lines = part.slice(3, -3).trim().split("\n");
      let lang = "";
      let codeLines = lines;
      if (lines.length > 0 && /^[a-zA-Z0-9_-]+$/.test(lines[0])) {
        lang = lines[0];
        codeLines = lines.slice(1);
      }
      const codeText = codeLines.join("\n");
      return <CodeBlock key={index} lang={lang} codeText={codeText} isUser={isUser} />;
    }
    
    const lines = part.split("\n");
    return (
      <div key={index} style={{ display: "flex", flexDirection: "column" }}>
        {lines.map((line, lineIdx) => parseMarkdownLine(line, lineIdx, isUser))}
      </div>
    );
  });

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {thinking && <ThinkingBlock thinking={thinking} isComplete={!content.includes("<think>")} />}
      {elements}
    </div>
  );
}
