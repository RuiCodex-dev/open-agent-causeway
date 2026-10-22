// Skeptic: attacks every "supported" verdict with a named confounder whose test has not run yet.
// Veto: a supported verdict cannot reach the Writer until the challenge tests have run (bounded rounds).
// Nemotron Super argues; the confounder must be a catalogue cause the Analyst can test. Offline: rule table.
import { z } from "zod";
import { generateJson, type Generator } from "../meterless/generator.ts";
import type { Trace } from "../orchestrator/trace.ts";
import { applicableCauses, CAUSES } from "./catalogue.ts";
import type { CauseType, Challenge, Frame, HypothesisResult } from "./types.ts";

const Schema = z.object({
  approve: z.boolean(),
  challenges: z.array(z.object({ target_hypothesis_id: z.string(), confounder: z.string(), argument: z.string().max(500) })).max(4),
});

/** Confounders the Skeptic may raise: applicable causes not yet tested in this run. */
export function openConfounders(frame: Frame, nace: string, tested: CauseType[]): CauseType[] {
  return applicableCauses(frame.metric, nace).map((c) => c.type).filter((t) => !tested.includes(t) && t !== "supplier_change");
}

export function offlineChallenges(results: HypothesisResult[], open: CauseType[], round: number): Challenge[] {
  const out: Challenge[] = [];
  const priority: CauseType[] = ["easter_shift", "own_price_change", "energy_cost", "retail_demand", "tourism_demand"];
  for (const r of results.filter((x) => x.verdict === "supported")) {
    for (const p of priority) {
      if (!open.includes(p) || out.some((c) => c.required_test === p)) continue;
      out.push({
        id: `ch-${round}-${out.length + 1}`,
        target_hypothesis_id: r.hypothesis.id,
        confounder: CAUSES[p].title,
        argument: `Before accepting "${r.hypothesis.title}", rule out ${CAUSES[p].title.toLowerCase()}: ${CAUSES[p].mechanism}`,
        required_test: p,
      });
      break;
    }
  }
  return out;
}

export async function review(
  frame: Frame,
  nace: string,
  results: HypothesisResult[],
  round: number,
  gen: Generator | null,
  trace?: Trace,
  carryover?: string,
): Promise<{ challenges: Challenge[]; approve: boolean; source: "nemotron" | "offline" }> {
  const tested = results.map((r) => r.hypothesis.cause_type);
  const open = openConfounders(frame, nace, tested);
  const supported = results.filter((r) => r.verdict === "supported");
  if (open.length === 0) {
    trace?.log("Skeptic", "approve", { round, reason: "no untested confounders left" });
    return { challenges: [], approve: true, source: gen ? "nemotron" : "offline" };
  }
  if (supported.length === 0) {
    // Challenge the null: before concluding that nothing explains the change, run the calendar and own-action tests.
    const nullTests = (["easter_shift", "own_price_change"] as CauseType[]).filter((t) => open.includes(t));
    if (round > 1 || nullTests.length === 0) {
      trace?.log("Skeptic", "approve", { round, reason: "nothing supported and no calendar or own-action test left" });
      return { challenges: [], approve: true, source: "offline" };
    }
    const challenges: Challenge[] = nullTests.map((t, i) => ({
      id: `ch-${round}-${i + 1}`,
      target_hypothesis_id: "null",
      confounder: CAUSES[t].title,
      argument: `No explanation is supported yet. Before concluding that nothing external happened, test ${CAUSES[t].title.toLowerCase()}: ${CAUSES[t].mechanism}`,
      required_test: t,
    }));
    trace?.log("Skeptic", "challenge", { round, source: "rule", target: "null", challenges });
    return { challenges, approve: false, source: "offline" };
  }
  if (gen) {
    try {
      const table = results.map((r) => `- ${r.hypothesis.id} ${r.hypothesis.title}: ${r.verdict.toUpperCase()} (${r.rule}); numbers ${JSON.stringify(r.numbers)}`).join("\n");
      const { value } = await generateJson(
        gen,
        "Skeptic",
        "You are the Skeptic in an investigation team. Your job is to stop the team from accepting an explanation too early. Attack each SUPPORTED verdict with the most dangerous untested confounder. You cannot run tests yourself; you name which test must run. Reply with JSON only.",
        [
          `Question: "${frame.question}" (${frame.metric}, ${frame.period} vs ${frame.baseline}).`,
          carryover ? `Investigation state carried over from earlier rounds (Meterless Markovian carryover):
${carryover}` : "",
          `Verdicts so far (decided by code from statistics):`,
          table,
          `Untested confounders you may demand (use these exact ids as "confounder"):`,
          ...open.map((t) => `- ${t}: ${CAUSES[t].mechanism}`),
          `Return {"approve": false, "challenges":[{"target_hypothesis_id":"hyp-n","confounder":"<id>","argument":"one or two sentences: why this could fake the supported result"}]}. Return {"approve": true, "challenges": []} only if no listed confounder could plausibly explain a supported result.`,
        ].join("\n"),
        Schema,
        trace,
      );
      const challenges: Challenge[] = [];
      for (const c of value.challenges) {
        if (!open.includes(c.confounder as CauseType) || !supported.some((s) => s.hypothesis.id === c.target_hypothesis_id) || challenges.some((x) => x.required_test === c.confounder)) {
          trace?.log("Skeptic", "rejected_challenge", { confounder: c.confounder, target: c.target_hypothesis_id });
          continue;
        }
        challenges.push({ id: `ch-${round}-${challenges.length + 1}`, target_hypothesis_id: c.target_hypothesis_id, confounder: CAUSES[c.confounder as CauseType].title, argument: c.argument, required_test: c.confounder as CauseType });
      }
      // The veto is enforced in code: a supported verdict must face at least one open confounder in round 1.
      if (challenges.length === 0 && round === 1) challenges.push(...offlineChallenges(results, open, round));
      trace?.log("Skeptic", challenges.length ? "challenge" : "approve", { round, source: "nemotron", challenges });
      return { challenges, approve: challenges.length === 0, source: "nemotron" };
    } catch (e) {
      trace?.log("Skeptic", "fallback_offline", { error: (e as Error).message.slice(0, 200) });
    }
  }
  const challenges = offlineChallenges(results, open, round);
  trace?.log("Skeptic", challenges.length ? "challenge" : "approve", { round, source: "offline", challenges });
  return { challenges, approve: challenges.length === 0, source: "offline" };
}

/** After a challenge test ran: if the confounder itself is supported, the target loses its standing. */
export function resolveChallenge(target: HypothesisResult, challenge: Challenge, confounder: HypothesisResult): HypothesisResult {
  challenge.resolved = true;
  if (confounder.verdict === "supported" && confounder.role === "cause") {
    challenge.outcome = `${confounder.hypothesis.title} is also supported, so ${target.hypothesis.title} cannot be credited alone`;
    const downgraded: HypothesisResult = {
      ...target,
      verdict: target.confidence === "high" ? "supported" : "inconclusive",
      confidence: target.confidence === "high" ? "medium" : "low",
      rule: `${target.rule}; Skeptic: confounded by ${confounder.hypothesis.title.toLowerCase()} (${challenge.id})`,
    };
    return downgraded;
  }
  challenge.outcome = `${confounder.hypothesis.title} is ${confounder.verdict}: ${confounder.rule}`;
  return { ...target, rule: `${target.rule}; survived Skeptic challenge ${challenge.id} (${confounder.hypothesis.title.toLowerCase()} ${confounder.verdict})` };
}
