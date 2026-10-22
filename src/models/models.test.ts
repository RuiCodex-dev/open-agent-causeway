import { describe, expect, it } from "vitest";
import { Pacer, backoffDelay } from "./pacer.ts";
import { ModelRouter, type CallRecord } from "./router.ts";
import { OpenAICompatProvider } from "./providers/openaiCompat.ts";
import { ProviderError, type ChatProvider, type ChatRequest, type ChatResult } from "./types.ts";

function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const req: ChatRequest = { role: "reasoner", messages: [{ role: "user", content: "hi" }] };

function scripted(id: ChatProvider["id"], outcomes: (number | "ok")[]): ChatProvider & { calls: number } {
  const p = {
    id,
    calls: 0,
    async chat(): Promise<ChatResult> {
      const o = outcomes[Math.min(p.calls, outcomes.length - 1)]!;
      p.calls++;
      if (o === "ok") return { text: `from ${id}`, provider: id, model: `${id}-model`, latency_ms: 5, retries: 0 };
      throw new ProviderError(`HTTP ${o}`, id, o, o === 429 || o >= 500);
    },
  };
  return p;
}

describe("Pacer", () => {
  it("allows a burst, then spaces calls at the per-minute rate", async () => {
    const c = fakeClock();
    const pacer = new Pacer({ perMinute: 30, burst: 2, concurrency: 1, now: c.now, sleep: c.sleep });
    const waits: number[] = [];
    for (let i = 0; i < 4; i++) waits.push((await pacer.run(async () => i)).waitedMs);
    expect(waits.slice(0, 2)).toEqual([0, 0]);
    expect(waits[2]).toBe(2000); // 30/min => one token every 2 s
    expect(waits[3]).toBe(2000);
  });
  it("computes bounded full-jitter back-off", () => {
    expect(backoffDelay(0, () => 0.999)).toBeLessThanOrEqual(2000);
    expect(backoffDelay(10, () => 0.999)).toBeLessThanOrEqual(30_000);
    expect(backoffDelay(3, () => 0)).toBe(0);
  });
});

describe("ModelRouter", () => {
  it("returns the primary result and records the call", async () => {
    const recs: CallRecord[] = [];
    const r = new ModelRouter({ primary: scripted("meterless", ["ok"]), onCall: (x) => recs.push(x) });
    const res = await r.chat(req);
    expect(res.provider).toBe("meterless");
    expect(recs).toHaveLength(1);
    expect(recs[0]!.ok).toBe(true);
  });
  it("retries retryable errors with back-off, then succeeds", async () => {
    const c = fakeClock();
    const primary = scripted("nvidia", [429, 503, "ok"]);
    const r = new ModelRouter({ primary, now: c.now, sleep: c.sleep, rand: () => 0.5, circuit: { failures: 5, windowMs: 60_000, openMs: 120_000 } });
    const res = await r.chat(req);
    expect(res.text).toBe("from nvidia");
    expect(res.retries).toBe(2);
    expect(primary.calls).toBe(3);
  });
  it("does not retry auth failures and fails over", async () => {
    const primary = scripted("meterless", [401]);
    const fallback = scripted("nebius", ["ok"]);
    const r = new ModelRouter({ primary, fallback });
    const res = await r.chat(req);
    expect(primary.calls).toBe(1);
    expect(res.provider).toBe("nebius");
  });
  it("opens the circuit after repeated failures and routes straight to the fallback", async () => {
    const c = fakeClock();
    const primary = scripted("nvidia", [503]);
    const fallback = scripted("nebius", ["ok"]);
    const recs: CallRecord[] = [];
    const r = new ModelRouter({ primary, fallback, now: c.now, sleep: c.sleep, rand: () => 0, onCall: (x) => recs.push(x) });
    await r.chat(req); // 3 failures open the circuit, then fallback
    expect(r.circuitOpen()).toBe(true);
    const before = primary.calls;
    const res = await r.chat(req);
    expect(primary.calls).toBe(before); // primary skipped while open
    expect(res.provider).toBe("nebius");
    expect(recs.some((x) => x.failover)).toBe(true);
    c.advance(121_000);
    expect(r.circuitOpen()).toBe(false);
  });
  it("throws the last error when everything fails", async () => {
    const r = new ModelRouter({ primary: scripted("nvidia", [400]) });
    await expect(r.chat(req)).rejects.toThrow("HTTP 400");
  });
});

describe("OpenAICompatProvider", () => {
  it("sends the model for the role, thinking off by default, and returns content", async () => {
    let sent: { url: string; body: Record<string, unknown>; auth: string | null } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get("authorization") };
      return new Response(JSON.stringify({ model: "nvidia/x", choices: [{ message: { content: " OK " } }], usage: { prompt_tokens: 3 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new OpenAICompatProvider({ id: "nvidia", baseUrl: "https://example.test/v1/", apiKey: "fake", models: { reasoner: "r-model", fast: "f-model", guard: "g-model" }, fetchImpl });
    const res = await p.chat({ ...req, role: "fast" });
    expect(res.text).toBe("OK");
    expect(sent!.url).toBe("https://example.test/v1/chat/completions");
    expect(sent!.body.model).toBe("f-model");
    expect(sent!.body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(sent!.auth).toBe("Bearer fake");
  });
  it("marks 429 retryable and 401 not retryable, and rejects empty content", async () => {
    const mk = (status: number, body: unknown = {}) =>
      new OpenAICompatProvider({ id: "nebius", baseUrl: "https://e.test/v1", apiKey: "k", models: { reasoner: "r", fast: "f", guard: "g" }, fetchImpl: (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch });
    await expect(mk(429).chat(req)).rejects.toMatchObject({ retryable: true, status: 429 });
    await expect(mk(401).chat(req)).rejects.toMatchObject({ retryable: false, status: 401 });
    await expect(mk(200, { choices: [{ message: { content: "" } }] }).chat(req)).rejects.toThrow("empty content");
  });
});
