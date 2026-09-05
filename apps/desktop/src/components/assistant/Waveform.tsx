import { useEffect, useRef } from "react";
import type { VoiceState } from "../../lib/schemas";

interface WaveformProps {
  voiceState: VoiceState;
  /** Override level from 0–1 (ignored when using live mic) */
  level?: number;
  /** Optional TTS playback RMS level */
  ttsLevel?: number;
}

export function Waveform({ voiceState, level, ttsLevel }: WaveformProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);

  const isListening = voiceState === "listening";
  const isSpeaking = voiceState === "speaking";
  const isProcessing = voiceState === "processing";
  const isError = voiceState === "error";
  const isActive = isListening || isSpeaking || isProcessing || isError;

  // Microphone audio capture when listening
  useEffect(() => {
    if (isListening) {
      let mounted = true;
      navigator.mediaDevices
        ?.getUserMedia({ audio: true, video: false })
        .then((stream) => {
          if (!mounted) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = stream;
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          audioCtxRef.current = ctx;
          const src = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.75;
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
        if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
          audioCtxRef.current.close().catch(() => {});
        }
        audioCtxRef.current = null;
        analyserRef.current = null;
      };
    }
  }, [isListening]);

  // Main Canvas Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = container.clientWidth || 600;
    let height = container.clientHeight || 96;
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      if (!container || !canvas) return;
      width = container.clientWidth || 600;
      height = container.clientHeight || 96;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    let t = 0;
    let smoothedAmp = isSpeaking ? 0.85 : isListening ? 0.35 : 0.12;
    const freqData = new Uint8Array(128);

    const render = () => {
      // 1. Advance time t
      // Faster, energetic speed as requested
      const dt = isSpeaking ? 0.055 : isListening ? 0.045 : isProcessing ? 0.06 : 0.02;
      t += dt;

      // 2. Sample live microphone input when listening
      let micLevel = 0;
      if (isListening && analyserRef.current) {
        analyserRef.current.getByteFrequencyData(freqData);
        let sum = 0;
        for (let i = 0; i < freqData.length; i++) {
          sum += freqData[i];
        }
        micLevel = sum / (freqData.length * 255); // 0 to 1
      }

      // 3. Compute target amplitude
      let targetAmp = 0.12;
      if (isSpeaking) {
        // Height should be significantly more throughout speaking
        const speechEnvelope = 0.82 + 0.18 * Math.sin(t * 3.2) * Math.cos(t * 1.7);
        const drive = ttsLevel !== undefined && ttsLevel > 0 ? ttsLevel : level !== undefined && level > 0 ? level : 1.0;
        targetAmp = Math.min(0.96, Math.max(0.65, 0.82 * speechEnvelope * drive));
      } else if (isListening) {
        // Less height compared to speaking, surges with microphone audio
        const micBoost = Math.pow(micLevel, 0.85) * 1.8;
        targetAmp = Math.min(0.70, Math.max(0.20, 0.22 + micBoost));
      } else if (isProcessing) {
        targetAmp = 0.45 + 0.20 * Math.sin(t * 4);
      } else if (isError) {
        targetAmp = 0.25;
      }

      // Smooth amplitude transitions
      smoothedAmp += (targetAmp - smoothedAmp) * (isListening ? 0.35 : 0.22);

      // 4. Direction of wave travel:
      // Speaking: moving forward (left to right: phase sign is negative)
      // Listening: moving backward (right to left: phase sign is positive)
      const travelDir = isListening ? 1 : -1;
      const speed = isSpeaking ? 3.4 : isListening ? 2.8 : isProcessing ? 4.2 : 1.2;
      const phase = travelDir * t * speed;

      // 5. Determine accent color
      let baseColor = "#00ff88"; // default neon green
      if (isError) baseColor = "#ef4444";
      else if (isProcessing) baseColor = "#38bdf8";
      else if (isSpeaking) baseColor = "#00ff88";

      // Try reading active CSS variable
      try {
        const computed = getComputedStyle(container);
        const cssAcc = computed.getPropertyValue(isError ? "--danger" : isSpeaking ? "--success" : "--accent").trim();
        if (cssAcc && cssAcc.startsWith("#")) baseColor = cssAcc;
      } catch (_) {}

      // 6. Draw on Canvas
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const cy = height / 2;
      const maxH = (height / 2) - 4; // Max half-amplitude in pixels (e.g. 44px)

      // Center laser baseline
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.lineTo(width, cy);
      ctx.strokeStyle = baseColor;
      ctx.globalAlpha = isActive ? 0.25 : 0.10;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Sample step for smooth continuous curve
      const step = Math.max(2, Math.floor(width / 140));
      const totalPoints = Math.ceil(width / step) + 1;

      // Arrays storing upper and lower curve coordinates
      const upperPts: { x: number; y: number }[] = [];
      const lowerPts: { x: number; y: number }[] = [];
      const midPts: { x: number; y: number }[] = [];
      const harmonicPts: { x: number; y: number }[] = [];

      for (let i = 0; i < totalPoints; i++) {
        const x = Math.min(width, i * step);
        const u = x / width; // 0 to 1

        // Smooth windowing envelope: zero at boundaries, maximum in center
        const taper = Math.pow(Math.sin(u * Math.PI), 0.85);

        // Spatial amplitude modulation: creates crests with DIFFERENT HEIGHTS across the wave!
        const spatialMod =
          0.52 +
          0.32 * Math.sin(2.4 * Math.PI * u + phase * 0.28) +
          0.16 * Math.cos(4.6 * Math.PI * u - phase * 0.18);

        // Multi-frequency sinusoidal components:
        // Main carrier wave
        const sin1 = Math.sin(u * Math.PI * 6.8 + phase);
        // First harmonic (higher frequency)
        const sin2 = Math.sin(u * Math.PI * 11.4 + phase * 1.35 + 1.2);
        // Sub-harmonic (lower frequency base)
        const sin3 = Math.sin(u * Math.PI * 3.6 + phase * 0.75 + 2.4);

        // Local frequency formant if mic active
        let micW = 0;
        if (isListening && micLevel > 0.05) {
          const binIdx = Math.min(freqData.length - 1, Math.floor(u * (freqData.length * 0.6)));
          micW = ((freqData[binIdx] || 0) / 255) * 0.45;
        }

        // Combined sinusoidal function (both positive and negative values)
        const combined = sin1 * 0.52 + sin2 * 0.32 + sin3 * 0.16 + micW;

        // Current wave displacement for this point
        const ampPixels = maxH * smoothedAmp * spatialMod * taper;
        const waveH = Math.max(1.5, Math.abs(combined) * ampPixels);

        // Upper wave point (Ups)
        upperPts.push({ x, y: cy - waveH });

        // Lower wave point (Downs) - asymmetrical harmonic shift so crests dance naturally on both sides
        const sinLower = Math.sin(u * Math.PI * 6.8 + phase + 0.45) * 0.52 +
                         Math.sin(u * Math.PI * 11.4 + phase * 1.35 + 1.8) * 0.32 +
                         Math.sin(u * Math.PI * 3.6 + phase * 0.75 + 3.1) * 0.16;
        const lowerH = Math.max(1.5, Math.abs(sinLower) * ampPixels);
        lowerPts.push({ x, y: cy + lowerH });

        // Traversing middle sine curve that swings through the center line (ups and downs across 0)
        midPts.push({ x, y: cy - combined * ampPixels * 0.92 });

        // Secondary harmonic curve
        const harmWave = Math.sin(u * Math.PI * 8.5 + phase * 1.2 + 0.8) * ampPixels * 0.65;
        harmonicPts.push({ x, y: cy - harmWave });
      }

      // Helper for drawing a smooth bezier curve through points
      const drawSmoothCurve = (pts: { x: number; y: number }[]) => {
        if (pts.length < 2) return;
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 0; i < pts.length - 1; i++) {
          const p0 = pts[i];
          const p1 = pts[i + 1];
          const mx = (p0.x + p1.x) / 2;
          const my = (p0.y + p1.y) / 2;
          ctx.quadraticCurveTo(p0.x, p0.y, mx, my);
        }
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      };

      // 7. Render Filled Area Ribbon between Upper and Lower Curves
      if (isActive && upperPts.length > 0 && lowerPts.length > 0) {
        ctx.save();
        ctx.beginPath();
        drawSmoothCurve(upperPts);
        // Connect down to bottom curve and reverse trace
        for (let i = lowerPts.length - 1; i >= 0; i--) {
          const p = lowerPts[i];
          if (i === lowerPts.length - 1) ctx.lineTo(p.x, p.y);
          else {
            const pNext = lowerPts[i + 1];
            const mx = (p.x + pNext.x) / 2;
            const my = (p.y + pNext.y) / 2;
            ctx.quadraticCurveTo(pNext.x, pNext.y, mx, my);
          }
        }
        ctx.closePath();

        const ribbonGrad = ctx.createLinearGradient(0, cy - maxH, 0, cy + maxH);
        ribbonGrad.addColorStop(0, `${baseColor}44`); // 27% opacity at top peak
        ribbonGrad.addColorStop(0.35, `${baseColor}18`); // 9% opacity
        ribbonGrad.addColorStop(0.5, `${baseColor}05`); // 2% opacity at center
        ribbonGrad.addColorStop(0.65, `${baseColor}18`);
        ribbonGrad.addColorStop(1, `${baseColor}44`); // 27% opacity at bottom peak
        ctx.fillStyle = ribbonGrad;
        ctx.globalAlpha = isSpeaking ? 0.95 : 0.65;
        ctx.fill();
        ctx.restore();
      }

      // 8. Render Secondary Harmonic Sine Curve (Subtle holographic depth)
      if (isActive && harmonicPts.length > 0) {
        ctx.save();
        ctx.beginPath();
        drawSmoothCurve(harmonicPts);
        ctx.strokeStyle = baseColor;
        ctx.globalAlpha = isSpeaking ? 0.40 : 0.25;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.restore();
      }

      // 9. Render Traversing Center Sine Wave (Weaving up and down across center)
      if (midPts.length > 0) {
        ctx.save();
        ctx.beginPath();
        drawSmoothCurve(midPts);
        ctx.strokeStyle = "#ffffff";
        ctx.globalAlpha = isActive ? (isSpeaking ? 0.95 : 0.75) : 0.20;
        ctx.lineWidth = isSpeaking ? 2.2 : 1.6;
        ctx.shadowColor = baseColor;
        ctx.shadowBlur = isActive ? (isSpeaking ? 16 : 10) : 4;
        ctx.stroke();
        ctx.restore();
      }

      // 10. Render Upper Sine Curve Stroke (Ups - dancing crests of varying heights)
      if (upperPts.length > 0) {
        ctx.save();
        ctx.beginPath();
        drawSmoothCurve(upperPts);
        ctx.strokeStyle = baseColor;
        ctx.globalAlpha = isActive ? 0.95 : 0.35;
        ctx.lineWidth = isSpeaking ? 2.4 : 1.8;
        ctx.shadowColor = baseColor;
        ctx.shadowBlur = isActive ? (isSpeaking ? 14 : 8) : 2;
        ctx.stroke();
        ctx.restore();
      }

      // 11. Render Lower Sine Curve Stroke (Downs - dancing troughs of varying heights)
      if (lowerPts.length > 0) {
        ctx.save();
        ctx.beginPath();
        drawSmoothCurve(lowerPts);
        ctx.strokeStyle = baseColor;
        ctx.globalAlpha = isActive ? 0.95 : 0.35;
        ctx.lineWidth = isSpeaking ? 2.4 : 1.8;
        ctx.shadowColor = baseColor;
        ctx.shadowBlur = isActive ? (isSpeaking ? 14 : 8) : 2;
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [isListening, isSpeaking, isProcessing, isError, level, ttsLevel]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "visible",
      }}
      aria-label={`Voice waveform — ${voiceState}`}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
        }}
      />
    </div>
  );
}
