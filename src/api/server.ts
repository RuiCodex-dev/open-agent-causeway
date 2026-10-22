// Causeway HTTP API (port 8000) and the static UI (port 8080).
//   GET  /health                      liveness + modes
//   GET  /businesses                  the (synthetic) businesses in the data source
//   POST /run                         run an investigation and return the result JSON (judge entry point)
//   POST /runs                        start an investigation; returns { run_id } immediately
//   GET  /runs/:id/events             Server-Sent Events: every trace line as it happens, then the result
//   GET  /runs/:id                    result of a finished run
//   GET  /memory/:business_id         owner facts in H-MEM + trust-ledger stats
//   POST /memory                      { business_id, fact } -> store an owner-confirmed fact
//   POST /memory/feedback             { business_id, memory_id, kind: helpful|wrong }
import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { loadConfig } from "../config.ts";
import { runInvestigation, type RunInput } from "../orchestrator/run.ts";
import { BusinessMemory } from "../meterless/memory.ts";
import { SnapshotDuckdb } from "../adapters/snapshotDuckdb.ts";
import { ZetarisRest } from "../adapters/zetaris.ts";
import { USL_PREFIX } from "../data/uslSchema.ts";
import type { TraceLine } from "../orchestrator/trace.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolvePath(__dirname, "../..");

function readVersion(): string {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
  return pkg.version;
}

const RunSchema = z.object({
  run_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  input: z.object({
    question: z.string().min(3).max(500),
    business_id: z.string().regex(/^[a-z0-9-]{1,64}$/),
    period: z.string().max(32).optional(),
    baseline: z.string().max(32).optional(),
    metric: z.enum(["revenue", "units", "gross_margin_pct", "avg_ticket"]).optional(),
  }),
  options: z
    .object({ sample_mode: z.boolean().nullable().optional(), max_rounds: z.number().int().min(0).max(2).optional(), reasoner: z.enum(["auto", "offline"]).optional(), stream: z.boolean().optional() })
    .optional(),
});

interface RunState {
  events: TraceLine[];
  result?: unknown;
  error?: { type: string; message: string };
  listeners: Set<(kind: string, data: unknown) => void>;
  done: boolean;
}

function errorBody(runId: string | undefined, e: unknown, started: number) {
  const err = e as { type?: string; message?: string };
  return { run_id: runId ?? null, status: "error", error: { type: err.type ?? "InternalError", message: (err.message ?? String(e)).slice(0, 500), recoverable: err.type !== "InvalidInput" }, execution_time_seconds: (Date.now() - started) / 1000 };
}

