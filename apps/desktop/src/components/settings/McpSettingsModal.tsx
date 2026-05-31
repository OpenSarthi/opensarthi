import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Cpu, Plus, Trash2, HelpCircle, CheckCircle2 } from "lucide-react";

interface McpSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function McpSettingsModal({ isOpen, onClose }: McpSettingsModalProps) {
  const [mcpExposeLocal, setMcpExposeLocal] = useState(() => {
    return localStorage.getItem("opensarthi_mcp_expose_local") !== "false";
  });
  const [mcpServers, setMcpServers] = useState<Array<{ id: string; name: string; url: string; enabled: boolean }>>(() => {
    try {
      const saved = localStorage.getItem("opensarthi_mcp_servers");
      return saved ? JSON.parse(saved) : [
        { id: "1", name: "FILESYSTEM TOOLSET", url: "http://localhost:8080/mcp", enabled: false }
      ];
    } catch {
      return [];
    }
  });

  const [newMcpName, setNewMcpName] = useState("");
  const [newMcpUrl, setNewMcpUrl] = useState("");
  const [saved, setSaved] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const addMcpServer = () => {
    if (!newMcpName.trim() || !newMcpUrl.trim()) return;
    const newServer = {
      id: crypto.randomUUID(),
      name: newMcpName.trim().toUpperCase(),
      url: newMcpUrl.trim(),
      enabled: true
    };
    const updated = [...mcpServers, newServer];
    setMcpServers(updated);
    localStorage.setItem("opensarthi_mcp_servers", JSON.stringify(updated));
    setNewMcpName("");
    setNewMcpUrl("");
  };

  const deleteMcpServer = (id: string) => {
    const updated = mcpServers.filter(s => s.id !== id);
    setMcpServers(updated);
    localStorage.setItem("opensarthi_mcp_servers", JSON.stringify(updated));
  };

