import {
  type ChatProvider,
  type ChatRequest,
  type ChatResult,
  ProviderError,
} from "../types.ts";

const DEFAULT_BASE_URL = "http://127.0.0.1:8088/v1";
const DEFAULT_APP_ID = "causeway";
const DEFAULT_MODEL = "meterless/auto";
const DEFAULT_TIMEOUT_MS = 180_000;
const PLACEHOLDER_TOKEN = "rt-local";

const DETECT_PORTS = [8088, 8090, 8787, 11434] as const;
const DETECT_HOSTS = ["127.0.0.1", "localhost", "[::1]"] as const;

export type MeterlessStatus = "online" | "unauthorized" | "offline";

export interface ConnectLinkInfo {
  baseUrl: string;
  apiKey: string;
  model: string | null;
  app: string | null;
  healthUrl: string;
}

export interface MeterlessProviderOpts {
  baseUrl?: string;
  token?: string;
  appId?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Reject the runtime placeholder and empty values; treat them as missing. */
function resolveToken(token: string | undefined): string | undefined {
  if (token === undefined) return undefined;
  const trimmed = token.trim();
  if (!trimmed || trimmed === PLACEHOLDER_TOKEN) return undefined;
  return trimmed;
}

/**
 * Accept a pasted URL with or without a scheme, `/v1`, `/v1/chat/completions`,
 * `/v1/models` or `/healthz`, and normalise to `<origin>/v1`. Never `/v1/v1`.
 */
export function normaliseBaseUrl(input: string): string {
  let raw = input.trim();
  if (!raw) {
    return DEFAULT_BASE_URL;
  }
  if (!/^https?:\/\//i.test(raw)) {
    raw = `http://${raw}`;
  }
  const url = new URL(raw);
  let path = url.pathname.replace(/\/+$/, "") || "";
  // Strip known suffixes (repeat so accidental /v1/v1 collapses).
  for (;;) {
    if (path.endsWith("/v1/chat/completions")) {
      path = path.slice(0, -"/v1/chat/completions".length);
    } else if (path.endsWith("/v1/models")) {
      path = path.slice(0, -"/v1/models".length);
    } else if (path.endsWith("/healthz")) {
      path = path.slice(0, -"/healthz".length);
    } else if (path.endsWith("/v1")) {
      path = path.slice(0, -"/v1".length);
    } else {
      break;
    }
    path = path.replace(/\/+$/, "");
  }
  path = path.replace(/\/+$/, "");
  url.pathname = `${path}/v1`;
  url.search = "";
  url.hash = "";
  let out = url.toString();
  if (out.endsWith("/")) out = out.slice(0, -1);
  // Guard against any residual double /v1.
  out = out.replace(/\/v1\/v1$/, "/v1");
  return out;
}

/**
 * Parse a Meterless connect link: `http://<host>:<port>/connect#k=<key>`.
 * Optional hash params `model` and `app` are forwarded when present.
 * Returns null when the path is not `/connect` or `k` is missing.
 * Never log the key.
 */
export function parseConnectLink(text: string): ConnectLinkInfo | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/connect") return null;
  const params = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const apiKey = params.get("k");
  if (!apiKey) return null;
  const origin = url.origin;
  return {
    baseUrl: `${origin}/v1`,
    apiKey,
    model: params.get("model"),
    app: params.get("app"),
    healthUrl: `${origin}/healthz`,
  };
}

function extractMeterlessIds(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const ids: string[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id === "string" && id.startsWith("meterless/")) {
      ids.push(id);
    }
  }
  return ids;
}

async function probeStatus(
  fetchImpl: typeof fetch,
  baseUrl: string,
  token?: string,
): Promise<MeterlessStatus> {
  const headers: Record<string, string> = {
    "meterless-app": DEFAULT_APP_ID,
  };
  const resolved = resolveToken(token);
  if (resolved) {
    headers.Authorization = `Bearer ${resolved}`;
  }
  try {
    const res = await fetchImpl(`${baseUrl}/models`, { method: "GET", headers });
    if (res.status === 401 || res.status === 403) return "unauthorized";
    if (res.status !== 200) return "offline";
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return "offline";
    }
    return extractMeterlessIds(body).length > 0 ? "online" : "offline";
  } catch {
    return "offline";
  }
}