export async function buildServer(): Promise<FastifyInstance> {
  const cfg = loadConfig();
  const app = Fastify({ logger: { level: cfg.LOG_LEVEL } });
  const version = readVersion();
  const runs = new Map<string, RunState>();

  app.addHook("onSend", async (req, reply, payload) => {
    const origin = req.headers.origin;
    if (origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      reply.header("access-control-allow-origin", origin);
      reply.header("access-control-allow-headers", "content-type");
    }
    return payload;
  });
  app.options("/*", async (_req, reply) => reply.code(204).send());

  app.get("/health", async () => ({
    status: "ok",
    service: "causeway",
    version,
    model_provider: cfg.MODEL_PROVIDER,
    zetaris_configured: Boolean(cfg.ZETARIS_REST_URL && cfg.ZETARIS_API_KEY),
    snapshot_available: SnapshotDuckdb.available(),
  }));

  app.get("/businesses", async () => {
    const live = cfg.SAMPLE_MODE !== "true" && cfg.ZETARIS_REST_URL && cfg.ZETARIS_API_KEY && cfg.ZETARIS_ORG_ID ? new ZetarisRest({ restUrl: cfg.ZETARIS_REST_URL, apiKey: cfg.ZETARIS_API_KEY, orgId: cfg.ZETARIS_ORG_ID }) : null;
    const useLive = live ? await live.healthy() : false;
    const data = useLive ? live! : new SnapshotDuckdb();
    const t = useLive ? `${USL_PREFIX}.business` : "business";
    const r = await data.query(`SELECT business_id, name, city, nace, sector, synthetic FROM ${t} ORDER BY business_id`);
    return { data_mode: useLive ? "zetaris" : "snapshot", businesses: r.rows.map((x) => ({ business_id: x[0], name: x[1], city: x[2], nace: x[3], sector: x[4], synthetic: String(x[5]) === "true" })) };
  });

  app.post("/run", async (req, reply) => {
    const started = Date.now();
    const parsed = RunSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ status: "error", error: { type: "InvalidInput", message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), recoverable: true } });
    try {
      const res = await runInvestigation(parsed.data as RunInput, { config: cfg });
      return reply.send(res);
    } catch (e) {
      const code = (e as { type?: string }).type === "InvalidInput" ? 400 : 502;
      return reply.code(code).send(errorBody(parsed.data.run_id, e, started));
    }
  });

  app.post("/runs", async (req, reply) => {
    const parsed = RunSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ status: "error", error: { type: "InvalidInput", message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") } });
    const runId = parsed.data.run_id ?? `r-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 6)}`;
    const state: RunState = { events: [], listeners: new Set(), done: false };
    runs.set(runId, state);
    const started = Date.now();
    runInvestigation({ ...(parsed.data as RunInput), run_id: runId }, {
      config: cfg,
      onEvent: (line) => {
        state.events.push(line);
        for (const l of state.listeners) l("trace", line);
      },
    })
      .then((res) => {
        state.result = res;
      })
      .catch((e) => {
        state.error = errorBody(runId, e, started).error;
        state.result = errorBody(runId, e, started);
      })
      .finally(() => {
        state.done = true;
        for (const l of state.listeners) l("result", state.result);
      });
    return reply.code(202).send({ run_id: runId, events: `/runs/${runId}/events`, result: `/runs/${runId}` });
  });

  app.get("/runs/:id", async (req, reply) => {
    const s = runs.get((req.params as { id: string }).id);
    if (!s) return reply.code(404).send({ status: "error", error: { type: "NotFound", message: "unknown run" } });
    if (!s.done) return reply.code(202).send({ status: "running", events: s.events.length });
    return reply.send(s.result);
  });

  app.get("/runs/:id/events", async (req, reply) => {
    const s = runs.get((req.params as { id: string }).id);
    if (!s) return reply.code(404).send({ status: "error", error: { type: "NotFound", message: "unknown run" } });
    reply.hijack();
    const origin = req.headers.origin;
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      ...(origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? { "access-control-allow-origin": origin } : {}),
    });
    const send = (kind: string, data: unknown) => reply.raw.write(`event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`);
    for (const e of s.events) send("trace", e);
    if (s.done) {
      send("result", s.result);
      reply.raw.end();
      return;
    }
    const listener = (kind: string, data: unknown) => {
      send(kind, data);
      if (kind === "result") {
        s.listeners.delete(listener);
        reply.raw.end();
      }
    };
    s.listeners.add(listener);
    req.raw.on("close", () => s.listeners.delete(listener));
  });

  app.get("/memory/:business_id", async (req, reply) => {
    const id = (req.params as { business_id: string }).business_id;
    if (!/^[a-z0-9-]{1,64}$/.test(id)) return reply.code(400).send({ status: "error", error: { type: "InvalidInput", message: "bad business_id" } });
    const m = new BusinessMemory(id);
    return { business_id: id, facts: m.facts(), ledger: m.ledgerStats() };
  });

  app.post("/memory", async (req, reply) => {
    const p = z.object({ business_id: z.string().regex(/^[a-z0-9-]{1,64}$/), fact: z.string().min(5).max(400) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ status: "error", error: { type: "InvalidInput", message: p.error.issues.map((i) => i.message).join("; ") } });
    const f = new BusinessMemory(p.data.business_id).addFact(p.data.fact);
    return { status: "stored", fact: f };
  });

  app.post("/memory/feedback", async (req, reply) => {
    const p = z.object({ business_id: z.string().regex(/^[a-z0-9-]{1,64}$/), memory_id: z.string().max(64), kind: z.enum(["helpful", "wrong"]) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ status: "error", error: { type: "InvalidInput", message: p.error.issues.map((i) => i.message).join("; ") } });
    new BusinessMemory(p.data.business_id).feedback(p.data.memory_id, p.data.kind);
    return { status: "recorded" };
  });

  return app;
}

/** Static server for the built UI (ui/dist) on its own port. */
export async function buildUiServer(): Promise<FastifyInstance | null> {
  const dist = join(ROOT, "ui", "dist");
  if (!existsSync(join(dist, "index.html"))) return null;
  const ui = Fastify({ logger: false });
  const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".json": "application/json" };
  ui.get("/*", async (req, reply) => {
    const url = decodeURIComponent((req.url.split("?")[0] ?? "/").replace(/\.\.+/g, ""));
    let file = join(dist, url === "/" ? "index.html" : url);
    if (!file.startsWith(dist) || !existsSync(file)) file = join(dist, "index.html");
    const ext = file.slice(file.lastIndexOf("."));
    return reply.type(types[ext] ?? "application/octet-stream").send(readFileSync(file));
  });
  return ui;
}

async function main() {
  const cfg = loadConfig();
  const app = await buildServer();
  await app.listen({ host: "0.0.0.0", port: cfg.PORT });
  const ui = await buildUiServer();
  if (ui) await ui.listen({ host: "0.0.0.0", port: cfg.UI_PORT });
}

const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
