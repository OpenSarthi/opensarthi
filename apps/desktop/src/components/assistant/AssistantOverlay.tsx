import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Settings, History, MessageSquarePlus, Wrench, Cpu, Plus, X, Check, Minimize2, Square, Bot, Terminal, ChevronRight, Volume2, Palette, Smartphone, Laptop, Paperclip, Eye, Link2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { VoiceButton } from "./VoiceButton";
import { Waveform } from "./Waveform";
// import { MatrixRainBackground } from "./MatrixRainBackground";
import { MessageList } from "./ResponseBubble";
import { ActionLog } from "../execution/ActionLog";
import { TaskList } from "./TaskList";
import { OverlayIdleView } from "./OverlayIdleView";
import { RuntimeConsole } from "./RuntimeConsole";
import { ContentPanelView } from "./ContentPanelView";
import { useAssistantStore } from "../../stores/assistantStore";
import { wsClient } from "../../lib/ws";
import pkg from "../../../package.json";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";


const getBuildTarget = (): string => {
  const userAgent = window.navigator.userAgent.toLowerCase();
  const platform = window.navigator.platform?.toLowerCase() || "";

  if (userAgent.includes("win") || platform.includes("win")) return "Windows build";
  if (userAgent.includes("mac") || platform.includes("mac")) return "macOS build";
  if (userAgent.includes("android")) return "Android build";
  if (userAgent.includes("iphone") || userAgent.includes("ipad")) return "iOS build";
  if (userAgent.includes("linux") || platform.includes("linux")) return "Linux build";
  if (userAgent.includes("web") || platform.includes("web")) return "Web build";
  return "SYSTEM BUILD";
};

interface AssistantOverlayProps {
  onOpenSettings: (mode: "agent" | "interaction" | "integrations") => void;
  onOpenHistory: () => void;
  onOpenCustomizer: () => void;
  onOpenMcpSettings: () => void;
  onOpenJsonImport: () => void;
  onOpenContext: () => void;
  onNewChat?: () => void;
}

const THEMES = [
  { value: "theme-green-black", label: "Graphite Green", swatch: "#32d74b" },
  { value: "theme-red-black", label: "Crimson", swatch: "#ff453a" },
  { value: "theme-purple-black", label: "Nebula", swatch: "#bf5af2" },
  { value: "theme-blue-black", label: "Ocean", swatch: "#0a84ff" },
  { value: "theme-light-sakura", label: "Sakura", swatch: "#ff8fab" },
  { value: "theme-light-slate", label: "Slate", swatch: "#64748b" },
  { value: "theme-multicolor-dark", label: "Spectrum", swatch: "linear-gradient(135deg,#32d74b,#0a84ff,#bf5af2,#ff453a)" },
  { value: "theme-multicolor-light", label: "Spectrum Light", swatch: "linear-gradient(135deg,#22c55e,#06b6d4,#8b5cf6,#ec4899)" },
];

/** Returns a traffic-light color based on percentage (0-100). */
function metricColor(pct: number): string {
  if (pct < 40) return "#38bdf8"; // sky blue
  if (pct < 60) return "#22c55e"; // green
  if (pct < 75) return "#facc15"; // yellow
  if (pct < 87) return "#f97316"; // orange
  return "#ef4444";               // red
}

/** Returns a text badge label for color-blind accessibility based on percentage. */
function metricStatusLabel(pct: number): string {
  if (pct < 60) return "";
  if (pct < 85) return "⚠";
  return "‼";
}

export function ActivityLogPanel({ logs }: { logs: { id: string; text: string; timestamp: number }[] }) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs.length]);

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        padding: "12px",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        fontFamily: "var(--font-mono)",
        fontSize: "10px",
        background: "rgba(0, 0, 0, 0.25)",
        borderRadius: "var(--radius-md)",
        border: "1px solid rgba(255, 255, 255, 0.05)",
      }}
      className="custom-scrollbar"
    >
      {logs.map((log) => {
        let color = "var(--text-secondary)";
        if (log.text.startsWith("SYS:")) color = "#00f0ff";
        else if (log.text.startsWith("SARTHI:")) color = "#00ff66";
        else if (log.text.startsWith("USER:")) color = "var(--accent)";

        return (
          <div key={log.id} style={{ color, whiteSpace: "pre-wrap", lineHeight: "1.4" }}>
            {log.text}
          </div>
        );
      })}
    </div>
  );
}

