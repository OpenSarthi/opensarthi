/**
 * OpenSarthi — Shared AI Model Registry
 *
 * Single source of truth for all AI provider model definitions.
 * Used by SettingsView, OnboardingView, and the AssistantOverlay HUD.
 *
 * Capability Tags:
 *   ⚡ fast        🧠 reasoning   💻 coding
 *   🛠 tools       👁 vision      💰 budget    🦙 local
 */

export interface ModelEntry {
  value: string;         // API model ID passed to the backend
  label: string;         // Human-readable display name
  tags?: string[];       // Capability tags for UI hints
  note?: string;         // Optional short note (e.g. "best default")
}

export interface ProviderMeta {
  label: string;
  icon: string;
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  docsUrl: string;
  supportsModelFetch: boolean;  // Whether live model discovery is supported
}

// ─── Provider metadata ───────────────────────────────────────────────────────

export const PROVIDER_LABELS: Record<string, ProviderMeta> = {
  ollama: {
    label: "Ollama (Local)",
    icon: "🦙",
    apiKeyLabel: "",
    apiKeyPlaceholder: "",
    docsUrl: "https://ollama.ai",
    supportsModelFetch: true,
  },
  google: {
    label: "Google Gemini",
    icon: "✨",
    apiKeyLabel: "GOOGLE AI API KEY",
    apiKeyPlaceholder: "AIza...",
    docsUrl: "https://aistudio.google.com/apikey",
    supportsModelFetch: false,
  },
  openai: {
    label: "OpenAI",
    icon: "🤖",
    apiKeyLabel: "OPENAI API KEY",
    apiKeyPlaceholder: "sk-...",
    docsUrl: "https://platform.openai.com/api-keys",
    supportsModelFetch: true,
  },
  anthropic: {
    label: "Anthropic Claude",
    icon: "🧠",
    apiKeyLabel: "ANTHROPIC API KEY",
    apiKeyPlaceholder: "sk-ant-...",
    docsUrl: "https://console.anthropic.com/settings/keys",
    supportsModelFetch: false,
  },
  groq: {
    label: "Groq (Ultra-Fast)",
    icon: "⚡",
    apiKeyLabel: "GROQ API KEY",
    apiKeyPlaceholder: "gsk_...",
    docsUrl: "https://console.groq.com/keys",
    supportsModelFetch: false,
  },
  openrouter: {
    label: "OpenRouter",
    icon: "🔀",
    apiKeyLabel: "OPENROUTER API KEY",
    apiKeyPlaceholder: "sk-or-...",
    docsUrl: "https://openrouter.ai/settings/keys",
    supportsModelFetch: true,
  },
};

// ─── Curated static model lists ──────────────────────────────────────────────

