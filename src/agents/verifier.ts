// Verifier (no LLM, veto): (1) re-executes every cited query and compares the result hash, (2) checks that
// every number written in a claim appears in the statistics of the evidence that claim cites, (3) checks that
// no sentence names a cause that was never tested in this run. Failing claims are struck before the owner sees them.
import type { DataAdapter } from "../adapters/zetaris.ts";
import { resultHash } from "../adapters/resultHash.ts";
import type { Trace } from "../orchestrator/trace.ts";
import type { CauseType, Claim, Evidence, HypothesisResult } from "./types.ts";

/** Words that name each catalogue cause in prose. */
const CAUSE_WORDS: Record<CauseType, RegExp> = {
  input_cost_cocoa: /\b(cocoa|cacao)\b/i,
  energy_cost: /\b(energy|electricity)\b/i,
  tourism_demand: /\b(touris[mt]s?|visitors?)\b/i,
  retail_demand: /\b(retail|consumer) (demand|spending|sales)\b/i,
  easter_shift: /\beaster\b/i,
  own_price_change: /\b(own prices?|price (increase|rise|change)s?|raised (its |our |their )?prices?)\b/i,
  sector_distress: /\b(bankrupt\w*|insolven\w*|sector distress)\b/i,
  supplier_change: /\bsuppliers?\b/i,
};

/** Causes a sentence names although this run never tested them (a model inventing a cause the code did not decide). */
export function untestedCausesNamed(text: string, results: HypothesisResult[]): CauseType[] {
  const tested = new Set(results.map((r) => r.hypothesis.cause_type));
  return (Object.keys(CAUSE_WORDS) as CauseType[]).filter((c) => !tested.has(c) && CAUSE_WORDS[c].test(text));
}

/** Numbers written in prose, excluding years and period labels such as H1, Q2, 2025-H1. */
export function extractNumbers(text: string): { value: number; decimals: number; raw: string; unit?: "pp" | "%" }[] {
  const out: { value: number; decimals: number; raw: string; unit?: "pp" | "%" }[] = [];
  // English prose: "14,068" and "1,234,567.5" use commas as thousands separators; "3,5" (one or two digits after
  // the comma) is read as a decimal comma.
  const re = /(?<![A-Za-z0-9.\-])(-|−)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?)(?![\d]*-[HQ]\d)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(m[2]!) ? m[2]!.replace(/,/g, "") : m[2]!.replace(",", ".");
    const before = text.slice(Math.max(0, m.index - 1), m.index);
    if (/[HhQq]/.test(before)) continue; // H1, Q2
    const v = Number(raw);
    if (/^(19|20)\d{2}$/.test(raw)) continue; // years
    if (/^\d{4}-\d{2}/.test(text.slice(m.index + (m[1] ? 1 : 0)))) continue; // 2025-03
    const decimals = raw.includes(".") ? raw.split(".")[1]!.length : 0;
    const after = text.slice(m.index + m[0].length);
    const unit = /^\s*(pp\b|percentage[- ]points?\b)/i.test(after) ? "pp" : /^\s*(%|percent\b)/i.test(after) ? "%" : undefined;
    out.push({ value: m[1] ? -v : v, decimals, raw: m[0], ...(unit ? { unit } : {}) });
  }
  return out;
}

export function candidateValues(results: HypothesisResult[], evidenceIds: string[]): number[] {
  const set = new Set<number>();
  for (const r of results) {
    if (!r.evidence_ids.some((id) => evidenceIds.includes(id))) continue;
    for (const v of Object.values(r.numbers)) {
      if (v === null || !Number.isFinite(v)) continue;
      set.add(v);
      set.add(Math.abs(v));
      if (Math.abs(v) <= 10) {
        set.add(v * 100);
        set.add(Math.abs(v * 100));
      }
    }
  }
  return [...set];
}

/** Values that are percentage points: fields named *_pp, and the outcome change itself (pp when the metric is margin). */
export function ppCandidates(results: HypothesisResult[], evidenceIds: string[]): number[] {
  const set = new Set<number>();
  for (const r of results) {
    if (!r.evidence_ids.some((id) => evidenceIds.includes(id))) continue;
    for (const [k, v] of Object.entries(r.numbers)) {
      if (v === null || !Number.isFinite(v)) continue;
      if (k.endsWith("_pp") || k === "outcome_change") set.add(Math.abs(v));
    }
  }
  return [...set];
}

export function numberMatches(n: { value: number; decimals: number }, candidates: number[]): boolean {
  const tol = 0.5 * 10 ** -n.decimals + 1e-9;
  return candidates.some((c) => Math.abs(Math.abs(n.value) - Math.abs(Number(c.toFixed(Math.min(n.decimals, 10))))) <= tol || Math.abs(Math.abs(n.value) - Math.abs(c)) <= tol);
}

export interface VerifyReport {
  claims: Claim[];
  requery: { evidence_id: string; ok: boolean; sha_before: string; sha_after: string }[];
  struck: number;
}

