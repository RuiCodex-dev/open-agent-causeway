// The Meterless-style injected generator: every model call in Causeway goes through this one seam
// (prompt, attachments, systemPrompt, onStream, abortSignal) -> { text, metadata }, backed by the ModelRouter
// (Meterless Runtime primary, NVIDIA direct, Nebius failover). Agents never call a provider directly.
import type { z } from "zod";
import type { Config } from "../config.ts";
import { ModelRouter, type CallRecord } from "../models/router.ts";
import { Pacer } from "../models/pacer.ts";
import { MeterlessProvider } from "../models/providers/meterless.ts";
import { OpenAICompatProvider } from "../models/providers/openaiCompat.ts";
import type { ChatProvider, ChatRequest } from "../models/types.ts";
import type { Trace } from "../orchestrator/trace.ts";

export interface GeneratorMeta {
  provider: string;
  model: string;
  latency_ms: number;
  retries: number;
  reasoning?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export type Generator = (
  prompt: string,
  attachments: unknown[] | undefined,
  systemPrompt: string | undefined,
  onStream?: (chunk: string) => void,
  abortSignal?: AbortSignal,
) => Promise<{ text: string; metadata: GeneratorMeta }>;

export function buildRouter(cfg: Config, onCall?: (r: CallRecord) => void): ModelRouter | null {
  const nvidiaModels = { reasoner: cfg.MODEL_REASONER, fast: cfg.MODEL_FAST, guard: cfg.MODEL_GUARD };
  const nvidia = cfg.MODEL_API_KEY ? new OpenAICompatProvider({ id: "nvidia", baseUrl: cfg.MODEL_BASE_URL, apiKey: cfg.MODEL_API_KEY, models: nvidiaModels }) : null;
  const nebius = cfg.FALLBACK_API_KEY
    ? new OpenAICompatProvider({ id: "nebius", baseUrl: cfg.FALLBACK_BASE_URL, apiKey: cfg.FALLBACK_API_KEY, models: { reasoner: "nvidia/nemotron-3-super-120b-a12b", fast: "nvidia/nemotron-3-super-120b-a12b", guard: "nvidia/nemotron-3-super-120b-a12b" } })
    : null;
  let primary: ChatProvider | null = null;
  if (cfg.MODEL_PROVIDER === "meterless") {
    primary = cfg.METERLESS_RUNTIME_TOKEN
      ? new MeterlessProvider({ baseUrl: cfg.METERLESS_BASE_URL, token: cfg.METERLESS_RUNTIME_TOKEN, appId: cfg.METERLESS_APP_ID, model: cfg.METERLESS_MODEL })
      : null;
  } else if (cfg.MODEL_PROVIDER === "nvidia") primary = nvidia;
  else if (cfg.MODEL_PROVIDER === "nebius") primary = nebius;
  if (!primary) return null;
  const fallback = primary.id === "nebius" ? undefined : primary.id === "meterless" ? (nvidia ?? nebius ?? undefined) : (nebius ?? undefined);
  return new ModelRouter({ primary, fallback, pacers: { nvidia: new Pacer({ perMinute: cfg.NVIDIA_RPM_BUDGET, burst: 8, concurrency: 3 }) }, onCall });
}

export function makeGenerator(router: ModelRouter, role: ChatRequest["role"], opts: { thinking?: boolean; maxTokens?: number; temperature?: number } = {}): Generator {
  return async (prompt, _attachments, systemPrompt, onStream, abortSignal) => {
    const messages: ChatRequest["messages"] = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });
    const r = await router.chat({ role, messages, thinking: opts.thinking, maxTokens: opts.maxTokens, temperature: opts.temperature, signal: abortSignal });
    onStream?.(r.text);
    return { text: r.text, metadata: { provider: r.provider, model: r.model, latency_ms: r.latency_ms, retries: r.retries, reasoning: r.reasoning, usage: r.usage } };
  };
}

/** Extract the first JSON object or array from model text (models sometimes wrap JSON in prose or fences). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1]! : text;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error("no JSON found");
  const open = body[start]!;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return JSON.parse(body.slice(start, i + 1));
  }
  throw new Error("unterminated JSON");
}

/** Call the generator for structured output, validate with zod, allow exactly one repair turn. */
export async function generateJson<T>(
  gen: Generator,
  agent: string,
  system: string,
  user: string,
  schema: z.ZodType<T>,
  trace?: Trace,
): Promise<{ value: T; meta: GeneratorMeta; repaired: boolean }> {
  const first = await gen(user, undefined, system);
  trace?.log(agent, "model_call", { provider: first.metadata.provider, model: first.metadata.model, latency_ms: first.metadata.latency_ms, retries: first.metadata.retries, usage: first.metadata.usage ?? null, reasoning_summary: first.metadata.reasoning?.slice(0, 600) ?? null });
  try {
    return { value: schema.parse(extractJson(first.text)), meta: first.metadata, repaired: false };
  } catch (e) {
    const err = e instanceof Error ? e.message.slice(0, 600) : String(e);
    trace?.log(agent, "json_invalid", { error: err });
    const second = await gen(`${user}\n\nYour previous answer was not valid for the required JSON schema:\n${err}\n\nReturn ONLY the corrected JSON, nothing else.`, undefined, system);
    trace?.log(agent, "model_call", { provider: second.metadata.provider, model: second.metadata.model, latency_ms: second.metadata.latency_ms, retries: second.metadata.retries, repair: true });
    return { value: schema.parse(extractJson(second.text)), meta: second.metadata, repaired: true };
  }
}
