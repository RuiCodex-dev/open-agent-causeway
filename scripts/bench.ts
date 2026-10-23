// Causeway Bench: runs every ground-truth case through the full agent and scores the verdicts.
// The truth lives in scripts/businesses.ts (and bench/truth/); the agent (src/) never reads it.
//   npx tsx scripts/bench.ts [--offline] [--cases B01,B04] [--out bench]
// Writes bench/results.json and bench/report.md (never hand-written).
import "dotenv/config";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { runInvestigation } from "../src/orchestrator/run.ts";
import { BusinessMemory } from "../src/meterless/memory.ts";
import { loadConfig } from "../src/config.ts";
import { BUSINESSES } from "./businesses.ts";

const offline = process.argv.includes("--offline");
const onlyArg = process.argv.indexOf("--cases");
const only = onlyArg > 0 ? new Set(process.argv[onlyArg + 1]!.split(",")) : null;
const outDir = process.argv.indexOf("--out") > 0 ? process.argv[process.argv.indexOf("--out") + 1]! : "bench";
const cfg = loadConfig({ ...process.env, SAMPLE_MODE: "true", ...(offline ? { MODEL_PROVIDER: "offline" } : {}) } as NodeJS.ProcessEnv);

interface CaseResult {
  case_id: string;
  split: string;
  business_id: string;
  question: string;
  expected_causes: string[];
  supported_causes: string[];
  main_cause_found: boolean;
  all_causes_found: boolean;
  false_supports: string[];
  null_control: boolean;
  null_control_pass: boolean | null;
  struck_claims: number;
  writer_revisions: number;
  verified_claims: number;
  ungrounded_in_final: number;
  skeptic_challenges: number;
  verdict_changes: number;
  model_calls: number;
  seconds: number;
  reasoner: string;
  sources: Record<string, string>;
  status: string;
}

const cases = BUSINESSES.flatMap((b) => b.truth.map((t) => ({ b, t }))).filter(({ t }) => !only || only.has(t.case_id));
const results: CaseResult[] = [];
for (const { b, t } of cases) {
  const dir = mkdtempSync(join(tmpdir(), `bench-${t.case_id}-`));
  if (t.fact) new BusinessMemory(b.id, join(dir, "mem"), join(dir, "logs")).addFact(t.fact);
  const t0 = Date.now();
  const res = (await runInvestigation(
    { input: { question: t.question, business_id: b.id, period: t.period, baseline: t.baseline }, options: { sample_mode: true, reasoner: offline ? "offline" : "auto" } },
    { config: cfg, logsDir: join(dir, "logs"), memoryRoot: join(dir, "mem") },
  )) as Record<string, any>;
  const hyps = (res.hypotheses ?? []) as { cause_type: string; verdict: string; role: string }[];
  const supported = hyps.filter((h) => h.verdict === "supported" && h.role === "cause").map((h) => h.cause_type);
  const claims = (res.output?.claims ?? []) as { verified: boolean }[];
  const r: CaseResult = {
    case_id: t.case_id,
    split: t.split,
    business_id: b.id,
    question: t.question,
    expected_causes: t.causes,
    supported_causes: supported,
    main_cause_found: t.causes.length === 0 ? supported.length === 0 : supported.includes(t.causes[0]!),
    all_causes_found: t.causes.every((c) => supported.includes(c)),
    false_supports: supported.filter((c) => !t.causes.includes(c)),
    null_control: t.causes.length === 0,
    null_control_pass: t.causes.length === 0 ? supported.length === 0 : null,
    struck_claims: res.verification?.struck_first_pass ?? res.verification?.struck ?? 0,
    writer_revisions: res.verification?.revisions ?? 0,
    verified_claims: claims.filter((c) => c.verified).length,
    ungrounded_in_final: claims.filter((c) => !c.verified).length,
    skeptic_challenges: (res.challenges ?? []).length,
    verdict_changes: (res.verdict_changes ?? []).length,
    model_calls: (res.model_calls ?? []).length,
    seconds: Math.round((Date.now() - t0) / 100) / 10,
    reasoner: res.reasoner,
    sources: res.sources ?? {},
    status: res.status,
  };
  results.push(r);
  console.log(`${t.case_id} ${t.split.padEnd(7)} ${b.id.padEnd(18)} expected=[${t.causes.join(",") || "none"}] supported=[${supported.join(",") || "none"}] main=${r.main_cause_found ? "OK" : "MISS"} false=${r.false_supports.length} struck=${r.struck_claims} ${r.seconds}s`);
}

