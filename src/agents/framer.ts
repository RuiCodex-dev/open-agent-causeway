// Framer: turns the owner's question into a Frame (metric, period, baseline) or asks ONE clarifying question.
// Nemotron Lightning (fast) proposes; deterministic parsing validates and fills gaps; offline uses parsing only.
import { z } from "zod";
import { generateJson, type Generator } from "../meterless/generator.ts";
import type { Trace } from "../orchestrator/trace.ts";
import { expandPeriodSpec } from "../stats/series.ts";
import type { Metric } from "../tests/compiler.ts";
import type { Frame } from "./types.ts";

export type FrameResult = { status: "ok"; frame: Frame; source: "nemotron" | "rules" } | { status: "needs_clarification"; question: string; source: "nemotron" | "rules" };

const METRIC_WORDS: [RegExp, Metric][] = [
  [/\bmargin|gross profit|profitab/i, "gross_margin_pct"],
  [/\bticket|basket|spend per (customer|visit)/i, "avg_ticket"],
  [/\bunits?\b|how many|number of .* (sold|we sold)|bikes|items sold|volume/i, "units"],
  [/\brevenue|sales|turnover|takings|income/i, "revenue"],
];

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export function parseMetric(q: string): Metric | null {
  for (const [re, m] of METRIC_WORDS) if (re.test(q)) return m;
  return null;
}

/** Finds period specs in order of appearance: "H1 2025", "first half of 2025", "Q2 2026", "2024", "March 2025". */
export function parsePeriods(q: string): string[] {
  const out: { at: number; spec: string }[] = [];
  const s = q.toLowerCase();
  const add = (at: number, spec: string) => out.push({ at, spec });
  let m: RegExpExecArray | null;
  const h = /\b(?:h([12])\s*(\d{4})|(\d{4})[- ]h([12])|(first|second) half of (\d{4}))\b/g;
  while ((m = h.exec(s))) add(m.index, m[1] ? `${m[2]}-H${m[1]}` : m[3] ? `${m[3]}-H${m[4]}` : `${m[6]}-H${m[5] === "first" ? 1 : 2}`);
  const qq = /\b(?:q([1-4])\s*(\d{4})|(\d{4})[- ]q([1-4]))\b/g;
  while ((m = qq.exec(s))) add(m.index, m[1] ? `${m[2]}-Q${m[1]}` : `${m[3]}-Q${m[4]}`);
  const mo = new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{4})\\b`, "g");
  while ((m = mo.exec(s))) add(m.index, `${m[2]}-${String(MONTHS.indexOf(m[1]!) + 1).padStart(2, "0")}`);
  const y = /\b(20\d{2})\b/g;
  while ((m = y.exec(s))) {
    const at = m.index;
    if (!out.some((o) => o.at <= at && at <= o.at + 24)) add(at, m[1]!);
  }
  return out.sort((a, b) => a.at - b.at).map((o) => o.spec).filter((sp) => {
    try {
      return expandPeriodSpec(sp).length > 0;
    } catch {
      return false;
    }
  });
}

export function ruleFrame(question: string, businessId: string, hints: { metric?: Metric; period?: string; baseline?: string }): FrameResult {
  const metric = hints.metric ?? parseMetric(question);
  const periods = parsePeriods(question);
  const period = hints.period ?? periods[0];
  const baseline = hints.baseline ?? periods[1];
  if (!metric || !period) {
    const missing = !metric && !period ? "which figure (revenue, units sold, gross margin or average ticket) and which period" : !metric ? "which figure you mean: revenue, units sold, gross margin or average ticket" : "which period you mean, for example 'the first half of 2025' or 'Q2 2026'";
    return { status: "needs_clarification", question: `To investigate this properly I need to know ${missing}. Could you tell me?`, source: "rules" };
  }
  return { status: "ok", frame: { business_id: businessId, metric, period, baseline: baseline ?? defaultBaseline(period), geo: "BE", question }, source: "rules" };
}

export function defaultBaseline(period: string): string {
  const m = /^(\d{4})(.*)$/.exec(period);
  if (!m) return period;
  if (/^\d{4}\.\.\d{4}/.test(period)) return period;
  return `${Number(m[1]) - 1}${m[2]}`;
}

const FrameSchema = z.object({
  metric: z.enum(["revenue", "units", "gross_margin_pct", "avg_ticket"]).nullable(),
  period: z.string().nullable(),
  baseline: z.string().nullable(),
  ambiguous: z.boolean(),
  clarifying_question: z.string().nullable(),
});

export async function frameQuestion(
  question: string,
  businessId: string,
  hints: { metric?: Metric; period?: string; baseline?: string },
  gen: Generator | null,
  trace?: Trace,
): Promise<FrameResult> {
  const rules = ruleFrame(question, businessId, hints);
  if (!gen) {
    trace?.log("Framer", "frame", { source: "rules", result: rules });
    return rules;
  }
  try {
    const { value } = await generateJson(
      gen,
      "Framer",
      "You frame a small-business owner's 'why' question for an analytics agent. Reply with JSON only.",
      `Question: "${question}"\nHints from the request (may be empty): ${JSON.stringify(hints)}\n\nReturn {"metric": one of "revenue","units","gross_margin_pct","avg_ticket" or null, "period": a spec like "2025-H1", "2026-Q2", "2024" or "2025-03" or null, "baseline": the comparison period spec or null if not stated, "ambiguous": true if the metric or period cannot be determined, "clarifying_question": one short question if ambiguous else null}.`,
      FrameSchema,
      trace,
    );
    const metric = (hints.metric ?? value.metric ?? (rules.status === "ok" ? rules.frame.metric : null)) as Metric | null;
    const period = hints.period ?? validSpec(value.period) ?? (rules.status === "ok" ? rules.frame.period : null);
    const baseline = hints.baseline ?? validSpec(value.baseline) ?? (period ? defaultBaseline(period) : null);
    if (!metric || !period || (value.ambiguous && rules.status !== "ok")) {
      const q = value.clarifying_question ?? (rules.status === "needs_clarification" ? rules.question : "Which figure and which period do you mean?");
      const res: FrameResult = { status: "needs_clarification", question: q, source: "nemotron" };
      trace?.log("Framer", "frame", { source: "nemotron", result: res });
      return res;
    }
    const res: FrameResult = { status: "ok", frame: { business_id: businessId, metric, period, baseline: baseline!, geo: "BE", question }, source: "nemotron" };
    trace?.log("Framer", "frame", { source: "nemotron", result: res });
    return res;
  } catch (e) {
    trace?.log("Framer", "fallback_rules", { error: (e as Error).message.slice(0, 200) });
    return rules;
  }
}

function validSpec(s: string | null): string | null {
  if (!s) return null;
  try {
    return expandPeriodSpec(s).length > 0 ? s : null;
  } catch {
    return null;
  }
}
