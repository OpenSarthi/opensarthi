import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff, Volume2 } from "lucide-react";
import type { VoiceState } from "../../lib/schemas";

interface VoiceButtonProps {
  voiceState: VoiceState;
  onClick: () => void;
  disabled?: boolean;
}

export function VoiceButton({ voiceState, onClick, disabled }: VoiceButtonProps) {
  const isListening  = voiceState === "listening";
  const isProcessing = voiceState === "processing";
  const isSpeaking   = voiceState === "speaking";
  const isError      = voiceState === "error";

  const accentColor =
    isError      ? "var(--danger)"
    : isSpeaking ? "var(--success)"
    : isListening ? "var(--accent)"
    : "var(--bg-tertiary)";

  const icon =
    isError      ? <MicOff size={18} />
    : isSpeaking ? <Volume2 size={18} />
    : isProcessing
      ? (
        // Spinning rings loader instead of Loader2
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <motion.circle
            cx="11" cy="11" r="8"
            stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"
            strokeDasharray="30 20"
            animate={{ rotate: 360 }}
            transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
            style={{ transformOrigin: "11px 11px" }}
          />
          <motion.circle
            cx="11" cy="11" r="4"
            stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round"
            strokeDasharray="14 10"
            animate={{ rotate: -360 }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
            style={{ transformOrigin: "11px 11px", opacity: 0.6 }}
          />
        </svg>
      )
    : <Mic size={18} />;

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      {/* Outer pulse rings — only when listening or speaking */}
      {(isListening || isSpeaking) && (
        <>
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                border: `1.5px solid ${accentColor}`,
                pointerEvents: "none",
              }}
              animate={{ scale: [1, 1.9 + i * 0.3], opacity: [0.6, 0] }}
              transition={{
                duration: 1.6,
                delay: i * 0.45,
                repeat: Infinity,
                ease: "easeOut",
              }}
            />
          ))}
        </>
      )}

      <motion.button
        onClick={onClick}
        disabled={disabled || isProcessing}
        aria-label={
          isListening  ? "Stop listening"
          : isSpeaking ? "Stop speaking"
          : isError    ? "Retry"
          : "Start listening"
        }
        whileHover={!disabled && !isProcessing ? { scale: 1.05 } : {}}
        whileTap={!disabled && !isProcessing  ? { scale: 0.94 } : {}}
        style={{
          width: "44px",
          height: "44px",
          borderRadius: "50%",
          background: accentColor,
          color: isError ? "#ffffff" : isListening || isSpeaking ? "#06140a" : "var(--text-primary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: `1px solid ${isListening || isSpeaking || isError ? accentColor : "var(--line-strong)"}`,
          flexShrink: 0,
          cursor: disabled || isProcessing ? "not-allowed" : "pointer",
          opacity: disabled ? 0.45 : 1,
          transition: "background 0.25s, border-color 0.25s, color 0.25s, box-shadow 0.25s",
          position: "relative",
          boxShadow: isListening || isSpeaking
            ? "0 8px 24px var(--accent-glow)"
            : "0 4px 14px rgba(0, 0, 0, 0.22)",
        }}
      >
        <AnimatePresence mode="wait">
          <motion.span
            key={voiceState}
            initial={{ scale: 0.7, opacity: 0, rotate: -15 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.7, opacity: 0, rotate: 15 }}
            transition={{ duration: 0.18 }}
            style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            {icon}
          </motion.span>
        </AnimatePresence>
      </motion.button>
    </div>
  );
}