export function AssistantOverlay({ onOpenSettings, onOpenHistory, onOpenCustomizer, onOpenMcpSettings, onOpenJsonImport, onOpenContext, onNewChat }: AssistantOverlayProps) {
  const [textInput, setTextInput] = useState("");
  const [statusIdx, setStatusIdx] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showLogsPanel, setShowLogsPanel] = useState(false);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const [showRemotePopover, setShowRemotePopover] = useState(false);
  const [showContentDrawer, setShowContentDrawer] = useState(false);

  // Custom theme color picker, mobile remote modal, and uptime tracking states
  const [showRemoteModal, setShowRemoteModal] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [pendingColor, setPendingColor] = useState<string | null>(null);
  const [previousColor, setPreviousColor] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [shortcutStatus, setShortcutStatus] = useState<string | null>(null);
  const [onlineSince, setOnlineSince] = useState<number | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);

  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const remoteRef = useRef<HTMLDivElement | null>(null);
  const wheelRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragCounter = useRef(0);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowSettingsDropdown(false);
      }
      if (remoteRef.current && !remoteRef.current.contains(e.target as Node)) {
        setShowRemotePopover(false);
      }
    };
    if (showSettingsDropdown || showRemotePopover) {
      document.addEventListener("mousedown", handleOutsideClick);
      document.body.classList.add("settings-dropdown-open");
    } else {
      document.body.classList.remove("settings-dropdown-open");
    }
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.body.classList.remove("settings-dropdown-open");
    };
  }, [showSettingsDropdown, showRemotePopover]);

  const {
    voiceState, isConnected, currentTranscript,
    messages, currentPlan, activeLocalModel, activeCloudModel, activeProvider, customOpenaiProviderName,
    tokenUsage, globalSessionTokens, taskPaused, isOverlayMode, setOverlayMode, snapAlign,
    continuousListening,
    setVoiceState, addMessage, setTranscript,
    tabs, activeThreadId, addTab, removeTab, setActiveThreadId,
    userOverrodeMinimize, setUserOverrodeMinimize,
    streamingResponse,
    onboardingCompleted,
    activeTheme, setActiveTheme,
    systemMetrics,
    mobilePairing,
    customAccent,
    setCustomAccent,
    activityLogs,
    contentPanel
  } = useAssistantStore();

  // Uptime is derived from the clock tick already forced by `time`.
  useEffect(() => {
    setOnlineSince(isConnected ? Date.now() : null);
  }, [isConnected]);

  // Auto-open content drawer when new content arrives
  useEffect(() => {
    if (contentPanel.contentType) {
      setShowContentDrawer(true);
    } else {
      setShowContentDrawer(false);
    }
  }, [contentPanel.contentType]);

  const getUptimeString = () => {
    if (!isConnected || !onlineSince) return "00h 00m";
    const diffMs = Date.now() - onlineSince;
    if (diffMs < 0) return "00h 00m";
    const totalMin = Math.floor(diffMs / 60000);
    const hrs = Math.floor(totalMin / 60);
    const mins = totalMin % 60;

    const hrsStr = hrs.toString().padStart(2, '0');
    const minsStr = mins.toString().padStart(2, '0');
    return `${hrsStr}h ${minsStr}m`;
  };

  // Color picker helper functions
  /** Convert any CSS color (hex #rgb, #rrggbb, or rgb(r,g,b)) to a 0-360 hue. */
  const anyColorToHue = (color: string): number => {
    if (!color) return 120;
    let r = 0, g = 0, b = 0;
    // Handle rgb(...) / rgba(...)
    const rgbMatch = color.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgbMatch) {
      r = parseInt(rgbMatch[1]) / 255;
      g = parseInt(rgbMatch[2]) / 255;
      b = parseInt(rgbMatch[3]) / 255;
    } else {
      // Handle #rgb or #rrggbb
      let hex = color.trim();
      if (!hex.startsWith("#")) return 120;
      if (hex.length === 4) hex = "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
      r = parseInt(hex.slice(1, 3), 16) / 255;
      g = parseInt(hex.slice(3, 5), 16) / 255;
      b = parseInt(hex.slice(5, 7), 16) / 255;
    }
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0;
    if (max !== min) {
      const d = max - min;
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return Math.round(h * 360);
  };

  const hexToHue = (hex: string): number => anyColorToHue(hex);

  const hslToHex = (h: number, s: number, l: number): string => {
    l /= 100;
    const a = (s * Math.min(l, 1 - l)) / 100;
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, "0");
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };

  const handleColorSelection = (clientX: number, clientY: number) => {
    if (!wheelRef.current) return;
    const rect = wheelRef.current.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const x = clientX - rect.left - cx;
    const y = clientY - rect.top - cy;

    let angle = Math.atan2(y, x);
    let hue = ((angle + Math.PI / 2) * 180) / Math.PI;
    hue = (hue + 360) % 360;

    const hex = hslToHex(hue, 100, 50);
    setPendingColor(hex);
    setCustomAccent(hex);
  };

  const onMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    handleColorSelection(e.clientX, e.clientY);
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        handleColorSelection(e.clientX, e.clientY);
      }
    };
    const onMouseUp = () => {
      setIsDragging(false);
    };
    if (isDragging) {
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isDragging]);

  const handleOpenColorPicker = () => {
    // Read the actual computed accent from CSS — returns rgb(r,g,b) in browsers
    const computedAccent = getComputedStyle(document.documentElement)
      .getPropertyValue("--accent")
      .trim();
    // Prefer customAccent (already a hex string) → computed accent → default green
    const startColor = customAccent || (computedAccent ? computedAccent : "#1aff1a");
    setPreviousColor(customAccent);
    setPendingColor(startColor);
    if (!customAccent) {
      // Convert computed rgb(...) to hex so we have a clean value to work with
      const hue = anyColorToHue(startColor);
      const hexStart = hslToHex(hue, 100, 50);
      setCustomAccent(hexStart);
      setPendingColor(hexStart);
    }
    setShowColorPicker(true);
  };

  const handleDiscardColor = () => {
    setCustomAccent(previousColor);
    setShowColorPicker(false);
  };

  const handleSaveColor = () => {
    setShowColorPicker(false);
  };

  const handleCreateShortcut = async () => {
    try {
      setShortcutStatus("CREATING...");
      await invoke<string>("create_desktop_shortcut");
      setShortcutStatus("SUCCESS!");
      setTimeout(() => setShortcutStatus(null), 3000);
    } catch (err: any) {
      setShortcutStatus("FAILED: " + err);
      setTimeout(() => setShortcutStatus(null), 4000);
    }
  };

  const isLocal = activeProvider === "ollama" || activeProvider === "local" || activeProvider === "custom_openai";
  const modelKey = isLocal ? activeLocalModel : activeCloudModel;
  const globalSessionCount = globalSessionTokens[modelKey] || 0;

  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const setupListener = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const appWindow = getCurrentWindow();
        const max = await appWindow.isMaximized();
        setIsMaximized(max);
        if (max) {
          await appWindow.setAlwaysOnTop(false);
          if (useAssistantStore.getState().isOverlayMode) {
            useAssistantStore.getState().setOverlayMode(false);
          }
        }

        const unsub = await appWindow.onResized(async () => {
          const m = await appWindow.isMaximized();
          setIsMaximized(m);
          if (m) {
            await appWindow.setAlwaysOnTop(false);
            if (useAssistantStore.getState().isOverlayMode) {
              useAssistantStore.getState().setOverlayMode(false);
            }
          }
        });
        unlisten = unsub;
      } catch (err) {
        console.warn("Failed to check or listen to window maximized state", err);
      }
    };
    setupListener();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Ref map: message id → DOM element for scroll-to
  const messageRefsMap = useRef<Record<string, HTMLDivElement | null>>({});
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const taskRefsMap = useRef<Record<string, HTMLDivElement | null>>({});

  // Leetcode-style Draggable Panel Resizing State
  const [leftWidth, setLeftWidth] = useState(260); // Default Left panel width in px
  const [rightWidth, setRightWidth] = useState(240); // Default Right panel width in px
  const [consoleHeight, setConsoleHeight] = useState(220); // Default Console panel height in px
  const isDraggingConsole = useRef(false);

  const containerRef = useRef<HTMLDivElement>(null);
  // const lastContainerWidth = useRef<number | null>(null);
  // Save panel widths before overlay collapse so they can be restored on expand
  const savedPanelWidths = useRef<{ left: number; right: number } | null>(null);
  const isRestoringFromOverlay = useRef(false);
  const isDraggingLeft = useRef(false);
  const isDraggingRight = useRef(false);

  const resizeLeft = useCallback((e: MouseEvent) => {
    if (!isDraggingLeft.current) return;
    if (!containerRef.current) return;
    const containerWidth = containerRef.current.clientWidth;
    const maxAllowed = Math.floor(containerWidth * 0.4);
    const newWidth = Math.max(250, Math.min(maxAllowed, e.clientX - 12)); // bounds: min 250px, max 40% of container
    setLeftWidth(newWidth);
  }, []);

  const stopResizeLeft = useCallback(() => {
    isDraggingLeft.current = false;
    document.removeEventListener("mousemove", resizeLeft);
    document.removeEventListener("mouseup", stopResizeLeft);
  }, [resizeLeft]);

  const startResizeLeft = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingLeft.current = true;
    document.addEventListener("mousemove", resizeLeft);
    document.addEventListener("mouseup", stopResizeLeft);
  }, [resizeLeft, stopResizeLeft]);

  const resizeRight = useCallback((e: MouseEvent) => {
    if (!isDraggingRight.current) return;
    if (!containerRef.current) return;
    const containerWidth = containerRef.current.clientWidth;
    const maxAllowed = Math.floor(containerWidth * 0.35);
    const newWidth = Math.max(230, Math.min(maxAllowed, containerWidth - e.clientX - 12)); // bounds: min 230px, max 35% of container
    setRightWidth(newWidth);
  }, []);

  const stopResizeRight = useCallback(() => {
    isDraggingRight.current = false;
    document.removeEventListener("mousemove", resizeRight);
    document.removeEventListener("mouseup", stopResizeRight);
  }, [resizeRight]);

  const startResizeRight = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRight.current = true;
    document.addEventListener("mousemove", resizeRight);
    document.addEventListener("mouseup", stopResizeRight);
  }, [resizeRight, stopResizeRight]);

  const resizeConsole = useCallback((e: MouseEvent) => {
    if (!isDraggingConsole.current) return;
    if (!containerRef.current) return;
    const containerHeight = containerRef.current.clientHeight;
    const maxAllowed = Math.floor(containerHeight * 0.65);
    const newHeight = Math.max(120, Math.min(maxAllowed, containerHeight - e.clientY));
    setConsoleHeight(newHeight);
  }, []);

  const stopResizeConsole = useCallback(() => {
    isDraggingConsole.current = false;
    document.removeEventListener("mousemove", resizeConsole);
    document.removeEventListener("mouseup", stopResizeConsole);
  }, [resizeConsole]);

  const startResizeConsole = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingConsole.current = true;
    document.addEventListener("mousemove", resizeConsole);
    document.addEventListener("mouseup", stopResizeConsole);
  }, [resizeConsole, stopResizeConsole]);

  // Handle window resizing to dynamically constrain sidepanels
  // useEffect(() => {
  //   const handleWindowResize = () => {
  //     if (!containerRef.current) return;
  //     // If we just restored from overlay mode, skip the width recalculation
  //     // because we already restored the saved widths
  //     if (isRestoringFromOverlay.current) {
  //       isRestoringFromOverlay.current = false;
  //       lastContainerWidth.current = containerRef.current.clientWidth;
  //       return;
  //     }
  //     const w = containerRef.current.clientWidth;
  //     if (lastContainerWidth.current && lastContainerWidth.current !== w) {
  //       const ratio = w / lastContainerWidth.current;
  //       setLeftWidth(prev => {
  //         const next = Math.round(prev * ratio);
  //         return Math.max(250, Math.min(next, 320));
  //       });
  //       setRightWidth(prev => {
  //         const next = Math.round(prev * ratio);
  //         return Math.max(230, Math.min(next, 320));
  //       });
  //     } else {
  //       setLeftWidth(Math.max(260, Math.min(Math.floor(w * 0.23), 320)));
  //       setRightWidth(Math.max(240, Math.min(Math.floor(w * 0.21), 300)));
  //     }
  //     lastContainerWidth.current = w;
  //   };
  //   window.addEventListener("resize", handleWindowResize);
  //   // Debounce/delay initial call slightly to ensure DOM is fully ready
  //   const timer = setTimeout(handleWindowResize, 60);
  //   return () => {
  //     window.removeEventListener("resize", handleWindowResize);
  //     clearTimeout(timer);
  //   };
  // }, []);

  // Save panel widths before entering overlay, restore them when exiting
  useEffect(() => {
    if (isOverlayMode) {
      // Capture current widths before the overlay shrinks the window
      savedPanelWidths.current = { left: leftWidth, right: rightWidth };
    } else {
      // Exiting overlay — restore saved widths if available
      if (savedPanelWidths.current) {
        setLeftWidth(savedPanelWidths.current.left);
        setRightWidth(savedPanelWidths.current.right);
        isRestoringFromOverlay.current = true;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOverlayMode]);

  // Clean up global listeners on unmount
  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", resizeLeft);
      document.removeEventListener("mouseup", stopResizeLeft);
      document.removeEventListener("mousemove", resizeRight);
      document.removeEventListener("mouseup", stopResizeRight);
      document.removeEventListener("mousemove", resizeConsole);
      document.removeEventListener("mouseup", stopResizeConsole);
    };
  }, [resizeLeft, stopResizeLeft, resizeRight, stopResizeRight, resizeConsole, stopResizeConsole]);


  const lastSentSourceRef = useRef<"text" | "voice">("text");

  const handleVoiceClick = useCallback(() => {
    if (voiceState === "idle" || voiceState === "error") {
      setVoiceState("listening");
      // Clean slate on toggle
      setTextInput("");
      useAssistantStore.getState().setTranscript("");
      wsClient.send("voice_state", { state: "listening" });
    } else if (voiceState === "listening") {
      setVoiceState("idle");
      wsClient.send("voice_state", { state: "idle" });
    } else if (voiceState === "speaking") {
      wsClient.send("stop_speech", {});
      const { continuousListening } = useAssistantStore.getState();
      setVoiceState(continuousListening ? "listening" : "idle");
    }
  }, [voiceState, setVoiceState]);

  const handleVoiceSend = useCallback((msg: string) => {
    if (!msg || !isConnected) return;
    lastSentSourceRef.current = "voice";
    addMessage({ id: crypto.randomUUID(), role: "user", content: msg, timestamp: Date.now() });
    wsClient.send("user_message", { text: msg, source: "voice", thread_id: activeThreadId });
    setTextInput("");
    setVoiceState("processing");
    setTranscript(null);
  }, [isConnected, setVoiceState, addMessage, activeThreadId, setTranscript]);

  const handleTextSend = useCallback(async () => {
    const msg = textInput.trim();
    if (!msg && attachedFiles.length === 0) return;
    if (!isConnected) return;
    lastSentSourceRef.current = "text";
    setVoiceState("processing");

    let finalMsg = msg;
    if (attachedFiles.length > 0) {
      const filePromises = attachedFiles.map(file => {
        return new Promise<string>((resolve) => {
          if (file.type.startsWith("text/") || /\.(md|json|py|js|ts|tsx|jsx|csv|txt|log)$/.test(file.name)) {
            const reader = new FileReader();
            reader.onload = (ev) => {
              const content = ev.target?.result as string;
              resolve(`\n\n--- Attached File: ${file.name} (${(file.size / 1024).toFixed(1)} KB) ---\n${content}`);
            };
            reader.onerror = () => {
              resolve(`\n\n--- Attached File: ${file.name} (Error reading file) ---`);
            };
            reader.readAsText(file);
          } else {
            resolve(`\n\n--- Attached File: ${file.name} (${(file.size / 1024).toFixed(1)} KB, binary file) ---`);
          }
        });
      });

      const fileContents = await Promise.all(filePromises);
      finalMsg = (msg + fileContents.join("")).trim();
    }

    addMessage({ id: crypto.randomUUID(), role: "user", content: finalMsg, timestamp: Date.now() });
    wsClient.send("user_message", { text: finalMsg, source: "text", thread_id: activeThreadId });
    setTextInput("");
    setAttachedFiles([]);
  }, [textInput, attachedFiles, isConnected, setVoiceState, addMessage, activeThreadId]);

  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Synchronize dynamic voice transcripts to the text prompt and auto-send on silence
  useEffect(() => {
    if (voiceState === "listening") {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

      if (currentTranscript && currentTranscript.trim()) {
        setTextInput(currentTranscript);
      }

      silenceTimerRef.current = setTimeout(() => {
        const finalMsg = currentTranscript ? currentTranscript.trim() : "";
        if (finalMsg) {
          handleVoiceSend(finalMsg);
        } else {
          // If continuous listening is enabled, do NOT go back to idle; stay ready for voice input
          if (!continuousListening) {
            setVoiceState("idle");
          }
        }
      }, (currentTranscript && currentTranscript.trim()) ? 3000 : 5000); // 5s wait for STT lag after wake word, 3.0s for natural narration pauses!
    } else {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    }

    return () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    };
  }, [currentTranscript, voiceState, handleVoiceSend, setVoiceState]);

  // Native Text-to-Speech (TTS) for voice input replies
  useEffect(() => {
    try {
      if (messages && messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        if (
          lastMsg &&
          lastMsg.role === "assistant" &&
          lastSentSourceRef.current === "voice" &&
          lastMsg.content
        ) {
          let textToSpeak = String(lastMsg.content);

          // Strip <think>...</think> block completely
          textToSpeak = textToSpeak.replace(/<think>[\s\S]*?<\/think>/g, "");

          // If there's an unclosed <think>, the model is still thinking — wait
          if (textToSpeak.includes("<think>")) {
            return;
          }

          // Strip markdown code blocks (including JSON plans)
          let clean = textToSpeak
            .replace(/<\/?next_action>/gi, "")
            .replace(/```[\s\S]*?```/g, "");

          // Strip raw JSON array blocks (in case LLM output JSON without backticks)
          clean = clean.replace(/\[\s*\{[\s\S]*\}\s*\]/g, "");

          // Strip task completion step lists (lines starting with "- **...")
          // These are from _build_success_response and should not be spoken verbatim
          clean = clean.replace(/^[-*]\s+\*\*.*?\*\*:.*$/gm, "");

          // Strip "What I did (N steps):" section headers
          clean = clean.replace(/\*\*What I did \(\d+ steps?\):\*\*/g, "");
          clean = clean.replace(/\*\*Results?:\*\*/g, "");

          // Strip divider lines
          clean = clean.replace(/^---.*---$/gm, "");

          // Strip inline code, markdown formatting
          clean = clean
            .replace(/`([^`]+)`/g, "$1")
            .replace(/[*#_\-]/g, "")
            .replace(/^\s*[✓✗❌⚠️✅]+\s*/gm, "")  // Strip status emojis/bullets
            .replace(/\n{3,}/g, "\n\n")  // Collapse multiple blank lines
            .trim();

          // Only speak the first paragraph/sentence if the content is very long
          // (task result lists shouldn't be read out loud in full)
          if (clean.length > 400) {
            const firstPara = clean.split(/\n\n/)[0];
            clean = firstPara.trim();
          }

          if (clean) {
            wsClient.send("speak_text", { text: clean, manual: false });
          }
          lastSentSourceRef.current = "text"; // reset expectation
        }
      }
    } catch (err) {
      console.error("Speech Synthesis error caught safely:", err);
    }
  }, [messages]);


  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleTextSend(); }
  };

  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const getFormattedTime = () => {
    return time.toLocaleTimeString('en-US', { hour12: false });
  };

  const getFormattedDate = () => {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const dayName = days[time.getDay()];
    const day = time.getDate();
    const monthName = months[time.getMonth()];
    const year = time.getFullYear();
    return `${dayName} ${day} ${monthName} ${year}`;
  };

  const handleNewThread = () => {
    onNewChat?.();
    const newId = crypto.randomUUID();
    addTab(newId);
    wsClient.send("load_thread", { thread_id: newId });
  };



  const activeTab = tabs.find((t) => t.id === activeThreadId);
  const isTaskRunning = !!activeTab?.currentPlan;
  const isBusy = isTaskRunning || voiceState === "processing" || voiceState === "speaking" || !!streamingResponse;

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, currentTranscript, voiceState, isTaskRunning]);

  // Streaming tokens update many times per second: jump instantly instead of
  // starting a new smooth-scroll animation on every chunk.
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el || !streamingResponse) return;
    el.scrollTop = el.scrollHeight;
  }, [streamingResponse]);

  // Auto-collapse console when connected, auto-expand during startup connection
  useEffect(() => {
    if (!onboardingCompleted) {
      setShowLogsPanel(false);
      return;
    }
    if (!isConnected) {
      setShowLogsPanel(true);
    } else {
      setShowLogsPanel(false);
    }
  }, [isConnected, onboardingCompleted]);

  // Toggle console-open body class for WebKitGTK native scrollbar clipping fixes
  useEffect(() => {
    document.body.classList.toggle("console-open", showLogsPanel);
    return () => {
      document.body.classList.remove("console-open");
    };
  }, [showLogsPanel]);

  // Toggle content-drawer-open body class for WebKitGTK native scrollbar clipping fixes
  useEffect(() => {
    document.body.classList.toggle("content-drawer-open", showContentDrawer);
    return () => {
      document.body.classList.remove("content-drawer-open");
    };
  }, [showContentDrawer]);

  // Handle stop task action (replaces send button when task is running)
  const handleStopTask = useCallback(() => {
    wsClient.send("cancel_execution", { thread_id: activeThreadId });
    // Instantly reset UI state locally
    const store = useAssistantStore.getState();
    store.setPlan(null, activeThreadId);
    store.setExecutingStep(null, activeThreadId);
    store.setVoiceState("idle");
    store.clearStreamingResponse();
  }, [activeThreadId]);

  // Reset user override when a new task starts
  useEffect(() => {
    if (isTaskRunning) {
      setUserOverrodeMinimize(false);
    }
  }, [isTaskRunning]);

  const STATUS_LINES = [
    "What should we work on?",
    "I can run tasks right on your desktop.",
    "Ask me to find, open, or automate anything.",
    "Voice and text both work.",
    "Ready when you are.",
    "Your files and context stay on this machine.",
    "Try “Summarise my notes.”",
    "Try “Open my calendar.”",
    "Try “Find that file from yesterday.”",
    "Listening whenever you are.",
  ];

  useEffect(() => {
    if (messages.length > 0 || !isConnected) return;
    const t = setInterval(() => setStatusIdx((i) => (i + 1) % STATUS_LINES.length), 2200);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, isConnected]);

  // ── Corner-radius logic: per snap position ────────────────────────────────
  // Right edge: free side (left) is curved, wall side (right) is 0
  // Left edge: free side (right) is curved, wall side (left) is 0
  // Floating (none): all corners curved
  const overlayRadius = {
    borderTopLeftRadius:
      snapAlign === "right" ? "20px" : snapAlign === "left" ? "0px" : "20px",
    borderBottomLeftRadius:
      snapAlign === "right" ? "20px" : snapAlign === "left" ? "0px" : "20px",
    borderTopRightRadius:
      snapAlign === "left" ? "20px" : snapAlign === "right" ? "0px" : "20px",
    borderBottomRightRadius:
      snapAlign === "left" ? "20px" : snapAlign === "right" ? "0px" : "20px",
  };

  // ── Border: only on free sides (none on the wall side) ───────────────────
  const overlayBorder = {
    borderTop: "1.5px solid var(--border-accent)",
    borderBottom: "1.5px solid var(--border-accent)",
    borderLeft: snapAlign === "right" ? "1.5px solid var(--border-accent)" : snapAlign === "left" ? "none" : "1.5px solid var(--border-accent)",
    borderRight: snapAlign === "left" ? "1.5px solid var(--border-accent)" : snapAlign === "right" ? "none" : "1.5px solid var(--border-accent)",
  };

  // Computed step counts for progress bar
  const overlaySteps = currentPlan?.steps ?? [];
  const overlayDoneCount = overlaySteps.filter(s => s.status === "success" || s.status === "error" || s.status === "terminated").length;
  const overlayTotalCount = overlaySteps.filter(s => s.status !== "divider").length;
  const overlayProgress = overlayTotalCount > 0 ? (overlayDoneCount / overlayTotalCount) * 100 : 0;
  const overlayRunningStep = overlaySteps.find(s => s.status === "running");

  const presence = !isConnected
    ? { label: "Offline", cls: "is-offline" }
    : voiceState === "listening"
      ? { label: "Listening", cls: "is-listening" }
      : voiceState === "speaking"
        ? { label: "Speaking", cls: "is-speaking" }
        : isTaskRunning || voiceState === "processing"
          ? {
              label: isTaskRunning
                ? taskPaused
                  ? "Paused"
                  : `Working${overlayTotalCount ? ` · ${overlayDoneCount}/${overlayTotalCount}` : ""}`
                : "Thinking",
              cls: "is-working",
            }
          : { label: "Ready", cls: "is-ready" };

  if (isOverlayMode) {
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-secondary)",
          boxShadow: snapAlign === "right"
            ? "-4px 0 40px rgba(0,0,0,0.7), 0 0 0 1px var(--border-accent)"
            : snapAlign === "left"
              ? "4px 0 40px rgba(0,0,0,0.7), 0 0 0 1px var(--border-accent)"
              : "0 8px 40px rgba(0,0,0,0.7), 0 0 24px var(--accent-glow)",
          padding: "0",
          gap: "0",
          overflow: "hidden",
          ...overlayRadius,
          ...overlayBorder,
        }}
      >
        {/* ─── Drag-handle Top Bar ─────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
            cursor: "grab",
            padding: "10px 12px 8px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            userSelect: "none",
            background: "rgba(255,255,255,0.02)",
          }}
          onMouseDown={async () => {
            try {
              const { getCurrentWindow } = await import("@tauri-apps/api/window");
              getCurrentWindow().startDragging();
            } catch (err) {
              console.warn("Drag error:", err);
            }
          }}
        >
          {/* Left: logo + status */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {/* Drag dots */}
            <div style={{ display: "grid", gridTemplateColumns: "3px 3px", gap: "2px", opacity: 0.35 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{ width: "3px", height: "3px", borderRadius: "50%", background: "var(--text-secondary)" }} />
              ))}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              {/* Pulsing status dot */}
              <div style={{
                width: "7px", height: "7px", borderRadius: "50%",
                background: isConnected ? "var(--accent)" : "rgba(255,80,80,0.7)",
                boxShadow: isConnected ? "0 0 6px var(--accent)" : "none",
                animation: isConnected && isTaskRunning ? "pulse 1.4s ease-in-out infinite" : "none",
              }} />
              <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.12em", color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
                SARTHI
              </span>
              {isTaskRunning && (
                <span style={{ fontSize: "9px", color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em", fontFamily: "var(--font-mono)" }}>
                  {taskPaused ? "PAUSED" : "RUNNING"}
                </span>
              )}
            </div>
          </div>

          {/* Right: action buttons */}
          <div
            style={{ display: "flex", gap: "4px", alignItems: "center" }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Expand button */}
            <button
              onClick={() => {
                setOverlayMode(false);
                setUserOverrodeMinimize(true);
                console.log("[Overlay] User manual expand, override active:", userOverrodeMinimize);
              }}
              title="Expand to Full View"
              style={{
                width: "26px", height: "26px",
                borderRadius: "6px",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "var(--text-secondary)",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={e => { (e.target as HTMLButtonElement).style.background = "rgba(255,255,255,0.12)"; (e.target as HTMLButtonElement).style.color = "var(--accent)"; }}
              onMouseLeave={e => { (e.target as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)"; (e.target as HTMLButtonElement).style.color = "var(--text-secondary)"; }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
            </button>
          </div>
        </div>

        {/* ─── Main scrollable content ──────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "0", minHeight: 0 }}>

          {currentPlan ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "12px" }}>

              {/* Goal card */}
              <div style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: "10px",
                padding: "10px 12px",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{
                    fontSize: "9px", color: "var(--accent)",
                    textTransform: "uppercase", letterSpacing: "0.1em",
                    fontFamily: "var(--font-mono)", opacity: 0.8
                  }}>⚡ Current Task</span>
                </div>
                <div className="selectable" style={{
                  fontSize: "12px", color: "rgba(255,255,255,0.85)",
                  fontWeight: 600, lineHeight: "1.45",
                  display: "-webkit-box", WebkitLineClamp: "3",
                  WebkitBoxOrient: "vertical", overflow: "hidden",
                }}>
                  {currentPlan.goal}
                </div>

                {/* Progress bar */}
                {overlayTotalCount > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "2px" }}>
                    <div style={{
                      height: "3px", borderRadius: "2px",
                      background: "rgba(255,255,255,0.08)",
                      overflow: "hidden",
                    }}>
                      <div style={{
                        height: "100%", borderRadius: "2px",
                        width: `${overlayProgress}%`,
                        background: "linear-gradient(to right, var(--accent), rgba(0,255,120,0.6))",
                        transition: "width 0.4s ease",
                        boxShadow: "0 0 6px var(--accent)",
                      }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", color: "rgba(255,255,255,0.3)", fontFamily: "var(--font-mono)" }}>
                      <span>{overlayDoneCount}/{overlayTotalCount} steps</span>
                      {overlayRunningStep && (
                        <span style={{ color: "var(--accent)", maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          ↻ {overlayRunningStep.description || overlayRunningStep.tool}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Tokens row */}
              <div style={{
                display: "flex", justifyContent: "space-between",
                fontSize: "10px", fontFamily: "var(--font-mono)",
                color: "rgba(255,255,255,0.3)",
                padding: "0 2px",
              }}>
                <span>Tokens</span>
                <span style={{ color: "var(--accent)" }}>{tokenUsage.totalTokens.toLocaleString()}</span>
              </div>

              {/* Action log */}
              <ActionLog plan={currentPlan} selectedTaskId={null} messages={messages} />
            </div>
          ) : (
            // ── Idle mini-chat view ──────────────────────────────────────
            <OverlayIdleView
              voiceState={voiceState}
              currentTranscript={currentTranscript}
              messages={messages}
              streamingResponse={streamingResponse}
              isConnected={isConnected}
              textInput={textInput}
              setTextInput={setTextInput}
              handleTextSend={handleTextSend}
              handleVoiceClick={handleVoiceClick}
              handleKeyDown={handleKeyDown}
            />
          )}
        </div>

        {/* ─── Footer Controls ─────────────────────────────────────────── */}
        <div style={{
          flexShrink: 0, display: "flex", flexDirection: "column", gap: "8px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          padding: "10px 12px",
          background: "rgba(0,0,0,0.2)",
        }}>
          {/* Pause / Stop controls — only when a task is running */}
          {isTaskRunning && (
            <div style={{ display: "flex", gap: "6px" }}>
              <button
                onClick={() => {
                  if (taskPaused) {
                    wsClient.send("resume_execution", { thread_id: activeThreadId });
                  } else {
                    wsClient.send("pause_execution", { thread_id: activeThreadId });
                  }
                }}
                style={{
                  flex: 1, padding: "7px 0",
                  fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em",
                  fontFamily: "var(--font-mono)",
                  borderRadius: "8px",
                  background: "rgba(255,255,255,0.03)",
                  border: `1px solid ${taskPaused ? "rgba(60,220,100,0.4)" : "rgba(255,160,30,0.4)"}`,
                  color: taskPaused ? "rgb(60,220,100)" : "rgb(255,160,30)",
                  cursor: "pointer",
                }}
              >
                {taskPaused ? "▶ RESUME" : "⏸ PAUSE"}
              </button>
              <button
                onClick={() => { wsClient.send("cancel_execution", { thread_id: activeThreadId }); }}
                style={{
                  flex: 1, padding: "7px 0",
                  fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em",
                  fontFamily: "var(--font-mono)",
                  borderRadius: "8px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,60,60,0.4)",
                  color: "rgb(255,80,80)",
                  cursor: "pointer",
                }}
              >
                ■ STOP
              </button>
            </div>
          )}

          {/* Status row */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            fontSize: "9px", color: "var(--text-secondary)",
            fontFamily: "var(--font-mono)", letterSpacing: "0.05em",
          }}>
            <span>ONLINE: <span style={{
              color: isConnected ? "var(--accent)" : "var(--danger)",
              fontWeight: 700,
              textShadow: isConnected ? "0 0 6px var(--accent-glow)" : "none"
            }}>{isConnected ? "YES" : "NO"}</span></span>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "2px" }}>
              <span style={{ color: "var(--text-secondary)", fontWeight: "bold" }}>{getFormattedTime()}</span>
              <span style={{ fontSize: "7px", color: "var(--text-muted)", letterSpacing: "0.03em" }}>{getFormattedDate().toUpperCase()}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        dragCounter.current++;
        if (dragCounter.current === 1) {
          setIsDragOver(true);
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragCounter.current--;
        if (dragCounter.current === 0) {
          setIsDragOver(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragCounter.current = 0;
        setIsDragOver(false);
        const files = Array.from(e.dataTransfer.files || []);
        if (files.length === 0) return;
        setAttachedFiles((prev) => {
          const combined = [...prev, ...files];
          if (combined.length > 5) {
            alert("You can attach at most 5 files.");
          }
          return combined.slice(0, 5);
        });
      }}
      style={{
        width: "100vw", height: "100vh",
        display: "flex", flexDirection: "column",
        background:
          "radial-gradient(ellipse 85% 55% at 50% -10%, var(--accent-glow-lg) 0%, transparent 62%), var(--bg-primary)",
        padding: "14px",
        gap: "12px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {isDragOver && (
        <div style={{
          position: "absolute",
          inset: "12px",
          zIndex: 1000,
          border: "2px dashed var(--accent)",
          borderRadius: "var(--radius-lg)",
          background: "rgba(6, 10, 8, 0.9)",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          boxShadow: "inset 0 1px 0 var(--glass-sheen)",
        }}>
          <Paperclip size={48} style={{ color: "var(--accent)" }} />
          <div style={{ color: "var(--accent)", fontSize: "18px", fontWeight: "bold", letterSpacing: "0.05em" }}>
            DROP FILES TO ATTACH
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>
            Up to 5 files can be attached
          </div>
        </div>
      )}
      {/* ─── Top Bar ─── */}
      <div className="os-topbar">
        <div className="os-brand">
          <div className="os-brand-mark" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3.2 4.4 12l7.6 8.8L19.6 12 12 3.2Z" />
              <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
            </svg>
          </div>
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span className="os-brand-name">OpenSarthi</span>
            <span className="os-brand-sub">Desktop Agent</span>
          </div>
          <span
            className={`os-presence ${presence.cls}`}
            title={
              isTaskRunning && overlayRunningStep
                ? `Running ${overlayRunningStep.tool}`
                : `Agent status: ${presence.label}`
            }
            role="status"
            aria-live="polite"
          >
            <span className="os-presence-dot" aria-hidden="true" />
            {presence.label}
          </span>
        </div>
        <div className="os-topbar-actions">
          {/* New Thread Button */}
          <motion.button
            onClick={handleNewThread}
            title="New thread"
            aria-label="New thread"
            className="os-icon-btn"
            whileTap={{ scale: 0.96 }}
            style={isMaximized ? { width: "auto", padding: "0 10px", gap: 7 } : undefined}
          >
            <MessageSquarePlus size={16} />
            {isMaximized && <span>New thread</span>}
          </motion.button>

          {/* History Button */}
          <motion.button
            onClick={onOpenHistory}
            title="Past threads"
            aria-label="Past threads"
            className="os-icon-btn"
            whileTap={{ scale: 0.96 }}
            style={isMaximized ? { width: "auto", padding: "0 10px", gap: 7 } : undefined}
          >
            <History size={16} />
            {isMaximized && <span>History</span>}
          </motion.button>

          {/* Toggle Console Logs Button */}
          <motion.button
            onClick={() => setShowLogsPanel(!showLogsPanel)}
            title="System console"
            aria-label="Toggle system console"
            aria-pressed={showLogsPanel}
            className="os-icon-btn"
            whileTap={{ scale: 0.96 }}
            style={isMaximized ? { width: "auto", padding: "0 10px", gap: 7 } : undefined}
          >
            <Terminal size={16} />
            {isMaximized && <span>Console</span>}
          </motion.button>

          {/* Settings Button Container (relative for dropdown anchor) */}
          <div ref={dropdownRef} style={{ position: "relative" }}>
            <motion.button
              onClick={() => setShowSettingsDropdown(!showSettingsDropdown)}
              title="Settings"
              aria-label="Open settings menu"
              aria-expanded={showSettingsDropdown}
              className="os-icon-btn"
              whileTap={{ scale: 0.96 }}
              style={isMaximized ? { width: "auto", padding: "0 10px", gap: 7 } : undefined}
            >
              <Settings size={16} />
              {isMaximized && <span>Settings</span>}
            </motion.button>

            <AnimatePresence>
              {showSettingsDropdown && (
                <motion.div
                  initial={{ opacity: 0, y: -15, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -15, scale: 0.95 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="settings-dropdown-menu"
                  style={{ originY: 0, originX: 1 }}
                >
                  <button
                    onClick={() => {
                      onOpenSettings("agent");
                      setShowSettingsDropdown(false);
                    }}
                    className="dropdown-item"
                  >
                    <Cpu size={13} style={{ color: "var(--accent)" }} />
                    <span>Agent Settings</span>
                  </button>

                  <button
                    onClick={() => {
                      onOpenSettings("interaction");
                      setShowSettingsDropdown(false);
                    }}
                    className="dropdown-item"
                  >
                    <Volume2 size={13} style={{ color: "var(--accent)" }} />
                    <span>Voice & Audio Settings</span>
                  </button>

                  <button
                    onClick={() => {
                      onOpenSettings("integrations");
                      setShowSettingsDropdown(false);
                    }}
                    className="dropdown-item"
                  >
                    <Link2 size={13} style={{ color: "var(--accent)" }} />
                    <span>Integrations & Sources</span>
                  </button>

                  <button
                    onClick={() => {
                      onOpenMcpSettings();
                      setShowSettingsDropdown(false);
                    }}
                    className="dropdown-item"
                  >
                    <Wrench size={13} style={{ color: "var(--accent)" }} />
                    <span>MCP Settings</span>
                  </button>

                  <button
                    onClick={() => {
                      onOpenCustomizer();
                      setShowSettingsDropdown(false);
                    }}
                    className="dropdown-item"
                  >
                    <Bot size={13} style={{ color: "var(--accent)" }} />
                    <span>Customizations</span>
                  </button>

                  <div style={{ height: "1px", background: "rgba(255,255,255,0.08)", margin: "4px 0" }} />

                  {/* Remote Control Dropdown Entry */}
                  <button
                    onClick={() => {
                      setShowRemoteModal(true);
                      wsClient.send("get_mobile_pairing", {});
                      setShowSettingsDropdown(false);
                    }}
                    className="dropdown-item"
                  >
                    <Smartphone size={13} style={{ color: "var(--accent)" }} />
                    <span>Remote Control</span>
                  </button>

                  {/* Create Desktop Shortcut Dropdown Entry */}
                  <button
                    onClick={handleCreateShortcut}
                    className="dropdown-item"
                    style={{ position: "relative" }}
                  >
                    <Laptop size={13} style={{ color: "var(--accent)" }} />
                    <span>Create Shortcut</span>
                    {shortcutStatus && (
                      <span style={{ fontSize: "8px", position: "absolute", right: "12px", color: shortcutStatus === "SUCCESS!" ? "var(--success)" : "var(--accent)" }}>
                        {shortcutStatus}
                      </span>
                    )}
                  </button>

                  <div style={{ height: "1px", background: "rgba(255,255,255,0.08)", margin: "4px 0" }} />

                  <div className="dropdown-submenu-trigger">
                    <Palette size={13} style={{ color: "var(--accent)" }} />
                    <span>Themes</span>
                    <ChevronRight size={10} style={{ marginLeft: "auto" }} />

                    <div className="dropdown-submenu">
                      {THEMES.map(t => (
                        <button
                          key={t.value}
                          onClick={() => {
                            setActiveTheme(t.value);
                            setCustomAccent(null);
                          }}
                          className="dropdown-item"
                          style={{ color: (activeTheme === t.value && !customAccent) ? "var(--accent)" : "var(--text-secondary)" }}
                        >
                          <span className="os-theme-swatch" style={{ background: t.swatch }} aria-hidden="true" />
                          <span>{t.label}</span>
                          {(activeTheme === t.value && !customAccent) && <Check size={13} style={{ marginLeft: "auto" }} />}
                        </button>
                      ))}

                      <div style={{ height: "1px", background: "rgba(255,255,255,0.08)", margin: "4px 0" }} />

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenColorPicker();
                        }}
                        className="dropdown-item"
                        style={{ color: customAccent ? "var(--accent)" : "var(--text-secondary)" }}
                      >
                        <span>Custom accent color</span>
                      </button>

                      {showColorPicker && (
                        <div
                          style={{
                            position: "absolute",
                            top: "0px",
                            right: "100%",
                            marginRight: "8px",
                            width: "200px",
                            background: "rgba(12, 12, 12, 0.98)",
                            border: "1px solid var(--border)",
                            borderRadius: "6px",
                            padding: "12px",
                            boxShadow: "0 12px 40px rgba(0, 0, 0, 0.7)",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: "10px",
                            zIndex: 1100,
                            fontFamily: "var(--font-mono)",
                            color: "var(--text-secondary)"
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: "9px", letterSpacing: "0.03em", color: "var(--text-muted)" }}>UI COLOUR</span>
                            <button
                              onClick={() => {
                                setCustomAccent(null);
                                setPendingColor("#1aff1a");
                              }}
                              style={{
                                background: "rgba(255,255,255,0.05)",
                                border: "1px solid var(--border)",
                                color: "var(--text-primary)",
                                fontSize: "8px",
                                padding: "2px 6px",
                                borderRadius: "3px",
                                cursor: "pointer",
                                fontWeight: "bold"
                              }}
                            >
                              DEFAULT
                            </button>
                          </div>

                          <div
                            ref={wheelRef}
                            onMouseDown={onMouseDown}
                            style={{
                              width: "110px",
                              height: "110px",
                              borderRadius: "50%",
                              background: "conic-gradient(from 0deg, red, yellow, lime, cyan, blue, magenta, red)",
                              position: "relative",
                              cursor: "pointer",
                              userSelect: "none"
                            }}
                          >
                            <div
                              style={{
                                position: "absolute",
                                top: "15px",
                                left: "15px",
                                width: "80px",
                                height: "80px",
                                borderRadius: "50%",
                                background: "rgba(12, 12, 12, 0.98)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center"
                              }}
                            >
                              <div
                                style={{
                                  width: "48px",
                                  height: "48px",
                                  borderRadius: "50%",
                                  background: pendingColor || customAccent || "#1aff1a",
                                  boxShadow: "inset 0 0 8px rgba(0,0,0,0.8)",
                                  border: "1px solid rgba(255,255,255,0.07)"
                                }}
                              />
                            </div>

                            {/* Compute coordinates based on HSL angle */}
                            {(() => {
                              const currentHueColor = pendingColor || customAccent || "#1aff1a";
                              const currentHue = hexToHue(currentHueColor);
                              const theta = (currentHue * Math.PI) / 180 - Math.PI / 2;
                              const radius = 45;
                              const cx = 55;
                              const cy = 55;
                              const handleX = cx + radius * Math.cos(theta);
                              const handleY = cy + radius * Math.sin(theta);
                              return (
                                <div
                                  style={{
                                    position: "absolute",
                                    left: `${handleX}px`,
                                    top: `${handleY}px`,
                                    width: "12px",
                                    height: "12px",
                                    borderRadius: "50%",
                                    border: "2px solid #fff",
                                    background: "transparent",
                                    transform: "translate(-50%, -50%)",
                                    boxShadow: "0 0 6px rgba(0,0,0,0.8)",
                                    pointerEvents: "none"
                                  }}
                                />
                              );
                            })()}
                          </div>

                          <div style={{ width: "100%", textAlign: "center" }}>
                            <span style={{ fontSize: "9px", color: "var(--text-muted)" }}>drag the handle</span>
                          </div>

                          <input
                            type="text"
                            readOnly
                            value={(pendingColor || customAccent || "#1AFF1A").toUpperCase()}
                            style={{
                              width: "100%",
                              background: "rgba(0,0,0,0.3)",
                              border: "1px solid var(--border)",
                              borderRadius: "4px",
                              color: "var(--text-primary)",
                              fontFamily: "var(--font-mono)",
                              fontSize: "11px",
                              textAlign: "center",
                              padding: "4px 0",
                              outline: "none"
                            }}
                          />

                          <div style={{ width: "100%", display: "flex", gap: "8px", marginTop: "4px" }}>
                            <button
                              onClick={handleDiscardColor}
                              style={{
                                flex: 1,
                                background: "rgba(255, 77, 77, 0.1)",
                                border: "1px solid rgba(255, 77, 77, 0.3)",
                                color: "#ff4d4d",
                                fontSize: "10px",
                                padding: "6px 0",
                                cursor: "pointer",
                                borderRadius: "4px",
                                fontWeight: "bold"
                              }}
                            >
                              DISCARD
                            </button>
                            <button
                              onClick={handleSaveColor}
                              style={{
                                flex: 1,
                                background: "var(--accent)",
                                border: "none",
                                color: "#000",
                                fontSize: "10px",
                                padding: "6px 0",
                                cursor: "pointer",
                                borderRadius: "4px",
                                fontWeight: "bold"
                              }}
                            >
                              SAVE
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Minimise to Sidebar Button */}
          <motion.button
            onClick={() => {
              setOverlayMode(true);
              setUserOverrodeMinimize(true);
            }}
            title="Minimise to sidebar overlay"
            aria-label="Minimise to sidebar overlay"
            className="os-icon-btn"
            whileTap={{ scale: 0.96 }}
            style={isMaximized ? { width: "auto", padding: "0 10px", gap: 7 } : undefined}
          >
            <Minimize2 size={16} />
            {isMaximized && <span>Minimise</span>}
          </motion.button>
        </div>
      </div>

      {/* ─── Main Content HUD ─── */}
      <div
        ref={containerRef}
        style={{ display: "flex", gap: "0px", overflow: "visible", flex: 1, position: "relative", minHeight: 0 }}
      >
          {/* LEFT PANEL */}
          <div data-panel="left" style={{ width: `${leftWidth}px`, maxWidth: "30vw", minWidth: "220px", flexShrink: 1, display: "flex", flexDirection: "column", gap: "12px" }}>
            <div className="hud-panel" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {/* <MatrixRainBackground voiceState={voiceState} /> */}
              <div style={{ position: "relative", zIndex: 1, flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                <div className="hud-panel-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Tasks</span>
                  <button
                    id="json-import-btn"
                    title="Import JSON Task Plan"
                    aria-label="Import JSON Task Plan"
                    onClick={onOpenJsonImport}
                    className="os-icon-btn"
                    style={{ width: 26, height: 26, minWidth: 26, minHeight: 26 }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  </button>
                </div>
                <div className="tasks-scroll-container" style={{ padding: "10px", overflowY: "auto", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                  <TaskList
                    messages={messages}
                    voiceState={voiceState}
                    hasActivePlan={!!currentPlan}
                    currentPlan={currentPlan}
                    selectedTaskId={selectedTaskId}
                    setSelectedTaskId={setSelectedTaskId}
                    taskRefsMap={taskRefsMap}
                    onScrollToMessage={(msgId) => {
                      const el = messageRefsMap.current[msgId];
                      if (el) {
                        el.scrollIntoView({ behavior: "smooth", block: "start" });
                        el.style.outline = "1px solid var(--accent)";
                        setTimeout(() => { el.style.outline = "none"; }, 1500);
                      }
                    }}
                  />
                </div>
              </div>
            </div>

            {/* AGENT STATUS & SYSTEMS */}
            <div className="hud-panel" style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {/* <MatrixRainBackground voiceState={voiceState} /> */}
              <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                <div className="hud-panel-title">Systems</div>
                <div style={{ display: "flex", flexDirection: "column", padding: "12px", gap: "8px", overflowY: "auto" }} className="custom-scrollbar">

                  {/* Top Part: System Monitor */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "11px" }}>
                    {/* <div style={{ textTransform: "uppercase", fontSize: "9px", color: "var(--text-muted)", letterSpacing: "0.05em", fontWeight: "bold" }}>[ SYS MONITOR ]</div> */}

                    {/* CPU */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>CPU:</span>
                        <span style={{ color: metricColor(systemMetrics.cpu), fontFamily: "var(--font-mono)" }}>
                          {systemMetrics.cpu}%{metricStatusLabel(systemMetrics.cpu) ? ` ${metricStatusLabel(systemMetrics.cpu)}` : ""}
                        </span>
                      </div>
                      <div style={{ height: "4px", background: "rgba(255,255,255,0.05)", borderRadius: "2px", overflow: "hidden" }}>
                        <div style={{ width: `${systemMetrics.cpu}%`, height: "100%", background: metricColor(systemMetrics.cpu), transition: "width 1s ease-out, background 1s ease-out" }} />
                      </div>
                    </div>

                    {/* MEM */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>RAM:</span>
                        <span style={{ color: metricColor(systemMetrics.mem), fontFamily: "var(--font-mono)" }}>
                          {systemMetrics.mem}%{metricStatusLabel(systemMetrics.mem) ? ` ${metricStatusLabel(systemMetrics.mem)}` : ""}
                        </span>
                      </div>
                      <div style={{ height: "4px", background: "rgba(255,255,255,0.05)", borderRadius: "2px", overflow: "hidden" }}>
                        <div style={{ width: `${systemMetrics.mem}%`, height: "100%", background: metricColor(systemMetrics.mem), transition: "width 1s ease-out, background 1s ease-out" }} />
                      </div>
                    </div>

                    {/* GPU */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>GPU:</span>
                        <span style={{ color: typeof systemMetrics.gpu === "number" ? metricColor(systemMetrics.gpu) : "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                          {typeof systemMetrics.gpu === "number" ? `${systemMetrics.gpu}%${metricStatusLabel(systemMetrics.gpu) ? ` ${metricStatusLabel(systemMetrics.gpu)}` : ""}` : systemMetrics.gpu}
                        </span>
                      </div>
                      {typeof systemMetrics.gpu === "number" && (
                        <div style={{ height: "4px", background: "rgba(255,255,255,0.05)", borderRadius: "2px", overflow: "hidden" }}>
                          <div style={{ width: `${systemMetrics.gpu}%`, height: "100%", background: metricColor(systemMetrics.gpu), transition: "width 1s ease-out, background 1s ease-out" }} />
                        </div>
                      )}
                    </div>

                    {/* TEMP */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>CORE TEMP:</span>
                        <span style={{ color: typeof systemMetrics.temp === "number" ? metricColor((systemMetrics.temp / 95) * 100) : "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                          {typeof systemMetrics.temp === "number" ? `${systemMetrics.temp}°C${metricStatusLabel((systemMetrics.temp / 95) * 100) ? ` ${metricStatusLabel((systemMetrics.temp / 95) * 100)}` : ""}` : systemMetrics.temp}
                        </span>
                      </div>
                      {typeof systemMetrics.temp === "number" && (
                        <div style={{ height: "4px", background: "rgba(255,255,255,0.05)", borderRadius: "2px", overflow: "hidden" }}>
                          <div style={{ width: `${Math.min(100, (systemMetrics.temp / 95) * 100)}%`, height: "100%", background: metricColor((systemMetrics.temp / 95) * 100), transition: "width 1s ease-out, background 1s ease-out" }} />
                        </div>
                      )}
                    </div>

                    {/* NET Speed */}
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: "2px" }}>
                      <span>NET SPEED:</span>
                      <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                        {systemMetrics.net_kbps >= 1024
                          ? `${(systemMetrics.net_kbps / 1024).toFixed(1)} MB/s`
                          : `${systemMetrics.net_kbps.toFixed(0)} KB/s`}
                      </span>
                    </div>
                  </div>

                  {/* Divider */}
                  <div style={{ borderTop: "1px dashed rgba(255,255,255,0.08)", margin: "4px 0" }} />

                  {/* Bottom Part: Agent Metadata */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px", fontSize: "11px" }}>
                    {/* <div style={{ textTransform: "uppercase", fontSize: "9px", color: "var(--text-muted)", letterSpacing: "0.05em", fontWeight: "bold" }}>[ AGENT MATRIX ]</div> */}

                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>PROVIDER:</span>
                      <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>
                        {(activeProvider === "custom_openai" && customOpenaiProviderName?.trim()) ? customOpenaiProviderName.trim() : activeProvider}
                      </span>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>LLM:</span>
                      <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", textTransform: "uppercase", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", maxWidth: "160px", textAlign: "right" }} title={modelKey}>
                        {modelKey}
                      </span>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>TOKENS (SESSION):</span>
                      <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>{tokenUsage.sessionTotalTokens}</span>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>TOKENS (TOTAL):</span>
                      <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>{globalSessionCount}</span>
                    </div>
                  </div>

                </div>
              </div>
            </div>
          </div>

          {/* LEFT PANEL DRAG HANDLE */}
          <div
            onMouseDown={startResizeLeft}
            style={{
              width: "12px",
              cursor: "col-resize",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10,
              position: "relative",
              flexShrink: 0,
            }}
            className="panel-splitter"
          >
            <div
              style={{
                width: "2px",
                height: "36px",
                background: "var(--border)",
                borderRadius: "1px",
                transition: "all 0.2s",
              }}
              className="splitter-bar"
            />
          </div>

          {/* CENTER PANEL */}
          <div className="hud-panel" style={{ flex: "1 1 0%", minWidth: "360px", display: "flex", flexDirection: "column" }}>
            <div className="os-tabbar">
              <div
                className="os-tabstrip"
                onWheel={(e) => {
                  e.currentTarget.scrollLeft += e.deltaY;
                }}
              >
                {tabs.map((tab) => {
                  const isActive = tab.id === activeThreadId;
                  const isRunning = !!tab.currentPlan;
                  return (
                    <div
                      key={tab.id}
                      onClick={() => setActiveThreadId(tab.id)}
                      className={`os-tab ${isActive ? "is-active" : ""}`}
                    >
                      {isRunning && <span className="os-tab-running" aria-label="Running" />}
                      <span className="os-tab-label">
                        {tab.title.replace(/^\/\/\s*/, "")}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTab(tab.id);
                        }}
                        aria-label={`Close tab: ${tab.title}`}
                        className="os-tab-close"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}
                <button
                  onClick={handleNewThread}
                  title="New thread"
                  aria-label="New thread"
                  className="os-icon-btn"
                  style={{ width: 26, height: 26, marginLeft: 2 }}
                >
                  <Plus size={15} />
                </button>
              </div>

              <div className="os-tabbar-end">
                {isTaskRunning && (
                  <span className="os-live-badge">
                    <span className="os-live-dot" aria-hidden="true" />
                    Live
                  </span>
                )}
                <button
                  onClick={onOpenContext}
                  title="Agent context"
                  aria-label="Open agent context"
                  className="os-icon-btn"
                >
                  <Cpu size={16} />
                </button>
              </div>
            </div>
            <div className="os-ambient" aria-hidden="true" />

            <div
              className="chat-scroll-container"
              style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 16px 40px", zIndex: 1, position: "relative" }}
              ref={chatScrollRef}
            >
              {messages.length === 0 && (
                <div className="os-empty-state">
                  <div className="os-empty-orb" aria-hidden="true">
                    <div className="os-empty-orb-ring" />
                    <div className="os-empty-orb-core">
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 3.2 4.4 12l7.6 8.8L19.6 12 12 3.2Z" />
                        <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
                      </svg>
                    </div>
                  </div>

                  <div className="os-empty-copy">
                    <h2 className="os-empty-title">How can I help?</h2>
                    <p key={statusIdx} className="os-empty-hint os-fade-in">
                      {isConnected
                        ? STATUS_LINES[statusIdx]
                        : "Connecting to the local runtime…"}
                    </p>
                  </div>

                  <div className="os-empty-shortcuts">
                    <span className="os-kbd">⌘</span>
                    <span className="os-kbd">K</span>
                    <span className="os-empty-shortcut-label">Speak or type to begin</span>
                  </div>
                </div>
              )}
              <MessageList
                messages={messages}
                messageRefsMap={messageRefsMap}
                onSelectMessage={(msgId) => {
                  const idx = messages.findIndex(m => m.id === msgId);
                  if (idx === -1) return;

                  let userMsgId = "";
                  if (messages[idx].role === "user") {
                    userMsgId = messages[idx].id;
                  } else {
                    for (let j = idx; j >= 0; j--) {
                      if (messages[j].role === "user") {
                        userMsgId = messages[j].id;
                        break;
                      }
                    }
                  }

                  if (userMsgId) {
                    setSelectedTaskId(userMsgId);
                    const taskEl = taskRefsMap.current[userMsgId];
                    if (taskEl) {
                      taskEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
                      taskEl.style.outline = "1px solid var(--accent)";
                      setTimeout(() => {
                        if (taskEl) taskEl.style.outline = "none";
                      }, 1500);
                    }
                  }
                }}
              />

              {/* Bouncing dots typing indicator — shown while AI is thinking/processing before first response */}
              {((voiceState === "processing" || isTaskRunning) && voiceState !== "listening" && voiceState !== "speaking" && !streamingResponse) && (
                <div style={{
                  display: "flex",
                  gap: "10px",
                  alignItems: "flex-start",
                  marginBottom: "8px",
                  padding: "0 4px",
                }}>
                  {/* Bot Avatar */}
                  <div
                    style={{
                      width: "28px",
                      height: "28px",
                      borderRadius: "var(--radius-full)",
                      background: "var(--accent-glow)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      border: "1px solid var(--border-accent)",
                      boxShadow: "0 0 8px var(--accent-glow)",
                      color: "var(--accent)",
                    }}
                  >
                    <Bot size={14} />
                  </div>
                  {/* Bubble wrapper with Speech Arrow */}
                  <div style={{ position: "relative", display: "flex", flexDirection: "column" }}>
                    <div
                      style={{
                        position: "absolute",
                        top: "12px",
                        left: "-4px",
                        width: "8px",
                        height: "8px",
                        background: "var(--bg-secondary)",
                        borderLeft: "1px solid var(--border-accent)",
                        borderBottom: "1px solid var(--border-accent)",
                        transform: "rotate(45deg)",
                        zIndex: 2,
                        pointerEvents: "none",
                      }}
                    />
                    {/* Bubble */}
                    <div
                      style={{
                        padding: "12px 18px",
                        borderRadius: "var(--radius-sm) var(--radius-lg) var(--radius-lg) var(--radius-lg)",
                        background: "var(--bg-secondary)",
                        border: "1px solid var(--border-accent)",
                        boxShadow: "inset 0 1px 0 var(--glass-sheen), 0 4px 20px rgba(0, 0, 0, 0.2)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 1,
                        minWidth: "60px",
                      }}
                    >
                      <span className="os-awaiting-dots" title="Agent is working..." />
                    </div>
                  </div>
                </div>
              )}

              {/* Live streaming bubble — shown while AI is generating a response.
                  When stream_end fires, ResponseBubble takes over seamlessly
                  (without re-running its own typewriter animation). */}
              <AnimatePresence>
                {streamingResponse && (
                  <motion.div
                    key="streaming-bubble"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, transition: { duration: 0.1 } }}
                    transition={{ duration: 0.2 }}
                    style={{
                      display: "flex",
                      justifyContent: "flex-start",
                      marginBottom: "8px",
                      padding: "0 4px",
                    }}
                  >
                    <div style={{
                      maxWidth: "85%",
                      background:
                        "linear-gradient(180deg, var(--glass-tint-soft) 0%, transparent 55%), var(--bg-secondary)",
                      border: "1px solid var(--glass-stroke)",
                      borderRadius: "var(--radius-sm) var(--radius-lg) var(--radius-lg) var(--radius-lg)",
                      padding: "11px 14px",
                      fontSize: "13.5px",
                      color: "var(--text-primary)",
                      lineHeight: "1.6",
                      position: "relative",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      boxShadow: "inset 0 1px 0 var(--glass-sheen), 0 6px 20px rgba(0,0,0,0.18)",
                    }}>
                      <div style={{
                        position: "absolute",
                        top: "8px",
                        right: "10px",
                        width: "6px",
                        height: "6px",
                        borderRadius: "50%",
                        background: "var(--accent)",
                        boxShadow: "0 0 6px var(--accent)",
                        animation: "pulse 1s ease-in-out infinite",
                      }} />
                      <div className="selectable" style={{ fontSize: "13.5px", lineHeight: "1.6", color: "var(--text-primary)" }}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {streamingResponse}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div ref={bottomRef} />
            </div>

            {/* INPUT BAR */}
            <div style={{
              padding: "10px 14px 14px",
              borderTop: "1px solid var(--line-soft)",
              display: "flex", flexDirection: "column", gap: "8px",
              zIndex: 1,
              position: "relative", overflow: "visible",
            }}>
              {/* Floating waveform — appears above input bar when active */}
              <AnimatePresence>
                {(voiceState === "listening" || voiceState === "speaking") && (
                  <motion.div
                    key="floating-waveform"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ duration: 0.3 }}
                    style={{
                      position: "absolute",
                      bottom: "calc(100% + 4px)",
                      left: "16px",
                      right: "16px",
                      height: "96px",
                      pointerEvents: "none",
                      zIndex: 5,
                    }}
                  >
                    <Waveform voiceState={voiceState} />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Attached files chips */}
              {attachedFiles.length > 0 && (
                <div style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "8px",
                  marginBottom: "12px",
                  position: "relative",
                  zIndex: 2
                }}>
                  {attachedFiles.map((file, index) => (
                    <div
                      key={index}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        background: "rgba(255, 255, 255, 0.05)",
                        border: "1px solid var(--border)",
                        borderRadius: "14px",
                        padding: "4px 10px",
                        fontSize: "11px",
                        color: "var(--text-primary)",
                      }}
                    >
                      <span style={{
                        maxWidth: "120px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                      }}>
                        {file.name}
                      </span>
                      <button
                        onClick={() => setAttachedFiles(prev => prev.filter((_, idx) => idx !== index))}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--text-muted)",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: "2px",
                        }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="os-composer" style={{ alignItems: "center", gap: "8px", padding: "6px 6px 6px 10px" }}>
                <VoiceButton voiceState={voiceState} onClick={handleVoiceClick} disabled={!isConnected} />
                <input
                  id="sarthi-text-input"
                  aria-label="Agent command prompt"
                  value={isBusy ? "" : textInput}
                  onChange={(e) => !isBusy && setTextInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={!isConnected ? "Connecting…" : isBusy ? "Agent is working…" : "Ask OpenSarthi anything…"}
                  disabled={!isConnected || isBusy}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    color: isBusy ? "var(--text-muted)" : "var(--text-primary)",
                    fontSize: "var(--text-md)",
                    fontFamily: "var(--font-sans)",
                    letterSpacing: "-0.005em",
                    padding: "9px 4px",
                    cursor: isBusy ? "default" : "text",
                  }}
                />
                {isBusy ? (
                  // STOP button — shown when agent is active/busy (running task, planning, or speaking)
                  <motion.button
                    id="sarthi-stop-btn"
                    onClick={handleStopTask}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.94 }}
                    title="Stop task"
                    aria-label="Stop task"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "36px",
                      height: "36px",
                      borderRadius: "50%",
                      background: "rgba(255, 69, 58, 0.16)",
                      color: "var(--danger)",
                      border: "1px solid rgba(255, 69, 58, 0.4)",
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    <Square size={14} fill="#ff4444" />
                  </motion.button>
                ) : (
                  <>
                    {/* Hidden file input */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      style={{ display: "none" }}
                      accept="text/*,.md,.json,.py,.js,.ts,.tsx,.jsx,.csv,.txt,.log"
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        if (files.length === 0) return;
                        setAttachedFiles((prev) => {
                          const combined = [...prev, ...files];
                          if (combined.length > 5) {
                            alert("You can attach at most 5 files.");
                          }
                          return combined.slice(0, 5);
                        });
                        e.target.value = "";
                      }}
                    />
                    {/* File upload button */}
                    <motion.button
                      id="sarthi-attach-btn"
                      onClick={() => fileInputRef.current?.click()}
                      title="Attach file"
                      aria-label="Attach file"
                      whileHover={{ scale: 1.06 }}
                      whileTap={{ scale: 0.94 }}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        width: "34px", height: "34px", borderRadius: "50%",
                        background: "transparent",
                        color: "var(--text-muted)",
                        border: "1px solid transparent",
                        cursor: "pointer",
                        flexShrink: 0,
                        transition: "color 0.2s, background 0.2s",
                      }}
                    >
                      <Paperclip size={16} />
                    </motion.button>
                    {/* SEND button */}
                    <motion.button
                      id="sarthi-send-btn"
                      onClick={handleTextSend}
                      disabled={(!textInput.trim() && attachedFiles.length === 0) || !isConnected}
                      whileHover={(textInput.trim() || attachedFiles.length > 0) && isConnected ? { scale: 1.05 } : {}}
                      whileTap={(textInput.trim() || attachedFiles.length > 0) && isConnected ? { scale: 0.95 } : {}}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "36px",
                        height: "36px",
                        borderRadius: "50%",
                        background: (textInput.trim() || attachedFiles.length > 0) && isConnected ? "var(--accent)" : "var(--surface-hover)",
                        color: (textInput.trim() || attachedFiles.length > 0) && isConnected ? "#06140a" : "var(--text-muted)",
                        border: "1px solid transparent",
                        boxShadow: (textInput.trim() || attachedFiles.length > 0) && isConnected ? "0 6px 16px var(--accent-glow)" : "none",
                        transition: "background 0.2s, color 0.2s, box-shadow 0.2s",
                        cursor: ((!textInput.trim() && attachedFiles.length === 0) || !isConnected) ? "not-allowed" : "pointer",
                        position: "relative",
                        overflow: "hidden",
                        flexShrink: 0,
                      }}
                    >
                      <Send size={16} style={{ transform: "rotate(-12deg)" }} />
                    </motion.button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT PANEL DRAG HANDLE */}
          <div
            onMouseDown={startResizeRight}
            style={{
              width: "12px",
              cursor: "col-resize",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10,
              position: "relative",
              flexShrink: 0,
            }}
            className="panel-splitter"
          >
            <div
              style={{
                width: "2px",
                height: "36px",
                background: "var(--border)",
                borderRadius: "1px",
                transition: "all 0.2s",
              }}
              className="splitter-bar"
            />
          </div>

          {/* RIGHT PANEL */}
          <div data-panel="right" style={{ width: `${rightWidth}px`, maxWidth: "28vw", minWidth: "200px", flexShrink: 1, display: "flex", flexDirection: "column", gap: "12px", position: "relative" }}>

            {/* ACTIVITY LOG */}
            <div className="hud-panel" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {/* <MatrixRainBackground voiceState={voiceState} /> */}
              <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
                <div className="hud-panel-title">Activity</div>
                <ActivityLogPanel logs={activityLogs} />
              </div>
            </div>

            {/* ACTIVE TASK PLAN */}
            <div className="hud-panel" style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {/* <MatrixRainBackground voiceState={voiceState} /> */}
              <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                  <div className="hud-panel-title">Plan</div>
                  {contentPanel.contentType && (
                    <button
                      onClick={() => setShowContentDrawer(!showContentDrawer)}
                      title={showContentDrawer ? "Close Results" : "View Results"}
                      style={{
                        background: showContentDrawer ? "var(--accent)" : "transparent",
                        border: "1px solid var(--border)",
                        borderRadius: "4px",
                        color: showContentDrawer ? "#000" : "var(--text-secondary)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "4px 8px",
                        cursor: "pointer",
                        marginRight: "12px",
                        marginTop: "4px",
                        boxShadow: showContentDrawer ? "0 0 6px var(--accent)" : "none",
                        transition: "all 0.2s ease",
                      }}
                      onMouseOver={e => {
                        if (!showContentDrawer) {
                          e.currentTarget.style.color = "var(--accent)";
                          e.currentTarget.style.borderColor = "var(--accent)";
                        }
                      }}
                      onMouseOut={e => {
                        if (!showContentDrawer) {
                          e.currentTarget.style.color = "var(--text-secondary)";
                          e.currentTarget.style.borderColor = "var(--border)";
                        }
                      }}
                    >
                      <Eye size={13} />
                    </button>
                  )}
                </div>
                <div className="activity-scroll-container" style={{ padding: "12px", overflowY: "auto", flex: 1, minHeight: 0 }}>
                  <ActionLog plan={currentPlan} selectedTaskId={selectedTaskId} messages={messages} />
                </div>
              </div>
            </div>


            <div className="hud-panel os-status-card">
              <div className="os-status-head">
                <span className={`os-status-dot ${isConnected ? "is-online" : "is-offline"}`} aria-hidden="true" />
                <span className="os-status-state">{isConnected ? "Connected" : "Offline"}</span>
                <span className="os-status-build">{getBuildTarget()} · v{pkg.version}</span>
              </div>
              <div className="os-status-foot">
                <span className="os-status-clock">{getFormattedTime()}</span>
                <span className="os-status-meta">
                  {getFormattedDate()}
                  {isConnected ? ` · up ${getUptimeString()}` : ""}
                </span>
              </div>
            </div>

            {/* Content View Side Panel Overlay */}
            <AnimatePresence>
              {showContentDrawer && contentPanel.contentType && (
                <motion.div
                  initial={{ x: "100%", opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: "100%", opacity: 0 }}
                  transition={{ type: "spring", damping: 26, stiffness: 280 }}
                  className="hud-panel"
                  style={{
                    position: "absolute",
                    top: "250px",
                    bottom: 0,
                    right: 0,
                    width: "min(380px, 100%)",
                    background:
                      "linear-gradient(180deg, var(--glass-tint) 0%, var(--glass-tint-soft) 50%, transparent 100%), var(--bg-secondary)",
                    border: "1px solid var(--glass-stroke-strong)",
                    boxShadow: "inset 0 1px 0 var(--glass-sheen), var(--elev-3)",
                    zIndex: 150,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                  }}
                >
                  {/* <MatrixRainBackground voiceState={voiceState} /> */}
                  <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
                    {/* Header */}
                    <div className="os-panel-head" style={{ justifyContent: "space-between" }}>
                      <span className="os-panel-head-title">Results</span>
                      <button
                        onClick={() => setShowContentDrawer(false)}
                        className="os-icon-btn"
                        aria-label="Close results"
                        style={{ width: 28, height: 28 }}
                      >
                        <X size={16} />
                      </button>
                    </div>
                    {/* Content */}
                    <div style={{ flex: 1, padding: "12px", overflowY: "auto", minHeight: 0 }} className="custom-scrollbar">
                      <ContentPanelView contentType={contentPanel.contentType} data={contentPanel.contentData} />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
      </div>
      {/* Collapsible Absolute Bottom Console Overlay (Full Width of App) */}
      {onboardingCompleted && (
        <RuntimeConsole
          isOpen={showLogsPanel}
          onClose={() => setShowLogsPanel(false)}
          height={consoleHeight}
          onResizeStart={startResizeConsole}
        />
      )}

      {/* ── REMOTE PAIRING MODAL ── */}
      <AnimatePresence>
        {showRemoteModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{
              position: "fixed",
              top: 0, left: 0, right: 0, bottom: 0,
              background: "rgba(0, 0, 0, 0.05)",
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "flex-start",
              padding: "54px 12px 12px 12px",
              zIndex: 2000,
            }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowRemoteModal(false); }}
          >
            <motion.div
              className="hud-panel"
              initial={{ x: 250, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 250, opacity: 0 }}
              transition={{ type: "spring", damping: 26, stiffness: 280 }}
              style={{
                width: "360px",
                maxHeight: "calc(100vh - 66px)",
                overflowY: "auto",
                background: "rgba(10, 10, 10, 0.98)",
                border: "1px solid var(--border)",
                boxShadow: "0 15px 50px rgba(0, 0, 0, 0.8), inset 0 0 1px 1px rgba(255,255,255,0.03)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "16px",
                fontFamily: "var(--font-mono)",
                color: "var(--text-secondary)",
              }}
            >
              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 20px 14px", borderBottom: "1px solid var(--border)", width: "100%" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Smartphone size={14} color="var(--accent)" />
                  <span style={{ fontSize: "13px", fontWeight: "bold", letterSpacing: "0.1em", color: "var(--accent)" }}>REMOTE ACCESS</span>
                </div>
                <button
                  onClick={() => setShowRemoteModal(false)}
                  style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 4, display: "flex", alignItems: "center" }}
                  onMouseOver={e => e.currentTarget.style.color = "var(--accent)"}
                  onMouseOut={e => e.currentTarget.style.color = "var(--text-secondary)"}
                >
                  <X size={14} />
                </button>
              </div>

              <div style={{ padding: "0 20px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", width: "100%" }}>
                {/* QR Code */}
                {mobilePairing ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
                    <div style={{ background: "white", padding: "10px", borderRadius: "6px", display: "flex", justifyContent: "center", alignItems: "center", boxShadow: "0 0 15px rgba(255,255,255,0.1)" }}>
                      <img src={`data:image/png;base64,${mobilePairing.qr}`} alt="QR" style={{ width: "160px", height: "160px", display: "block" }} />
                    </div>
                    <span style={{ fontSize: "10px", color: "var(--text-muted)", textAlign: "center" }}>
                      Scan with phone camera to connect instantly
                    </span>
                  </div>
                ) : (
                  <div style={{ height: "180px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", color: "var(--text-muted)" }}>
                    GENERATING KEY...
                  </div>
                )}

                {/* PIN + URL */}
                {mobilePairing && (
                  <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                    <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>Or enter manually:</span>
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>
                      {mobilePairing.url.split("/auto-login")[0]}
                    </div>
                    <div style={{
                      fontSize: "24px",
                      fontWeight: "bold",
                      letterSpacing: "0.15em",
                      color: "var(--accent)",
                      background: "rgba(0,0,0,0.4)",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      padding: "8px 24px",
                      textAlign: "center",
                      width: "100%",
                      textShadow: "0 0 10px var(--accent-glow)"
                    }}>
                      {mobilePairing.key}
                    </div>
                  </div>
                )}

                {/* Connection Status */}
                <div style={{ width: "100%", background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.08)", borderRadius: "4px", padding: "10px", display: "flex", flexDirection: "column", gap: "6px", fontSize: "11px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>STATUS:</span>
                    <span style={{ fontWeight: "bold", color: systemMetrics.mobile_status?.connected ? "var(--success)" : "var(--text-muted)" }}>
                      {systemMetrics.mobile_status?.connected ? "CONNECTED" : "NOT CONNECTED"}
                    </span>
                  </div>
                  {systemMetrics.mobile_status?.connected && systemMetrics.mobile_status.devices && systemMetrics.mobile_status.devices.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px", borderTop: "1px dashed rgba(255,255,255,0.06)", paddingTop: "6px", marginTop: "2px" }}>
                      <span style={{ fontSize: "9px", color: "var(--text-muted)" }}>CONNECTED DEVICES:</span>
                      {systemMetrics.mobile_status.devices.map((device, idx) => (
                        <div key={idx} style={{ color: "var(--text-primary)", fontSize: "10px" }}>• {device}</div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div style={{ width: "100%", display: "flex", gap: "10px" }}>
                  <button
                    onClick={() => wsClient.send("get_mobile_pairing", {})}
                    style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: "11px", padding: "8px 0", cursor: "pointer", borderRadius: "4px", fontWeight: "bold", transition: "all 0.15s", fontFamily: "var(--font-mono)" }}
                    onMouseOver={e => e.currentTarget.style.background = "rgba(255,255,255,0.1)"}
                    onMouseOut={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                  >
                    NEW KEY
                  </button>
                  <button
                    onClick={() => setShowRemoteModal(false)}
                    style={{ flex: 1, background: "var(--accent)", border: "none", color: "#000", fontSize: "11px", padding: "8px 0", cursor: "pointer", borderRadius: "4px", fontWeight: "bold", transition: "all 0.15s", fontFamily: "var(--font-mono)" }}
                    onMouseOver={e => e.currentTarget.style.boxShadow = "0 0 10px var(--accent-glow)"}
                    onMouseOut={e => e.currentTarget.style.boxShadow = "none"}
                  >
                    DISMISS
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>


    </div>
  );
}
