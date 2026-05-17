import { useEffect, useRef, useState } from "react";
import { wsClient } from "../lib/ws";
import { useAssistantStore } from "../stores/assistantStore";
import { usePermissionStore } from "../stores/permissionStore";
import {
  PlanSchema,
  PlanStepSchema,
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
        const connected = !!(msg.payload as { connected?: boolean })?.connected;
        setIsConnected(connected);
        setConnected(connected);
        if (connected) setVoiceState("idle");
      }),

      wsClient.on("transcript_update", (msg) => {
        const { text } = msg.payload as { text: string };
        setTranscript(text);
        setVoiceState("listening");
      }),

      wsClient.on("plan_created", (msg) => {
        const plan = PlanSchema.parse(msg.payload);
        setPlan(plan);
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