export async function verify(claims: Claim[], results: HypothesisResult[], evidence: Map<string, Evidence>, data: DataAdapter, trace?: Trace): Promise<VerifyReport> {
  const cited = [...new Set(claims.flatMap((c) => c.evidence_ids))].filter((id) => evidence.has(id));
  const requery: VerifyReport["requery"] = [];
  for (const id of cited) {
    const ev = evidence.get(id)!;
    try {
      const r = await data.query(ev.sql);
      const sha = resultHash(r.columns, r.rows);
      requery.push({ evidence_id: id, ok: sha === ev.sha256, sha_before: ev.sha256, sha_after: sha });
      trace?.log("Verifier", data.engine === "zetaris" ? "requery_zetaris" : "requery_snapshot", { evidence_id: id, ok: sha === ev.sha256 });
    } catch (e) {
      requery.push({ evidence_id: id, ok: false, sha_before: ev.sha256, sha_after: "error" });
      trace?.log("Verifier", "requery_failed", { evidence_id: id, error: (e as Error).message.slice(0, 160) });
    }
  }
  const badEvidence = new Set(requery.filter((r) => !r.ok).map((r) => r.evidence_id));
  let struck = 0;
  const out = claims.map((c) => {
    const ids = c.evidence_ids.filter((id) => evidence.has(id));
    if (ids.length === 0) {
      struck++;
      return { ...c, verified: false, struck_reason: "cites no known evidence" };
    }
    const bad = ids.find((id) => badEvidence.has(id));
    if (bad) {
      struck++;
      return { ...c, verified: false, struck_reason: `re-executed query ${bad} returned a different result` };
    }
    const untested = untestedCausesNamed(c.text, results);
    if (untested.length) {
      struck++;
      return { ...c, verified: false, struck_reason: `names a cause this run never tested (${untested.join(", ")})` };
    }
    const cands = candidateValues(results, ids);
    const nums = extractNumbers(c.text);
    const miss = nums.find((n) => !numberMatches(n, cands));
    if (miss) {
      struck++;
      return { ...c, verified: false, struck_reason: `the number ${miss.raw.trim()} does not appear in the cited evidence` };
    }
    const wrongCause = misattributedNumbers(c.text, results.filter((r) => r.evidence_ids.some((id) => ids.includes(id))))[0];
    if (wrongCause) {
      struck++;
      return { ...c, verified: false, struck_reason: `${wrongCause.raw} is credited to ${wrongCause.cause}, but it is not one of that cause's figures` };
    }
    const pp = ppCandidates(results, ids);
    const wrongUnit = nums.find((n) => n.unit === "pp" && !numberMatches(n, pp));
    if (wrongUnit) {
      struck++;
      return { ...c, verified: false, struck_reason: `${wrongUnit.raw.trim()} is written as percentage points, but in the evidence it is not a percentage-point figure` };
    }
    return { ...c, verified: true };
  });
  trace?.log("Verifier", "verified", { claims: out.length, struck, requeried: requery.length, requery_failures: badEvidence.size, details: out.map((c) => ({ id: c.id, verified: c.verified, reason: c.struck_reason ?? null })) });
  return { claims: out, requery, struck };
}

/** Numbers every hypothesis shares: the outcome itself. Any clause may quote them. */
const SHARED_KEYS = new Set(["outcome_change", "outcome_z", "delta_margin_pp"]);

function expand(values: number[]): number[] {
  const out = new Set<number>();
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    out.add(v);
    out.add(Math.abs(v));
    if (Math.abs(v) <= 10) {
      out.add(v * 100);
      out.add(Math.abs(v * 100));
    }
  }
  return [...out];
}

/**
 * Attribution check. A clause that names exactly one tested cause may only use that cause's own numbers (plus the
 * shared outcome figures). This catches a true number credited to the wrong cause, e.g. cocoa's -12.16 pp cost effect
 * written as the supplier change's effect. Clauses naming several causes, or none, are left to the number check.
 */
export function misattributedNumbers(text: string, results: HypothesisResult[]): { raw: string; cause: CauseType }[] {
  const tested = new Map(results.map((r) => [r.hypothesis.cause_type, r]));
  const shared: number[] = [];
  for (const r of results) for (const [k, v] of Object.entries(r.numbers)) if (SHARED_KEYS.has(k) && v !== null) shared.push(v);
  const out: { raw: string; cause: CauseType }[] = [];
  for (const clause of text.split(/;|(?<=[.!?])\s+/)) {
    const named = (Object.keys(CAUSE_WORDS) as CauseType[]).filter((c) => tested.has(c) && CAUSE_WORDS[c].test(clause));
    if (named.length !== 1) continue;
    const own = Object.values(tested.get(named[0]!)!.numbers).filter((v): v is number => v !== null);
    const cands = expand([...own, ...shared]);
    for (const n of extractNumbers(clause)) if (!numberMatches(n, cands)) out.push({ raw: n.raw.trim(), cause: named[0]! });
  }
  return out;
}

/** Problems in the headline verdict: numbers that are in no evidence, numbers credited to the wrong cause. */
export function verdictProblems(verdict: string, results: HypothesisResult[]): string[] {
  const all = expand(results.flatMap((r) => Object.values(r.numbers).filter((v): v is number => v !== null)));
  const problems = extractNumbers(verdict).filter((n) => !numberMatches(n, all)).map((n) => `${n.raw.trim()} is in no evidence`);
  for (const m of misattributedNumbers(verdict, results)) problems.push(`${m.raw} is not a figure of ${m.cause}`);
  return problems;
}
