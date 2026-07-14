import { useEffect, useRef, useState } from "react";
import { wsClient } from "../lib/ws";
import { useAssistantStore } from "../stores/assistantStore";
import { usePermissionStore } from "../stores/permissionStore";
import { playCue } from "./useAudioCues";
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
  const { setConnected, setTranscript, setVoiceState, addMessage, setPlan, updateStepStatus, setExecutingStep, onboardingCompleted } =
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
          if (connected) {
            setVoiceState("idle");
            // Load or initialize the active thread on the backend!
            const activeId = useAssistantStore.getState().activeThreadId;
            if (activeId) {
              wsClient.send("load_thread", { thread_id: activeId });
            }
          }
        }
      }),

      wsClient.on("transcript_update", (msg) => {
        const { text } = msg.payload as { text: string };
        const { voiceState, setVoiceState, setTranscript, wakeWords, wakeWordEnabled } = useAssistantStore.getState();

        if (voiceState === "idle" || voiceState === "error") {
          if (!wakeWordEnabled || !wakeWords || wakeWords.length === 0) return;

          const lowerText = text.toLowerCase();
          
          const escapedWakeWords = wakeWords.map((w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
          const hasSarthi = wakeWords.some((w: string) => w.toLowerCase().includes("sarthi") || w.toLowerCase().includes("sarathi"));
          if (hasSarthi) {
            escapedWakeWords.push("sanati", "farati", "sarath", "sarth", "sorthi", "sorathi", "sorth", "sharthi", "sharathi", "sharth", "sarty", "sarathy", "sarti", "sarathi", "sarthii", "sarathii");
          }

          // Sort by length descending to match longer phrases first and prevent partial word shadowing
          escapedWakeWords.sort((a: string, b: string) => b.length - a.length);

          // Wake word must appear with optional prefix (hey/hello/hi) and as a whole word (boundary check)
          const wakeWordPattern = escapedWakeWords.join('|');
          const wakeWordRegex = new RegExp(`(?:^|\\s)(?:hey|hello|hi)?\\s*(?:${wakeWordPattern})(?:\\s|$|[,;:.!?])`, 'i');
          const hasWakeWord = wakeWordRegex.test(lowerText);
          
          if (hasWakeWord) {
            // Wake word beep — ascending up-glide
            playCue("wake");
            
            // Strip everything up to and including the full wake phrase (prefix + wake word)
            const wakeWordRegexFull = new RegExp(`^(?:.*?)(?:hey|hello|hi)?\\s*(?:${wakeWordPattern})`, 'i');
            const cleanText = text
              .replace(wakeWordRegexFull, "")
              .replace(/^[\s,;:.!?]+/, "")
              .replace(/[\s,;:.!?]+$/, "")
              .trim();
            
            setVoiceState("listening");
            setTranscript(cleanText);
          }
        } else if (voiceState === "listening") {
          const currentTranscript = useAssistantStore.getState().currentTranscript;
          const newTranscript = currentTranscript ? `${currentTranscript} ${text}`.trim() : text;
          setTranscript(newTranscript);
        }
      }),

      wsClient.on("plan_created", (msg) => {
        const { thread_id } = msg.payload as { thread_id?: string };
        const plan = PlanSchema.parse(msg.payload);
        const store = useAssistantStore.getState();
        store.setUserOverrodeMinimize(false);
        setPlan(plan, thread_id);
        setVoiceState("processing");
        playCue("processing");
      }),

      wsClient.on("tool_action", (msg) => {
        const { tool, description, status, result, thread_id } = msg.payload as any;
        useAssistantStore.getState().addOrUpdateToolAction(tool, description, status, result, thread_id);
        setVoiceState("processing");
      }),

      wsClient.on("tool_started", (msg) => {
        const { index, thread_id, tool, description, args } = msg.payload as any;
        if (tool === "shell") {
          useAssistantStore.getState().clearShellOutput();
        }
        setExecutingStep(index, thread_id);
        updateStepStatus(index, { 
          status: "running", 
          timestamp: Date.now(),
          ...(tool && { tool }),
          ...(description && { description }),
          ...(args && { args }),
        }, thread_id);
      }),

      wsClient.on("tool_completed", (msg) => {
        const { index, result, thread_id, tool, description, args } = msg.payload as any;
        updateStepStatus(index, { 
          status: "success", 
          result, 
          timestamp: Date.now(),
          ...(tool && { tool }),
          ...(description && { description }),
          ...(args && { args }),
        }, thread_id);
      }),

      wsClient.on("tool_error", (msg) => {
        const { index, error, thread_id, tool, description, args } = msg.payload as any;
        updateStepStatus(index, { 
          status: "error", 
          error, 
          timestamp: Date.now(),
          ...(tool && { tool }),
          ...(description && { description }),
          ...(args && { args }),
        }, thread_id);
      }),

      wsClient.on("tool_terminated", (msg) => {
        const { index, thread_id } = msg.payload as { index: number; thread_id?: string };
        updateStepStatus(index, { status: "terminated", timestamp: Date.now() }, thread_id);
      }),

      wsClient.on("assistant_response", (msg) => {
        const message = MessageSchema.parse(msg.payload);
        const { thread_id } = msg.payload as { thread_id?: string };
        addMessage(message, thread_id);
        setTranscript(null);
        
        const usage = (msg.payload as any).usage;
        if (usage) {
          useAssistantStore.getState().updateTokenUsage(usage, thread_id);
        }
        
        const isVoice = (msg.payload as any).is_voice;
        
        if (isVoice) {
          setVoiceState("speaking");
        } else {
          setVoiceState("idle");
          playCue("response_ready");
        }
        
        setPlan(null, thread_id);
        setExecutingStep(null, thread_id);
      }),

      wsClient.on("speech_started", () => {
        setVoiceState("speaking");
        playCue("speech_start");
      }),

      wsClient.on("speech_completed", (msg) => {
        const wasManual = (msg?.payload as any)?.was_manual === true;
        if (wasManual) {
          setVoiceState("idle");
          return;
        }
        const { continuousListening } = useAssistantStore.getState();
        if (continuousListening) {
          setVoiceState("listening");
          setTranscript(null);
        } else {
          setVoiceState("idle");
          playCue("speech_end");
        }
      }),

      wsClient.on("voice_state", (msg) => {
        const { state } = msg.payload as { state: any };
        if (state) {
          const prev = useAssistantStore.getState().voiceState;
          setVoiceState(state);
          if (state === "listening") {
            // Mic just opened — play listen_start cue
            playCue("listen_start");
            setTranscript(null);
          } else if (state === "idle" && prev === "listening") {
            // Mic closed — play listen_stop cue
            playCue("listen_stop");
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

        store.setAllApiKeys({
          gemini: p.gemini_api_key || "",
          openai: p.openai_api_key || "",
          anthropic: p.anthropic_api_key || "",
          groq: p.groq_api_key || "",
          openrouter: p.openrouter_api_key || "",
        });

        if (p.user_name !== undefined || p.user_skills !== undefined || p.custom_prompt !== undefined) {
          store.setPersonalization(
            p.user_name || store.userName,
            p.user_skills || store.userSkills,
            p.custom_prompt || store.customPrompt,
          );
        }
      }),

      wsClient.on("history_response", (msg) => {
        const { threads } = msg.payload as any;
        useAssistantStore.getState().setThreads(threads);
      }),

      wsClient.on("thread_loaded", (msg) => {
        const { thread_id, messages, token_totals } = msg.payload as any;
        const store = useAssistantStore.getState();
        store.loadThreadToTab(thread_id, messages, token_totals);
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
        playCue("error");
      }),

      wsClient.on("task_paused", (msg) => {
        const { thread_id } = msg.payload as { thread_id?: string };
        useAssistantStore.getState().setTaskPaused(true, thread_id);
      }),

      wsClient.on("task_resumed", (msg) => {
        const { thread_id } = msg.payload as { thread_id?: string };
        useAssistantStore.getState().setTaskPaused(false, thread_id);
      }),

      wsClient.on("shell_output", (msg) => {
        const { line } = msg.payload as { line: string; command: string };
        useAssistantStore.getState().appendShellOutputLine(line);
      }),

      wsClient.on("intent_classified", (msg) => {
        const { classification } = msg.payload as { classification: string };
        useAssistantStore.getState().setLastClassification(classification);
      }),

      wsClient.on("token_update", (msg) => {
        const { thread_id, request_tokens, response_tokens, total_tokens, delta_total_tokens } = msg.payload as any;
        useAssistantStore.getState().updateTokenUsageFromWS(thread_id, {
          request_tokens,
          response_tokens,
          total_tokens,
          delta_total_tokens,
        });
      }),

      // Smart minimize: AI signals that screen access is needed, auto-minimize if user hasn't overridden
      wsClient.on("window_control", (msg) => {
        const { action } = msg.payload as { action: string; reason?: string };
        const store = useAssistantStore.getState();
        if (action === "minimize_hint") {
          // Only auto-minimize if the user hasn't manually set their preference this task
          if (!store.isOverlayMode && !store.userOverrodeMinimize) {
            store.setOverlayMode(true);
          }
        } else if (action === "restore_hint") {
          // Optionally restore when non-screen tasks start if user hasn't manually set overlay preference
          if (store.isOverlayMode && !store.userOverrodeMinimize) {
            store.setOverlayMode(false);
          }
        }
      }),

      // Streaming text response chunks — route to dedicated streamingResponse state, NOT voice transcript
      wsClient.on("stream_chunk", (msg) => {
        const { chunk, thread_id } = msg.payload as { chunk: string; thread_id?: string };
        const store = useAssistantStore.getState();
        const tid = thread_id || store.activeThreadId;
        // Append chunk to streaming response buffer only
        store.appendStreamChunk(chunk);
        // Also maintain per-tab buffer for stream_end finalization
        if (!(store as any)._streamBuffer) (store as any)._streamBuffer = {};
        (store as any)._streamBuffer[tid] = ((store as any)._streamBuffer[tid] || "") + chunk;
      }),

      wsClient.on("stream_end", (msg) => {
        const { thread_id } = msg.payload as { thread_id?: string };
        const store = useAssistantStore.getState();
        const tid = thread_id || store.activeThreadId;
        // Clear the streaming buffer and the live streaming response bubble
        if ((store as any)._streamBuffer) {
          delete (store as any)._streamBuffer[tid];
        }
        store.clearStreamingResponse();
      }),
    ];

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [port]);

  useEffect(() => {
    if (isConnected) {
      wsClient.send("client_state", { page: onboardingCompleted ? "assistant" : "onboarding" });
    }
  }, [isConnected, onboardingCompleted]);

  return { isConnected };
}
