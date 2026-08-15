import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { VoiceState } from "../../lib/schemas";

interface WaveformProps {
  voiceState: VoiceState;
  /** Override level from 0–1 (ignored when using live mic) */
  level?: number;
}

const BAR_COUNT = 40;

export function Waveform({ voiceState }: WaveformProps) {
  const isListening = voiceState === "listening";
  const isSpeaking = voiceState === "speaking";
  const isActive = isListening || isSpeaking;

  // Live microphone amplitude analysis
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const [bars, setBars] = useState<number[]>(Array(BAR_COUNT).fill(0.08));

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
        setBars(Array(BAR_COUNT).fill(0.08));
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
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.80;
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
            // Bell-curve taper so center bars are taller
            const taper = 1 - Math.abs((i / (BAR_COUNT - 1)) - 0.5) * 0.5;
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
          t += 0.07;
          setBars(
            Array.from({ length: BAR_COUNT }, (_, i) =>
              Math.max(0.06, 0.42 + Math.sin(t + i * 0.5) * 0.38)
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

  const halfCount = Math.ceil(BAR_COUNT / 2);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "2px",
        height: "52px",
        width: "100%",
        padding: "0 8px",
      }}
      aria-label={`Voice waveform — ${voiceState}`}
    >
      {/* Upper + lower mirrored bars */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1px", width: "100%" }}>
        {/* Upper half */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: "2px", height: "24px", width: "100%", justifyContent: "center" }}>
          {bars.slice(0, halfCount).map((h, i) => (
            <motion.div
              key={`u-${i}`}
              animate={
                speakBars
                  ? { scaleY: [Math.max(0.08, 0.28 + Math.sin(i * 1.1) * 0.2), Math.max(0.08, 0.65 + Math.sin(i * 1.1 + 1.5) * 0.3), Math.max(0.08, 0.28 + Math.sin(i * 1.1) * 0.2)] }
                  : { scaleY: Math.max(0.06, h) }
              }
              transition={
                speakBars
                  ? { duration: 0.6 + (i % 4) * 0.09, delay: (i / halfCount) * 0.25, repeat: Infinity, ease: "easeInOut" }
                  : { duration: 0.07, ease: "linear" }
              }
              style={{
                flex: 1,
                maxWidth: "5px",
                height: "100%",
                borderRadius: "2px 2px 0 0",
                background: `linear-gradient(to top, ${barColor}, rgba(255,255,255,0.85))`,
                transformOrigin: "bottom",
                opacity: isActive ? 0.9 : 0.15,
                boxShadow: isActive ? `0 0 5px ${barColor}88` : "none",
              }}
            />
          ))}
        </div>
        {/* Center line */}
        <div style={{ height: "1px", width: "100%", background: isActive ? `${barColor}55` : "transparent" }} />
        {/* Lower mirror half */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: "2px", height: "24px", width: "100%", justifyContent: "center" }}>
          {bars.slice(0, halfCount).map((h, i) => (
            <motion.div
              key={`d-${i}`}
              animate={
                speakBars
                  ? { scaleY: [Math.max(0.08, 0.28 + Math.sin(i * 1.1) * 0.2), Math.max(0.08, 0.65 + Math.sin(i * 1.1 + 1.5) * 0.3), Math.max(0.08, 0.28 + Math.sin(i * 1.1) * 0.2)] }
                  : { scaleY: Math.max(0.06, h) }
              }
              transition={
                speakBars
                  ? { duration: 0.6 + (i % 4) * 0.09, delay: (i / halfCount) * 0.25, repeat: Infinity, ease: "easeInOut" }
                  : { duration: 0.07, ease: "linear" }
              }
              style={{
                flex: 1,
                maxWidth: "5px",
                height: "100%",
                borderRadius: "0 0 2px 2px",
                background: `linear-gradient(to bottom, ${barColor}, rgba(255,255,255,0.4))`,
                transformOrigin: "top",
                opacity: isActive ? 0.5 : 0.08,
                boxShadow: isActive ? `0 0 3px ${barColor}44` : "none",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
