// Analyst (no LLM): compiles each hypothesis' tests to SQL, runs them on the data adapter (Zetaris live or the
// Zetaris snapshot in DuckDB), computes statistics in code and applies the rule table.
import { createHash } from "node:crypto";
import type { DataAdapter } from "../adapters/zetaris.ts";
import { resultHash } from "../adapters/resultHash.ts";
import { compile, resolve, type Metric, type TestSpec } from "../tests/compiler.ts";
import { baselineFor, expandPeriodSpec, mean, round, sd, shiftPeriod, type Point } from "../stats/series.ts";
import { laggedAssociation, marginDecomposition, seasonalZ, spliceRatio, windowDelta, type Totals } from "../stats/tests.ts";
import { applyRules, type RuleInputs } from "../stats/rules.ts";
import { CAUSES } from "./catalogue.ts";
import type { Evidence, Frame, Hypothesis, HypothesisResult } from "./types.ts";
import type { Trace } from "../orchestrator/trace.ts";

/** Keep z readable when a series has (almost) no historical variation. */
const capZ = (z: number): number => (Number.isFinite(z) ? Math.max(-99, Math.min(99, z)) : 0);

const SOURCE_TABLES: Record<TestSpec["kind"], string[]> = {
  outcome_series: ["causeway.business_period"],
  driver_series: ["causeway.driver_month"],
  window_totals: ["causeway.business_period"],
  calendar: ["causeway.calendar_month"],
  outcome_vs_driver: ["causeway.business_period", "causeway.driver_month"],
};

export interface AnalystContext {
  frame: Frame;
  data: DataAdapter;
  trace?: Trace;
  budget: { sql: number };
}

export class Analyst {
  readonly evidence = new Map<string, Evidence>();
  private outcomeCache = new Map<string, { change: number; moved: boolean; z: number; delta: ReturnType<typeof windowDelta> }>();

  constructor(private ctx: AnalystContext) {}

  get target(): string[] {
    return expandPeriodSpec(this.ctx.frame.period);
  }
  get baseline(): string[] {
    return this.ctx.frame.baseline ? expandPeriodSpec(this.ctx.frame.baseline) : baselineFor(this.ctx.frame.period);
  }

  /** Run one spec and record it as Evidence. Identical spec + identical result => identical id. */
  async run(spec: TestSpec, hypothesisId: string, purpose: string): Promise<Evidence> {
    if (this.ctx.budget.sql <= 0) throw new Error("SQL budget exhausted for this run");
    this.ctx.budget.sql--;
    const sql = resolve(compile(spec), this.ctx.data.engine);
    let res;
    try {
      res = await this.ctx.data.query(sql);
    } catch (e) {
      this.ctx.trace?.log("Analyst", "query_failed", { hypothesis_id: hypothesisId, engine: this.ctx.data.engine, error: (e as Error).message.slice(0, 200) });
      throw e;
    }
    const sha = resultHash(res.columns, res.rows);
    const id = "ev-" + createHash("sha256").update(JSON.stringify(spec) + sha).digest("hex").slice(0, 8);
    const ev: Evidence = {
      id,
      hypothesis_id: hypothesisId,
      purpose,
      spec,
      sql,
      engine: res.engine,
      executed_at: new Date().toISOString(),
      columns: res.columns,
      rows: res.rows,
      row_count: res.rows.length,
      sha256: sha,
      source_tables: SOURCE_TABLES[spec.kind],
    };
    this.evidence.set(id, ev);
    this.ctx.trace?.log("Analyst", this.ctx.data.engine === "zetaris" ? "query_zetaris" : "query_snapshot", {
      hypothesis_id: hypothesisId,
      evidence_id: id,
      purpose,
      sql_sha: createHash("sha256").update(sql).digest("hex").slice(0, 12),
      row_count: ev.row_count,
      elapsed_ms: res.elapsed_ms,
    });
    return ev;
  }

  private static points(ev: Evidence, valueCol = "value"): Point[] {
    const pi = ev.columns.indexOf("period");
    const vi = ev.columns.indexOf(valueCol);
    return ev.rows.map((r) => ({ period: String(r[pi]), value: r[vi] === null ? null : Number(r[vi]) }));
  }

  private static totals(ev: Evidence): Totals {
    const g = (c: string) => Number(ev.rows[0]?.[ev.columns.indexOf(c)] ?? NaN);
    return { revenue: g("revenue"), cogs: g("cogs"), units: g("units") };
  }