  const toggleMcpServer = (id: string) => {
    const updated = mcpServers.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s);
    setMcpServers(updated);
    localStorage.setItem("opensarthi_mcp_servers", JSON.stringify(updated));
  };

  const handleSave = () => {
    localStorage.setItem("opensarthi_mcp_expose_local", mcpExposeLocal ? "true" : "false");
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 800);
  };

  const inputStyle: React.CSSProperties = {
    background: "rgba(0,0,0,0.5)",
    border: "1px solid var(--border)",
    padding: "9px 12px",
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono)",
    fontSize: "13px",
    outline: "none",
    borderRadius: "6px",
    width: "100%",
    boxSizing: "border-box",
    transition: "border-color 0.2s, box-shadow 0.2s",
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{
            position: "fixed",
            top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0, 0, 0, 0.45)",
            backdropFilter: "blur(20px) saturate(150%)",
            WebkitBackdropFilter: "blur(20px) saturate(150%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            className="hud-panel"
            initial={{ scale: 0.93, y: 15, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.93, y: 15, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 350 }}
            style={{
              width: "560px",
              maxHeight: "85vh",
              display: "flex",
              flexDirection: "column",
              gap: "0",
              overflow: "hidden",
              background: "rgba(0, 0, 0, 0.45)",
              backdropFilter: "blur(28px) saturate(160%)",
              WebkitBackdropFilter: "blur(28px) saturate(160%)",
              boxShadow: "0 20px 50px rgba(0, 0, 0, 0.6), inset 0 0 20px rgba(255,255,255,0.03)",
            }}
          >
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 20px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <Cpu size={16} color="var(--accent)" />
                <h2 style={{ fontSize: "14px", color: "var(--accent)", letterSpacing: "0.1em", fontWeight: "bold", margin: 0 }}>
                  MODEL CONTEXT PROTOCOL (MCP)
                </h2>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <button
                  onClick={() => setShowHelp(!showHelp)}
                  style={{
                    color: showHelp ? "var(--accent)" : "var(--text-secondary)",
                    cursor: "pointer",
                    background: "none",
                    border: "none",
                    display: "flex",
                    alignItems: "center"
                  }}
                  title="What is MCP?"
                >
                  <HelpCircle size={18} />
                </button>
                <button onClick={onClose} style={{ color: "var(--text-secondary)", cursor: "pointer", background: "none", border: "none", display: "flex", alignItems: "center" }}>
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Scrollable content */}
            <div style={{ overflowY: "auto", flex: 1, padding: "20px 24px", display: "flex", flexDirection: "column", gap: "20px" }}>
              
              {/* Educational info panel */}
              {(showHelp || mcpServers.length === 0) && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px dashed var(--border)",
                    borderRadius: "10px",
                    padding: "12px 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    overflow: "hidden"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", fontWeight: "bold", color: "var(--accent)" }}>
                    <HelpCircle size={14} /> EXPLAINER: MODEL CONTEXT PROTOCOL
                  </div>
                  <div style={{ fontSize: "11.5px", color: "var(--text-secondary)", textTransform: "none", lineHeight: 1.5 }}>
                    The <strong>Model Context Protocol (MCP)</strong> is a standardized open standard created by Anthropic. It allows AI models to directly communicate with external tools, data sets, and server operations in a secure, plug-and-play format.
                  </div>
                  <div style={{ fontSize: "10.5px", color: "var(--text-muted)", textTransform: "none", lineHeight: 1.5, borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "6px" }}>
                    • <strong>OpenSarthi as Server:</strong> When enabled, OpenSarthi exposes its desktop control tools to other LLM clients (like Cursor or Claude Desktop) at the local endpoint subpath.<br/>
                    • <strong>OpenSarthi as Client:</strong> By registering external MCP servers below, you allow the Sarthi agent to leverage external data capabilities (e.g. database querying, GitHub integrations, filesystem searchers) inside the active plan.
                  </div>
                </motion.div>
              )}

              {/* Local Server Config */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <h3 style={{ fontSize: "11px", color: "var(--text-secondary)", letterSpacing: "0.06em", margin: 0 }}>
                  [ LOCAL MCP SERVER (EXPOSER) ]
                </h3>
                <div style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid var(--border)",
                  borderRadius: "10px",
                  padding: "14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "11px", color: "var(--text-primary)" }}>EXPOSE OPENSARTHI DESKTOP AUTOMATION SKILLS</span>
                    <input
                      type="checkbox"
                      checked={mcpExposeLocal}
                      onChange={(e) => setMcpExposeLocal(e.target.checked)}
                      style={{ width: "16px", height: "16px", accentColor: "var(--accent)", cursor: "pointer" }}
                    />
                  </div>
                  {mcpExposeLocal && (
                    <div style={{
                      background: "rgba(0,0,0,0.3)",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      border: "1px solid var(--border)",
                      fontSize: "11px",
                      fontFamily: "var(--font-mono)",
                      color: "var(--text-secondary)",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center"
                    }}>
                      <span>ENDPOINT URL:</span>
                      <span style={{ color: "var(--accent)", textTransform: "none", fontWeight: "bold" }}>http://127.0.0.1:1420/mcp</span>
                    </div>
                  )}
                </div>
              </div>

              {/* External Client Integration */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <h3 style={{ fontSize: "11px", color: "var(--text-secondary)", letterSpacing: "0.06em", margin: 0 }}>
                  [ EXTERNAL MCP CLIENT INTEGRATIONS ]
                </h3>
                
                {/* External server list */}
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {mcpServers.length === 0 ? (
                    <div style={{
                      fontSize: "11px",
                      color: "var(--text-muted)",
                      fontStyle: "italic",
                      textAlign: "center",
                      padding: "16px",
                      border: "1px dashed var(--border)",
                      borderRadius: "10px"
                    }}>
                      // NO EXTERNAL MCP CLIENTS REGISTERED
                    </div>
                  ) : (
                    mcpServers.map((server) => (
                      <div key={server.id} style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        background: "rgba(255,255,255,0.02)",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                        padding: "10px 14px",
                        gap: "12px",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.15)"
                      }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "3px", overflow: "hidden", flex: 1 }}>
                          <span style={{ fontSize: "12px", fontWeight: "bold", color: "var(--text-primary)", letterSpacing: "0.03em" }}>{server.name}</span>
                          <span style={{ fontSize: "10px", color: "var(--text-muted)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textTransform: "none" }}>
                            {server.url}
                          </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <input
                            type="checkbox"
                            checked={server.enabled}
                            onChange={() => toggleMcpServer(server.id)}
                            style={{ width: "14px", height: "14px", accentColor: "var(--accent)", cursor: "pointer" }}
                            title={server.enabled ? "Disable server" : "Enable server"}
                          />
                          <button
                            onClick={() => deleteMcpServer(server.id)}
                            style={{
                              background: "none",
                              border: "none",
                              color: "var(--text-muted)",
                              cursor: "pointer",
                              display: "flex",
                              padding: "4px",
                              transition: "color 0.2s"
                            }}
                            onMouseOver={e => e.currentTarget.style.color = "var(--danger)"}
                            onMouseOut={e => e.currentTarget.style.color = "var(--text-muted)"}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Add new server form */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "8px", marginTop: "4px" }}>
                  <input
                    placeholder="SERVER NAME"
                    value={newMcpName}
                    onChange={(e) => setNewMcpName(e.target.value)}
                    style={{ ...inputStyle, fontSize: "12px" }}
                  />
                  <input
                    placeholder="ENDPOINT URL (http://...)"
                    value={newMcpUrl}
                    onChange={(e) => setNewMcpUrl(e.target.value)}
                    style={{ ...inputStyle, fontSize: "12px" }}
                  />
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={addMcpServer}
                    style={{
                      background: "var(--accent)",
                      color: "#000",
                      border: "none",
                      padding: "10px 14px",
                      borderRadius: "6px",
                      fontWeight: "bold",
                      fontSize: "12px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center"
                    }}
                  >
                    <Plus size={14} />
                  </motion.button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div style={{ padding: "14px 20px", borderTop: "1px solid var(--border)", background: "rgba(0,0,0,0.3)", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                onClick={onClose}
                style={{
                  background: "transparent",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border)",
                  padding: "9px 16px",
                  fontSize: "12px",
                  fontWeight: "bold",
                  cursor: "pointer",
                  borderRadius: "6px",
                  letterSpacing: "0.05em",
                  transition: "all 0.2s"
                }}
                onMouseOver={e => e.currentTarget.style.borderColor = "var(--text-primary)"}
                onMouseOut={e => e.currentTarget.style.borderColor = "var(--border)"}
              >
                CANCEL
              </button>
              <button
                onClick={handleSave}
                style={{
                  background: saved ? "var(--success)" : "var(--accent)",
                  color: "#000",
                  border: "none",
                  padding: "9px 24px",
                  fontWeight: "bold",
                  fontSize: "12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  cursor: "pointer",
                  borderRadius: "6px",
                  letterSpacing: "0.05em",
                  transition: "background 0.3s",
                }}
              >
                {saved ? <><CheckCircle2 size={14} /> SAVED!</> : <>SAVE CONFIGURATION</>}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
