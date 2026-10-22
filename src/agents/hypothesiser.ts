// Hypothesiser: proposes RIVAL explanations, each tied to a catalogue cause the Analyst knows how to test.
// Nemotron Super chooses and argues; the catalogue bounds what can be proposed (a model cannot invent a test).
// Offline: every applicable non-calendar cause (calendar effects are the Skeptic's to raise).
import { z } from "zod";
import { generateJson, type Generator } from "../meterless/generator.ts";
import type { Trace } from "../orchestrator/trace.ts";
import { METRICS } from "../tests/compiler.ts";
import { applicableCauses, CAUSES } from "./catalogue.ts";
import type { CauseType, Frame, Hypothesis } from "./types.ts";
import type { OwnerFact } from "../meterless/memory.ts";

const Schema = z.object({
  hypotheses: z
    .array(z.object({ cause_type: z.string(), why_plausible: z.string().max(400), refuted_if: z.string().max(300) }))
    .min(1)
    .max(8),
});

export interface HypothesiserInput {
  frame: Frame;
  business: { name: string; sector: string; nace: string; city: string };
  outcome: { change: number; unit: string };
  facts: OwnerFact[];
  max: number;
}

export async function propose(input: HypothesiserInput, gen: Generator | null, trace?: Trace): Promise<{ hypotheses: Hypothesis[]; source: "nemotron" | "offline" }> {
  const { frame, facts } = input;
  const allowed = applicableCauses(frame.metric, input.business.nace, facts.filter((f) => f.cause_type).map((f) => ({ cause_type: f.cause_type! })));
  const initialAllowed = allowed.filter((c) => c.type !== "easter_shift");
  const factHyps = (): Hypothesis[] =>
    facts
      .filter((f) => f.cause_type && allowed.some((c) => c.type === f.cause_type))
      .map((f) => ({ id: "", cause_type: f.cause_type!, title: CAUSES[f.cause_type!].title, mechanism: `Owner said: "${f.text}"`, proposed_by: "Memory" as const, params: f.params }));

  let chosen: { cause_type: CauseType; mechanism: string; proposed_by: Hypothesis["proposed_by"] }[] = [];
  let source: "nemotron" | "offline" = "offline";
  if (gen) {
    try {
      const { value } = await generateJson(
        gen,
        "Hypothesiser",
        "You are the Hypothesiser in an investigation team for a small business. You propose RIVAL explanations; you never decide which is right (code tests them). Reply with JSON only.",
        [
          `Business: ${input.business.name}, ${input.business.sector} (NACE ${input.business.nace}), ${input.business.city}, Belgium. Its data is synthetic (a demo business).`,
          `Question: "${frame.question}"`,
          `Observed: ${METRICS[frame.metric].label} changed by ${input.outcome.change.toFixed(2)} ${input.outcome.unit} in ${frame.period} versus ${frame.baseline}.`,
          facts.length ? `Facts the owner confirmed earlier (from memory): ${facts.map((f) => `"${f.text}"`).join("; ")}` : "No owner facts in memory.",
          `You may ONLY choose cause_type values from this catalogue (each has a test the analyst can run):`,
          ...initialAllowed.map((c) => `- ${c.type}: ${c.title} - ${c.mechanism}`),
          `Propose the ${Math.min(input.max, initialAllowed.length)} most plausible rival explanations as {"hypotheses":[{"cause_type": "...", "why_plausible": "one sentence", "refuted_if": "what result would refute it"}]}. Include any cause linked to an owner fact.`,
        ].join("\n"),
        Schema,
        trace,
      );
      const seen = new Set<string>();
      for (const h of value.hypotheses) {
        if (!initialAllowed.some((c) => c.type === h.cause_type) || seen.has(h.cause_type)) {
          trace?.log("Hypothesiser", "rejected_out_of_catalogue", { cause_type: h.cause_type });
          continue;
        }
        seen.add(h.cause_type);
        chosen.push({ cause_type: h.cause_type as CauseType, mechanism: h.why_plausible, proposed_by: "Hypothesiser" });
      }
      source = "nemotron";
    } catch (e) {
      trace?.log("Hypothesiser", "fallback_offline", { error: (e as Error).message.slice(0, 200) });
    }
  }
  if (chosen.length < Math.min(3, initialAllowed.length)) {
    // Offline (or too few valid rivals): every applicable non-calendar cause, in catalogue order.
    for (const c of initialAllowed) if (!chosen.some((x) => x.cause_type === c.type)) chosen.push({ cause_type: c.type, mechanism: c.mechanism, proposed_by: "Hypothesiser" });
  }
  for (const fh of factHyps()) {
    const existing = chosen.find((c) => c.cause_type === fh.cause_type);
    if (existing) existing.proposed_by = "Memory";
    else chosen.push({ cause_type: fh.cause_type, mechanism: fh.mechanism, proposed_by: "Memory" });
  }
  chosen = chosen.slice(0, Math.max(input.max, factHyps().length));
  const hypotheses: Hypothesis[] = chosen.map((c, i) => {
    const fact = facts.find((f) => f.cause_type === c.cause_type);
    return { id: `hyp-${i + 1}`, cause_type: c.cause_type, title: CAUSES[c.cause_type].title, mechanism: c.mechanism, proposed_by: c.proposed_by, params: fact?.params };
  });
  trace?.log("Hypothesiser", "proposed", { source, hypotheses: hypotheses.map((h) => ({ id: h.id, cause_type: h.cause_type, proposed_by: h.proposed_by })) });
  return { hypotheses, source };
}
