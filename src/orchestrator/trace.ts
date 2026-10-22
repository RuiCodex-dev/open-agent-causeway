// JSONL trace: one line per agent action, written to logs/trace-<run>.jsonl and (optionally) stdout.
// Values that look like credentials are masked before writing.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface TraceLine {
  ts: string;
  run_id: string;
  step: number;
  agent: string;
  action: string;
  [k: string]: unknown;
}

const SECRETISH = /(nvapi-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+\/=-]{8,})/g;

export function mask(value: unknown): unknown {
  if (typeof value === "string") return value.replace(SECRETISH, "***");
  if (Array.isArray(value)) return value.map(mask);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = /^(authorization|api[_-]?key|access[_-]?token|token|runtime[_-]?token|password|secret|client[_-]?secret)$/i.test(k) ? "***" : mask(v);
    return out;
  }
  return value;
}

export class Trace {
  private step = 0;
  readonly file: string;
  readonly lines: TraceLine[] = [];
  private listeners: ((l: TraceLine) => void)[] = [];

  constructor(readonly runId: string, dir = "logs", private echo = process.env.TRACE_STDOUT === "1") {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, `trace-${runId}.jsonl`);
  }

  onLine(fn: (l: TraceLine) => void): void {
    this.listeners.push(fn);
  }

  log(agent: string, action: string, data: Record<string, unknown> = {}): TraceLine {
    const line = mask({ ts: new Date().toISOString(), run_id: this.runId, step: ++this.step, agent, action, ...data }) as TraceLine;
    this.lines.push(line);
    appendFileSync(this.file, JSON.stringify(line) + "\n");
    if (this.echo) process.stdout.write(JSON.stringify(line) + "\n");
    for (const fn of this.listeners) fn(line);
    return line;
  }
}
