// Meterless H-MEM (vendored reference engine) as the per-business memory of Causeway.
// Owner-confirmed facts and past verdicts persist across sessions in data/memory/<business_id>/ with the
// engine's append-only trust ledger; recall happens before the Hypothesiser runs.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { HMEM, type MemoryRecord } from "../../vendor/meterless/hmem/reference/src/index.ts";
import type { CauseType } from "../agents/types.ts";

export interface OwnerFact {
  id: string;
  text: string;
  cause_type: CauseType | null;
  params: Record<string, string>;
  created: string;
}

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};

/** Deterministic mapping from an owner's sentence to a testable cause and its start month. */
export function interpretFact(text: string): { cause_type: CauseType | null; params: Record<string, string> } {
  const t = text.toLowerCase();
  const params: Record<string, string> = {};
  const m = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/.exec(t) ?? /\b(\d{4})-(\d{2})\b/.exec(t);
  if (m) params.from = m[1]!.length === 4 ? `${m[1]}-${m[2]}` : `${m[2]}-${MONTHS[m[1]!]}`;
  let cause: CauseType | null = null;
  if (/supplier|vendor|couverture|wholesaler/.test(t)) cause = "supplier_change";
  else if (/price|prices|pricing/.test(t)) cause = "own_price_change";
  return { cause_type: cause, params };
}

export class BusinessMemory {
  readonly hmem: HMEM;
  readonly dir: string;
  private ledgerFile: string;

  constructor(readonly businessId: string, root = "data/memory", logsDir = "logs") {
    this.dir = join(root, businessId.replace(/[^a-z0-9-]/gi, "_"));
    mkdirSync(this.dir, { recursive: true });
    mkdirSync(logsDir, { recursive: true });
    this.ledgerFile = join(logsDir, "hmem-ledger.jsonl");
    this.hmem = new HMEM({ persistDir: this.dir, actor: "causeway" });
  }

  private logLedger(action: string, details: Record<string, unknown>): void {
    appendFileSync(this.ledgerFile, JSON.stringify({ ts: new Date().toISOString(), business_id: this.businessId, action, ...details }) + "\n");
  }

  addFact(text: string): OwnerFact {
    const { cause_type, params } = interpretFact(text);
    const rec = this.hmem.add({
      content: text,
      type: "factual",
      layer: "long_term",
      tags: ["owner_fact", ...(cause_type ? [`cause:${cause_type}`] : []), ...(params.from ? [`from:${params.from}`] : [])],
      confidence: 0.95,
      source: "owner",
      provenance: { origin: "user_correction", learnedAt: Date.now(), label: "owner confirmed fact" },
    });
    this.logLedger("add_fact", { memory_id: rec.id, cause_type, params });
    return toFact(rec);
  }

  facts(): OwnerFact[] {
    return this.hmem.store.all().filter((r) => r.tags.includes("owner_fact") && !r.supersededBy).map(toFact);
  }

  /** Recall memories relevant to a question (retrieval writes "read" entries to the trust ledger). */
  recall(query: string, topN = 5): { facts: OwnerFact[]; context: string; scores: Record<string, number> } {
    const res = this.hmem.query(query, { topN, threshold: 0 });
    const facts = this.facts();
    this.logLedger("recall", { query, returned: res.memories.map((m) => m.memory.id), facts: facts.map((f) => f.id) });
    return { facts, context: res.context, scores: res.trace.scores };
  }

  rememberVerdict(question: string, summary: string, evidenceIds: string[], runId: string): void {
    const rec = this.hmem.add({
      content: `Run ${runId} answered "${question}": ${summary}`,
      type: "general",
      layer: "working",
      tags: ["verdict", `run:${runId}`],
      confidence: 0.7,
      source: "causeway",
      provenance: { origin: "plan_completion", learnedAt: Date.now(), label: "investigation verdict", refs: evidenceIds },
    });
    this.logLedger("remember_verdict", { memory_id: rec.id, run_id: runId, evidence_ids: evidenceIds });
  }

  /** The owner retracts a fact: removed from recall, and the deletion is kept in the engine's trust ledger. */
  forget(memoryId: string): boolean {
    const rec = this.hmem.store.get(memoryId);
    if (!rec || !rec.tags.includes("owner_fact")) return false;
    this.hmem.store.delete(memoryId, "owner retracted the fact");
    this.logLedger("forget_fact", { memory_id: memoryId });
    return true;
  }

  feedback(memoryId: string, kind: "helpful" | "wrong"): void {
    this.hmem.feedback(memoryId, kind);
    this.logLedger("feedback", { memory_id: memoryId, kind });
  }

  ledgerStats(): Record<string, number> {
    return this.hmem.ledger.stats();
  }
}

function toFact(r: MemoryRecord): OwnerFact {
  const cause = r.tags.find((t) => t.startsWith("cause:"))?.slice(6) as CauseType | undefined;
  const from = r.tags.find((t) => t.startsWith("from:"))?.slice(5);
  return { id: r.id, text: r.content, cause_type: cause ?? null, params: from ? { from } : {}, created: new Date(r.timestamp).toISOString() };
}
