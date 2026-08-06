import { useEffect, useRef } from "react";
import type { VoiceState } from "../../lib/schemas";
import { useAssistantStore } from "../../stores/assistantStore";

interface MatrixRainBackgroundProps {
  voiceState: VoiceState;
}

/* ─── Accent color parser ──────────────────────────────────────────────────── */
let cachedRGB: [number, number, number] = [255, 26, 26];
function parseAccent(): [number, number, number] {
  try {
    const el = document.createElement("div");
    el.style.cssText = "color:var(--accent);position:absolute;visibility:hidden";
    document.body.appendChild(el);
    const m = getComputedStyle(el).color.match(/\d+/g);
    document.body.removeChild(el);
    if (m && m.length >= 3) {
      cachedRGB = [+m[0], +m[1], +m[2]];
    }
  } catch { /* ignore */ }
  return cachedRGB;
}

export function MatrixRainBackground({ voiceState }: MatrixRainBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeTheme = useAssistantStore((s) => s.activeTheme);
  const vsRef = useRef<VoiceState>(voiceState);
  const intensityRef = useRef<number>(0);

  useEffect(() => {
    vsRef.current = voiceState;
  }, [voiceState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const parent = canvas.parentElement;

    let W = (canvas.width = parent?.clientWidth ?? 200);
    let H = (canvas.height = parent?.clientHeight ?? 300);

    const charList = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-={}[]|"];
    const fontSize = 10;
    let cols = Math.ceil(W / fontSize);
    let drops = Array.from({ length: cols }, () => (Math.random() * (H / fontSize) * -1.5));

    const ro = new ResizeObserver(() => {
      W = canvas.width = parent?.clientWidth ?? W;
      H = canvas.height = parent?.clientHeight ?? H;
      const newCols = Math.ceil(W / fontSize);
      if (newCols !== cols) {
        cols = newCols;
        drops = Array.from({ length: cols }, () => (Math.random() * (H / fontSize) * -1.5));
      }
    });
    if (parent) ro.observe(parent);

    let animationFrameId = 0;
    let lastTime = performance.now();
    let timeAccumulator = 0;

    const draw = (now: number) => {
      const deltaTime = now - lastTime;
      lastTime = now;

      // Smooth transition of state-aware animation speed intensity
      const vs = vsRef.current;
      let targetIntensity = 0;
      if (vs === "listening") targetIntensity = 0.55;
      else if (vs === "processing") targetIntensity = 1.0;
      else if (vs === "speaking") targetIntensity = 0.75;
      else if (vs === "error") targetIntensity = 0.3;

      intensityRef.current += (targetIntensity - intensityRef.current) * 0.04;
      const intensity = intensityRef.current;

      const baseFrameRate = 33; // base update step every 33ms
      const speedFactor = 0.55 + intensity * 2.45; // speeds up on audio/task activity
      const effectiveInterval = baseFrameRate / speedFactor;

      timeAccumulator += deltaTime;

      if (timeAccumulator >= effectiveInterval) {
        timeAccumulator = timeAccumulator % effectiveInterval;

        const [r, g, b] = parseAccent();

        // Trail fade clear
        ctx.fillStyle = "rgba(0, 0, 0, 0.09)";
        ctx.fillRect(0, 0, W, H);

        ctx.font = `${fontSize}px monospace`;

        for (let i = 0; i < drops.length; i++) {
          const row = Math.floor(drops[i]);

          if (row >= 0 && row * fontSize < H) {
            const text = charList[Math.floor(Math.random() * charList.length)];

            // Lead head drop in bright white-glowing text
            ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
            ctx.fillText(text, i * fontSize, row * fontSize);

            // Trail drop in accent color
            if (row > 0) {
              const prevText = charList[Math.floor(Math.random() * charList.length)];
              ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.82)`;
              ctx.fillText(prevText, i * fontSize, (row - 1) * fontSize);
            }
          }

          drops[i] += 1;

          // Wrap back to top randomly
          if (drops[i] * fontSize > H && Math.random() > 0.975) {
            drops[i] = -1;
          }
        }
      }

      animationFrameId = requestAnimationFrame(draw);
    };

    animationFrameId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animationFrameId);
      ro.disconnect();
    };
  }, [activeTheme]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 0,
        display: "block",
        opacity: 0.16,
      }}
    />
  );
}
