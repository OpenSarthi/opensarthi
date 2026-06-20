import { useEffect, useRef } from "react";
import type { VoiceState } from "../../lib/schemas";
import { useAssistantStore } from "../../stores/assistantStore";

interface ParticleBackgroundProps {
  voiceState: VoiceState;
}

/* ─── Safe Canvas Helpers ──────────────────────────────────────────────────── */
function valid(...vals: number[]) {
  return vals.every((v) => isFinite(v) && !isNaN(v));
}

function safeArc(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, r: number,
  start: number, end: number,
  fill: string,
  lineWidth?: number
) {
  if (!valid(x, y, r) || r <= 0) return;
  ctx.beginPath();
  ctx.arc(x, y, r, start, end);
  if (lineWidth !== undefined) {
    ctx.strokeStyle = fill;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  } else {
    ctx.fillStyle = fill;
    ctx.fill();
  }
}

function safeRadialGlow(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, r0: number, r1: number,
  cr: number, cg: number, cb: number,
  a0: number, a1: number
) {
  const ir = Math.max(0.01, r0);
  const or = Math.max(ir + 0.5, r1);
  if (!valid(x, y, ir, or, a0, a1)) return;
  try {
    const g = ctx.createRadialGradient(x, y, ir, x, y, or);
    g.addColorStop(0, `rgba(${cr},${cg},${cb},${Math.min(1, Math.max(0, a0))})`);
    g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    ctx.beginPath();
    ctx.arc(x, y, or, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  } catch { /* skip */ }
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

/* ─── 3D projection helpers ────────────────────────────────────────────────── */
interface Vec3 { x: number; y: number; z: number }

function rotateY(v: Vec3, a: number): Vec3 {
  return { x: v.x * Math.cos(a) - v.z * Math.sin(a), y: v.y, z: v.z * Math.cos(a) + v.x * Math.sin(a) };
}
function rotateX(v: Vec3, a: number): Vec3 {
  return { x: v.x, y: v.y * Math.cos(a) - v.z * Math.sin(a), z: v.y * Math.sin(a) + v.z * Math.cos(a) };
}
function project(v: Vec3, cx: number, cy: number, fl: number): { px: number; py: number; sc: number } {
  const sc = fl / (fl + v.z + 1);
  return { px: cx + v.x * sc, py: cy + v.y * sc, sc };
}

/* ─── Ring definition ──────────────────────────────────────────────────────── */
interface Ring {
  radius: number;     // world-space radius
  tiltX: number;      // rotation around X
  tiltZ: number;      // rotation around Z
  phase: number;      // initial phase offset
  speed: number;      // spin speed multiplier
  particleCount: number;
  thickness: number;  // scatter around ring path
  brightness: number;
}

const RINGS: Ring[] = [
  { radius: 1.00, tiltX: 0.55, tiltZ: 0.0,  phase: 0,   speed: 1.00, particleCount: 450, thickness: 0.14, brightness: 1.0  },
  { radius: 0.75, tiltX: 1.15, tiltZ: 0.8,  phase: 1.2, speed: 1.60, particleCount: 320, thickness: 0.11, brightness: 0.85 },
  { radius: 1.25, tiltX: 0.25, tiltZ: -0.5, phase: 2.5, speed: 0.65, particleCount: 350, thickness: 0.10, brightness: 0.70 },
  { radius: 0.50, tiltX: 2.00, tiltZ: 1.3,  phase: 0.7, speed: 2.40, particleCount: 210, thickness: 0.09, brightness: 0.60 },
  { radius: 1.55, tiltX: -0.4, tiltZ: 0.3,  phase: 3.8, speed: 0.40, particleCount: 290, thickness: 0.08, brightness: 0.45 },
];

/* ─── Nebula background particles (slow, large, very dim) ──────────────────── */
function buildNebulaCloud(count: number, maxR: number) {
  return Array.from({ length: count }, () => {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = Math.pow(Math.random(), 0.6) * maxR * 1.15;
    return {
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.sin(phi) * Math.sin(theta) * 0.5,
      z: r * Math.cos(phi),
      sz: Math.random() * 2.2 + 0.6,
      alpha: Math.random() * 0.20 + 0.05,
      phase: Math.random() * Math.PI * 2,
    };
  });
}

export function ParticleBackground({ voiceState }: ParticleBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vsRef = useRef<VoiceState>(voiceState);
  const activeTheme = useAssistantStore((s) => s.activeTheme);
  const frameRef = useRef<number>(0);

  useEffect(() => { vsRef.current = voiceState; }, [voiceState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const parent = canvas.parentElement;

    let W = (canvas.width = parent?.clientWidth ?? 350);
    let H = (canvas.height = parent?.clientHeight ?? 600);
    let BASE_R = Math.pow(Math.min(W, H), 0.76) * 1.5;

    // Nebula particles
    let nebula = buildNebulaCloud(500, BASE_R * 1.6);

    const ro = new ResizeObserver(() => {
      W = canvas.width = parent?.clientWidth ?? W;
      H = canvas.height = parent?.clientHeight ?? H;
      BASE_R = Math.pow(Math.min(W, H), 0.76) * 1.5;
      nebula = buildNebulaCloud(500, BASE_R * 1.6);
    });
    if (parent) ro.observe(parent);

    // Animation state
    let time = 0;
    let globalRotY = 0;
    let sweepAngle = 0;
    let intensity = 0;
    let targetIntensity = 0;

    // PRE-COMPUTE per-particle scatter offsets & sizes
    const ringParticles = RINGS.map((ring) =>
      Array.from({ length: ring.particleCount }, () => ({
        dx:     (Math.random() - 0.5),          // scatter X offset
        dy:     (Math.random() - 0.5) * 0.6,    // scatter Y offset
        dz:     (Math.random() - 0.5),          // scatter Z offset
        bright: Math.random() < 0.08,
        size:   Math.random() < 0.08
          ? Math.random() * 3.2 + 1.6
          : Math.random() * 1.8 + 0.5,
      }))
    );

    const draw = () => {
      const vs = vsRef.current;
      time += 0.012;
      globalRotY += 0.006;

      // Intensity target by state
      targetIntensity = vs === "idle" ? 0.0
        : vs === "listening" ? 0.55
          : vs === "processing" ? 1.0
            : vs === "speaking" ? 0.75
              : 0.3;
      intensity += (targetIntensity - intensity) * 0.04;

      // Base rendering density / visual brightness scaling
      const visualIntensity = 0.35 + intensity * 0.65;

      const sweepSpeed = 0.014 + intensity * 0.055;
      sweepAngle += sweepSpeed;

      const [r, g, b] = parseAccent();
      const cx = W / 2, cy = H / 2;
      const FL = 800;

      ctx.clearRect(0, 0, W, H);

      /* ─── nebula cloud (background haze) ─────────────────────────────────── */
      ctx.globalCompositeOperation = "screen";
      for (const n of nebula) {
        const twinkle = 0.85 + Math.sin(time * 1.4 + n.phase) * 0.15;
        const v = rotateX(rotateY({ x: n.x, y: n.y, z: n.z }, globalRotY * 0.5), 0.3);
        const { px, py, sc } = project(v, cx, cy, FL);
        const a = n.alpha * twinkle * (0.3 + intensity * 0.25);
        safeArc(ctx, px, py, Math.max(0.1, n.sz * sc), 0, Math.PI * 2, `rgba(${r},${g},${b},${a})`);
      }

      /* ─── central core glow ──────────────────────────────────────────────── */
      const corePulse = 1 + Math.sin(time * (3 + intensity * 8)) * (0.08 + intensity * 0.18);
      const coreR = Math.max(1, BASE_R * 0.06 * corePulse);

      // Outer ambient fog — cheap single arc fill, zero gradient allocation
      ctx.fillStyle = `rgba(${r},${g},${b},${(visualIntensity * 0.045).toFixed(4)})`;
      ctx.beginPath();
      ctx.arc(cx, cy, BASE_R * (0.52 + intensity * 0.28), 0, Math.PI * 2);
      ctx.fill();

      // Mid + nucleus — shadowBlur is GPU-side, no JS object allocation per frame
      ctx.shadowColor = `rgba(${r},${g},${b},${(visualIntensity * 0.6).toFixed(4)})`;
      ctx.shadowBlur = coreR * 5;
      ctx.fillStyle = `rgba(${r},${g},${b},${(visualIntensity * 0.16).toFixed(4)})`;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR * 2.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowBlur = coreR * 1.5;
      ctx.fillStyle = `rgba(${r},${g},${b},${(visualIntensity * 0.75).toFixed(4)})`;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0.5, coreR * 0.7), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";

      /* ─── rings + particles ──────────────────────────────────────────────── */
      for (let ri = 0; ri < RINGS.length; ri++) {
        const ring = RINGS[ri];
        const spinSpeed = ring.speed * 0.85 * (1 + intensity * 2.5);
        const ringAngle = globalRotY * spinSpeed + ring.phase;

        const dynamicTiltX = ring.tiltX + Math.sin(time * 0.28 + ring.phase * 0.4) * 0.38;
        const dynamicTiltZ = ring.tiltZ + Math.cos(time * 0.20 + ring.phase * 0.6) * 0.22;

        const worldR = BASE_R * ring.radius;

        type P = { px: number; py: number; pz: number; alpha: number; size: number; isBright: boolean };
        const pts: P[] = [];

        for (let i = 0; i < ring.particleCount; i++) {
          const t = (i / ring.particleCount) * Math.PI * 2;
          const sp = ringParticles[ri][i];

          const px0 = Math.cos(t) * worldR;
          const pz0 = Math.sin(t) * worldR;

          const tx1 = px0;
          const ty1 = -pz0 * Math.sin(dynamicTiltX);
          const tz1 =  pz0 * Math.cos(dynamicTiltX);

          const sc2 = worldR * ring.thickness;
          const fx = tx1 + sp.dx * sc2;
          const fy = ty1 + sp.dy * sc2;
          const fz = tz1 + sp.dz * sc2;

          let v: Vec3 = { x: fx, y: fy, z: fz };
          v = rotateY(v, ringAngle);
          v = rotateX(v, dynamicTiltZ);
          v = rotateY(v, globalRotY * 0.25);

          const { px: ppx, py: ppy, sc: psc } = project(v, cx, cy, FL);
          if (!valid(ppx, ppy, psc)) continue;

          const depthA = Math.min(1.2, psc);
          const angleDiff = Math.abs(((t - sweepAngle) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
          const sweepBoost = intensity > 0.15 ? Math.max(0, 1 - angleDiff / 0.45) : 0;

          const baseAlpha = ring.brightness * depthA * (0.20 + visualIntensity * 0.16);
          const alpha = Math.min(0.90, baseAlpha + sweepBoost * 0.55);
          const size = Math.max(0.15, sp.size * Math.min(1.4, psc));

          pts.push({ px: ppx, py: ppy, pz: v.z, alpha, size, isBright: sp.bright });
        }

        pts.sort((a, c) => c.pz - a.pz);

        for (const p of pts) {
          safeArc(ctx, p.px, p.py, p.size, 0, Math.PI * 2, `rgba(${r},${g},${b},${p.alpha})`);
          if (p.isBright) {
            ctx.shadowColor = `rgba(${r},${g},${b},${(p.alpha * 0.5).toFixed(4)})`;
            ctx.shadowBlur = p.size * 4;
            safeArc(ctx, p.px, p.py, p.size, 0, Math.PI * 2, `rgba(${r},${g},${b},${p.alpha})`);
            ctx.shadowBlur = 0;
            ctx.shadowColor = "transparent";
          }
        }

        /* ── Draw the ring arc outline (visible light color ring structure) ── */
        const arcAlpha = ring.brightness * 0.12 * (0.4 + visualIntensity * 0.6);
        const arcSteps = 120;
        ctx.beginPath();
        let first = true;
        for (let i = 0; i <= arcSteps; i++) {
          const t = (i / arcSteps) * Math.PI * 2;
          let v: Vec3 = {
            x: Math.cos(t) * worldR,
            y: -Math.sin(t) * worldR * Math.sin(dynamicTiltX),
            z:  Math.sin(t) * worldR * Math.cos(dynamicTiltX),
          };
          v = rotateY(v, ringAngle);
          v = rotateX(v, dynamicTiltZ);
          v = rotateY(v, globalRotY * 0.25);
          const { px: ax, py: ay } = project(v, cx, cy, FL);
          if (!valid(ax, ay)) continue;
          if (first) { ctx.moveTo(ax, ay); first = false; }
          else ctx.lineTo(ax, ay);
        }
        ctx.closePath();
        ctx.strokeStyle = `rgba(${r},${g},${b},${arcAlpha})`;
        ctx.lineWidth = 0.5 + visualIntensity * 0.3;
        ctx.stroke();
      }

      /* ─── scanning beam ──────────────────────────────────────── */
      if (intensity > 0.1) {
        const beamLen = BASE_R * (1.0 + intensity * 0.5);
        const bx = cx + Math.cos(sweepAngle) * beamLen;
        const by = cy + Math.sin(sweepAngle) * beamLen;
        const beam = ctx.createLinearGradient(cx, cy, bx, by);
        beam.addColorStop(0, `rgba(${r},${g},${b},${0.35 * intensity})`);
        beam.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(bx, by);
        ctx.strokeStyle = beam;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        for (let t = 1; t <= 5; t++) {
          const ta = sweepAngle - t * 0.10;
          const tbx = cx + Math.cos(ta) * beamLen * 0.95;
          const tby = cy + Math.sin(ta) * beamLen * 0.95;
          const ta2 = intensity * (0.14 - t * 0.025);
          if (ta2 <= 0) continue;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(tbx, tby);
          ctx.strokeStyle = `rgba(${r},${g},${b},${ta2})`;
          ctx.lineWidth = 1.0;
          ctx.stroke();
        }
      }

      /* ─── HUD brackets ────────────────────────────────────────── */
      if (intensity > 0.45) {
        const bSize = BASE_R * 0.9;
        const bA = 0.1 + (intensity - 0.45) * 0.25;
        const arm = bSize * 0.18;
        ctx.strokeStyle = `rgba(${r},${g},${b},${bA})`;
        ctx.lineWidth = 1;
        const corners = [
          [cx - bSize, cy - bSize], [cx + bSize, cy - bSize],
          [cx + bSize, cy + bSize], [cx - bSize, cy + bSize],
        ] as [number, number][];
        const dirs = [[1, 1], [-1, 1], [-1, -1], [1, -1]] as [number, number][];
        for (let i = 0; i < 4; i++) {
          const [bx2, by2] = corners[i];
          const [dx, dy] = dirs[i];
          if (!valid(bx2, by2)) continue;
          ctx.beginPath(); ctx.moveTo(bx2, by2 + dy * arm); ctx.lineTo(bx2, by2); ctx.lineTo(bx2 + dx * arm, by2); ctx.stroke();
        }
      }

      /* ─── concentric pulsing rings ────────────────────────────────────────── */
      if (vs === "listening" || vs === "speaking") {
        const waves = vs === "speaking" ? 4 : 3;
        for (let w = 0; w < waves; w++) {
          const progress = ((time * 0.6 + w / waves) % 1);
          const wR = progress * BASE_R * 1.6;
          const wA = (1 - progress) * 0.18 * intensity;
          safeArc(ctx, cx, cy, wR, 0, Math.PI * 2, `rgba(${r},${g},${b},${wA})`, 1.5);
        }
      }

      /* ─── energy vortex ────────────────────────────────────────────────────── */
      if (vs === "processing" && intensity > 0.6) {
        for (let i = 0; i < 6; i++) {
          const angle = time * 4 + (i / 6) * Math.PI * 2;
          const vR = BASE_R * (0.08 + i * 0.05);
          const vx = cx + Math.cos(angle) * vR;
          const vy = cy + Math.sin(angle) * vR;
          safeRadialGlow(ctx, vx, vy, 0, vR * 1.2, r, g, b, 0.35 * (intensity - 0.6) / 0.4, 0);
        }
      }

      ctx.globalCompositeOperation = "source-over";
      frameRef.current = requestAnimationFrame(draw);
    };

    cancelAnimationFrame(frameRef.current);
    draw();

    return () => {
      cancelAnimationFrame(frameRef.current);
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
      }}
    />
  );
}