  /** The outcome itself: did it move beyond its own noise band, and in which direction? */
  async outcome(hypId = "frame"): Promise<{ change: number; moved: boolean; z: number; delta: ReturnType<typeof windowDelta>; evidence: string[] }> {
    const f = this.ctx.frame;
    const key = `${f.business_id}|${f.metric}|${f.period}|${f.baseline}`;
    const T = this.target;
    const B = this.baseline;
    const from = shiftPeriod(B[0]!, -36);
    const series = await this.run({ kind: "outcome_series", business_id: f.business_id, metric: f.metric, from, to: T[T.length - 1]! }, hypId, `${f.metric} by month, ${from} to ${T[T.length - 1]}`);
    const pts = Analyst.points(series);
    const delta = windowDelta(pts, T, B);
    const z = seasonalZ(pts, T).z;
    let change = delta.abs_change;
    if (f.metric === "gross_margin_pct") {
      // Margin of the window totals, not the mean of monthly margins.
      const tt = await this.run({ kind: "window_totals", business_id: f.business_id, periods: T }, hypId, `totals ${f.period}`);
      const bt = await this.run({ kind: "window_totals", business_id: f.business_id, periods: B }, hypId, `totals ${f.baseline}`);
      const d = marginDecomposition(Analyst.totals(bt), Analyst.totals(tt));
      change = d.delta_margin_pp;
      const res = { change, moved: Math.abs(change) >= 1 || Math.abs(z) >= 2, z, delta, evidence: [series.id, tt.id, bt.id] };
      this.outcomeCache.set(key, res);
      return res;
    }
    const rel = delta.rel_change ?? 0;
    const res = { change, moved: Math.abs(rel) >= 0.03 || Math.abs(z) >= 2, z, delta, evidence: [series.id] };
    this.outcomeCache.set(key, res);
    return res;
  }

  /** Driver series for a cause, spliced if the catalogue declares a continuation base. */
  private async driverPoints(hyp: Hypothesis, seriesId: string, continuation: string | undefined, from: string, to: string): Promise<{ pts: Point[]; evidence: string[]; splice?: { ratio: number; overlap: number } }> {
    const ev = await this.run({ kind: "driver_series", series_id: seriesId, from, to }, hyp.id, `${seriesId} by month`);
    let pts = Analyst.points(ev);
    const ids = [ev.id];
    if (continuation) {
      const ev2 = await this.run({ kind: "driver_series", series_id: continuation, from, to }, hyp.id, `${continuation} by month (newer index base)`);
      const newer = Analyst.points(ev2);
      const splice = spliceRatio(pts, newer);
      ids.push(ev2.id);
      if (splice.overlap > 0) {
        const have = new Set(pts.filter((p) => p.value !== null).map((p) => p.period));
        pts = [...pts, ...newer.filter((p) => !have.has(p.period) && p.value !== null).map((p) => ({ period: p.period, value: (p.value as number) / splice.ratio }))].sort((a, b) => (a.period < b.period ? -1 : 1));
        return { pts, evidence: ids, splice };
      }
    }
    return { pts, evidence: ids };
  }

