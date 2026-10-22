import { describe, expect, it } from "vitest";
import { extractNumbers, numberMatches, candidateValues, verify } from "./verifier.ts";
import { parseMetric, parsePeriods, ruleFrame, defaultBaseline } from "./framer.ts";
import { applicableCauses } from "./catalogue.ts";
import { compile, resolve } from "../tests/compiler.ts";
import { extractJson } from "../meterless/generator.ts";
import { interpretFact } from "../meterless/memory.ts";
import type { DataAdapter, QueryResult } from "../adapters/zetaris.ts";
import { resultHash } from "../adapters/resultHash.ts";
import type { Evidence, HypothesisResult } from "./types.ts";

describe("Verifier number extraction", () => {
  it("finds numbers but skips years and period labels", () => {
    const ns = extractNumbers("Margin fell 10.01 points in 2025-H1 vs H1 2024; cocoa rose 10.7% (r=0.94) in Q2.");
    expect(ns.map((n) => n.value)).toEqual([10.01, 10.7, 0.94]);
  });
  it("matches with rounding tolerance and percent-of-fraction", () => {
    expect(numberMatches({ value: 10, decimals: 0 }, [-10.013])).toBe(true);
    expect(numberMatches({ value: 94, decimals: 0 }, candidateValues([res({ assoc_r: 0.9417 }, ["ev-1"])], ["ev-1"]))).toBe(true);
    expect(numberMatches({ value: 24, decimals: 0 }, [21.8])).toBe(false);
  });
});

function res(numbers: Record<string, number>, evidence_ids: string[]): HypothesisResult {
  return { hypothesis: { id: "hyp-1", cause_type: "input_cost_cocoa", title: "t", mechanism: "m", proposed_by: "Hypothesiser" }, evidence_ids, verdict: "supported", rule: "r", confidence: "high", role: "cause", numbers };
}

describe("Verifier veto", () => {
  const rows = [["2025-01", 1.5]];
  const columns = ["period", "value"];
  const ev: Evidence = { id: "ev-1", hypothesis_id: "hyp-1", purpose: "p", spec: { kind: "calendar", periods: ["2025-01"] }, sql: "SELECT 1", engine: "duckdb-snapshot", executed_at: "", columns, rows, row_count: 1, sha256: resultHash(columns, rows), source_tables: [] };
  const same: DataAdapter = { engine: "duckdb-snapshot", query: async (): Promise<QueryResult> => ({ columns, rows, engine: "duckdb-snapshot", elapsed_ms: 1 }) };
  const changed: DataAdapter = { engine: "duckdb-snapshot", query: async (): Promise<QueryResult> => ({ columns, rows: [["2025-01", 9]], engine: "duckdb-snapshot", elapsed_ms: 1 }) };
  const results = [res({ driver_change_pct: 10.72 }, ["ev-1"])];
  it("strikes a claim whose number is not in the cited evidence and keeps a grounded one", async () => {
    const r = await verify(
      [
        { id: "c-1", text: "Cocoa rose 10.7% between the windows.", evidence_ids: ["ev-1"] },
        { id: "c-2", text: "Cocoa rose 24% between the windows.", evidence_ids: ["ev-1"] },
        { id: "c-3", text: "Something without evidence.", evidence_ids: ["ev-404"] },
      ],
      results,
      new Map([["ev-1", ev]]),
      same,
    );
    expect(r.claims.map((c) => c.verified)).toEqual([true, false, false]);
    expect(r.struck).toBe(2);
  });
  it("strikes claims when a re-executed query returns a different result", async () => {
    const r = await verify([{ id: "c-1", text: "Cocoa rose 10.7%.", evidence_ids: ["ev-1"] }], results, new Map([["ev-1", ev]]), changed);
    expect(r.claims[0]!.verified).toBe(false);
    expect(r.claims[0]!.struck_reason).toMatch(/different result/);
  });
});

describe("Framer rules", () => {
  it("parses metric and periods", () => {
    expect(parseMetric("Why did our gross margin fall?")).toBe("gross_margin_pct");
    expect(parseMetric("why did revenue drop")).toBe("revenue");
    expect(parsePeriods("in the first half of 2025 compared with H1 2024")).toEqual(["2025-H1", "2024-H1"]);
    expect(parsePeriods("Q2 2026 vs Q2 2025")).toEqual(["2026-Q2", "2025-Q2"]);
    expect(defaultBaseline("2025-H1")).toBe("2024-H1");
  });
  it("asks one clarifying question when the metric and period are missing", () => {
    const r = ruleFrame("Why are things bad lately?", "atelier-noir", {});
    expect(r.status).toBe("needs_clarification");
  });
});

describe("catalogue and compiler", () => {
  it("restricts causes to the metric and sector, and supplier change to owner facts", () => {
    const margin = applicableCauses("gross_margin_pct", "G47.24").map((c) => c.type);
    expect(margin).toContain("input_cost_cocoa");
    expect(margin).not.toContain("tourism_demand");
    expect(margin).not.toContain("supplier_change");
    expect(applicableCauses("gross_margin_pct", "G47.24", [{ cause_type: "supplier_change" }]).map((c) => c.type)).toContain("supplier_change");
  });
  it("compiles specs to placeholder SQL and resolves per engine; rejects injected literals", () => {
    const sql = compile({ kind: "driver_series", series_id: "hicp_choc_i15", from: "2024-01", to: "2025-06" });
    expect(resolve(sql, "zetaris")).toContain("lightning.metastore.causeway_ns.causeway.driver_month");
    expect(resolve(sql, "duckdb-snapshot")).toContain("FROM driver_month d");
    expect(() => compile({ kind: "driver_series", series_id: "x' OR 1=1 --", from: "2024-01", to: "2025-06" })).toThrow();
  });
});

describe("model JSON and owner facts", () => {
  it("extracts JSON from prose and repairs unquoted evidence ids", () => {
    expect(extractJson('Sure! ```json\n{"a": [1,2]}\n```')).toEqual({ a: [1, 2] });
    expect(extractJson('{"ids": ["ev-1234abcd", ev-5678ef90]}')).toEqual({ ids: ["ev-1234abcd", "ev-5678ef90"] });
  });
  it("maps owner sentences to testable causes with a start month", () => {
    expect(interpretFact("We switched our couverture supplier in May 2025.")).toEqual({ cause_type: "supplier_change", params: { from: "2025-05" } });
    expect(interpretFact("We raised prices by 6% on 1 April 2025").cause_type).toBe("own_price_change");
  });
});
