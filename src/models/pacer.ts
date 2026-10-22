// Client-side pacing for the NVIDIA free tier (about 40 requests/minute, no rate-limit headers):
// a token bucket (default 32/min, burst 8) plus a concurrency cap. Clock and sleep are injectable for tests.

export interface PacerOptions {
  perMinute?: number;
  burst?: number;
  concurrency?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class Pacer {
  private tokens: number;
  private last: number;
  private inFlight = 0;
  private waiters: (() => void)[] = [];
  readonly perMinute: number;
  readonly burst: number;
  readonly concurrency: number;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;

  constructor(opts: PacerOptions = {}) {
    this.perMinute = opts.perMinute ?? 32;
    this.burst = opts.burst ?? 8;
    this.concurrency = opts.concurrency ?? 3;
    this.now = opts.now ?? (() => Date.now());
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.tokens = this.burst;
    this.last = this.now();
  }

  private refill(): void {
    const t = this.now();
    const add = ((t - this.last) / 60_000) * this.perMinute;
    if (add > 0) {
      this.tokens = Math.min(this.burst, this.tokens + add);
      this.last = t;
    }
  }

  /** Milliseconds until one token is available (0 if available now). */
  waitTime(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    return Math.ceil(((1 - this.tokens) / this.perMinute) * 60_000);
  }

  private async acquireSlot(): Promise<void> {
    if (this.inFlight < this.concurrency) {
      this.inFlight++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.inFlight++;
  }

  private releaseSlot(): void {
    this.inFlight--;
    const next = this.waiters.shift();
    if (next) next();
  }

  /** Run fn once a token and a concurrency slot are available. Returns the time waited. */
  async run<T>(fn: () => Promise<T>): Promise<{ value: T; waitedMs: number }> {
    const start = this.now();
    await this.acquireSlot();
    try {
      for (;;) {
        const w = this.waitTime();
        if (w === 0) break;
        await this.sleep(w);
      }
      this.tokens -= 1;
      const value = await fn();
      return { value, waitedMs: this.now() - start };
    } finally {
      this.releaseSlot();
    }
  }
}

/** Full-jitter exponential back-off delay for attempt n (0-based): random(0, min(cap, base*factor^n)). */
export function backoffDelay(attempt: number, rand: () => number = Math.random, baseMs = 2000, factor = 2, capMs = 30_000): number {
  return Math.floor(rand() * Math.min(capMs, baseMs * factor ** attempt));
}