  async test(hyp: Hypothesis): Promise<HypothesisResult> {
    const f = this.ctx.frame;
    const cause = CAUSES[hyp.cause_type];
    const T = this.target;
    const B = this.baseline;
    const end = T[T.length - 1]!;
    const out = await this.outcome(hyp.id);
    const dir = Math.sign(out.change) || 1;
    const effect = cause.effects[f.metric] ?? 1;
    const expected = (dir * effect >= 0 ? 1 : -1) as 1 | -1;
    const evidence = [...out.evidence];
    const numbers: Record<string, number | null> = { outcome_change: round(out.change, 4), outcome_z: out.z };
    let inputs: RuleInputs | null = null;
    let calendarVerdict: HypothesisResult | null = null;

    if (cause.driver) {
      const from = shiftPeriod(B[0]!, -48);
      const d = await this.driverPoints(hyp, cause.driver, cause.driver_continuation, from, end);
      evidence.push(...d.evidence);
      if (d.splice) numbers.splice_ratio = d.splice.ratio;
      // Association between the outcome-side series and the driver, lags in the declared window.
      let assoc: ReturnType<typeof laggedAssociation> | null = null;
      if (cause.assoc_metric) {
        const asOf = await this.run({ kind: "outcome_series", business_id: f.business_id, metric: cause.assoc_metric, from: shiftPeriod(end, -47), to: end }, hyp.id, `${cause.assoc_metric} by month for the lag test`);
        evidence.push(asOf.id);
        const lags: number[] = [];
        for (let l = cause.lag_window[0]; l <= cause.lag_window[1]; l++) lags.push(l);
        const window = expandPeriodSpec(`${shiftPeriod(end, -23)}..${end}`);
        assoc = laggedAssociation(Analyst.points(asOf), d.pts, window, lags);
        numbers.assoc_r = assoc.r;
        numbers.best_lag = Number.isFinite(assoc.best_lag) ? assoc.best_lag : null;
      }
      const lag = assoc && Number.isFinite(assoc.best_lag) ? assoc.best_lag : cause.lag_window[0];
      const zt = seasonalZ(d.pts, T.map((p) => shiftPeriod(p, -lag)));
      const dd = windowDelta(d.pts, T.map((p) => shiftPeriod(p, -lag)), B.map((p) => shiftPeriod(p, -lag)));
      numbers.driver_z = capZ(zt.z);
      numbers.driver_change_pct = dd.rel_change === null ? null : round(dd.rel_change * 100, 2);
      let share: number | null = null;
      if (f.metric === "gross_margin_pct" && cause.effects.unit_cost) {
        const tt = await this.run({ kind: "window_totals", business_id: f.business_id, periods: T }, hyp.id, `totals ${f.period}`);
        const bt = await this.run({ kind: "window_totals", business_id: f.business_id, periods: B }, hyp.id, `totals ${f.baseline}`);
        const dec = marginDecomposition(Analyst.totals(bt), Analyst.totals(tt));
        // Attribute part of the unit-cost change to THIS driver: slope of unit-cost YoY on driver YoY (at the
        // best lag) times the driver's change. The rest of the cost effect stays unattributed.
        const slope = assoc ? yoySlope(assoc, lag) : null;
        const t0 = Analyst.totals(bt);
        const p0 = t0.revenue / t0.units;
        const c0 = t0.cogs / t0.units;
        if (slope !== null && dd.rel_change !== null && Math.abs(dec.delta_margin_pp) > 1e-9) {
          const driverCostEffectPp = (-(slope * dd.rel_change * c0) / p0) * 100;
          share = round(driverCostEffectPp / dec.delta_margin_pp, 4);
          numbers.cost_elasticity = round(slope, 4);
          numbers.driver_cost_effect_pp = round(driverCostEffectPp, 3);
        } else share = dec.cost_share;
        numbers.cost_effect_pp = dec.cost_effect_pp;
        numbers.price_effect_pp = dec.price_effect_pp;
        numbers.delta_margin_pp = dec.delta_margin_pp;
        evidence.push(tt.id, bt.id);
      }
      // Orient the association so that + supports the explanation (driver and assoc series move together).
      const assocOriented = assoc && Number.isFinite(assoc.r) ? assoc.r : null;
      inputs = {
        expected_sign: expected,
        outcome_moved: out.moved,
        driver_z: capZ(zt.z),
        driver_change: dd.rel_change,
        assoc_r: assocOriented,
        best_lag: numbers.best_lag ?? null,
        lag_window: cause.lag_window,
        contribution_share: share,
        coverage: Math.min(zt.coverage, dd.coverage),
      };
    } else if (hyp.cause_type === "own_price_change") {
      const ser = await this.run({ kind: "outcome_series", business_id: f.business_id, metric: "unit_price", from: shiftPeriod(B[0]!, -36), to: end }, hyp.id, "unit price by month");
      evidence.push(ser.id);
      const pts = Analyst.points(ser);
      const zt = seasonalZ(pts, T);
      const dd = windowDelta(pts, T, B);
      numbers.driver_z = capZ(zt.z);
      numbers.driver_change_pct = dd.rel_change === null ? null : round(dd.rel_change * 100, 2);
      let share: number | null = null;
      if (f.metric === "gross_margin_pct") {
        const tt = await this.run({ kind: "window_totals", business_id: f.business_id, periods: T }, hyp.id, `totals ${f.period}`);
        const bt = await this.run({ kind: "window_totals", business_id: f.business_id, periods: B }, hyp.id, `totals ${f.baseline}`);
        const dec = marginDecomposition(Analyst.totals(bt), Analyst.totals(tt));
        share = dec.price_share;
        numbers.price_effect_pp = dec.price_effect_pp;
        numbers.delta_margin_pp = dec.delta_margin_pp;
        evidence.push(tt.id, bt.id);
      }
      inputs = { expected_sign: expected, outcome_moved: out.moved, driver_z: capZ(zt.z), driver_change: dd.rel_change, assoc_r: null, best_lag: null, lag_window: [0, 0], contribution_share: share, coverage: Math.min(zt.coverage, dd.coverage) };
    } else if (hyp.cause_type === "supplier_change") {
      calendarVerdict = await this.supplierChange(hyp, out, expected, evidence, numbers);
    } else if (hyp.cause_type === "easter_shift") {
      calendarVerdict = await this.easter(hyp, out, evidence, numbers);
    }

    if (calendarVerdict) return calendarVerdict;
    const r = applyRules(inputs!);
    const role = r.verdict === "supported" ? "cause" : r.verdict === "contradicted" && (inputs!.contribution_share ?? 0) < -0.15 ? "offset" : "none";
    const result: HypothesisResult = { hypothesis: hyp, evidence_ids: [...new Set(evidence)], verdict: r.verdict, rule: r.rule, confidence: r.confidence, role, numbers };
    this.ctx.trace?.log("Analyst", "verdict", { hypothesis_id: hyp.id, cause_type: hyp.cause_type, verdict: r.verdict, rule: r.rule, confidence: r.confidence, role, inputs, numbers });
    return result;
  }

