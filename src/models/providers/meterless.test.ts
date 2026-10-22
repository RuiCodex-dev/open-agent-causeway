import { describe, expect, it } from "vitest";
import {
  MeterlessProvider,
  autoDetect,
  normaliseBaseUrl,
  parseConnectLink,
} from "./meterless.ts";
import { ProviderError } from "../types.ts";

describe("normaliseBaseUrl", () => {
  it("normalises bare host, /v1, chat, models and healthz paths", () => {
    expect(normaliseBaseUrl("127.0.0.1:8088")).toBe("http://127.0.0.1:8088/v1");
    expect(normaliseBaseUrl("http://127.0.0.1:8088")).toBe("http://127.0.0.1:8088/v1");
    expect(normaliseBaseUrl("http://127.0.0.1:8088/v1")).toBe("http://127.0.0.1:8088/v1");
    expect(normaliseBaseUrl("http://127.0.0.1:8088/v1/")).toBe("http://127.0.0.1:8088/v1");
    expect(normaliseBaseUrl("http://127.0.0.1:8088/v1/chat/completions")).toBe(
      "http://127.0.0.1:8088/v1",
    );
    expect(normaliseBaseUrl("http://127.0.0.1:8088/v1/models")).toBe(
      "http://127.0.0.1:8088/v1",
    );
    expect(normaliseBaseUrl("http://127.0.0.1:8088/healthz")).toBe(
      "http://127.0.0.1:8088/v1",
    );
  });

  it("never produces /v1/v1", () => {
    expect(normaliseBaseUrl("http://127.0.0.1:8088/v1/v1")).toBe(
      "http://127.0.0.1:8088/v1",
    );
    expect(normaliseBaseUrl("http://127.0.0.1:8088/v1/v1/models")).toBe(
      "http://127.0.0.1:8088/v1",
    );
  });

  it("adds https when already present and keeps the host", () => {
    expect(normaliseBaseUrl("https://runtime.example/v1/chat/completions")).toBe(
      "https://runtime.example/v1",
    );
  });
});

describe("parseConnectLink", () => {
  it("parses a valid connect link", () => {
    const parsed = parseConnectLink("http://127.0.0.1:8088/connect#k=secret-key");
    expect(parsed).toEqual({
      baseUrl: "http://127.0.0.1:8088/v1",
      apiKey: "secret-key",
      model: null,
      app: null,
      healthUrl: "http://127.0.0.1:8088/healthz",
    });
  });

  it("accepts a trailing slash on /connect and optional hash params", () => {
    const parsed = parseConnectLink(
      "http://127.0.0.1:8090/connect/#k=abc&model=meterless/fast&app=causeway",
    );
    expect(parsed).toEqual({
      baseUrl: "http://127.0.0.1:8090/v1",
      apiKey: "abc",
      model: "meterless/fast",
      app: "causeway",
      healthUrl: "http://127.0.0.1:8090/healthz",
    });
  });

  it("returns null for an invalid path", () => {
    expect(parseConnectLink("http://127.0.0.1:8088/v1#k=secret")).toBeNull();
    expect(parseConnectLink("http://127.0.0.1:8088/#k=secret")).toBeNull();
  });

  it("returns null when k is missing", () => {
    expect(parseConnectLink("http://127.0.0.1:8088/connect")).toBeNull();
    expect(parseConnectLink("http://127.0.0.1:8088/connect#model=meterless/auto")).toBeNull();
  });
});

describe("MeterlessProvider.status", () => {
  it("reports online when /models returns meterless ids", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          data: [{ id: "meterless/auto" }, { id: "other/model" }],
        }),
        { status: 200 },
      );
    const p = new MeterlessProvider({ token: "tok", fetchImpl });
    expect(await p.status()).toBe("online");
    expect(p.listModels()).toEqual(["meterless/auto"]);
  });

  it("reports unauthorized on 401 or 403", async () => {
    for (const status of [401, 403]) {
      const fetchImpl: typeof fetch = async () => new Response("nope", { status });
      const p = new MeterlessProvider({ token: "wrong", fetchImpl });
      expect(await p.status()).toBe("unauthorized");
    }
  });

  it("reports offline on other failures", async () => {
    const fetch500: typeof fetch = async () => new Response("err", { status: 500 });
    expect(await new MeterlessProvider({ token: "tok", fetchImpl: fetch500 }).status()).toBe(
      "offline",
    );

    const fetchEmpty: typeof fetch = async () =>
      new Response(JSON.stringify({ data: [{ id: "gpt-4" }] }), { status: 200 });
    expect(await new MeterlessProvider({ token: "tok", fetchImpl: fetchEmpty }).status()).toBe(
      "offline",
    );

    const fetchThrow: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await new MeterlessProvider({ token: "tok", fetchImpl: fetchThrow }).status()).toBe(
      "offline",
    );
  });
});

