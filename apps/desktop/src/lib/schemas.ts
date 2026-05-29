import { z } from "zod";

// ─── WebSocket Message Types ──────────────────────────────────────────────────

export const WSMessageTypeSchema = z.enum([
  "user_message",
  "transcript_update",
  "plan_created",
  "tool_started",
  "tool_completed",
  "tool_error",
  "tool_action",
  "observation",
  "assistant_response",
  "history_response",
  "thread_loaded",
  "permission_request",
  "permission_response",
  "session_state",
  "error",
  "update_settings",
  "get_history",
  "load_thread",
  "new_chat",
  "speak_text",
  "speech_started",
  "speech_completed",
  "settings_sync",
  "voice_state",
  "stop_speech",
  "input_request",
  "input_response",
  "delete_thread",
  "delete_all_threads",
  "cancel_execution",
  "pause_execution",
  "resume_execution",
  "task_paused",
  "task_resumed",
  "tool_terminated",
  "run_json_plan",
]);
export type WSMessageType = z.infer<typeof WSMessageTypeSchema>;

export const WSMessageSchema = z.object({
  id: z.string().uuid(),
  type: WSMessageTypeSchema,
  payload: z.unknown(),
  timestamp: z.number(),
});
export type WSMessage = z.infer<typeof WSMessageSchema>;

// ─── Plan ─────────────────────────────────────────────────────────────────────

export const PlanStepSchema = z.object({
  index: z.number(),
  tool: z.string(),
  args: z.record(z.unknown()),
  description: z.string(),
  status: z.enum(["pending", "running", "success", "error", "skipped", "terminated"]),
  error: z.string().optional(),
  result: z.unknown().optional(),
  timestamp: z.number().optional(),
});
export type PlanStep = z.infer<typeof PlanStepSchema>;

export const PlanSchema = z.object({
  id: z.string().uuid(),
  goal: z.string(),
  steps: z.array(PlanStepSchema),
  recovery_hint: z.string().nullable(),
});
export type Plan = z.infer<typeof PlanSchema>;

// ─── Messages ─────────────────────────────────────────────────────────────────

export const MessageRoleSchema = z.enum(["user", "assistant", "system"]);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const MessageSchema = z.object({
  id: z.string().uuid(),
  role: MessageRoleSchema,
  content: z.string(),
  timestamp: z.number(),
  plan: PlanSchema.optional(),
});
export type Message = z.infer<typeof MessageSchema>;

// ─── Permission ───────────────────────────────────────────────────────────────

export const RiskLevelSchema = z.enum(["safe", "moderate", "dangerous", "forbidden"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const PermissionRequestSchema = z.object({
  request_id: z.string().uuid(),
  tool: z.string(),
  args: z.record(z.unknown()),
  risk_level: RiskLevelSchema,
  description: z.string(),
  timeout_seconds: z.number().default(30),
});
export type PermissionRequest = z.infer<typeof PermissionRequestSchema>;

// ─── Session State ────────────────────────────────────────────────────────────

export const VoiceStateSchema = z.enum([
  "idle",
  "listening",
  "processing",
  "speaking",
  "error",
]);
export type VoiceState = z.infer<typeof VoiceStateSchema>;

// ─── Settings ─────────────────────────────────────────────────────────────────

export const SettingsSchema = z.object({
  wakeWords: z.array(z.string()).default(["hey sarthi", "hello sarthi"]),
  localModel: z.string().default("qwen2.5:3b"),
  cloudModel: z.string().default("deepseek/deepseek-chat"),
  openRouterKey: z.string().default(""),
  ttsVoice: z.string().default("af_heart"),
  sttModel: z.string().default("large-v3-turbo"),
  permissionTimeout: z.number().default(30),
  autoStart: z.boolean().default(false),
  showTray: z.boolean().default(true),
});
export type Settings = z.infer<typeof SettingsSchema>;