  /** Easter: does the change survive once the Easter-affected months are removed from both windows? */
  private async easter(hyp: Hypothesis, out: { change: number; moved: boolean }, evidence: string[], numbers: Record<string, number | null>): Promise<HypothesisResult> {
    const f = this.ctx.frame;
    const T = this.target;
    const B = this.baseline;
    const cal = await this.run({ kind: "calendar", periods: [...B, ...T] }, hyp.id, "Easter window shares by month");
    evidence.push(cal.id);
    const share = new Map(cal.rows.map((r) => [String(r[0]), Number(r[1])]));
    const eT = T.map((p) => share.get(p) ?? 0);
    const eB = B.map((p) => share.get(p) ?? 0);
    const shifted = eT.some((v, i) => Math.abs(v - (eB[i] ?? 0)) > 0.01);
    numbers.easter_months_target = T.filter((p) => (share.get(p) ?? 0) > 0).length;
    numbers.easter_months_baseline = B.filter((p) => (share.get(p) ?? 0) > 0).length;
    const keep = T.map((_, i) => (eT[i] ?? 0) === 0 && (eB[i] ?? 0) === 0);
    const Tx = T.filter((_, i) => keep[i]);
    const Bx = B.filter((_, i) => keep[i]);
    let rule: string;
    let verdict: HypothesisResult["verdict"];
    if (!shifted) {
      verdict = "contradicted";
      rule = "Easter fell in the same calendar month in both windows, so it cannot move sales between them";
    } else if (Tx.length === 0) {
      verdict = "inconclusive";
      rule = "every month in the window is Easter-affected; cannot separate the effect";
    } else {
      let exChange: number;
      if (f.metric === "gross_margin_pct") {
        const tt = await this.run({ kind: "window_totals", business_id: f.business_id, periods: Tx }, hyp.id, "totals excluding Easter months (target)");
        const bt = await this.run({ kind: "window_totals", business_id: f.business_id, periods: Bx }, hyp.id, "totals excluding Easter months (baseline)");
        evidence.push(tt.id, bt.id);
        exChange = marginDecomposition(Analyst.totals(bt), Analyst.totals(tt)).delta_margin_pp;
      } else {
        const ser = await this.run({ kind: "outcome_series", business_id: f.business_id, metric: f.metric, from: B[0]!, to: T[T.length - 1]! }, hyp.id, `${f.metric} by month for the Easter test`);
        evidence.push(ser.id);
        const pts = Analyst.points(ser);
        const full = windowDelta(pts, T, B).rel_change ?? 0;
        const ex = windowDelta(pts, Tx, Bx).rel_change ?? 0;
        numbers.change_rel_full_pct = round(full * 100, 2);
        exChange = ex * 100;
        out = { ...out, change: full * 100 };
      }
      numbers.change_excluding_easter = round(exChange, 3);
      const kept = out.change !== 0 ? exChange / out.change : 0;
      numbers.share_of_change_kept = round(kept, 3);
      if (kept >= 0.6) {
        verdict = "contradicted";
        rule = `the change persists without the Easter months (${round(kept * 100, 0)}% of it remains)`;
      } else if (kept < 0.4) {
        verdict = "supported";
        rule = `most of the change disappears without the Easter months (${round(kept * 100, 0)}% remains)`;
      } else {
        verdict = "inconclusive";
        rule = `the Easter months explain part of the change (${round(kept * 100, 0)}% remains without them)`;
      }
    }
    const res: HypothesisResult = { hypothesis: hyp, evidence_ids: [...new Set(evidence)], verdict, rule, confidence: verdict === "inconclusive" ? "low" : "medium", role: verdict === "supported" ? "cause" : "none", numbers };
    this.ctx.trace?.log("Analyst", "verdict", { hypothesis_id: hyp.id, cause_type: hyp.cause_type, verdict, rule, numbers });
    return res;
  }

