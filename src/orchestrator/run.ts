// The investigation state machine (bounded, non-linear):
// Framer -> Recall (H-MEM) -> Hypothesiser -> Analyst (Zetaris SQL + stats) -> rule verdicts -> Skeptic
// (challenge -> new test -> re-verdict, at most 2 rounds) -> Writer -> Verifier (re-execute + number match,
// strike, one revision) -> Memory Keeper -> response. All state lives in the Meterless World Model.
import { randomUUID } from "node:crypto";
import { loadConfig, type Config } from "../config.ts";
import { SnapshotDuckdb } from "../adapters/snapshotDuckdb.ts";
import { ZetarisRest, type DataAdapter } from "../adapters/zetaris.ts";
import { USL_PREFIX } from "../data/uslSchema.ts";
import { Analyst } from "../agents/analyst.ts";
import { CAUSES } from "../agents/catalogue.ts";
import { frameQuestion } from "../agents/framer.ts";
import { propose } from "../agents/hypothesiser.ts";
import { resolveChallenge, review } from "../agents/skeptic.ts";
import { verify } from "../agents/verifier.ts";
import { unitFor, write } from "../agents/writer.ts";
import type { Challenge, Hypothesis, HypothesisResult } from "../agents/types.ts";
import { buildRouter, makeGenerator, type Generator } from "../meterless/generator.ts";
import { EvidenceGraph } from "../meterless/worldModel.ts";
import { BusinessMemory } from "../meterless/memory.ts";
import { InvestigationLoop } from "../meterless/loop.ts";
import { openConfounders } from "../agents/skeptic.ts";
import { Trace, type TraceLine } from "./trace.ts";
import type { Metric } from "../tests/compiler.ts";

export interface RunInput {
  run_id?: string;
  input: { question: string; business_id: string; period?: string; baseline?: string; metric?: Metric };
  options?: { sample_mode?: boolean | null; max_rounds?: number; reasoner?: "auto" | "offline" };
}

export interface RunOptions {
  config?: Config;
  onEvent?: (line: TraceLine) => void;
  logsDir?: string;
  memoryRoot?: string;
}

export const AGENTS = [
  { name: "Framer", role: "Turns the question into metric, period and baseline, or asks one clarifying question" },
  { name: "Hypothesiser", role: "Proposes rival explanations from the cause catalogue" },
  { name: "Analyst", role: "Compiles each test to SQL, runs it on Zetaris, computes statistics and applies the rule table (no LLM)" },
  { name: "Skeptic", role: "Challenges every supported verdict with an untested confounder; veto until the test runs" },
  { name: "Writer", role: "Writes the explanation card; every claim cites evidence" },
  { name: "Verifier", role: "Re-executes cited queries and strikes any number not found in the evidence (no LLM, veto)" },
  { name: "Memory Keeper", role: "Recalls and stores owner facts and verdicts in Meterless H-MEM" },
];

async function pickData(cfg: Config, sample: boolean | null | undefined, trace: Trace): Promise<{ data: DataAdapter; mode: "zetaris" | "snapshot"; failover: boolean }> {
  const forcedSample = sample === true || cfg.SAMPLE_MODE === "true";
  const forcedLive = sample === false || cfg.SAMPLE_MODE === "false";
  if (!forcedSample && cfg.ZETARIS_REST_URL && cfg.ZETARIS_API_KEY && cfg.ZETARIS_ORG_ID) {
    const z = new ZetarisRest({ restUrl: cfg.ZETARIS_REST_URL, apiKey: cfg.ZETARIS_API_KEY, orgId: cfg.ZETARIS_ORG_ID });
    if (await z.healthy()) return { data: z, mode: "zetaris", failover: false };
    if (forcedLive) throw Object.assign(new Error("Zetaris is not reachable and SAMPLE_MODE=false"), { type: "UpstreamUnavailable" });
    trace.log("Orchestrator", "data_failover", { reason: "Zetaris not reachable; using the Zetaris snapshot" });
    return { data: new SnapshotDuckdb(), mode: "snapshot", failover: true };
  }
  return { data: new SnapshotDuckdb(), mode: "snapshot", failover: false };
}

