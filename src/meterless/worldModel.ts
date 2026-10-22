// Meterless World Model (vendored reference engine) as the shared evidence graph of one investigation.
// Every agent writes through it: businesses, hypotheses, evidence, verdicts, challenges, claims and owner facts,
// with provenance on every write. Stable ids make re-runs on identical data idempotent.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { WorldModel } from "../../vendor/meterless/world-model/reference/src/index.ts";
import type { Challenge, Claim, Evidence, Hypothesis, HypothesisResult } from "../agents/types.ts";

export class EvidenceGraph {
  readonly wm: WorldModel;
  private at: string;

  constructor(readonly runId: string) {
    this.wm = new WorldModel({ namespace: `causeway-${runId}`, storage: "memory" });
    this.at = new Date().toISOString();
  }

  private src(by: string) {
    return { kind: "agent" as const, by, at: this.at, runId: this.runId };
  }

  private ext(type: string, id: string) {
    return { type, externalKey: { system: "causeway", id } };
  }

  async business(id: string, name: string, attrs: Record<string, unknown>): Promise<string> {
    const e = await this.wm.upsertEntity({ ...this.ext("Business", id), name, attrs, source: this.src("Framer") });
    return e.id;
  }

  async hypothesis(h: Hypothesis, businessEntity: string): Promise<string> {
    const e = await this.wm.upsertEntity({ ...this.ext("Hypothesis", h.id), name: h.title, attrs: { cause_type: h.cause_type, mechanism: h.mechanism, proposed_by: h.proposed_by, params: h.params ?? null }, source: this.src(h.proposed_by) });
    await this.wm.relate({ from: e.id, type: "explains_change_of", to: businessEntity, source: this.src(h.proposed_by) });
    return e.id;
  }

  async evidence(ev: Evidence): Promise<string> {
    const e = await this.wm.upsertEntity({
      ...this.ext("Evidence", ev.id),
      name: ev.id,
      attrs: { purpose: ev.purpose, engine: ev.engine, sql: ev.sql, row_count: ev.row_count, sha256: ev.sha256, source_tables: ev.source_tables, executed_at: ev.executed_at },
      source: { ...this.src("Analyst"), checksum: ev.sha256 },
    });
    return e.id;
  }

  async verdict(r: HypothesisResult, hypEntity: string, evEntities: Map<string, string>): Promise<void> {
    const rel = r.verdict === "supported" ? "supports" : r.verdict === "contradicted" ? "contradicts" : "tests";
    for (const id of r.evidence_ids) {
      const ent = evEntities.get(id);
      if (ent) await this.wm.relate({ from: ent, type: rel, to: hypEntity, attrs: { rule: r.rule }, source: this.src("Analyst") });
    }
    await this.wm.assertFact({ about: hypEntity, predicate: "verdict", value: { verdict: r.verdict, rule: r.rule, confidence: r.confidence, role: r.role }, confidence: r.confidence === "high" ? 0.9 : r.confidence === "medium" ? 0.7 : 0.4, source: this.src("Analyst") });
  }

  async challenge(c: Challenge, targetEntity: string): Promise<void> {
    const e = await this.wm.upsertEntity({ ...this.ext("Challenge", c.id), name: c.confounder, attrs: { argument: c.argument, required_test: c.required_test }, source: this.src("Skeptic") });
    await this.wm.relate({ from: targetEntity, type: "challenged_by", to: e.id, source: this.src("Skeptic") });
  }

  async claim(c: Claim, evEntities: Map<string, string>): Promise<void> {
    const e = await this.wm.upsertEntity({ ...this.ext("Claim", c.id), name: c.text.slice(0, 120), attrs: { text: c.text, verified: c.verified ?? null, struck_reason: c.struck_reason ?? null }, source: this.src("Writer") });
    for (const id of c.evidence_ids) {
      const ent = evEntities.get(id);
      if (ent) await this.wm.relate({ from: e.id, type: "cites", to: ent, source: this.src("Writer") });
    }
  }

  async fact(text: string, factId: string, bearsOn: string | null): Promise<string> {
    const e = await this.wm.upsertEntity({ ...this.ext("Fact", factId), name: text.slice(0, 120), attrs: { text, source: "owner" }, source: this.src("Memory") });
    if (bearsOn) await this.wm.relate({ from: e.id, type: "bears_on", to: bearsOn, source: this.src("Memory") });
    return e.id;
  }

  /** Persist the event log and audit trail as JSONL for judges. */
  export(dir = "logs"): string {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `worldmodel-${this.runId}.jsonl`);
    const lines = [
      ...this.wm.events().map((e) => JSON.stringify({ log: "event", ...e })),
      ...this.wm.audit().map((a) => JSON.stringify({ log: "audit", ...a })),
      JSON.stringify({ log: "state_shape", shape: this.wm.stateShape() }),
    ];
    writeFileSync(file, lines.join("\n") + "\n");
    return file;
  }

  counts(): Record<string, number> {
    const by: Record<string, number> = {};
    for (const e of this.wm.events()) by[e.kind] = (by[e.kind] ?? 0) + 1;
    return by;
  }
}