/**
 * Probe common local ports/hosts; return the first base URL that is
 * `online` or `unauthorized`. Returns null if none respond that way.
 */
export async function autoDetect(
  fetchImpl: typeof fetch = fetch,
  token?: string,
): Promise<string | null> {
  for (const port of DETECT_PORTS) {
    for (const host of DETECT_HOSTS) {
      const baseUrl = `http://${host}:${port}/v1`;
      const st = await probeStatus(fetchImpl, baseUrl, token);
      if (st === "online" || st === "unauthorized") {
        return baseUrl;
      }
    }
  }
  return null;
}

export class MeterlessProvider implements ChatProvider {
  readonly id = "meterless" as const;
  readonly name = "Meterless Runtime";

  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly appId: string;
  /** Explicit routing mode from opts; when unset, chat maps role → mode. */
  private readonly configuredModel: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private modelsCache: string[] = [];

  constructor(opts: MeterlessProviderOpts = {}) {
    this.baseUrl = normaliseBaseUrl(opts.baseUrl ?? DEFAULT_BASE_URL);
    this.token = resolveToken(opts.token);
    this.appId = (opts.appId ?? DEFAULT_APP_ID).toLowerCase();
    this.configuredModel = opts.model;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Model ids from the last successful `status()` that saw a 200 body. */
  listModels(): string[] {
    return [...this.modelsCache];
  }

  async status(): Promise<MeterlessStatus> {
    const headers: Record<string, string> = {
      "meterless-app": this.appId,
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/models`, {
        method: "GET",
        headers,
      });
      if (res.status === 401 || res.status === 403) {
        this.modelsCache = [];
        return "unauthorized";
      }
      if (res.status !== 200) {
        this.modelsCache = [];
        return "offline";
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        this.modelsCache = [];
        return "offline";
      }
      const ids = extractMeterlessIds(body);
      this.modelsCache = ids;
      return ids.length > 0 ? "online" : "offline";
    } catch {
      this.modelsCache = [];
      return "offline";
    }
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    if (!this.token) {
      throw new ProviderError(
        "Meterless Runtime token missing or placeholder",
        "meterless",
        401,
        false,
      );
    }

    const model =
      this.configuredModel ??
      (req.role === "fast" ? "meterless/fast" : DEFAULT_MODEL);

    const signals: AbortSignal[] = [AbortSignal.timeout(this.timeoutMs)];
    if (req.signal) signals.push(req.signal);
    const signal = AbortSignal.any(signals);

    const started = Date.now();
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "meterless-app": this.appId,
          "meterless-scope": "user",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: req.messages,
          max_tokens: req.maxTokens,
          temperature: req.temperature,
          stream: false,
          // Nightshift forwards this to NVIDIA Nemotron lanes; without it, thinking can consume the whole
          // max_tokens budget and the lane returns an empty answer (HTTP 502 from the runtime).
          chat_template_kwargs: { enable_thinking: req.thinking === true },
        }),
        signal,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "request failed";
      throw new ProviderError(message, "meterless", null, true);
    }

    if (!res.ok) {
      const status = res.status;
      const retryable = status === 429 || status >= 500;
      throw new ProviderError(
        `Meterless Runtime HTTP ${status}`,
        "meterless",
        status,
        retryable,
      );
    }

    let body: {
      model?: string;
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new ProviderError(
        "Meterless Runtime returned invalid JSON",
        "meterless",
        res.status,
        true,
      );
    }

    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new ProviderError(
        "Meterless Runtime returned non-string content",
        "meterless",
        res.status,
        false,
      );
    }

    return {
      text: content,
      provider: "meterless",
      model: typeof body.model === "string" && body.model ? body.model : model,
      usage: body.usage,
      latency_ms: Date.now() - started,
      retries: 0,
    };
  }
}
