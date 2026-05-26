import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { VoiceState } from "../../lib/schemas";

interface WaveformProps {
  voiceState: VoiceState;
  /** Override level from 0–1 (ignored when using live mic) */
  level?: number;
}

const BAR_COUNT = 20;

export function Waveform({ voiceState }: WaveformProps) {
  const isListening = voiceState === "listening";
  const isSpeaking = voiceState === "speaking";
  const isActive = isListening || isSpeaking;

  // Live microphone amplitude analysis
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const [bars, setBars] = useState<number[]>(Array(BAR_COUNT).fill(0.12));

  useEffect(() => {
    if (!isListening) {
      // Tear down mic stream when not listening
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      analyserRef.current = null;
      if (isSpeaking) {
        // Gentle animated idle for speaking state
        setBars(
          Array.from({ length: BAR_COUNT }, (_, i) =>
            0.15 + Math.abs(Math.sin(i * 0.7)) * 0.35
          )
        );
      } else {
        setBars(Array(BAR_COUNT).fill(0.12));
      }
      return;
    }

    // Set up mic → analyser
    let mounted = true;
    navigator.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then((stream) => {
        if (!mounted) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.78;
        src.connect(analyser);
        analyserRef.current = analyser;

        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (!mounted) return;
          analyser.getByteFrequencyData(data);
          // Map frequency bins → bar heights (0–1)
          const step = Math.floor(data.length / BAR_COUNT);
          const newBars = Array.from({ length: BAR_COUNT }, (_, i) => {
            const bin = data[Math.min(i * step, data.length - 1)] / 255;
            // Taper: make center bars slightly taller for a natural shape
            const taper = 1 - Math.abs((i / (BAR_COUNT - 1)) - 0.5) * 0.4;
            return Math.max(0.06, bin * taper);
          });
          setBars(newBars);
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      })
      .catch(() => {
        // Mic not available — fall back to animated bars
        if (!mounted) return;
        let t = 0;
        const tick = () => {
          t += 0.08;
          setBars(
            Array.from({ length: BAR_COUNT }, (_, i) =>
              Math.max(0.1, 0.45 + Math.sin(t + i * 0.6) * 0.4)
            )
          );
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      });

    return () => {
      mounted = false;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      analyserRef.current = null;
    };
  }, [isListening, isSpeaking]);

  // For speaking state: gentle pulsing animation
  const speakBars = isSpeaking && !isListening;

  const barColor =
    voiceState === "error"   ? "var(--danger)"
    : voiceState === "speaking" ? "var(--success)"
    : "var(--accent)";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "2px",
        height: "36px",
        padding: "0 4px",
      }}
      aria-label={`Voice waveform — ${voiceState}`}
    >
      {bars.map((h, i) => (
        <motion.div
          key={i}
          animate={
            speakBars
              ? {
                  scaleY: [
                    Math.max(0.12, 0.3 + Math.sin(i * 1.1) * 0.2),
                    Math.max(0.12, 0.6 + Math.sin(i * 1.1 + 1.5) * 0.35),
                    Math.max(0.12, 0.3 + Math.sin(i * 1.1) * 0.2),
                  ],
                }
              : { scaleY: Math.max(0.06, h) }
          }
          transition={
            speakBars
              ? {
                  duration: 0.65 + (i % 4) * 0.08,
                  delay: (i / BAR_COUNT) * 0.3,
                  repeat: Infinity,
                  ease: "easeInOut",
                }
              : { duration: 0.07, ease: "linear" }
          }
          style={{
            width: "3px",
            height: "100%",
            borderRadius: "2px",
            background: barColor,
            transformOrigin: "center",
            opacity: isActive ? 0.9 : 0.25,
            boxShadow: isActive ? `0 0 4px ${barColor}` : "none",
          }}
        />
      ))}
    </div>
  );
}
