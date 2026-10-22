// Verifier (no LLM, veto): (1) re-executes every cited query and compares the result hash, (2) checks that
// every number written in a claim appears in the statistics of the evidence that claim cites.
// Failing claims are struck before the owner sees them.
import type { DataAdapter } from "../adapters/zetaris.ts";
import { resultHash } from "../adapters/resultHash.ts";
import type { Trace } from "../orchestrator/trace.ts";
import type { Claim, Evidence, HypothesisResult } from "./types.ts";

/** Numbers written in prose, excluding years and period labels such as H1, Q2, 2025-H1. */
export function extractNumbers(text: string): { value: number; decimals: number; raw: string }[] {
  const out: { value: number; decimals: number; raw: string }[] = [];
  const re = /(?<![A-Za-z0-9.\-])(-|−)?(\d+(?:[.,]\d+)?)(?![\d]*-[HQ]\d)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[2]!.replace(",", ".");
    const before = text.slice(Math.max(0, m.index - 1), m.index);
    if (/[HhQq]/.test(before)) continue; // H1, Q2
    const v = Number(raw);
    if (/^(19|20)\d{2}$/.test(raw)) continue; // years
    if (/^\d{4}-\d{2}/.test(text.slice(m.index + (m[1] ? 1 : 0)))) continue; // 2025-03
    const decimals = raw.includes(".") ? raw.split(".")[1]!.length : 0;
    out.push({ value: m[1] ? -v : v, decimals, raw: m[0] });
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
    const cands = candidateValues(results, ids);
    const nums = extractNumbers(c.text);
    const miss = nums.find((n) => !numberMatches(n, cands));
    if (miss) {
      struck++;
      return { ...c, verified: false, struck_reason: `the number ${miss.raw.trim()} does not appear in the cited evidence` };
    }
    return { ...c, verified: true };
  });
  trace?.log("Verifier", "verified", { claims: out.length, struck, requeried: requery.length, requery_failures: badEvidence.size, details: out.map((c) => ({ id: c.id, verified: c.verified, reason: c.struck_reason ?? null })) });
  return { claims: out, requery, struck };
}
