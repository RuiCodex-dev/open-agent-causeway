// OpenAI-compatible chat provider used for direct NVIDIA (build.nvidia.com) and Nebius Token Factory.
import { ProviderError, type ChatProvider, type ChatRequest, type ChatResult, type ProviderId } from "../types.ts";

export interface OpenAICompatOptions {
  id: Extract<ProviderId, "nvidia" | "nebius">;
  baseUrl: string;
  apiKey: string;
  models: { reasoner: string; fast: string; guard: string };
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface CompletionResponse {
  model?: string;
  choices?: { message?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class OpenAICompatProvider implements ChatProvider {
  readonly id: Extract<ProviderId, "nvidia" | "nebius">;
  private base: string;
  private fetchImpl: typeof fetch;

  constructor(private opts: OpenAICompatOptions) {
    if (!opts.apiKey) throw new Error(`${opts.id}: API key missing`);
    this.id = opts.id;
    this.base = opts.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  modelFor(role: ChatRequest["role"]): string {
    return this.opts.models[role];
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const model = this.modelFor(req.role);
    const timeout = AbortSignal.timeout(this.opts.timeoutMs ?? 90_000);
    const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
    const body: Record<string, unknown> = {
      model,
      messages: req.messages,
      max_tokens: req.maxTokens ?? 1500,
      temperature: req.temperature ?? 0.2,
      stream: false,
      chat_template_kwargs: { enable_thinking: req.thinking === true },
    };
    const started = Date.now();
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      throw new ProviderError(`${this.id}: request failed (${(e as Error).name})`, this.id, null, true);
    }
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new ProviderError(`${this.id}: HTTP ${res.status}`, this.id, res.status, retryable);
    }
    const data = (await res.json()) as CompletionResponse;
    const msg = data.choices?.[0]?.message;
    const text = (msg?.content ?? "").trim();
    if (!text) throw new ProviderError(`${this.id}: empty content`, this.id, res.status, true);
    return {
      text,
      reasoning: msg?.reasoning_content ?? msg?.reasoning ?? undefined,
      provider: this.id,
      model: data.model ?? model,
      usage: data.usage,
      latency_ms: Date.now() - started,
      retries: 0,
    };
  }
}
