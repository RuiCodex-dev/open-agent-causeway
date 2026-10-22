// Shared types for model providers. Every provider is OpenAI-compatible chat completions.

export type ProviderId = "meterless" | "nvidia" | "nebius" | "offline";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** Logical model role; each provider maps it to a concrete model id or routing mode. */
  role: "reasoner" | "fast" | "guard";
  maxTokens?: number;
  temperature?: number;
  /** Ask the model to think (Nemotron `enable_thinking`). Off by default: content must be non-empty. */
  thinking?: boolean;
  /** Ask for a JSON object (OpenAI-compatible response_format). */
  json?: boolean;
  signal?: AbortSignal;
}

export interface ChatResult {
  text: string;
  reasoning?: string;
  provider: ProviderId;
  model: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  latency_ms: number;
  retries: number;
}

export interface ChatProvider {
  readonly id: ProviderId;
  chat(req: ChatRequest): Promise<ChatResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: ProviderId,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
