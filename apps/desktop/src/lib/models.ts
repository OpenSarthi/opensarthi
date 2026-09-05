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
    label: "Local LLM (Ollama)",
    icon: "🏠",
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
    supportsModelFetch: true,
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
    supportsModelFetch: true,
  },
  groq: {
    label: "Groq (Ultra-Fast)",
    icon: "⚡",
    apiKeyLabel: "GROQ API KEY",
    apiKeyPlaceholder: "gsk_...",
    docsUrl: "https://console.groq.com/keys",
    supportsModelFetch: true,
  },
  openrouter: {
    label: "OpenRouter",
    icon: "🔀",
    apiKeyLabel: "OPENROUTER API KEY",
    apiKeyPlaceholder: "sk-or-...",
    docsUrl: "https://openrouter.ai/settings/keys",
    supportsModelFetch: true,
  },
  custom_openai: {
    label: "Custom OpenAI Endpoint",
    icon: "🔧",
    apiKeyLabel: "API KEY (optional)",
    apiKeyPlaceholder: "sk-... (leave blank if not required)",
    docsUrl: "",
    supportsModelFetch: true,
  },
};


// ─── Curated static model lists ──────────────────────────────────────────────

export const PROVIDER_MODELS: Record<string, ModelEntry[]> = {
  google: [
    { value: "gemini-3.6-flash",            label: "Gemini 3.6 Flash",       tags: ["⚡", "🛠", "✨"], note: "Latest flagship — speed & agency" },
    { value: "gemini-3.5-flash-lite",       label: "Gemini 3.5 Flash Lite",  tags: ["⚡", "💰"],        note: "Fastest cost-effective model" },
    { value: "gemini-3.5-flash",            label: "Gemini 3.5 Flash",       tags: ["🧠", "💻"],        note: "Frontier coding & agentic tasks" },
    { value: "gemini-3.1-pro-preview",       label: "Gemini 3.1 Pro Preview", tags: ["🧠", "👁", "💻"], note: "SOTA reasoning & multimodal" },
    { value: "gemini-3.1-flash-lite",       label: "Gemini 3.1 Flash Lite",  tags: ["⚡", "💰"],        note: "High-volume agentic tasks" },
    { value: "gemini-3-flash-preview",      label: "Gemini 3 Flash Preview", tags: ["⚡", "🛠"],        note: "Frontier speed & grounding" },
    { value: "gemini-flash-latest",         label: "Gemini Flash (Latest)",  tags: ["⚡", "✨"],        note: "Points to gemini-3.6-flash" },
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

  // Ollama & Custom OpenAI entries are fetched dynamically or suggested
  ollama: [],
  custom_openai: [],
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

/**
 * Client-side direct validator & model discovery (inspired by MultiLLMService in ai-social-agent).
 * Used for local custom_openai endpoints and as resilient fallback when Python runtime is offline or restarting.
 */
export async function validateClientDirect(
  provider: string,
  apiKey?: string,
  baseUrl?: string
): Promise<{ valid: boolean; message: string; models: FetchedModel[] }> {
  try {
    if (provider === "custom_openai") {
      const targetUrl = (baseUrl || "http://localhost:20128/v1").trim().replace(/\/+$/, "");
      if (!targetUrl) {
        return { valid: false, message: "❌ Base URL is required", models: [] };
      }
      const modelsUrl = `${targetUrl}/models`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      let res: Response;
      try {
        res = await fetch(modelsUrl, { method: "GET", headers, signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
      if (res.status === 401 || res.status === 403) {
        return { valid: false, message: "❌ Unauthorized (401/403): Check your API key", models: [] };
      }
      if (!res.ok) {
        return { valid: false, message: `❌ Server returned HTTP ${res.status}`, models: [] };
      }
      const data = await res.json();
      let rawList: any[] = [];
      if (Array.isArray(data)) {
        rawList = data;
      } else if (Array.isArray(data?.data)) {
        rawList = data.data;
      } else if (Array.isArray(data?.models)) {
        rawList = data.models;
      }
      const models: FetchedModel[] = rawList
        .filter((m) => m && (m.id || m.name || typeof m === "string"))
        .map((m) => {
          const val = typeof m === "string" ? m : m.id || m.name;
          const lbl = typeof m === "string" ? m : m.name || m.id;
          return { value: String(val), label: String(lbl) };
        });
      return {
        valid: true,
        message: `✅ Connected! ${models.length} models available.`,
        models,
      };
    }

    if (provider === "ollama") {
      const targetUrl = (baseUrl || "http://127.0.0.1:11434").trim().replace(/\/+$/, "");
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      let res: Response;
      try {
        res = await fetch(`${targetUrl}/api/tags`, { method: "GET", signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!res.ok) {
        return { valid: false, message: `❌ Ollama HTTP ${res.status}`, models: [] };
      }
      const data = await res.json();
      const models: FetchedModel[] = (data.models || []).map((m: any) => ({
        value: String(m.name),
        label: String(m.name),
      }));
      return {
        valid: true,
        message: `✅ Ollama running with ${models.length} models.`,
        models,
      };
    }

    if (provider === "groq") {
      if (!apiKey) return { valid: false, message: "API key is required", models: [] };
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      let res: Response;
      try {
        res = await fetch("https://api.groq.com/openai/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      if (res.status === 401) return { valid: false, message: "❌ Invalid API key", models: [] };
      if (!res.ok) return { valid: false, message: `❌ Groq HTTP ${res.status}`, models: [] };
      const data = await res.json();
      const models: FetchedModel[] = (data.data || [])
        .filter((m: any) => m.id && !m.id.startsWith("whisper") && !m.id.startsWith("distil"))
        .map((m: any) => ({ value: String(m.id), label: String(m.id) }))
        .sort((a: any, b: any) => a.value.localeCompare(b.value));
      return {
        valid: true,
        message: `✅ Groq API key valid! ${models.length} models available.`,
        models,
      };
    }

    if (provider === "openai") {
      if (!apiKey) return { valid: false, message: "API key is required", models: [] };
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      let res: Response;
      try {
        res = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      if (res.status === 401) return { valid: false, message: "❌ Invalid API key", models: [] };
      if (!res.ok) return { valid: false, message: `❌ OpenAI HTTP ${res.status}`, models: [] };
      const data = await res.json();
      const models: FetchedModel[] = (data.data || [])
        .filter((m: any) => m.id && (m.id.startsWith("gpt-") || m.id.startsWith("o1") || m.id.startsWith("o3") || m.id.startsWith("chatgpt-")))
        .map((m: any) => ({ value: String(m.id), label: String(m.id) }))
        .sort((a: any, b: any) => a.value.localeCompare(b.value));
      return {
        valid: true,
        message: `✅ OpenAI API key valid! ${models.length} models available.`,
        models,
      };
    }

    if (provider === "openrouter") {
      if (!apiKey) return { valid: false, message: "API key is required", models: [] };
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      let res: Response;
      try {
        res = await fetch("https://openrouter.ai/api/v1/models", {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "HTTP-Referer": "https://opensarthi.app",
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      if (res.status === 401) return { valid: false, message: "❌ Invalid API key", models: [] };
      if (!res.ok) return { valid: false, message: `❌ OpenRouter HTTP ${res.status}`, models: [] };
      const data = await res.json();
      const models: FetchedModel[] = (data.data || [])
        .filter((m: any) => m.id)
        .map((m: any) => ({ value: String(m.id), label: String(m.name || m.id) }))
        .sort((a: any, b: any) => a.value.localeCompare(b.value));
      return {
        valid: true,
        message: `✅ OpenRouter API key valid! ${models.length} models available.`,
        models,
      };
    }

    if (provider === "google") {
      if (!apiKey) return { valid: false, message: "API key is required", models: [] };
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      let res: Response;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!res.ok) return { valid: false, message: `❌ Google HTTP ${res.status}`, models: [] };
      const data = await res.json();
      const models: FetchedModel[] = (data.models || [])
        .filter((m: any) => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map((m: any) => ({
          value: String(m.name.replace("models/", "")),
          label: String(m.displayName || m.name.replace("models/", "")),
        }))
        .sort((a: any, b: any) => a.value.localeCompare(b.value));
      return {
        valid: true,
        message: `✅ Google API key valid! ${models.length} models available.`,
        models,
      };
    }

    if (provider === "anthropic") {
      if (!apiKey) return { valid: false, message: "API key is required", models: [] };
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      let res: Response;
      try {
        res = await fetch("https://api.anthropic.com/v1/models", {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      if (res.status === 401) return { valid: false, message: "❌ Invalid API key", models: [] };
      if (!res.ok) return { valid: false, message: `❌ Anthropic HTTP ${res.status}`, models: [] };
      const data = await res.json();
      const models: FetchedModel[] = (data.data || []).map((m: any) => ({
        value: String(m.id),
        label: String(m.display_name || m.id),
      }));
      return {
        valid: true,
        message: `✅ Anthropic API key valid! ${models.length} models available.`,
        models,
      };
    }

    return { valid: false, message: `Unsupported provider: ${provider}`, models: [] };
  } catch (err: any) {
    return { valid: false, message: `Connection failed: ${err.message || String(err)}`, models: [] };
  }
}
