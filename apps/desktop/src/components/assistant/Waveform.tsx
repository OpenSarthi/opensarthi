import { motion } from "framer-motion";
import type { VoiceState } from "../../lib/schemas";

interface WaveformProps {
  voiceState: VoiceState;
  level?: number; // 0.0–1.0
}

const BAR_COUNT = 12;

export function Waveform({ voiceState, level = 0 }: WaveformProps) {
  const isActive = voiceState === "listening" || voiceState === "speaking";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "3px",
        height: "32px",
        padding: "0 4px",
      }}
      aria-label={`Voice waveform — ${voiceState}`}
    >
      {Array.from({ length: BAR_COUNT }).map((_, i) => {
        const delay = (i / BAR_COUNT) * 0.6;
        const baseHeight = isActive
          ? Math.max(0.15, (level + Math.sin(i * 1.3) * 0.3 + 0.3))
          : 0.12;

        return (
          <motion.div
            key={i}
            animate={
              isActive
                ? {
                    scaleY: [baseHeight, Math.min(1, baseHeight + 0.5), baseHeight],
                  }
                : { scaleY: 0.12 }
            }
            transition={
              isActive
                ? {
                    duration: 0.6,
                    delay,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }
                : { duration: 0.3 }
            }
            style={{
              width: "3px",
              height: "100%",
              borderRadius: "2px",
              background:
                voiceState === "error"
                  ? "var(--danger)"
                  : voiceState === "speaking"
                  ? "var(--success)"
                  : "var(--accent)",
              transformOrigin: "center",
              opacity: isActive ? 1 : 0.3,
            }}
          />
        );
      })}
    </div>
  );
}
