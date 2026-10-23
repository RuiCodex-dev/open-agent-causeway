/** Shared API and UI types for Causeway. */

export type DataMode = "zetaris" | "snapshot" | "snapshot (failover)" | string;
export type Reasoner = "nemotron" | "offline" | string;
export type Verdict = "supported" | "contradicted" | "inconclusive";
export type HypothesisStatus = "pending" | "tested" | Verdict;
export type ProposedBy = "Hypothesiser" | "Skeptic" | "Memory" | string;
export type ReasonerChoice = "auto" | "offline";

export interface HealthResponse {
  status: string;
  service?: string;
  version?: string;
  model_provider: string;
  zetaris_configured: boolean;
  snapshot_available: boolean;
}

export interface Business {
  business_id: string;
  name: string;
  city: string;
  nace: string;
  sector: string;
  synthetic: boolean | string;
}

export interface BusinessesResponse {
  data_mode: DataMode;
  businesses: Business[];
}

export interface RunRequest {
  input: {
    question: string;
    business_id: string;
    period?: string;
    baseline?: string;
  };
  options?: {
    reasoner?: ReasonerChoice;
    sample_mode?: boolean | null;
  };
}

export interface RunAccepted {
  run_id: string;
  events: string;
  result: string;
}

export interface TraceLine {
  ts: string;
  run_id: string;
  step: number;
  agent: string;
  action: string;
  [key: string]: unknown;
}

export interface Claim {
  id: string;
  text: string;
  evidence_ids: string[];
  verified?: boolean;
  struck_reason?: string;
}

export interface RejectedOrOffset {
  hypothesis: string;
  why: string;
  evidence_ids: string[];
}

export interface MemoryUsed {
  fact: string;
  memory_id: string;
  source?: string;
  cause_type?: string | null;
}

export interface ExplanationOutput {
  verdict?: string;
  chain?: string[];
  claims?: Claim[];
  struck_claims?: Claim[];
  rejected?: RejectedOrOffset[];
  offsets?: RejectedOrOffset[];
  limitations?: string[];
  what_would_change?: string[];
  actions?: string[];
  memory_used?: MemoryUsed[];
  clarifying_question?: string;
}

export interface HypothesisResult {
  id: string;
  title: string;
  cause_type: string;
  proposed_by: ProposedBy;
  verdict: Verdict;
  confidence: string;
  role: string;
  rule: string;
  numbers: Record<string, number | null>;
  evidence_ids: string[];
}

export interface Challenge {
  id: string;
  target_hypothesis_id: string;
  confounder: string;
  argument: string;
  required_test?: string;
  resolved?: boolean;
  outcome?: string;
}

export interface EvidenceItem {
  id: string;
  purpose: string;
  engine: "zetaris" | "duckdb-snapshot" | string;
  sql: string;
  columns: string[];
  rows_preview: unknown[][];
  row_count: number;
  sha256: string;
  source_tables: string[];
  executed_at: string;
}

export interface VerificationReport {
  requery: { evidence_id: string; ok: boolean; sha_before?: string; sha_after?: string }[];
  struck: number;
  revisions: number;
}

export interface ModelCall {
  provider: string;
  model: string | null;
  ok: boolean;
  failover: boolean;
}

export interface Frame {
  business_id: string;
  metric: string;
  period: string;
  baseline: string;
  geo?: string;
  question: string;
}

export interface RunResult {
  run_id: string;
  data_mode: DataMode;
  reasoner: Reasoner;
  status: "success" | "needs_clarification" | "error" | string;
  frame?: Frame;
  output?: ExplanationOutput;
  hypotheses?: HypothesisResult[];
  challenges?: Challenge[];
  verdict_changes?: { hypothesis_id: string; before: string; after: string; by: string }[];
  evidence?: EvidenceItem[];
  verification?: VerificationReport;
  model_calls?: ModelCall[];
  execution_time_seconds?: number;
  error?: { type: string; message: string; recoverable?: boolean };
  agents?: { name: string; role: string }[];
  trace_id?: string;
}

export interface OwnerFact {
  id: string;
  text: string;
  cause_type: string | null;
  params: Record<string, string>;
  created: string;
}

export interface MemoryResponse {
  business_id?: string;
  facts: OwnerFact[];
  ledger: Record<string, number>;
}

export interface MemoryStoreResponse {
  status: string;
  fact: OwnerFact;
}

export interface LiveHypothesis {
  id: string;
  title: string;
  cause_type: string;
  proposed_by: ProposedBy;
  status: HypothesisStatus;
  rule?: string;
  confidence?: string;
  role?: string;
}

export interface LiveChallenge {
  id: string;
  target_hypothesis_id: string;
  confounder: string;
  argument: string;
  resolved?: boolean;
  outcome?: string;
}

/** Human titles for catalogue cause types (used when trace only sends cause_type). */
export const CAUSE_TITLES: Record<string, string> = {
  input_cost_cocoa: "Cocoa-driven input costs",
  energy_cost: "Energy costs",
  tourism_demand: "Tourist demand",
  retail_demand: "General retail demand",
  easter_shift: "Easter timing",
  own_price_change: "Our own price changes",
  sector_distress: "Sector distress",
  supplier_change: "Supplier change",
};

export function titleForCause(causeType: string): string {
  return CAUSE_TITLES[causeType] ?? causeType.replace(/_/g, " ");
}

export function isSynthetic(value: boolean | string): boolean {
  return value === true || value === "true";
}

export function formatDataMode(mode: DataMode | undefined, health?: HealthResponse): string {
  if (mode) {
    if (mode === "zetaris") return "Zetaris live";
    if (mode.startsWith("snapshot")) return "Zetaris snapshot";
  }
  if (health?.zetaris_configured) return "Zetaris live";
  if (health?.snapshot_available) return "Zetaris snapshot";
  return "Zetaris snapshot";
}

export function formatReasoner(
  reasoner: Reasoner | undefined,
  modelCalls?: ModelCall[],
  health?: HealthResponse,
): string {
  const r = reasoner ?? (health?.model_provider === "offline" ? "offline" : "nemotron");
  if (r === "offline" || health?.model_provider === "offline") return "offline reasoner";
  // The reasoning calls decide the label; the input guard always calls NVIDIA directly and must not mask the route.
  const ok = modelCalls?.find((c) => c.ok && c.provider && c.provider !== "nvidia") ?? modelCalls?.find((c) => c.ok && c.provider);
  const provider = ok?.provider ?? health?.model_provider ?? "unknown";
  const names: Record<string, string> = { meterless: "Meterless Nightshift", nvidia: "NVIDIA API", nebius: "Nebius (failover)" };
  return `Nemotron via ${names[provider] ?? provider}`;
}