export async function runInvestigation(req: RunInput, opts: RunOptions = {}) {
  const started = Date.now();
  const cfg = opts.config ?? loadConfig();
  const runId = req.run_id ?? `r-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 6)}`;
  const trace = new Trace(runId, opts.logsDir ?? "logs");
  if (opts.onEvent) trace.onLine(opts.onEvent);
  const maxRounds = Math.max(0, Math.min(2, req.options?.max_rounds ?? 2));
  const calls: { provider: string; model: string | null; ok: boolean; failover: boolean }[] = [];
  const router = req.options?.reasoner === "offline" || cfg.MODEL_PROVIDER === "offline" ? null : buildRouter(cfg, (c) => {
    calls.push({ provider: c.provider, model: c.model, ok: c.ok, failover: c.failover });
    trace.log("ModelRouter", "call", { ...c });
  });
  const gens: { fast: Generator | null; reason: Generator | null; write: Generator | null } = router
    ? { fast: makeGenerator(router, "fast", { maxTokens: 400, json: true }), reason: makeGenerator(router, "reasoner", { maxTokens: 2500, temperature: 0.3, json: true }), write: makeGenerator(router, "reasoner", { maxTokens: 2500, temperature: 0.2, json: true }) }
    : { fast: null, reason: null, write: null };
  trace.log("Orchestrator", "start", { input: req.input, options: req.options ?? {}, model_provider: router ? router.primaryId : "offline" });

  const { data, mode, failover } = await pickData(cfg, req.options?.sample_mode, trace);
  const t = (name: string) => (data.engine === "zetaris" ? `${USL_PREFIX}.${name}` : name);
  const biz = await data.query(`SELECT business_id, name, city, nace, sector, synthetic FROM ${t("business")} WHERE business_id = '${req.input.business_id.replace(/[^a-z0-9-]/gi, "")}'`);
  if (biz.rows.length === 0) throw Object.assign(new Error(`unknown business_id ${req.input.business_id}`), { type: "InvalidInput" });
  const [business_id, name, city, nace, sector] = biz.rows[0]!.map(String) as [string, string, string, string, string];
  const graph = new EvidenceGraph(runId);
  const bizEntity = await graph.business(business_id, name, { city, nace, sector, synthetic: true });

  // Memory: recall owner facts and earlier verdicts.
  const memory = new BusinessMemory(business_id, opts.memoryRoot ?? "data/memory", opts.logsDir ?? "logs");
  const recall = memory.recall(req.input.question);
  trace.log("Memory Keeper", "recall", { facts: recall.facts.map((f) => ({ id: f.id, text: f.text, cause_type: f.cause_type, params: f.params })) });

  const framed = await frameQuestion(req.input.question, business_id, { metric: req.input.metric, period: req.input.period, baseline: req.input.baseline }, gens.fast, trace);
  const base = { run_id: runId, data_mode: failover ? "snapshot (failover)" : mode, reasoner: router ? "nemotron" : "offline", trace_id: `trace-${runId}`, log_file: trace.file, agents: AGENTS };
  if (framed.status === "needs_clarification") {
    return { ...base, status: "needs_clarification", output: { clarifying_question: framed.question }, evidence: [], execution_time_seconds: (Date.now() - started) / 1000 };
  }
  const frame = framed.frame;
  const analyst = new Analyst({ frame, data, trace, budget: { sql: 60 } });
  const outcome = await analyst.outcome();
  trace.log("Analyst", "outcome", { metric: frame.metric, period: frame.period, baseline: frame.baseline, change: outcome.change, moved: outcome.moved, z: outcome.z });

  const { hypotheses, source: hypSource } = await propose({ frame, business: { name, sector, nace, city }, outcome: { change: outcome.change, unit: unitFor(frame.metric) }, facts: recall.facts, max: 5 }, gens.reason, trace);
  const hypEntity = new Map<string, string>();
  const evEntity = new Map<string, string>();
  for (const h of hypotheses) hypEntity.set(h.id, await graph.hypothesis(h, bizEntity));
  for (const f of recall.facts) await graph.fact(f.text, f.id, hypotheses.find((h) => h.cause_type === f.cause_type) ? hypEntity.get(hypotheses.find((h) => h.cause_type === f.cause_type)!.id)! : null);

  const results: HypothesisResult[] = [];
  const record = async (r: HypothesisResult) => {
    for (const id of r.evidence_ids) if (!evEntity.has(id)) evEntity.set(id, await graph.evidence(analyst.evidence.get(id)!));
    await graph.verdict(r, hypEntity.get(r.hypothesis.id)!, evEntity);
  };
  for (const h of hypotheses) {
    const r = await analyst.test(h);
    results.push(r);
    await record(r);
  }

  // Markovian loop: every round hands the next one a compressed state instead of the full history.
  const loop = new InvestigationLoop(runId);
  const openNow = () => openConfounders(frame, nace, results.map((r) => r.hypothesis.cause_type));
  // Skeptic rounds.
  const challenges: Challenge[] = [];
  let carry = await loop.round(InvestigationLoop.state(frame, results, [], openNow()), JSON.stringify({ hypotheses, results: results.map((r) => ({ id: r.hypothesis.id, verdict: r.verdict, rule: r.rule, numbers: r.numbers })) }));
  trace.log("Markovian", "carryover", { round: 0, tokens_estimated: Math.ceil(carry.length / 4) });
  const verdictChanges: { hypothesis_id: string; before: string; after: string; by: string }[] = [];
  let skepticSource = "offline";
  for (let round = 1; round <= maxRounds; round++) {
    const rev = await review(frame, nace, results, round, gens.reason, trace, carry);
    skepticSource = rev.source;
    if (rev.challenges.length === 0) break;
    for (const ch of rev.challenges) {
      challenges.push(ch);
      const target = results.find((r) => r.hypothesis.id === ch.target_hypothesis_id);
      await graph.challenge(ch, target ? hypEntity.get(target.hypothesis.id)! : bizEntity);
      const h: Hypothesis = { id: `hyp-${results.length + 1}`, cause_type: ch.required_test as Hypothesis["cause_type"], title: CAUSES[ch.required_test as Hypothesis["cause_type"]].title, mechanism: ch.argument, proposed_by: "Skeptic" };
      hypEntity.set(h.id, await graph.hypothesis(h, bizEntity));
      const r = await analyst.test(h);
      results.push(r);
      await record(r);
      if (!target) {
        ch.resolved = true;
        ch.outcome = `${r.hypothesis.title} is ${r.verdict}: ${r.rule}`;
        trace.log("Skeptic", "challenge_resolved", { challenge: ch.id, target: "null", confounder_verdict: r.verdict, outcome: ch.outcome });
        continue;
      }
      const updated = resolveChallenge(target, ch, r);
      if (updated.verdict !== target.verdict || updated.confidence !== target.confidence) verdictChanges.push({ hypothesis_id: target.hypothesis.id, before: `${target.verdict}/${target.confidence}`, after: `${updated.verdict}/${updated.confidence}`, by: ch.id });
      results[results.indexOf(target)] = updated;
      trace.log("Skeptic", "challenge_resolved", { challenge: ch.id, target: target.hypothesis.id, confounder_verdict: r.verdict, outcome: ch.outcome });
    }
    carry = await loop.round(InvestigationLoop.state(frame, results, challenges, openNow()), JSON.stringify({ round, challenges, results: results.map((r) => ({ id: r.hypothesis.id, verdict: r.verdict, rule: r.rule, numbers: r.numbers })) }));
    trace.log("Markovian", "carryover", { round, tokens_estimated: Math.ceil(carry.length / 4) });
  }

  // Writer + Verifier (one revision).
  const factTexts = recall.facts.map((f) => f.text);
  let { card, source: writerSource } = await write(frame, results, outcome.change, factTexts, gens.write, trace, undefined, carry);
  let report = await verify(card.claims, results, analyst.evidence, data, trace);
  let revisions = 0;
  const struckFirstPass = report.struck;
  if (report.struck > 0 && gens.write) {
    const fb = report.claims.filter((c) => !c.verified).map((c) => `- "${c.text}" (${c.struck_reason})`).join("\n");
    const second = await write(frame, results, outcome.change, factTexts, gens.write, trace, fb, carry);
    const report2 = await verify(second.card.claims, results, analyst.evidence, data, trace);
    revisions = 1;
    card = second.card;
    writerSource = second.source;
    report = report2;
  }
  card.claims = report.claims;
  for (const c of card.claims) await graph.claim(c, evEntity);

  const supported = results.filter((r) => r.verdict === "supported" && r.role === "cause");
  memory.rememberVerdict(req.input.question, card.verdict, supported.flatMap((r) => r.evidence_ids), runId);
  const wmFile = graph.export(opts.logsDir ?? "logs");
  const mkFile = loop.export(opts.logsDir ?? "logs");
  trace.log("Orchestrator", "done", { status: "success", world_model_events: graph.counts(), world_model_log: wmFile, struck: report.struck, revisions });

  return {
    ...base,
    status: "success",
    frame,
    output: {
      verdict: card.verdict,
      chain: card.chain,
      claims: card.claims.filter((c) => c.verified),
      struck_claims: card.claims.filter((c) => !c.verified),
      rejected: card.rejected,
      offsets: card.offsets,
      limitations: card.limitations,
      what_would_change: card.what_would_change,
      actions: card.actions,
      memory_used: recall.facts.map((f) => ({ fact: f.text, source: "owner", memory_id: f.id, cause_type: f.cause_type })),
    },
    hypotheses: results.map((r) => ({ id: r.hypothesis.id, title: r.hypothesis.title, cause_type: r.hypothesis.cause_type, proposed_by: r.hypothesis.proposed_by, verdict: r.verdict, confidence: r.confidence, role: r.role, rule: r.rule, numbers: r.numbers, evidence_ids: r.evidence_ids })),
    challenges,
    verdict_changes: verdictChanges,
    evidence: [...analyst.evidence.values()].map((e) => ({ id: e.id, purpose: e.purpose, engine: e.engine, sql: e.sql, columns: e.columns, rows_preview: e.rows.slice(0, 12), row_count: e.row_count, sha256: e.sha256, source_tables: e.source_tables, executed_at: e.executed_at })),
    verification: { requery: report.requery, struck_first_pass: struckFirstPass, struck: report.struck, revisions },
    markovian: { ...loop.report(), log_file: mkFile },
    sources: { framer: framed.source, hypothesiser: hypSource, skeptic: skepticSource, writer: writerSource },
    model_calls: calls,
    world_model: { events: graph.counts(), log_file: wmFile },
    memory: { ledger: memory.ledgerStats(), ledger_file: "logs/hmem-ledger.jsonl" },
    execution_time_seconds: Math.round((Date.now() - started) / 100) / 10,
  };
}
