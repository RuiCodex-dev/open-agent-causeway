// Meterless Markovian engine (vendored reference) bounding the multi-round Hypothesiser <-> Skeptic <-> Writer
// dialogue: each round receives a compressed carryover state (COMPLETED / REMAINING / DECISIONS / CONTEXT) built
// through the engine's CarryoverService cascade, instead of the growing history of every earlier round.
// The engine's own runEfficiency() reports the estimated token saving (labelled "estimated", chars/4).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CarryoverService,
  canonicalBlock,
  estimateTokens,
  resolveConfig,
  runEfficiency,
  type ChunkConfig,
  type ChunkInfo,
} from "../../vendor/meterless/markovian/reference/src/index.ts";
import type { Challenge, Frame, HypothesisResult } from "../agents/types.ts";

export class InvestigationLoop {
  readonly config: ChunkConfig;
  private carry = new CarryoverService();
  private carryover = "";
  readonly chunks: ChunkInfo[] = [];
  readonly levels: string[] = [];

  constructor(readonly runId: string, carryoverTokens = 256) {
    this.config = resolveConfig({ carryoverTokens, maxChunks: 6, chunkSize: 4000, overlapTokens: 0 });
  }

  /** State the next round needs, as the canonical Markovian block. */
  static state(frame: Frame, results: HypothesisResult[], challenges: Challenge[], open: string[]): string {
    const done = results.map((r) => `${r.hypothesis.id} ${r.hypothesis.cause_type}=${r.verdict}`).join(", ");
    const decisions = challenges.length ? challenges.map((c) => `${c.id} on ${c.target_hypothesis_id}: ${c.outcome ?? "pending"}`).join("; ") : "no challenges yet";
    return canonicalBlock({
      completed: done || "nothing tested yet",
      remaining: open.length ? `untested confounders: ${open.join(", ")}` : "no untested confounders",
      decisions,
      context: `${frame.metric} ${frame.period} vs ${frame.baseline} for ${frame.business_id}`,
    });
  }

  /**
   * Close one round: `roundText` is everything this round produced (prompts, model output, verdict lines).
   * Returns the compressed carryover for the next round.
   */
  async round(state: string, roundText: string): Promise<string> {
    const res = await this.carry.next({ markerState: state, previousCarryover: this.carryover, chunkText: roundText, config: this.config });
    this.chunks.push({ id: this.chunks.length + 1, tokens: estimateTokens(roundText), carryover: this.carryover, content: roundText.slice(0, 2000) });
    this.levels.push(res.level);
    this.carryover = res.carryover;
    return res.carryover;
  }

  get current(): string {
    return this.carryover;
  }

  report() {
    const eff = runEfficiency(this.chunks, this.config);
    return { config: this.config, rounds: this.chunks.length, cascade_levels: this.levels, ...eff, token_label: "estimated" as const };
  }

  export(dir = "logs"): string {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `markovian-${this.runId}.json`);
    writeFileSync(file, JSON.stringify({ run_id: this.runId, ...this.report(), chunks: this.chunks.map((c) => ({ id: c.id, tokens: c.tokens, carryover_in: c.carryover })) }, null, 2) + "\n");
    return file;
  }
}
