// Shared agent types (validated with zod at model boundaries in the agents that call models).
import type { Metric, TestSpec } from "../tests/compiler.ts";
import type { RuleResult } from "../stats/rules.ts";

export interface Frame {
  business_id: string;
  metric: Metric;
  period: string; // spec, e.g. "2025-H1"
  baseline: string; // spec, e.g. "2024-H1"
  geo: "BE";
  question: string;
}

export type CauseType =
  | "input_cost_cocoa"
  | "energy_cost"
  | "tourism_demand"
  | "retail_demand"
  | "easter_shift"
  | "own_price_change"
  | "sector_distress"
  | "supplier_change";

export interface Hypothesis {
  id: string; // hyp-1...
  cause_type: CauseType;
  title: string;
  mechanism: string;
  proposed_by: "Hypothesiser" | "Skeptic" | "Memory";
  /** Optional, e.g. the date from an owner fact (supplier change). */
  params?: Record<string, string | number>;
}

export interface Evidence {
  id: string; // ev-<sha8>
  hypothesis_id: string;
  purpose: string;
  spec: TestSpec;
  sql: string; // exactly as executed on the engine
  engine: "zetaris" | "duckdb-snapshot";
  executed_at: string;
  columns: string[];
  rows: unknown[][]; // full result (results here are small)
  row_count: number;
  sha256: string;
  statistic?: Record<string, unknown>;
  source_tables: string[];
}

export interface HypothesisResult {
  hypothesis: Hypothesis;
  evidence_ids: string[];
  verdict: RuleResult["verdict"];
  rule: string;
  confidence: RuleResult["confidence"];
  role: "cause" | "offset" | "none";
  numbers: Record<string, number | null>; // key statistics the Writer may cite
}

export interface Challenge {
  id: string;
  target_hypothesis_id: string;
  confounder: string;
  argument: string;
  required_test: CauseType | "excluding_easter_months" | "residual_after_driver";
  resolved?: boolean;
  outcome?: string;
}

export interface Claim {
  id: string;
  text: string;
  evidence_ids: string[];
  verified?: boolean;
  struck_reason?: string;
}

export interface ExplanationCard {
  verdict: string;
  chain: string[];
  claims: Claim[];
  rejected: { hypothesis: string; why: string; evidence_ids: string[] }[];
  offsets: { hypothesis: string; why: string; evidence_ids: string[] }[];
  limitations: string[];
  what_would_change: string[];
  actions: string[];
}