describe("MeterlessProvider.chat", () => {
  it("sends auth, app and scope headers and returns string content", async () => {
    let seenUrl = "";
    let seenHeaders: Headers | undefined;
    let seenBody: unknown;

    const fetchImpl: typeof fetch = async (input, init) => {
      seenUrl = String(input);
      seenHeaders = new Headers(init?.headers);
      seenBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          model: "meterless/auto",
          choices: [{ message: { content: "hello from runtime" } }],
          usage: { prompt_tokens: 3, completion_tokens: 4 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const p = new MeterlessProvider({
      baseUrl: "http://127.0.0.1:8088/v1",
      token: "real-token",
      appId: "causeway",
      fetchImpl,
    });
    const result = await p.chat({
      messages: [{ role: "user", content: "hi" }],
      role: "reasoner",
    });

    expect(seenUrl).toBe("http://127.0.0.1:8088/v1/chat/completions");
    expect(seenHeaders?.get("Authorization")).toBe("Bearer real-token");
    expect(seenHeaders?.get("meterless-app")).toBe("causeway");
    expect(seenHeaders?.get("meterless-scope")).toBe("user");
    expect(seenHeaders?.get("content-type")).toBe("application/json");
    expect(seenBody).toMatchObject({
      model: "meterless/auto",
      stream: false,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.text).toBe("hello from runtime");
    expect(result.provider).toBe("meterless");
    expect(result.model).toBe("meterless/auto");
    expect(result.retries).toBe(0);
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("uses meterless/fast when role is fast and no model override", async () => {
    let seenBody: { model?: string } = {};
    const fetchImpl: typeof fetch = async (_input, init) => {
      seenBody = JSON.parse(String(init?.body)) as { model?: string };
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "fast" } }],
        }),
        { status: 200 },
      );
    };
    const p = new MeterlessProvider({ token: "tok", fetchImpl });
    await p.chat({ messages: [{ role: "user", content: "x" }], role: "fast" });
    expect(seenBody.model).toBe("meterless/fast");
  });

  it("rejects rt-local as a missing token", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("should not fetch");
    };
    const p = new MeterlessProvider({ token: "rt-local", fetchImpl });
    await expect(
      p.chat({ messages: [{ role: "user", content: "x" }], role: "reasoner" }),
    ).rejects.toMatchObject({
      name: "ProviderError",
      provider: "meterless",
      status: 401,
      retryable: false,
    });
  });

  it("marks 401/403 non-retryable and 429/5xx retryable", async () => {
    for (const [status, retryable] of [
      [401, false],
      [403, false],
      [429, true],
      [503, true],
    ] as const) {
      const fetchImpl: typeof fetch = async () => new Response("err", { status });
      const p = new MeterlessProvider({ token: "tok", fetchImpl });
      try {
        await p.chat({ messages: [{ role: "user", content: "x" }], role: "reasoner" });
        throw new Error(`expected ProviderError for status ${status}`);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("expected ProviderError")) {
          throw err;
        }
        expect(err).toBeInstanceOf(ProviderError);
        expect(err).toMatchObject({ status, retryable, provider: "meterless" });
      }
    }
  });
});

describe("autoDetect", () => {
  it("picks the first online or unauthorized base URL in port/host order", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url === "http://127.0.0.1:8090/v1/models") {
        return new Response("unauthorized", { status: 401 });
      }
      return new Response("nope", { status: 500 });
    };

    const found = await autoDetect(fetchImpl);
    expect(found).toBe("http://127.0.0.1:8090/v1");
    // First port 8088 is tried on all three hosts before 8090.
    expect(calls[0]).toBe("http://127.0.0.1:8088/v1/models");
    expect(calls).toContain("http://localhost:8088/v1/models");
    expect(calls).toContain("http://[::1]:8088/v1/models");
    expect(calls[calls.length - 1]).toBe("http://127.0.0.1:8090/v1/models");
  });

  it("returns null when nothing is online or unauthorized", async () => {
    const fetchImpl: typeof fetch = async () => new Response("down", { status: 500 });
    expect(await autoDetect(fetchImpl)).toBeNull();
  });
});
