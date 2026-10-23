import type {
  BusinessesResponse,
  HealthResponse,
  MemoryResponse,
  MemoryStoreResponse,
  OwnerFact,
  RunAccepted,
  RunRequest,
  RunResult,
  TraceLine,
} from "./types";

const DEFAULT_API = "http://localhost:8000";

export function apiBase(): string {
  const raw = import.meta.env.VITE_API_URL?.trim();
  return (raw && raw.length > 0 ? raw : DEFAULT_API).replace(/\/$/, "");
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Invalid JSON from ${res.url} (${res.status})`);
  }
  if (!res.ok) {
    const err = body as { error?: { type?: string; message?: string }; message?: string } | null;
    const type = err?.error?.type ?? "HttpError";
    const message = err?.error?.message ?? err?.message ?? res.statusText;
    throw Object.assign(new Error(message), { type, status: res.status, body });
  }
  return body as T;
}

export async function getHealth(): Promise<HealthResponse> {
  return parseJson(await fetch(`${apiBase()}/health`));
}

export async function getBusinesses(): Promise<BusinessesResponse> {
  return parseJson(await fetch(`${apiBase()}/businesses`));
}

export async function startRun(body: RunRequest): Promise<RunAccepted> {
  return parseJson(
    await fetch(`${apiBase()}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function getMemory(businessId: string): Promise<MemoryResponse> {
  return parseJson(await fetch(`${apiBase()}/memory/${encodeURIComponent(businessId)}`));
}

export async function postMemory(businessId: string, fact: string): Promise<MemoryStoreResponse> {
  return parseJson(
    await fetch(`${apiBase()}/memory`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ business_id: businessId, fact }),
    }),
  );
}

export async function deleteMemory(businessId: string, memoryId: string): Promise<{ status: string }> {
  return parseJson(
    await fetch(`${apiBase()}/memory/${encodeURIComponent(businessId)}/${encodeURIComponent(memoryId)}`, { method: "DELETE" }),
  );
}

export interface RunEventHandlers {
  onTrace: (line: TraceLine) => void;
  onResult: (result: RunResult) => void;
  onError?: (error: Error) => void;
}

/** Subscribe to SSE for a run. Returns a dispose function. */
export function subscribeRunEvents(runId: string, handlers: RunEventHandlers): () => void {
  const url = `${apiBase()}/runs/${encodeURIComponent(runId)}/events`;
  const es = new EventSource(url);

  const onTrace = (ev: MessageEvent) => {
    try {
      handlers.onTrace(JSON.parse(String(ev.data)) as TraceLine);
    } catch (e) {
      handlers.onError?.(e instanceof Error ? e : new Error(String(e)));
    }
  };
  const onResult = (ev: MessageEvent) => {
    try {
      handlers.onResult(JSON.parse(String(ev.data)) as RunResult);
    } catch (e) {
      handlers.onError?.(e instanceof Error ? e : new Error(String(e)));
    } finally {
      es.close();
    }
  };
  const onError = () => {
    if (es.readyState === EventSource.CLOSED) return;
    handlers.onError?.(new Error("Lost connection to run events"));
  };

  es.addEventListener("trace", onTrace as EventListener);
  es.addEventListener("result", onResult as EventListener);
  es.onerror = onError;

  return () => {
    es.removeEventListener("trace", onTrace as EventListener);
    es.removeEventListener("result", onResult as EventListener);
    es.onerror = null;
    es.close();
  };
}

export type { OwnerFact };