function summary(rs: CaseResult[]) {
  const n = rs.length || 1;
  const withCause = rs.filter((r) => !r.null_control);
  const nulls = rs.filter((r) => r.null_control);
  return {
    cases: rs.length,
    main_cause_accuracy: withCause.length ? withCause.filter((r) => r.main_cause_found).length / withCause.length : null,
    all_causes_recall: withCause.length ? withCause.filter((r) => r.all_causes_found).length / withCause.length : null,
    false_support_rate: rs.reduce((a, r) => a + r.false_supports.length, 0) / n,
    null_control_pass: nulls.length ? `${nulls.filter((r) => r.null_control_pass).length}/${nulls.length}` : "n/a",
    ungrounded_numbers_in_final_prose: rs.reduce((a, r) => a + r.ungrounded_in_final, 0),
    verifier_strikes: rs.reduce((a, r) => a + r.struck_claims, 0),
    writer_revisions: rs.reduce((a, r) => a + r.writer_revisions, 0),
    skeptic_challenges: rs.reduce((a, r) => a + r.skeptic_challenges, 0),
    skeptic_verdict_changes: rs.reduce((a, r) => a + r.verdict_changes, 0),
    mean_seconds: Math.round((rs.reduce((a, r) => a + r.seconds, 0) / n) * 10) / 10,
    mean_model_calls: Math.round((rs.reduce((a, r) => a + r.model_calls, 0) / n) * 10) / 10,
  };
}

const sha = (() => {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "unknown";
  }
})();
const all = summary(results);
const tune = summary(results.filter((r) => r.split === "tune"));
const holdout = summary(results.filter((r) => r.split === "holdout"));
// Holdout cases that prompted a code change (see bench/RUNS.md) are no longer clean; report the rest separately.
const PROMPTED_A_CHANGE = new Set(["B03", "B08", "B12"]);
const cleanHoldout = summary(results.filter((r) => r.split === "holdout" && !PROMPTED_A_CHANGE.has(r.case_id)));
mkdirSync(outDir, { recursive: true });
const meta = { generated_at: new Date().toISOString(), git_sha: sha, reasoner: offline ? "offline" : `nemotron (${cfg.MODEL_PROVIDER})`, data: "Zetaris snapshot (data/snapshot) via DuckDB", seed_note: "ledgers from scripts/gen-ledgers.ts, seed 2610" };
writeFileSync(join(outDir, `results${offline ? "-offline" : ""}.json`), JSON.stringify({ meta, summary: { all, tune, holdout, clean_holdout: cleanHoldout }, cases: results }, null, 2) + "\n");
const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);
const row = (name: string, s: ReturnType<typeof summary>) => `| ${name} | ${s.cases} | ${pct(s.main_cause_accuracy)} | ${pct(s.all_causes_recall)} | ${s.false_support_rate.toFixed(2)} | ${s.null_control_pass} | ${s.ungrounded_numbers_in_final_prose} | ${s.verifier_strikes} | ${s.skeptic_challenges} | ${s.mean_seconds}s |`;
const md = [
  `# Causeway Bench report (${offline ? "offline reasoner" : "Nemotron"})`,
  ``,
  `Generated by \`scripts/bench.ts\` at ${meta.generated_at} on commit \`${sha}\`. Reasoner: ${meta.reasoner}. Data: ${meta.data}.`,
  `The businesses are synthetic and their ground truth is the generator's own parameters (\`scripts/businesses.ts\`), which the agent never reads.`,
  `This measures whether the agent recovers known synthetic causes from real Eurostat drivers; it does **not** prove real-world causality.`,
  ``,
  `| Split | Cases | Main cause found | All causes found | False supports / case | Null controls passed | Ungrounded numbers in final prose | Verifier strikes | Skeptic challenges | Mean time |`,
  `|---|---|---|---|---|---|---|---|---|---|`,
  row("All", all),
  row("Tune (cases used while setting thresholds)", tune),
  row("Holdout (never used to set thresholds)", holdout),
  row("Clean holdout (also never prompted a code change: B05, B09, B10, B11)", cleanHoldout),
  ``,
  `## Cases`,
  ``,
  `| Case | Split | Business | Expected | Supported by the agent | Main | False supports | Struck | Seconds |`,
  `|---|---|---|---|---|---|---|---|---|`,
  ...results.map((r) => `| ${r.case_id} | ${r.split} | ${r.business_id} | ${r.expected_causes.join(", ") || "none (null control)"} | ${r.supported_causes.join(", ") || "none"} | ${r.main_cause_found ? "yes" : "no"} | ${r.false_supports.join(", ") || "-"} | ${r.struck_claims} | ${r.seconds} |`),
  ``,
].join("\n");
writeFileSync(join(outDir, `report${offline ? "-offline" : ""}.md`), md);
console.log(JSON.stringify({ all, tune, holdout }, null, 1));
process.exit(0);
