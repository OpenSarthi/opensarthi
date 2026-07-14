/**
 * useAudioCues — Centralized Web Audio API sound cues for OpenSarthi
 *
 * All sounds are synthesized entirely in the browser using oscillators + gain envelopes.
 * No audio files are needed. Sounds respect the user's soundEnabled and soundVolume settings.
 */

import { useAssistantStore } from "../stores/assistantStore";

// Shared AudioContext (lazily created, reused across all cues)
let _ctx: AudioContext | null = null;
function getCtx(): AudioContext {
  if (!_ctx || _ctx.state === "closed") {
    _ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return _ctx;
}

// ── Sound design helpers ──────────────────────────────────────────────────────

type OscType = "sine" | "square" | "sawtooth" | "triangle";

interface ToneSegment {
  freqStart: number;
  freqEnd: number;
  duration: number;
  type?: OscType;
  /** Gain at start (0-1), default 0.15 */
  gainStart?: number;
  /** Gain at end (0-1), default 0.001 */
  gainEnd?: number;
  /** Delay before this segment starts (in seconds from note start) */
  startOffset?: number;
}

function playSegments(segments: ToneSegment[], masterGain: number) {
  const ctx = getCtx();
  if (ctx.state === "suspended") ctx.resume();

  segments.forEach((seg) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const t0 = ctx.currentTime + (seg.startOffset ?? 0);
    const t1 = t0 + seg.duration;

    osc.type = seg.type ?? "sine";
    osc.frequency.setValueAtTime(seg.freqStart, t0);
    if (seg.freqStart !== seg.freqEnd) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(seg.freqEnd, 1), t1);
    }

    const gs = (seg.gainStart ?? 0.15) * masterGain;
    const ge = (seg.gainEnd ?? 0.001) * masterGain;
    gain.gain.setValueAtTime(gs, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(ge, 0.0001), t1);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t1 + 0.01);
  });
}

// ── Cue definitions ──────────────────────────────────────────────────────────

type CueName =
  | "wake"
  | "listen_start"
  | "listen_stop"
  | "processing"
  | "response_ready"
  | "speech_start"
  | "speech_end"
  | "error"
  | "task_done";

const CUE_DESIGNS: Record<CueName, () => ToneSegment[]> = {
  /** Wake word detected — ascending up-glide, bright and attention-grabbing */
  wake: () => [
    { freqStart: 480, freqEnd: 800, duration: 0.18, gainStart: 0.12, gainEnd: 0.001 },
    { freqStart: 800, freqEnd: 960, duration: 0.14, gainStart: 0.08, gainEnd: 0.001, startOffset: 0.2 },
  ],

  /** Mic opens — soft double-ping, "ready and listening" */
  listen_start: () => [
    { freqStart: 680, freqEnd: 720, duration: 0.12, gainStart: 0.1, gainEnd: 0.001 },
    { freqStart: 880, freqEnd: 920, duration: 0.1,  gainStart: 0.08, gainEnd: 0.001, startOffset: 0.15 },
  ],

  /** Mic closes — gentle down-glide, "done listening" */
  listen_stop: () => [
    { freqStart: 620, freqEnd: 380, duration: 0.18, gainStart: 0.09, gainEnd: 0.001 },
  ],

  /** Query sent / processing started — short neutral click, subtle */
  processing: () => [
    { freqStart: 440, freqEnd: 440, duration: 0.07, type: "triangle", gainStart: 0.07, gainEnd: 0.001 },
  ],

  /** Text response ready (non-voice) — warm chime, "answer is here" */
  response_ready: () => [
    { freqStart: 820, freqEnd: 1080, duration: 0.25, gainStart: 0.12, gainEnd: 0.001 },
    { freqStart: 1080, freqEnd: 1080, duration: 0.15, gainStart: 0.06, gainEnd: 0.001, startOffset: 0.28 },
  ],

  /** TTS begins speaking — short warm single tone */
  speech_start: () => [
    { freqStart: 560, freqEnd: 590, duration: 0.13, gainStart: 0.09, gainEnd: 0.001 },
  ],

  /** TTS finished speaking — falling, gentle sign-off */
  speech_end: () => [
    { freqStart: 540, freqEnd: 360, duration: 0.22, gainStart: 0.09, gainEnd: 0.001 },
  ],

  /** Error state — two-tone descending alarm */
  error: () => [
    { freqStart: 340, freqEnd: 240, duration: 0.22, type: "sawtooth", gainStart: 0.1, gainEnd: 0.005 },
    { freqStart: 240, freqEnd: 180, duration: 0.18, type: "sawtooth", gainStart: 0.07, gainEnd: 0.001, startOffset: 0.25 },
  ],

  /** Task completed — three-note ascending chime (C5 → E5 → G5) */
  task_done: () => [
    { freqStart: 523, freqEnd: 523, duration: 0.14, gainStart: 0.13, gainEnd: 0.001 },
    { freqStart: 659, freqEnd: 659, duration: 0.14, gainStart: 0.13, gainEnd: 0.001, startOffset: 0.17 },
    { freqStart: 784, freqEnd: 784, duration: 0.22, gainStart: 0.13, gainEnd: 0.001, startOffset: 0.34 },
  ],
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Play a named audio cue.
 * Reads soundEnabled and soundVolume from the store — can be called from anywhere
 * (hooks, WebSocket handlers, etc.) without React context.
 */
export function playCue(name: CueName): void {
  try {
    const { soundEnabled, soundVolume } = useAssistantStore.getState();
    if (!soundEnabled) return;

    const masterGain = Math.max(0, Math.min(1, (soundVolume ?? 60) / 100));
    const segments = CUE_DESIGNS[name]?.();
    if (!segments) return;

    playSegments(segments, masterGain);
  } catch (err) {
    // Audio is non-critical — never throw
    console.warn("[AudioCues] Failed to play cue:", name, err);
  }
}

/**
 * React hook that returns the playCue function (same as the standalone export).
 * Use this in React components; use the standalone export in non-React contexts.
 */
export function useAudioCues() {
  return { playCue };
}
