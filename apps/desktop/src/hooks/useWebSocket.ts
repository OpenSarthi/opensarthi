import { useEffect, useRef, useState } from "react";
import { wsClient } from "../lib/ws";
import { useAssistantStore } from "../stores/assistantStore";
import { usePermissionStore } from "../stores/permissionStore";
import {
  PlanSchema,
  PermissionRequestSchema,
  MessageSchema,
} from "../lib/schemas";

/**
 * Initialises the WS connection to the Python runtime and
 * routes all incoming messages to the appropriate stores.
 */
export function useWebSocket(port: number | null) {
  const [isConnected, setIsConnected] = useState(false);
  const { setConnected, setTranscript, setVoiceState, addMessage, setPlan, updateStepStatus, setExecutingStep } =
    useAssistantStore();
  const { setPendingRequest } = usePermissionStore();
  const portRef = useRef<number | null>(null);

  useEffect(() => {
    if (!port || port === portRef.current) return;
    portRef.current = port;
    wsClient.connect(port);

    const unsubs = [
      wsClient.on("session_state", (msg) => {
        const payload = msg.payload as { connected?: boolean; active?: boolean };
        if (payload.connected !== undefined) {
          const connected = !!payload.connected;
          setIsConnected(connected);
          setConnected(connected);
          if (connected) setVoiceState("idle");
        }
      }),

      wsClient.on("transcript_update", (msg) => {
        const { text } = msg.payload as { text: string };
        const { voiceState, setVoiceState, setTranscript, wakeWords, wakeWordEnabled } = useAssistantStore.getState();

        if (voiceState === "idle" || voiceState === "error") {
          if (!wakeWordEnabled || !wakeWords || wakeWords.length === 0) return;

          const lowerText = text.toLowerCase();
          
          const escapedWakeWords = wakeWords.map((w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
          // Append common Whisper phonetic misspellings if the user is trying to use "sarthi"
          const hasSarthi = wakeWords.some((w: string) => w.toLowerCase().includes("sarthi") || w.toLowerCase().includes("sarathi"));
          if (hasSarthi) {
            escapedWakeWords.push("sanati", "farati", "sarath", "sarth", "sorthi", "sorathi", "sorth", "sharthi", "sharathi", "sharth", "sarty", "sarathy", "sarti");
          }

          const wakeWordRegex = new RegExp(`(?:${escapedWakeWords.join('|')})`, 'i');
          const hasWakeWord = wakeWordRegex.test(lowerText);
          
          if (hasWakeWord) {
            // Play a simple beep natively in browser for "Google Assistant" style feedback
            const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(600, audioCtx.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.1);
            gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            oscillator.start();
            oscillator.stop(audioCtx.currentTime + 0.2);
            
            const cleanText = text
              // Remove the wake word and any prefix like "hey", "hello", "hi" before it
              .replace(new RegExp(`(?:hey|hello|hi|he)?\\s*(?:${escapedWakeWords.join('|')})`, 'gi'), "")
              .replace(/hey!/gi, "")
              // Clean up leading/trailing punctuation and whitespace artifacts
              .replace(/^[\s,;:.!?]+/, "")  // strip leading commas, spaces, punctuation
              .replace(/[\s,;:.!?]+$/, "")  // strip trailing commas, spaces, punctuation
              .trim();
            
            setVoiceState("listening");
            setTranscript(cleanText);
          }
        } else if (voiceState === "listening") {
          setTranscript(text);
        }
      }),

      wsClient.on("plan_created", (msg) => {
        const plan = PlanSchema.parse(msg.payload);
        setPlan(plan);
        setVoiceState("processing");
      }),

      wsClient.on("tool_action", (msg) => {
        const { tool, description, status, result } = msg.payload as any;
        useAssistantStore.getState().addOrUpdateToolAction(tool, description, status, result);
        setVoiceState("processing");
      }),

      wsClient.on("tool_started", (msg) => {
        const { index } = msg.payload as { index: number };
        setExecutingStep(index);
        updateStepStatus(index, { status: "running" });
      }),

      wsClient.on("tool_completed", (msg) => {
        const { index, result } = msg.payload as { index: number; result: unknown };
        updateStepStatus(index, { status: "success", result });
      }),

      wsClient.on("tool_error", (msg) => {
        const { index, error } = msg.payload as { index: number; error: string };
        updateStepStatus(index, { status: "error", error });
      }),

      wsClient.on("assistant_response", (msg) => {
        const message = MessageSchema.parse(msg.payload);
        addMessage(message);
        setTranscript(null);
        
        // Extract and store token usage if present
        const usage = (msg.payload as any).usage;
        if (usage) {
          useAssistantStore.getState().updateTokenUsage(usage);
        }
        
        const isVoice = (msg.payload as any).is_voice;
        
        if (isVoice) {
          setVoiceState("speaking");
        } else {
          setVoiceState("idle");
        }
        
        setPlan(null);
        setExecutingStep(null);
      }),

      wsClient.on("speech_started", () => {
        setVoiceState("speaking");
      }),

      wsClient.on("speech_completed", () => {
        const { continuousListening } = useAssistantStore.getState();
        if (continuousListening) {
          setVoiceState("listening");
        } else {
          setVoiceState("idle");
        }
      }),

      wsClient.on("voice_state", (msg) => {
        const { state } = msg.payload as { state: any };
        if (state) {
          setVoiceState(state);
          if (state === "listening") {
            const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(600, audioCtx.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.1);
            gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            oscillator.start();
            oscillator.stop(audioCtx.currentTime + 0.2);
            setTranscript(null);
          }
        }
      }),

      wsClient.on("settings_sync", (msg) => {
        const p = msg.payload as any;
        const store = useAssistantStore.getState();

        if (p.local_model && p.cloud_model) store.setActiveModels(p.local_model, p.cloud_model);
        if (p.ai_provider) store.setActiveProvider(p.ai_provider);
        if (p.voice_accent !== undefined && p.voice_speed !== undefined && p.continuous_listening !== undefined) {
          store.setVoiceSettings(p.voice_accent, p.voice_speed, p.continuous_listening);
        }
        if (p.wake_words !== undefined && p.wake_word_enabled !== undefined && p.wake_word_threshold !== undefined) {
          store.setWakeWordSettings(p.wake_word_enabled, p.wake_word_threshold, p.wake_words);
        }
        if (p.active_theme) store.setActiveTheme(p.active_theme);
        
        // Sync all per-provider API keys (masked indicator only — show saved/not-saved in UI)
        store.setAllApiKeys({
          gemini: p.gemini_api_key || "",
          openai: p.openai_api_key || "",
          anthropic: p.anthropic_api_key || "",
          groq: p.groq_api_key || "",
          openrouter: p.openrouter_api_key || "",
        });
      }),

      wsClient.on("history_response", (msg) => {
        const { threads } = msg.payload as any;
        useAssistantStore.getState().setThreads(threads);
      }),

      wsClient.on("thread_loaded", (msg) => {
        const { messages } = msg.payload as any;
        useAssistantStore.getState().setMessages(messages);
        setPlan(null);
        setExecutingStep(null);
      }),

      wsClient.on("permission_request", (msg) => {
        const req = PermissionRequestSchema.parse(msg.payload);
        setPendingRequest(req);
      }),

      wsClient.on("input_request", (msg) => {
        const { prompt, input_type } = msg.payload as any;
        usePermissionStore.getState().setPendingInputRequest({ prompt, input_type });
      }),

      wsClient.on("error", (msg) => {
        console.error("[Runtime error]", msg.payload);
        setVoiceState("error");
      }),
    ];

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [port]);

  return { isConnected };
}
