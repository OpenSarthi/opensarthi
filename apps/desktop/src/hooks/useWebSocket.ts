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
        const { voiceState, setVoiceState, setTranscript } = useAssistantStore.getState();

        if (voiceState === "idle" || voiceState === "error") {
          const lowerText = text.toLowerCase();
          const wakeWordRegex = /(?:sarathi|sarthi|sarath|sarth|sorthi|sorathi|sorth|sharthi|sharathi|sharth|sarty|sarathy|sarti)/i;
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
              .replace(/(?:hey|hello|hi|he)?\s*(?:sarathi|sarthi|sarath|sarth|sorthi|sorathi|sorth|sharthi|sharathi|sharth|sarty|sarathy|sarti)/gi, "")
              .replace(/hey!/gi, "")
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
        setVoiceState("idle");
        setPlan(null);
        setExecutingStep(null);
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
