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

/* ─── HUD data stream particles (diagonal streaks across screen) ───────────── */
function buildDataStreams(count: number, W: number, H: number) {
  return Array.from({ length: count }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    vx: (Math.random() - 0.5) * 0.8,
    vy: Math.random() * 1.2 + 0.3,
    len: Math.random() * 40 + 10,
    alpha: Math.random() * 0.18 + 0.04,
    speed: Math.random() * 0.6 + 0.2,
  }));
}

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

/* ════════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════════════════════════════ */
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

    let W = (canvas.width = parent?.clientWidth ?? 700);
    let H = (canvas.height = parent?.clientHeight ?? 500);
    let BASE_R = Math.pow(Math.min(W, H), 0.76) * 1.5;

    // Nebula particles
    let nebula = buildNebulaCloud(400, BASE_R * 1.6);

    // Data streams (Jarvis-style falling particles)
    let streams = buildDataStreams(35, W, H);

    const ro = new ResizeObserver(() => {
      W = canvas.width = parent?.clientWidth ?? W;
      H = canvas.height = parent?.clientHeight ?? H;
      BASE_R = Math.pow(Math.min(W, H), 0.76) * 1.5;
      nebula = buildNebulaCloud(400, BASE_R * 1.6);
      streams = buildDataStreams(35, W, H);
    });
    if (parent) ro.observe(parent);

    // Animation state
    let time = 0;
    let globalRotY = 0;
    let sweepAngle = 0;
    let intensity = 0;
    let targetIntensity = 0;

    // PRE-COMPUTE per-particle scatter offsets & sizes so they don't re-random every frame
    // (calling Math.random() in draw() causes particles to flutter incoherently)
    const ringParticles = RINGS.map((ring) =>
      Array.from({ length: ring.particleCount }, () => ({
        dx:     (Math.random() - 0.5),          // scatter X offset (unit)
        dy:     (Math.random() - 0.5) * 0.6,    // scatter Y offset
        dz:     (Math.random() - 0.5),          // scatter Z offset
        bright: Math.random() < 0.08,
        size:   Math.random() < 0.08
          ? Math.random() * 3.2 + 1.6
          : Math.random() * 1.8 + 0.5,
      }))
    );

    /* ── draw one frame ── */
    const draw = () => {
      const vs = vsRef.current;
      time += 0.012;
      globalRotY += 0.006;  // ~1 full Y drift per ~17s — clearly visible rotation

      // Intensity target by state
      targetIntensity = vs === "idle" ? 0.0
        : vs === "listening" ? 0.55
          : vs === "processing" ? 1.0
            : vs === "speaking" ? 0.75
              : /* error */                   0.3;
      intensity += (targetIntensity - intensity) * 0.04;

      // Base rendering density / visual brightness scaling
      const visualIntensity = 0.35 + intensity * 0.65;

      // Sweep: gentle idle, picks up noticeably when agent is active
      const sweepSpeed = 0.014 + intensity * 0.055;
      sweepAngle += sweepSpeed;

      const [r, g, b] = parseAccent();
      const cx = W / 2, cy = H / 2;
      const FL = 800;

      // 3D holographic wobble tilt angles (Yaw, Pitch, Roll)
      const wobbleY = Math.sin(time * 0.95) * 0.58;  // dynamic yaw
      const wobbleX = Math.cos(time * 0.78) * 0.44;  // dynamic pitch
      const wobbleZ = Math.sin(time * 0.48) * 0.38;  // dynamic roll

      const rotateZ = (v: Vec3, a: number): Vec3 => {
        return {
          x: v.x * Math.cos(a) - v.y * Math.sin(a),
          y: v.x * Math.sin(a) + v.y * Math.cos(a),
          z: v.z
        };
      };

      const draw3DCircle = (
        radius: number,
        color: string,
        lineWidth: number,
        segments?: { start: number; end: number }[],
        rotZ: number = 0
      ) => {
        const steps = 96;
        const drawArc = (startAng: number, endAng: number) => {
          ctx.beginPath();
          let first = true;
          const arcSteps = Math.ceil(steps * (endAng - startAng) / (Math.PI * 2));
          for (let i = 0; i <= arcSteps; i++) {
            const t = startAng + (i / arcSteps) * (endAng - startAng) + rotZ;
            const pt: Vec3 = {
              x: Math.cos(t) * radius,
              y: Math.sin(t) * radius,
              z: 0
            };
            let v = rotateZ(pt, wobbleZ);
            v = rotateY(v, wobbleY);
            v = rotateX(v, wobbleX);
            const { px, py } = project(v, cx, cy, FL);
            if (!valid(px, py)) continue;
            if (first) {
              ctx.moveTo(px, py);
              first = false;
            } else {
              ctx.lineTo(px, py);
            }
          }
          ctx.strokeStyle = color;
          ctx.lineWidth = lineWidth;
          ctx.stroke();
        };

        if (segments) {
          for (const seg of segments) {
            drawArc(seg.start, seg.end);
          }
        } else {
          drawArc(0, Math.PI * 2);
        }
      };

      const draw3DLine = (
        p1: Vec3,
        p2: Vec3,
        color: string,
        lineWidth: number
      ) => {
        let v1 = rotateZ(p1, wobbleZ);
        v1 = rotateY(v1, wobbleY);
        v1 = rotateX(v1, wobbleX);
        let v2 = rotateZ(p2, wobbleZ);
        v2 = rotateY(v2, wobbleY);
        v2 = rotateX(v2, wobbleX);
        const proj1 = project(v1, cx, cy, FL);
        const proj2 = project(v2, cx, cy, FL);
        if (!valid(proj1.px, proj1.py, proj2.px, proj2.py)) return;

        ctx.beginPath();
        ctx.moveTo(proj1.px, proj1.py);
        ctx.lineTo(proj2.px, proj2.py);
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      };

      const draw3DText = (
        textVal: string,
        pt: Vec3,
        color: string,
        fontSize: number
      ) => {
        let v = rotateZ(pt, wobbleZ);
        v = rotateY(v, wobbleY);
        v = rotateX(v, wobbleX);
        const { px, py, sc } = project(v, cx, cy, FL);
        if (!valid(px, py)) return;

        ctx.fillStyle = color;
        ctx.font = `${Math.max(4, fontSize * sc)}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(textVal, px, py);
      };

      /* ─── clear ─────────────────────────────────────────────────────────── */
      ctx.clearRect(0, 0, W, H);

      /* ─── Jarvis-style sparse hex grid (very dim) ─────────────────────── */
      ctx.globalCompositeOperation = "screen";
      const hexSize = Math.max(W, H) * 0.07;
      const hexAlpha = 0.012 + intensity * 0.014;
      if (hexAlpha > 0.005) {
        const cols = Math.ceil(W / (hexSize * 1.7)) + 2;
        const rows = Math.ceil(H / (hexSize * 1.5)) + 2;
        ctx.strokeStyle = `rgba(${r},${g},${b},${hexAlpha})`;
        ctx.lineWidth = 0.5;
        for (let row = -1; row < rows; row++) {
          for (let col = -1; col < cols; col++) {
            const hx = col * hexSize * 1.732 + (row % 2) * hexSize * 0.866;
            const hy = row * hexSize * 1.5;
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
              const a = (Math.PI / 3) * i - Math.PI / 6;
              const px = hx + hexSize * 0.92 * Math.cos(a);
              const py = hy + hexSize * 0.92 * Math.sin(a);
              if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.stroke();
          }
        }
      }

      /* ─── Data streams (Jarvis falling code rain style) ──────────────────── */
      const streamAlpha = 0.06 + intensity * 0.08;
      if (streamAlpha > 0.01) {
        for (const s of streams) {
          s.x += s.vx * 0.4;
          s.y += s.vy * s.speed;
          if (s.y > H + s.len) { s.y = -s.len; s.x = Math.random() * W; }
          if (s.x < 0) s.x = W; if (s.x > W) s.x = 0;
          const sg = ctx.createLinearGradient(s.x, s.y, s.x + s.vx * s.len, s.y + s.vy * s.len);
          const sa = s.alpha * streamAlpha / 0.08;
          sg.addColorStop(0, `rgba(${r},${g},${b},0)`);
          sg.addColorStop(0.6, `rgba(${r},${g},${b},${sa})`);
          sg.addColorStop(1, `rgba(${r},${g},${b},${sa * 0.3})`);
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(s.x + s.vx * s.len * 0.5, s.y + s.vy * s.len * 0.5);
          ctx.strokeStyle = sg;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }

      /* ─── nebula cloud (background haze) ─────────────────────────────────── */
      for (const n of nebula) {
        const twinkle = 0.85 + Math.sin(time * 1.4 + n.phase) * 0.15;
        const v = rotateX(rotateY({ x: n.x, y: n.y, z: n.z }, globalRotY * 0.5), 0.3);
        const { px, py, sc } = project(v, cx, cy, FL);
        const a = n.alpha * twinkle * (0.25 + intensity * 0.22);
        safeArc(ctx, px, py, Math.max(0.1, n.sz * sc), 0, Math.PI * 2, `rgba(${r},${g},${b},${a})`);
      }

      /* ─── Crosshair targeting reticle (active state) ─────────────────────── */
      if (intensity > 0.2) {
        const crossA = (intensity - 0.2) * 0.08;
        const crossR = BASE_R * 0.14 * (1 + Math.sin(time * 2.5) * 0.05);
        const crossColor = `rgba(${r},${g},${b},${crossA})`;
        
        // Four arc corners in 3D
        for (let i = 0; i < 4; i++) {
          const ca = (Math.PI / 2) * i;
          const segments = [{ start: ca + 0.2, end: ca + Math.PI / 2 - 0.2 }];
          draw3DCircle(crossR, crossColor, 0.7, segments);
        }
        
        // Crosshair lines in 3D
        const pLeft: Vec3 = { x: -crossR * 0.35, y: 0, z: 0 };
        const pRight: Vec3 = { x: crossR * 0.35, y: 0, z: 0 };
        const pTop: Vec3 = { x: 0, y: -crossR * 0.35, z: 0 };
        const pBottom: Vec3 = { x: 0, y: crossR * 0.35, z: 0 };
        
        draw3DLine(pLeft, pRight, crossColor, 0.7);
        draw3DLine(pTop, pBottom, crossColor, 0.7);
      }

      /* ─── central core glow ──────────────────────────────────────────────── */

      // Keep outer ambient fog for depth
      ctx.fillStyle = `rgba(${r},${g},${b},${(visualIntensity * 0.035).toFixed(4)})`;
      ctx.beginPath();
      ctx.arc(cx, cy, BASE_R * (0.52 + intensity * 0.28), 0, Math.PI * 2);
      ctx.fill();

      // ─── 3D Rotating Hacking Disk Animation (Replaces Simple Dot/Sphere Nucleus) ───
      const BASE_SIZE = BASE_R * 0.38;

      // 1. Outer Jittering Ticks Ring (f2 equivalent)
      const numTicks = 36;
      const tickRot = time * 0.45;
      for (let i = 0; i < numTicks; i++) {
        const t = (i / numTicks) * Math.PI * 2 + tickRot;
        const isMajor = i % 3 === 0;
        const len = isMajor ? BASE_SIZE * 0.05 : BASE_SIZE * 0.025;
        const p1: Vec3 = { x: Math.cos(t) * (BASE_SIZE * 0.55 - len), y: Math.sin(t) * (BASE_SIZE * 0.55 - len), z: 0 };
        const p2: Vec3 = { x: Math.cos(t) * (BASE_SIZE * 0.55), y: Math.sin(t) * (BASE_SIZE * 0.55), z: 0 };
        draw3DLine(p1, p2, `rgba(${r},${g},${b},${0.25 * visualIntensity})`, isMajor ? 1.5 : 1);
      }

      // 2. Dotted Inner Ticks (f1 equivalent)
      const numMajorTicks = 12;
      const jitterRot = time * 1.1 + Math.sin(time * 3.0) * 0.5;
      for (let i = 0; i < numMajorTicks; i++) {
        const t = (i / numMajorTicks) * Math.PI * 2 + jitterRot;
        const p1: Vec3 = { x: Math.cos(t) * (BASE_SIZE * 0.50 - BASE_SIZE * 0.06), y: Math.sin(t) * (BASE_SIZE * 0.50 - BASE_SIZE * 0.06), z: 0 };
        const p2: Vec3 = { x: Math.cos(t) * (BASE_SIZE * 0.50), y: Math.sin(t) * (BASE_SIZE * 0.50), z: 0 };
        draw3DLine(p1, p2, `rgba(${r},${g},${b},${0.45 * visualIntensity})`, 2);
      }

      // 3. Thick Segmented Blue Ring (f3 equivalent)
      const f3Segments = [
        { start: 0.1, end: Math.PI / 2 - 0.1 },
        { start: Math.PI / 2 + 0.1, end: Math.PI - 0.1 },
        { start: Math.PI + 0.1, end: 3 * Math.PI / 2 - 0.1 },
        { start: 3 * Math.PI / 2 + 0.1, end: 2 * Math.PI - 0.1 }
      ];
      draw3DCircle(BASE_SIZE * 0.40, `rgba(${r},${g},${b},${0.35 * visualIntensity})`, 6, f3Segments, time * -0.95);

      // 4. Thin Segmented Ring (f4 equivalent)
      const f4Segments = [
        { start: 0.2, end: Math.PI / 2 - 0.2 },
        { start: Math.PI / 2 + 0.2, end: Math.PI - 0.2 },
        { start: Math.PI + 0.2, end: 3 * Math.PI / 2 - 0.2 },
        { start: 3 * Math.PI / 2 + 0.2, end: 2 * Math.PI - 0.2 }
      ];
      draw3DCircle(BASE_SIZE * 0.32, `rgba(${r},${g},${b},${0.65 * visualIntensity})`, 1.5, f4Segments, time * 1.35);

      // 5. Rotating Numbers Ring (f5 equivalent)
      const numCount = 12;
      const numRot = time * -0.55;
      for (let i = 0; i < numCount; i++) {
        const t = (i / numCount) * Math.PI * 2 + numRot;
        const pt: Vec3 = { x: Math.cos(t) * (BASE_SIZE * 0.24), y: Math.sin(t) * (BASE_SIZE * 0.24), z: 0 };
        const val = Math.floor(((time * 2 + i) % 1) * 99).toString();
        draw3DText(val, pt, `rgba(${r},${g},${b},${0.4 * visualIntensity})`, 7);
      }

      // 6. Inner Thin Circles (f6 equivalent)
      draw3DCircle(BASE_SIZE * 0.16, `rgba(${r},${g},${b},${0.45 * visualIntensity})`, 1);
      draw3DCircle(BASE_SIZE * 0.13, `rgba(${r},${g},${b},${0.25 * visualIntensity})`, 1);

      // 7. Rotating Thin Crosslines (f7 equivalent)
      const crossRot = time * 1.75;
      draw3DCircle(BASE_SIZE * 0.09, `rgba(${r},${g},${b},${0.5 * visualIntensity})`, 1.5);
      const pX1: Vec3 = { x: Math.cos(crossRot) * (BASE_SIZE * 0.14), y: Math.sin(crossRot) * (BASE_SIZE * 0.14), z: 0 };
      const pX2: Vec3 = { x: -Math.cos(crossRot) * (BASE_SIZE * 0.14), y: -Math.sin(crossRot) * (BASE_SIZE * 0.14), z: 0 };
      const pY1: Vec3 = { x: Math.cos(crossRot + Math.PI/2) * (BASE_SIZE * 0.14), y: Math.sin(crossRot + Math.PI/2) * (BASE_SIZE * 0.14), z: 0 };
      const pY2: Vec3 = { x: -Math.cos(crossRot + Math.PI/2) * (BASE_SIZE * 0.14), y: -Math.sin(crossRot + Math.PI/2) * (BASE_SIZE * 0.14), z: 0 };
      draw3DLine(pX1, pX2, `rgba(${r},${g},${b},${0.6 * visualIntensity})`, 1);
      draw3DLine(pY1, pY2, `rgba(${r},${g},${b},${0.6 * visualIntensity})`, 1);

      // 8. Thick Pill rotating Crossbars (f8 equivalent)
      const thickRot = time * -2.4;
      const p1a: Vec3 = { x: Math.cos(thickRot) * (BASE_SIZE * 0.05), y: Math.sin(thickRot) * (BASE_SIZE * 0.05), z: 0 };
      const p1b: Vec3 = { x: -Math.cos(thickRot) * (BASE_SIZE * 0.05), y: -Math.sin(thickRot) * (BASE_SIZE * 0.05), z: 0 };
      const p2a: Vec3 = { x: Math.cos(thickRot + Math.PI/2) * (BASE_SIZE * 0.05), y: Math.sin(thickRot + Math.PI/2) * (BASE_SIZE * 0.05), z: 0 };
      const p2b: Vec3 = { x: -Math.cos(thickRot + Math.PI/2) * (BASE_SIZE * 0.05), y: -Math.sin(thickRot + Math.PI/2) * (BASE_SIZE * 0.05), z: 0 };
      
      // Draw glow under the thick crossbars
      ctx.shadowColor = `rgba(${r},${g},${b},${(visualIntensity * 0.65).toFixed(4)})`;
      ctx.shadowBlur = 10;
      draw3DLine(p1a, p1b, `rgba(${r},${g},${b},${0.8 * visualIntensity})`, 5);
      draw3DLine(p2a, p2b, `rgba(${r},${g},${b},${0.8 * visualIntensity})`, 5);
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";

      // 9. Core dot (f9 equivalent)
      draw3DCircle(BASE_SIZE * 0.015, `rgba(${r},${g},${b},${0.9 * visualIntensity})`, 2);

      /* ─── rings + particles ──────────────────────────────────────────────── */
      for (let ri = 0; ri < RINGS.length; ri++) {
        const ring = RINGS[ri];

        // Ring spin — visible rotation, active states noticeably faster
        const spinSpeed = ring.speed * 0.85 * (1 + intensity * 2.5);
        const ringAngle = globalRotY * spinSpeed + ring.phase;

        // Tilt precession — visible axis wobble every ~30s
        const dynamicTiltX = ring.tiltX + Math.sin(time * 0.28 + ring.phase * 0.4) * 0.38;
        const dynamicTiltZ = ring.tiltZ + Math.cos(time * 0.20 + ring.phase * 0.6) * 0.22;

        const worldR = BASE_R * ring.radius;

        // Build sorted projected particles for this ring
        type P = { px: number; py: number; pz: number; alpha: number; size: number; isBright: boolean };
        const pts: P[] = [];

        for (let i = 0; i < ring.particleCount; i++) {
          const t = (i / ring.particleCount) * Math.PI * 2;
          const sp = ringParticles[ri][i];   // pre-computed scatter params

          // Particle on ring path
          const px0 = Math.cos(t) * worldR;
          const pz0 = Math.sin(t) * worldR;

          // Apply ring's own DYNAMIC tilt (axis precession)
          const tx1 = px0;
          const ty1 = -pz0 * Math.sin(dynamicTiltX);
          const tz1 =  pz0 * Math.cos(dynamicTiltX);

          // Fixed scatter (pre-computed, no flickering)
          const sc2 = worldR * ring.thickness;
          const fx = tx1 + sp.dx * sc2;
          const fy = ty1 + sp.dy * sc2;
          const fz = tz1 + sp.dz * sc2;

          // Global spin (ringAngle around Y) + dynamic Z tilt
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

        // Sort by depth
        pts.sort((a, c) => c.pz - a.pz);

        for (const p of pts) {
          // Core dot — screen blending already makes nearby particles self-illuminate,
          // so no per-particle gradient allocation needed (was the #1 lag source)
          safeArc(ctx, p.px, p.py, p.size, 0, Math.PI * 2, `rgba(${r},${g},${b},${p.alpha})`);
          // Bright stars only get a cheap shadowBlur halo instead of a new gradient
          if (p.isBright) {
            ctx.shadowColor = `rgba(${r},${g},${b},${(p.alpha * 0.5).toFixed(4)})`;
            ctx.shadowBlur = p.size * 4;
            safeArc(ctx, p.px, p.py, p.size, 0, Math.PI * 2, `rgba(${r},${g},${b},${p.alpha})`);
            ctx.shadowBlur = 0;
            ctx.shadowColor = "transparent";
          }
        }

        /* ── Draw the ring arc outline (visible light color ring structure) — uses dynamic tilts ── */
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

      /* ─── scanning beam (when active) ──────────────────────────────────────── */
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

        // Trailing fan (looks like a radar sweep)
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

      /* ─── HUD brackets (four corners, processing only) ─────────────────────── */
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

      /* ─── concentric pulsing rings (listening / speaking) ──────────────────── */
      if (vs === "listening" || vs === "speaking") {
        const waves = vs === "speaking" ? 4 : 3;
        for (let w = 0; w < waves; w++) {
          const progress = ((time * 0.6 + w / waves) % 1);
          const wR = progress * BASE_R * 1.6;
          const wA = (1 - progress) * 0.18 * intensity;
          safeArc(ctx, cx, cy, wR, 0, Math.PI * 2, `rgba(${r},${g},${b},${wA})`, 1.5);
        }
      }

      /* ─── energy vortex (processing) ───────────────────────────────────────── */
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
