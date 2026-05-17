import { motion } from "framer-motion";
import { Mic, MicOff, Loader2 } from "lucide-react";
import type { VoiceState } from "../../lib/schemas";

interface VoiceButtonProps {
  voiceState: VoiceState;
  onClick: () => void;
  disabled?: boolean;
}

const STATE_CONFIG: Record<
  VoiceState,
  { icon: React.ReactNode; label: string; color: string; pulse: boolean }
> = {
  idle: {
    icon: <Mic size={22} />,
    label: "Start listening",
    color: "var(--bg-tertiary)",
    pulse: false,
  },
  listening: {
    icon: <Mic size={22} />,
    label: "Listening…",
    color: "var(--accent)",
    pulse: true,
  },
  processing: {
    icon: <Loader2 size={22} className="animate-spin" />,
    label: "Processing…",
    color: "var(--accent-dim)",
    pulse: false,
  },
  speaking: {
    icon: <Mic size={22} />,
    label: "Speaking…",
    color: "var(--success)",
    pulse: true,
  },
  error: {
    icon: <MicOff size={22} />,
    label: "Error — tap to retry",
    color: "var(--danger)",
    pulse: false,
  },
};

export function VoiceButton({ voiceState, onClick, disabled }: VoiceButtonProps) {
  const cfg = STATE_CONFIG[voiceState];

  return (
    <motion.button
      onClick={onClick}
      disabled={disabled || voiceState === "processing"}
      aria-label={cfg.label}
      title={cfg.label}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.94 }}
      animate={
        cfg.pulse
          ? {
              boxShadow: [
                "0 0 0px hsla(252,80%,65%,0)",
                "0 0 20px hsla(252,80%,65%,0.55)",
                "0 0 0px hsla(252,80%,65%,0)",
              ],
            }
          : { boxShadow: "none" }
      }
      transition={cfg.pulse ? { duration: 1.6, repeat: Infinity } : {}}
      style={{
        width: "56px",
        height: "56px",
        borderRadius: "var(--radius-full)",
        background: cfg.color,
        color: "var(--text-primary)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1px solid var(--border)",
        flexShrink: 0,
        transition: "background var(--transition-fast)",
      }}
    >
      {cfg.icon}
    </motion.button>
  );
}
