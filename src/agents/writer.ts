// Writer: turns the verdict table into an explanation card. Every claim must cite evidence ids, and may only use
// numbers from the table (the Verifier enforces this). Nemotron Super writes; offline uses a fixed template.
import { z } from "zod";
import { generateJson, type Generator } from "../meterless/generator.ts";
import type { Trace } from "../orchestrator/trace.ts";
import { METRICS } from "../tests/compiler.ts";
import type { Claim, ExplanationCard, Frame, HypothesisResult } from "./types.ts";

const Schema = z.object({
  verdict: z.string().max(400),
  chain: z.array(z.string().max(300)).min(1).max(5),
  claims: z.array(z.object({ text: z.string().max(400), evidence_ids: z.array(z.string()).min(1) })).min(1).max(8),
  limitations: z.array(z.string().max(300)).max(5),
  what_would_change: z.array(z.string().max(300)).max(4),
  actions: z.array(z.string().max(300)).min(1).max(4),
});

const fmt = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "n/a" : v.toFixed(d));

export function unitFor(metric: Frame["metric"]): string {
  return metric === "gross_margin_pct" ? "percentage points" : metric === "revenue" || metric === "avg_ticket" ? "EUR" : "units";
}

/** Deterministic parts of the card: rejected rivals and offsets come straight from the rule table. */
export function rejectedAndOffsets(results: HypothesisResult[]): Pick<ExplanationCard, "rejected" | "offsets"> {
  return {
    rejected: results.filter((r) => r.verdict === "contradicted" && r.role !== "offset").map((r) => ({ hypothesis: r.hypothesis.title, why: r.rule, evidence_ids: r.evidence_ids })),
    offsets: results.filter((r) => r.role === "offset").map((r) => ({ hypothesis: r.hypothesis.title, why: r.rule, evidence_ids: r.evidence_ids })),
  };
}

function numberTable(results: HypothesisResult[]): string {
  return results
    .map((r) => {
      const nums = Object.entries(r.numbers).filter(([, v]) => v !== null).map(([k, v]) => `${k}=${fmt(v as number, Math.abs(v as number) < 1 ? 3 : 2)}`).join(", ");
      return `- ${r.hypothesis.id} "${r.hypothesis.title}" verdict=${r.verdict} role=${r.role} confidence=${r.confidence}\n  rule: ${r.rule}\n  numbers: ${nums}\n  evidence_ids: ${r.evidence_ids.join(", ")}`;
    })
    .join("\n");
}

export function offlineCard(frame: Frame, results: HypothesisResult[], change: number): Omit<ExplanationCard, "rejected" | "offsets"> {
  const label = METRICS[frame.metric].label;
  const unit = unitFor(frame.metric);
  const causes = results.filter((r) => r.verdict === "supported" && r.role === "cause");
  const outcomeEv = results[0]?.evidence_ids.slice(0, 1) ?? [];
  const claims: Claim[] = [{ id: "c-1", text: `${label} changed by ${fmt(change, 2)} ${unit} in ${frame.period} compared with ${frame.baseline}.`, evidence_ids: outcomeEv }];
  for (const r of causes) {
    const n = r.numbers;
    const parts: string[] = [];
    if (n.driver_change_pct !== undefined && n.driver_change_pct !== null) parts.push(`the driver moved ${fmt(n.driver_change_pct, 1)}% between the windows`);
    if (n.assoc_r !== undefined && n.assoc_r !== null) parts.push(`it tracks the business's own series with a correlation of ${fmt(n.assoc_r, 2)}`);
    if (n.driver_cost_effect_pp !== undefined && n.driver_cost_effect_pp !== null) parts.push(`it accounts for about ${fmt(n.driver_cost_effect_pp, 1)} points of margin`);
    if (n.residual_step_pct !== undefined && n.residual_step_pct !== null) parts.push(`unit cost stepped up ${fmt(n.residual_step_pct, 1)}% beyond what cocoa prices explain`);
    if (n.share_of_change_kept !== undefined && n.share_of_change_kept !== null) parts.push(`only ${fmt((n.share_of_change_kept as number) * 100, 0)}% of the change remains without the Easter months`);
    claims.push({ id: `c-${claims.length + 1}`, text: `${r.hypothesis.title}: ${parts.join("; ") || r.rule}.`, evidence_ids: r.evidence_ids });
  }
  for (const r of results.filter((x) => x.role === "offset")) {
    if (r.numbers.price_effect_pp !== undefined && r.numbers.price_effect_pp !== null) claims.push({ id: `c-${claims.length + 1}`, text: `${r.hypothesis.title} worked the other way, adding about ${fmt(r.numbers.price_effect_pp, 1)} points.`, evidence_ids: r.evidence_ids });
  }
  const verdict = causes.length
    ? `${causes.map((c) => c.hypothesis.title).join(" and ")} ${causes.length > 1 ? "best explain" : "best explains"} the change in ${label} in ${frame.period}.`
    : `No external cause in the catalogue explains the change in ${label} in ${frame.period}; it is within what the tests can separate from normal variation.`;
  return {
    verdict,
    chain: causes.length ? causes.map((c) => `${c.hypothesis.title}: ${c.rule}`) : ["Every tested explanation was contradicted or inconclusive."],
    claims,
    limitations: [
      "Association with public statistics is evidence consistent with a cause, not proof of it.",
      "The business ledger in this demo is synthetic; the public drivers are real Eurostat series.",
    ],
    what_would_change: causes.length ? ["An input-cost invoice series that does not follow the public price index.", "A one-off event in the period that the ledger does not show."] : ["A longer history, or a cause outside the catalogue (for example a local event)."],
    actions: causes.some((c) => c.hypothesis.cause_type === "input_cost_cocoa" || c.hypothesis.cause_type === "supplier_change")
      ? ["Review list prices against the current input cost per unit.", "Ask suppliers for fixed-price contracts for the next season.", "Track cost per unit monthly so the next squeeze shows early."]
      : ["Keep tracking the figure monthly against the same period last year.", "Note any own actions (prices, opening hours, suppliers) so the next investigation can test them."],
  };
}

