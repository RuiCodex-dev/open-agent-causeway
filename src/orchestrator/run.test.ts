// End-to-end on the bundled Zetaris snapshot with the offline reasoner: no network, no keys.
import { describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInvestigation } from "./run.ts";
import { loadConfig } from "../config.ts";
import { BusinessMemory } from "../meterless/memory.ts";

const cfg = loadConfig({ MODEL_PROVIDER: "offline", SAMPLE_MODE: "true" } as NodeJS.ProcessEnv);

describe("investigation (snapshot + offline reasoner)", () => {
  it("answers the hero question with evidence, a Skeptic challenge and verified claims", async () => {
    const dir = mkdtempSync(join(tmpdir(), "causeway-"));
    const res = (await runInvestigation(
      { input: { question: "Why did our gross margin fall in the first half of 2025?", business_id: "atelier-noir" } },
      { config: cfg, logsDir: join(dir, "logs"), memoryRoot: join(dir, "mem") },
    )) as Record<string, any>;
    expect(res.status).toBe("success");
    expect(res.data_mode).toBe("snapshot");
    expect(res.reasoner).toBe("offline");
    const cocoa = res.hypotheses.find((h: any) => h.cause_type === "input_cost_cocoa");
    expect(cocoa.verdict).toBe("supported");
    expect(res.hypotheses.find((h: any) => h.cause_type === "easter_shift")?.proposed_by).toBe("Skeptic");
    expect(res.challenges.length).toBeGreaterThan(0);
    expect(res.output.claims.length).toBeGreaterThan(0);
    expect(res.output.claims.every((c: any) => c.verified)).toBe(true);
    expect(res.verification.requery.every((r: any) => r.ok)).toBe(true);
    expect(existsSync(res.log_file)).toBe(true);
    expect(readFileSync(res.world_model.log_file, "utf8")).toContain('"log":"event"');
  }, 60_000);

  it("asks a clarifying question instead of guessing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "causeway-"));
    const res = (await runInvestigation({ input: { question: "Why are things bad lately?", business_id: "atelier-noir" } }, { config: cfg, logsDir: join(dir, "logs"), memoryRoot: join(dir, "mem") })) as Record<string, any>;
    expect(res.status).toBe("needs_clarification");
    expect(res.output.clarifying_question).toMatch(/\?$/);
  }, 60_000);

  it("uses an owner fact from H-MEM to add and test the supplier-change cause", async () => {
    const dir = mkdtempSync(join(tmpdir(), "causeway-"));
    new BusinessMemory("atelier-noir", join(dir, "mem"), join(dir, "logs")).addFact("We switched to a more expensive couverture supplier in May 2025.");
    const res = (await runInvestigation(
      { input: { question: "Why did our gross margin fall in the first half of 2025?", business_id: "atelier-noir" } },
      { config: cfg, logsDir: join(dir, "logs"), memoryRoot: join(dir, "mem") },
    )) as Record<string, any>;
    const sup = res.hypotheses.find((h: any) => h.cause_type === "supplier_change");
    expect(sup.proposed_by).toBe("Memory");
    expect(sup.verdict).toBe("supported");
    expect(res.output.memory_used.length).toBe(1);
  }, 60_000);

  it("finds no external cause for the null-control florist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "causeway-"));
    const res = (await runInvestigation({ input: { question: "Why did our revenue change in the first half of 2025?", business_id: "fleur-leuven" } }, { config: cfg, logsDir: join(dir, "logs"), memoryRoot: join(dir, "mem") })) as Record<string, any>;
    expect(res.hypotheses.filter((h: any) => h.verdict === "supported" && h.role === "cause")).toHaveLength(0);
  }, 60_000);
});
