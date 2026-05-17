import { motion, AnimatePresence } from "framer-motion";

interface TranscriptViewProps {
  transcript: string | null;
}

export function TranscriptView({ transcript }: TranscriptViewProps) {
  return (
    <AnimatePresence>
      {transcript && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
          style={{
            padding: "10px 14px",
            background: "var(--bg-tertiary)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border)",
            fontSize: "13px",
            color: "var(--text-secondary)",
            fontStyle: "italic",
            lineHeight: 1.5,
            overflow: "hidden",
          }}
          aria-live="polite"
          aria-label="Speech transcript"
        >
          <span style={{ color: "var(--accent)", marginRight: "6px", fontStyle: "normal" }}>
            🎙
          </span>
          {transcript}
          <span
            style={{
              display: "inline-block",
              width: "2px",
              height: "13px",
              background: "var(--accent)",
              marginLeft: "3px",
              verticalAlign: "middle",
              animation: "pulse-ring 1s ease-in-out infinite",
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