/** Remove leaked internal identifiers such as "(residual_step_pct)" or "[ev-12]" from owner-facing prose. Numbers are untouched. */
export function plain(text: string): string {
  return text
    .replace(/\s*[([]\s*(?:[a-z]+_[a-z0-9_]+|ev-[\w-]+)(?:\s*,\s*(?:[a-z]+_[a-z0-9_]+|ev-[\w-]+))*\s*[)\]]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export async function write(
  frame: Frame,
  results: HypothesisResult[],
  change: number,
  facts: string[],
  gen: Generator | null,
  trace?: Trace,
  feedback?: string,
  carryover?: string,
): Promise<{ card: ExplanationCard; source: "nemotron" | "offline" }> {
  const fixed = rejectedAndOffsets(results);
  if (gen) {
    try {
      const { value } = await generateJson(
        gen,
        "Writer",
        "You are the Writer. You explain an investigation's result to a small-business owner in plain English. Every claim must cite evidence ids from the table, and every number you write must come from the table (you may round, and you may turn a fraction like 0.94 into 94%). Never invent numbers, causes or data. Write for the owner: never put internal field names, snake_case identifiers or evidence ids in the sentence text (evidence ids go only in evidence_ids). Reply with JSON only.",
        [
          `Question: "${frame.question}". Metric: ${METRICS[frame.metric].label}; ${frame.period} vs ${frame.baseline}; overall change ${fmt(change, 2)} ${unitFor(frame.metric)}.`,
          facts.length ? `Owner-confirmed facts: ${facts.join("; ")}` : "",
          carryover ? `Investigation state (Meterless Markovian carryover):
${carryover}` : "",
          `Verdict table (decided by code; do not change verdicts):`,
          numberTable(results),
          feedback ? `\nThe Verifier struck these claims in your previous draft; fix them by using only numbers from the table:\n${feedback}` : "",
          `Return {"verdict": "one sentence answer naming the supported cause(s)", "chain": ["short causal steps"], "claims": [{"text": "one factual sentence with numbers from the table", "evidence_ids": ["ev-..."]}], "limitations": ["..."], "what_would_change": ["..."], "actions": ["2-3 concrete things the owner can do"]}`,
        ].join("\n"),
        Schema,
        trace,
      );
      const claims = value.claims.map((c, i) => ({ id: `c-${i + 1}`, text: plain(c.text), evidence_ids: c.evidence_ids }));
      return { card: { verdict: plain(value.verdict), chain: value.chain.map(plain), claims, limitations: value.limitations, what_would_change: value.what_would_change, actions: value.actions, ...fixed }, source: "nemotron" };
    } catch (e) {
      trace?.log("Writer", "fallback_offline", { error: (e as Error).message.slice(0, 200) });
    }
  }
  const card = offlineCard(frame, results, change);
  trace?.log("Writer", "drafted", { source: "offline", claims: card.claims.length });
  return { card: { ...card, ...fixed }, source: "offline" };
}
