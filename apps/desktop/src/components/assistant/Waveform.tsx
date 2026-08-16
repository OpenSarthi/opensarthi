import { useEffect, useRef, useState } from "react";
import type { VoiceState } from "../../lib/schemas";

interface WaveformProps {
  voiceState: VoiceState;
  /** Override level from 0–1 (ignored when using live mic) */
  level?: number;
}

const BAR_COUNT = 90;

export function Waveform({ voiceState }: WaveformProps) {
  const isListening = voiceState === "listening";
  const isSpeaking = voiceState === "speaking";
  const isProcessing = voiceState === "processing";
  const isError = voiceState === "error";
  const isActive = isListening || isSpeaking || isProcessing || isError;

  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  
  // Array storing current display heights (0 to 1)
  const [bars, setBars] = useState<number[]>(Array(BAR_COUNT).fill(0.05));
  const currentBarsRef = useRef<number[]>(Array(BAR_COUNT).fill(0.05));

  useEffect(() => {
    // Microphone source setup when listening
    if (isListening) {
      let mounted = true;
      navigator.mediaDevices
        .getUserMedia({ audio: true, video: false })
        .then((stream) => {
          if (!mounted) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = stream;
          const ctx = new AudioContext();
          const src = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.8;
          src.connect(analyser);
          analyserRef.current = analyser;
        })
        .catch((err) => {
          console.warn("Waveform: Microphone access denied or unavailable", err);
        });

      return () => {
        mounted = false;
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        analyserRef.current = null;
      };
    }
  }, [isListening]);

  // Main animation render loop (updates state every frame)
  useEffect(() => {
    let t = 0;
    const data = analyserRef.current ? new Uint8Array(analyserRef.current.frequencyBinCount) : null;

    const tick = () => {
      t += 0.05;
      const analyser = analyserRef.current;
      if (analyser && data) {
        analyser.getByteFrequencyData(data);
      }

      // 4-5 waves configuration across BAR_COUNT
      const waveCount = 4.5;
      const freq = (waveCount * 2 * Math.PI) / BAR_COUNT;

      const targetBars = Array.from({ length: BAR_COUNT }, (_, i) => {
        // Flat boundary taper allowing multiple cycles to show across the full width (matches Mark-L aesthetics)
        const taper = 0.45 + 0.55 * Math.sin((i / (BAR_COUNT - 1)) * Math.PI);

        // 1. MIC ACTIVE MODE
        if (isListening && analyser && data) {
          const step = Math.floor(data.length / BAR_COUNT);
          const binVal = data[Math.min(i * step, data.length - 1)] / 255;
          // Background organic breathing wave
          const baseWave = 0.05 + 0.04 * Math.sin(t - i * freq) * taper;
          // React strongly to voice input (raise high when user speaks, drop to flat normal base when silent/muted)
          return Math.max(0.04, binVal * 2.5 * taper + baseWave);
        }

        // 2. SPEAKING MODE (Simulate dynamic spoken syllable envelope and silent pauses)
        if (isSpeaking) {
          const speechEnvelope = Math.max(0.08, Math.sin(t * 1.6) * 0.75 + Math.cos(t * 0.7) * 0.35);
          const waveA = 0.45 * Math.sin(t - i * freq);
          const waveB = 0.20 * Math.sin(1.8 * t + i * 1.5 * freq);
          const activeWave = (waveA + waveB) * taper * speechEnvelope;
          return Math.max(0.04, 0.06 + activeWave);
        }

        // 3. PROCESSING/THINKING MODE (Fast moving pulse)
        if (isProcessing) {
          const wave = 0.35 * Math.sin(2.5 * t - i * 1.5 * freq);
          return Math.max(0.04, 0.08 + wave * taper);
        }

        // 4. ERROR STATE (Low red flat frozen wave)
        if (isError) {
          return Math.max(0.04, 0.08 + 0.04 * Math.sin(t * 0.2 + i * freq * 2) * taper);
        }

        // 5. IDLE BREATHING STATE
        const idleWave = 0.06 * Math.sin(t * 0.6 - i * freq);
        return Math.max(0.04, 0.06 + idleWave * taper);
      });

      // Linear interpolation (lerp) for smooth transitions between states and frames
      const lerped = currentBarsRef.current.map((curr, i) => {
        const target = targetBars[i];
        const factor = isListening && analyser ? 0.25 : 0.15; // Faster reaction for live mic
        const val = curr + (target - curr) * factor;
        currentBarsRef.current[i] = val;
        return val;
      });

      setBars(lerped);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isListening, isSpeaking, isProcessing, isError]);

  const barColor =
    voiceState === "error" ? "var(--danger)"
    : voiceState === "speaking" ? "var(--success)"
    : "var(--accent)";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "60px",
        width: "100%",
        padding: "0 4px",
      }}
      aria-label={`Voice waveform — ${voiceState}`}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1px", width: "100%" }}>
        
        {/* Top half of waveform */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: "1px", height: "28px", width: "100%", justifyContent: "center" }}>
          {bars.map((h, i) => (
            <div
              key={`u-${i}`}
              style={{
                flex: 1,
                maxWidth: "3px",
                height: `${Math.max(4, h * 100)}%`,
                borderRadius: "1.5px 1.5px 0 0",
                background: `linear-gradient(to top, ${barColor}, rgba(255, 255, 255, 0.95))`,
                opacity: isActive ? 0.95 : 0.2,
                boxShadow: isActive ? `0 -1px 4px ${barColor}` : "none",
                transition: "height 0.05s linear",
              }}
            />
          ))}
        </div>

        {/* Dynamic center baseline */}
        <div 
          style={{ 
            height: "1px", 
            width: "100%", 
            background: barColor,
            opacity: isActive ? 0.6 : 0.1,
          }} 
        />

        {/* Bottom mirror half (reflection effect) */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: "1px", height: "28px", width: "100%", justifyContent: "center" }}>
          {bars.map((h, i) => (
            <div
              key={`d-${i}`}
              style={{
                flex: 1,
                maxWidth: "3px",
                height: `${Math.max(4, h * 85)}%`, // slightly compressed reflection height
                borderRadius: "0 0 1.5px 1.5px",
                background: `linear-gradient(to bottom, ${barColor}, rgba(255, 255, 255, 0.05))`,
                opacity: isActive ? 0.35 : 0.08, // soft reflection transparency
                boxShadow: isActive ? `0 1px 3px ${barColor}` : "none",
                transition: "height 0.05s linear",
              }}
            />
          ))}
        </div>

      </div>
    </div>
  );
}
