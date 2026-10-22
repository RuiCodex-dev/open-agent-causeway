// CLI: npm run ask -- "<question>" --business <id> [--period 2025-H1] [--baseline 2024-H1] [--sample] [--live] [--offline]
//      npm run ask -- --fact "We switched supplier in May 2025" --business atelier-noir
//      npm run ask -- --input input_examples/example_1.json [--out result.json]
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { runInvestigation, type RunInput } from "./orchestrator/run.ts";
import { BusinessMemory } from "./meterless/memory.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const business = arg("business") ?? "atelier-noir";
  const fact = arg("fact");
  if (fact) {
    const f = new BusinessMemory(business).addFact(fact);
    console.log(JSON.stringify({ stored: f }, null, 2));
    return;
  }
  let req: RunInput;
  const inputFile = arg("input");
  if (inputFile) req = JSON.parse(readFileSync(inputFile, "utf8")) as RunInput;
  else {
    const question = process.argv.slice(2).find((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--")) ?? "";
    req = { input: { question, business_id: business, period: arg("period"), baseline: arg("baseline") }, options: {} };
  }
  req.options = { ...(req.options ?? {}) };
  if (process.argv.includes("--sample")) req.options.sample_mode = true;
  if (process.argv.includes("--live")) req.options.sample_mode = false;
  if (process.argv.includes("--offline")) req.options.reasoner = "offline";
  const res = await runInvestigation(req);
  const out = arg("out");
  if (out) writeFileSync(out, JSON.stringify(res, null, 2) + "\n");
  if (process.argv.includes("--json")) console.log(JSON.stringify(res, null, 2));
  else {
    console.log(`\n[${res.status}] run ${res.run_id} | data: ${res.data_mode} | reasoner: ${res.reasoner} | ${res.execution_time_seconds}s`);
    if (res.status === "needs_clarification") {
      console.log("Clarifying question:", (res.output as { clarifying_question: string }).clarifying_question);
      return;
    }
    const r = res as Extract<typeof res, { hypotheses: unknown }>;
    console.log(`\nVERDICT: ${r.output.verdict}\n`);
    for (const h of r.hypotheses) console.log(`  ${h.verdict.padEnd(13)} ${h.confidence.padEnd(6)} ${h.role.padEnd(6)} ${h.id} ${h.title} [${h.proposed_by}] - ${h.rule}`);
    console.log(`\nChallenges: ${r.challenges.map((c) => `${c.id} -> ${c.target_hypothesis_id}: ${c.confounder} => ${c.outcome}`).join("\n            ") || "none"}`);
    console.log(`\nClaims:`);
    for (const c of r.output.claims) console.log(`  [ok] ${c.text}  (${c.evidence_ids.join(", ")})`);
    for (const c of r.output.struck_claims) console.log(`  [STRUCK] ${c.text}  -- ${c.struck_reason}`);
    console.log(`\nMemory used: ${r.output.memory_used.map((m) => m.fact).join("; ") || "none"}`);
    console.log(`Evidence: ${r.evidence.length} queries on ${r.data_mode}; re-executed ${r.verification.requery.length}, struck ${r.verification.struck}, revisions ${r.verification.revisions}`);
    console.log(`Sources: ${JSON.stringify(r.sources)}; model calls: ${r.model_calls.length}`);
    console.log(`Trace: ${r.log_file}`);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(JSON.stringify({ status: "error", error: { type: (e as { type?: string }).type ?? "Error", message: (e as Error).message } }));
    process.exit(1);
  },
);