  /**
   * Supplier change (owner fact with a start month): is there a step in unit cost after that month that the
   * cocoa driver does not explain? Fits unit_cost ~ a + b * driver on the 24 months before, then tests the
   * mean residual after the change.
   */
  private async supplierChange(hyp: Hypothesis, out: { change: number; moved: boolean }, expected: 1 | -1, evidence: string[], numbers: Record<string, number | null>): Promise<HypothesisResult> {
    const f = this.ctx.frame;
    const from = String(hyp.params?.from ?? "");
    const T = this.target;
    const end = T[T.length - 1]!;
    if (!/^\d{4}-\d{2}$/.test(from)) {
      return { hypothesis: hyp, evidence_ids: evidence, verdict: "inconclusive", rule: "no valid change month in the owner's fact", confidence: "low", role: "none", numbers };
    }
    const uc = await this.run({ kind: "outcome_series", business_id: f.business_id, metric: "unit_cost", from: shiftPeriod(from, -30), to: end }, hyp.id, "unit cost by month around the supplier change");
    evidence.push(uc.id);
    const d = await this.driverPoints(hyp, "hicp_choc_i15", "hicp_choc_i25", shiftPeriod(from, -31), end);
    evidence.push(...d.evidence);
    const cost = new Map(Analyst.points(uc).filter((p) => p.value !== null).map((p) => [p.period, p.value as number]));
    const drv = new Map(d.pts.filter((p) => p.value !== null).map((p) => [p.period, p.value as number]));
    const before = expandPeriodSpec(`${shiftPeriod(from, -24)}..${shiftPeriod(from, -1)}`).filter((p) => cost.has(p) && drv.has(shiftPeriod(p, -1)));
    const after = T.filter((p) => p >= from && cost.has(p) && drv.has(shiftPeriod(p, -1)));
    if (before.length < 12 || after.length < 2) {
      return { hypothesis: hyp, evidence_ids: [...new Set(evidence)], verdict: "inconclusive", rule: `not enough months around ${from} (${before.length} before, ${after.length} after in the window)`, confidence: "low", role: "none", numbers };
    }
    const xs = before.map((p) => drv.get(shiftPeriod(p, -1))!);
    const ys = before.map((p) => cost.get(p)!);
    const mx = mean(xs);
    const my = mean(ys);
    const b = xs.reduce((a, x, i) => a + (x - mx) * (ys[i]! - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    const a = my - b * mx;
    const resid = (p: string) => cost.get(p)! - (a + b * drv.get(shiftPeriod(p, -1))!);
    const rb = before.map(resid);
    const ra = after.map(resid);
    const s = sd(rb);
    const step = mean(ra) - mean(rb);
    const z = s > 0 ? step / (s / Math.sqrt(ra.length)) : 0;
    const stepPct = (step / my) * 100;
    numbers.residual_step_eur = round(step, 4);
    numbers.residual_step_pct = round(stepPct, 2);
    numbers.driver_z = round(capZ(z), 3);
    numbers.months_after = ra.length;
    const inputs: RuleInputs = { expected_sign: expected, outcome_moved: out.moved, driver_z: capZ(z), assoc_r: null, best_lag: null, lag_window: [0, 0], contribution_share: null, coverage: 1 };
    const r = applyRules(inputs);
    const res: HypothesisResult = { hypothesis: hyp, evidence_ids: [...new Set(evidence)], verdict: r.verdict, rule: `unit-cost step after ${from} not explained by cocoa prices: ${r.rule}`, confidence: r.confidence, role: r.verdict === "supported" ? "cause" : "none", numbers };
    this.ctx.trace?.log("Analyst", "verdict", { hypothesis_id: hyp.id, cause_type: hyp.cause_type, verdict: r.verdict, rule: res.rule, numbers });
    return res;
  }
}

/** Pass-through slope (outcome YoY per unit of driver YoY) at the chosen lag, if measured. */
function yoySlope(assoc: { by_lag: { lag: number; slope: number }[] }, lag: number): number | null {
  const p = assoc.by_lag.find((x) => x.lag === lag);
  return p && Number.isFinite(p.slope) ? p.slope : null;
}