export const PROVIDER_MODELS: Record<string, ModelEntry[]> = {
  google: [
    { value: "gemini-2.5-flash",      label: "Gemini 2.5 Flash",      tags: ["⚡", "🛠", "💰"], note: "Best default — fast & multimodal" },
    { value: "gemini-2.5-pro",        label: "Gemini 2.5 Pro",        tags: ["🧠", "💻", "👁"], note: "Best reasoning" },
    { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", tags: ["⚡", "💰"],        note: "Cheapest" },
    { value: "gemini-2.0-flash",      label: "Gemini 2.0 Flash",      tags: ["⚡", "🛠"],        note: "" },
    { value: "gemini-1.5-pro",        label: "Gemini 1.5 Pro",        tags: ["🧠", "👁"],        note: "" },
  ],

  openai: [
    { value: "gpt-5.6-sol",   label: "GPT-5.6 Sol",   tags: ["🧠", "💻"], note: "Best reasoning & coding" },
    { value: "gpt-5.6-terra", label: "GPT-5.6 Terra", tags: ["🛠", "👁"], note: "Best default" },
    { value: "gpt-5.6-luna",  label: "GPT-5.6 Luna",  tags: ["⚡", "💰"], note: "Fast & cheap" },
    { value: "gpt-5.5",       label: "GPT-5.5",        tags: ["🧠", "💻"], note: "Stable flagship" },
    { value: "gpt-5.4-mini",  label: "GPT-5.4 Mini",  tags: ["⚡"],        note: "Low latency" },
    { value: "gpt-5.4-nano",  label: "GPT-5.4 Nano",  tags: ["⚡", "💰"], note: "Cheapest" },
    { value: "gpt-oss-120b",  label: "GPT OSS 120B",  tags: ["💻", "🛠"], note: "Open-weight" },
    { value: "gpt-oss-20b",   label: "GPT OSS 20B",   tags: ["⚡", "💰"], note: "Small open-weight" },
  ],

  anthropic: [
    { value: "claude-opus-4-1",      label: "Claude Opus",          tags: ["🧠", "💻"],        note: "Most powerful" },
    { value: "claude-sonnet-4",      label: "Claude Sonnet 4",      tags: ["💻", "🛠"],        note: "Best for coding & tools" },
    { value: "claude-haiku-4",       label: "Claude Haiku 4",       tags: ["⚡", "💰"],        note: "Fast & cheap" },
    { value: "claude-sonnet-latest", label: "Claude Sonnet (Latest)", tags: ["💻", "🛠"],      note: "Latest alias" },
    { value: "claude-opus-latest",   label: "Claude Opus (Latest)", tags: ["🧠"],             note: "Latest alias" },
  ],

  groq: [
    { value: "llama-3.3-70b-versatile",             label: "Llama 3.3 70B",        tags: ["🧠", "🛠"],  note: "Best Groq model" },
    { value: "llama-3.1-8b-instant",                label: "Llama 3.1 8B Instant", tags: ["⚡", "💰"],  note: "Ultra-fast" },
    { value: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout", tags: ["⚡", "🛠"],  note: "Multimodal" },
    { value: "qwen/qwen3.6-27b",                    label: "Qwen 3.6 27B",         tags: ["💻", "🧠"],  note: "" },
    { value: "deepseek-r1-distill-llama-70b",       label: "DeepSeek R1 Distill",  tags: ["🧠", "💻"],  note: "Reasoning" },
    { value: "openai/gpt-oss-120b",                 label: "GPT OSS 120B",         tags: ["💻", "🛠"],  note: "" },
    { value: "openai/gpt-oss-20b",                  label: "GPT OSS 20B",          tags: ["⚡"],        note: "" },
    { value: "groq/compound",                       label: "Groq Compound",        tags: ["🧠", "🛠"],  note: "Agentic" },
    { value: "groq/compound-mini",                  label: "Groq Compound Mini",   tags: ["⚡", "🛠"],  note: "" },
  ],

  openrouter: [
    { value: "anthropic/claude-sonnet-4",    label: "Claude Sonnet 4",      tags: ["💻", "🛠"],       note: "" },
    { value: "anthropic/claude-opus-4.1",    label: "Claude Opus 4.1",      tags: ["🧠"],             note: "" },
    { value: "openai/gpt-5.6-terra",         label: "GPT-5.6 Terra",        tags: ["🛠", "👁"],       note: "" },
    { value: "openai/gpt-5.6-luna",          label: "GPT-5.6 Luna",         tags: ["⚡", "💰"],       note: "" },
    { value: "google/gemini-2.5-pro",        label: "Gemini 2.5 Pro",       tags: ["🧠", "👁"],       note: "" },
    { value: "google/gemini-2.5-flash",      label: "Gemini 2.5 Flash",     tags: ["⚡", "💰"],       note: "" },
    { value: "deepseek/deepseek-chat",       label: "DeepSeek V3",          tags: ["💻", "🛠"],       note: "" },
    { value: "deepseek/deepseek-r1",         label: "DeepSeek R1",          tags: ["🧠", "💻"],       note: "Reasoning" },
    { value: "qwen/qwen3-coder",             label: "Qwen3 Coder",          tags: ["💻"],             note: "" },
    { value: "qwen/qwen3",                   label: "Qwen3",                tags: ["🧠", "💻"],       note: "" },
    { value: "x-ai/grok-4",                  label: "Grok Latest",          tags: ["🧠", "👁"],       note: "" },
    { value: "moonshotai/kimi-k2",           label: "Kimi Latest",          tags: ["💻", "🛠"],       note: "" },
    { value: "z-ai/glm-5.2",                 label: "GLM-5.2",              tags: ["🧠"],             note: "" },
  ],

  // Ollama entries are curated suggestions; actual list is fetched dynamically
  ollama: [],
};

// ─── Ollama curated suggestions (shown when Ollama is offline / unfetched) ───

export interface OllamaModelGroup {
  label: string;
  models: ModelEntry[];
}

export const OLLAMA_SUGGESTED_GROUPS: OllamaModelGroup[] = [
  {
    label: "⚡ Small (≤8 GB RAM)",
    models: [
      { value: "gemma3:4b",      label: "Gemma 3 4B",        tags: ["⚡", "💰"] },
      { value: "phi4",           label: "Phi-4",             tags: ["💻", "⚡"] },
      { value: "llama3.2:3b",   label: "Llama 3.2 3B",      tags: ["⚡", "💰"] },
      { value: "qwen2.5:3b",    label: "Qwen 2.5 3B",       tags: ["⚡", "💰"] },
    ],
  },
  {
    label: "🧠 Medium (8–16 GB RAM)",
    models: [
      { value: "llama3.1:8b",   label: "Llama 3.1 8B",      tags: ["🛠", "💻"] },
      { value: "qwen2.5:7b",    label: "Qwen 2.5 7B",       tags: ["💻", "🛠"] },
      { value: "mistral",        label: "Mistral 7B",        tags: ["⚡", "💻"] },
      { value: "deepseek-r1:8b",label: "DeepSeek R1 8B",    tags: ["🧠", "💻"] },
    ],
  },
  {
    label: "🦙 Large (16+ GB RAM)",
    models: [
      { value: "qwen3:32b",      label: "Qwen3 32B",         tags: ["🧠", "💻"] },
      { value: "llama3.3:70b",  label: "Llama 3.3 70B",     tags: ["🧠", "🛠"] },
      { value: "deepseek-r1",    label: "DeepSeek R1",       tags: ["🧠", "💻"] },
      { value: "glm4",           label: "GLM-4",             tags: ["🧠"] },
    ],
  },
];

// Flat list of all suggested Ollama models for the dropdown
export const OLLAMA_ALL_SUGGESTIONS: ModelEntry[] = OLLAMA_SUGGESTED_GROUPS.flatMap(g => g.models);

// ─── Dynamic model discovery ──────────────────────────────────────────────────

export interface FetchedModel {
  value: string;
  label: string;
}

/**
 * Fetch locally available Ollama models.
 * Returns an empty array if Ollama is not running.
 */
export async function fetchOllamaModels(): Promise<FetchedModel[]> {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags", {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const models: Array<{ name: string }> = data.models ?? [];
    return models.map(m => ({ value: m.name, label: m.name }));
  } catch {
    return [];
  }
}

/**
 * Fetch available OpenAI models (filtered to chat models only).
 */
export async function fetchOpenAIModels(apiKey: string): Promise<FetchedModel[]> {
  if (!apiKey) return [];
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const chatModels: string[] = (data.data ?? [])
      .map((m: { id: string }) => m.id)
      .filter((id: string) =>
        id.startsWith("gpt-") ||
        id.startsWith("o1") ||
        id.startsWith("o3") ||
        id.startsWith("o4") ||
        id.startsWith("chatgpt-")
      )
      .sort();
    return chatModels.map(id => ({ value: id, label: id }));
  } catch {
    return [];
  }
}

/**
 * Fetch top OpenRouter models (filtered to text generation).
 */
export async function fetchOpenRouterModels(apiKey: string): Promise<FetchedModel[]> {
  if (!apiKey) return [];
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://opensarthi.app",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const models: Array<{ id: string; name: string }> = data.data ?? [];
    // Filter to top useful models, sorted by id
    return models
      .filter(m => m.id && m.name)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(m => ({ value: m.id, label: m.name || m.id }));
  } catch {
    return [];
  }
}

// ─── Helper: format a label with tags ────────────────────────────────────────

export function formatModelLabel(entry: ModelEntry): string {
  if (!entry.tags || entry.tags.length === 0) return entry.label;
  return `${entry.label}  ${entry.tags.join("")}`;
}
