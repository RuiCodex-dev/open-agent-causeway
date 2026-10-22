// Model router: primary provider (Meterless Runtime by default) with pacing, back-off,
// a circuit breaker and failover. Every call reports a trace record (never the prompt secrets or keys).
import { Pacer, backoffDelay } from "./pacer.ts";
import { ProviderError, type ChatProvider, type ChatRequest, type ChatResult, type ProviderId } from "./types.ts";

export interface CallRecord {
  provider: ProviderId;
  model: string | null;
  role: ChatRequest["role"];
  ok: boolean;
  status: number | null;
  latency_ms: number;
  waited_ms: number;
  attempt: number;
  failover: boolean;
  error?: string;
}

export interface RouterOptions {
  primary: ChatProvider;
  fallback?: ChatProvider;
  pacers?: Partial<Record<ProviderId, Pacer>>;
  maxAttempts?: number;
  circuit?: { failures: number; windowMs: number; openMs: number };
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  rand?: () => number;
  onCall?: (rec: CallRecord) => void;
}

export class ModelRouter {
  private failures: number[] = [];
  private openUntil = 0;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;
  private rand: () => number;

  constructor(private opts: RouterOptions) {
    this.now = opts.now ?? (() => Date.now());
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.rand = opts.rand ?? Math.random;
  }

  get primaryId(): ProviderId {
    return this.opts.primary.id;
  }

  circuitOpen(): boolean {
    return this.now() < this.openUntil;
  }

  private recordFailure(): void {
    const c = this.opts.circuit ?? { failures: 3, windowMs: 60_000, openMs: 120_000 };
    const t = this.now();
    this.failures = this.failures.filter((x) => t - x < c.windowMs);
    this.failures.push(t);
    if (this.failures.length >= c.failures) {
      this.openUntil = t + c.openMs;
      this.failures = [];
    }
  }

  private async callOnce(p: ChatProvider, req: ChatRequest, attempt: number, failover: boolean): Promise<ChatResult> {
    const pacer = this.opts.pacers?.[p.id];
    const started = this.now();
    try {
      const { value, waitedMs } = pacer ? await pacer.run(() => p.chat(req)) : { value: await p.chat(req), waitedMs: 0 };
      this.opts.onCall?.({ provider: p.id, model: value.model, role: req.role, ok: true, status: 200, latency_ms: value.latency_ms, waited_ms: waitedMs, attempt, failover });
      return { ...value, retries: attempt };
    } catch (e) {
      const pe = e instanceof ProviderError ? e : new ProviderError(String(e), p.id, null, true);
      this.opts.onCall?.({ provider: p.id, model: null, role: req.role, ok: false, status: pe.status, latency_ms: this.now() - started, waited_ms: 0, attempt, failover, error: pe.message });
      throw pe;
    }
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const max = this.opts.maxAttempts ?? 4;
    let lastErr: ProviderError | null = null;
    if (!this.circuitOpen()) {
      for (let attempt = 0; attempt < max; attempt++) {
        try {
          return await this.callOnce(this.opts.primary, req, attempt, false);
        } catch (e) {
          lastErr = e as ProviderError;
          if (!lastErr.retryable) break;
          this.recordFailure();
          if (this.circuitOpen() || attempt === max - 1) break;
          await this.sleep(backoffDelay(attempt, this.rand));
        }
      }
    }
    if (this.opts.fallback) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await this.callOnce(this.opts.fallback, req, attempt, true);
        } catch (e) {
          lastErr = e as ProviderError;
          if (!lastErr.retryable) break;
          await this.sleep(backoffDelay(attempt, this.rand));
        }
      }
    }
    throw lastErr ?? new ProviderError("model call failed: circuit open and no fallback", this.opts.primary.id, null, false);
  }
}
