// Deterministic statistics used by the Analyst. No model ever computes these.
import { coverage, mean, round, sd, shiftPeriod, sum, toMap, yoySeries, type Point } from "./series.ts";

export interface WindowDelta {
  kind: "window_delta";
  target_mean: number;
  baseline_mean: number;
  abs_change: number;
  rel_change: number | null;
  coverage: number;
}

/** Mean of the target window against the mean of the baseline window. */
export function windowDelta(points: Point[], target: string[], baseline: string[]): WindowDelta {
  const m = toMap(points);
  const t = target.filter((p) => m.has(p)).map((p) => m.get(p)!);
  const b = baseline.filter((p) => m.has(p)).map((p) => m.get(p)!);
  const tm = mean(t);
  const bm = mean(b);
  return {
    kind: "window_delta",
    target_mean: round(tm, 6),
    baseline_mean: round(bm, 6),
    abs_change: round(tm - bm, 6),
    rel_change: bm !== 0 && Number.isFinite(bm) ? round(tm / bm - 1, 6) : null,
    coverage: round(Math.min(coverage(m, target), coverage(m, baseline)), 4),
  };
}

export interface SeasonalZ {
  kind: "seasonal_z";
  target_yoy: number;
  history_mean: number;
  history_sd: number;
  z: number;
  history_n: number;
  coverage: number;
}

/**
 * Is the year-over-year change in the target window unusual compared with the
 * year-over-year changes the series showed before the window?
 * z = (mean YoY in window - mean historical YoY) / sd(historical YoY).
 */
export function seasonalZ(points: Point[], target: string[], historyMonths = 36): SeasonalZ {
  const m = toMap(points);
  const yoy = yoySeries(m);
  const tv = target.filter((p) => yoy.has(p)).map((p) => yoy.get(p)!);
  const first = target[0]!;
  const hist: number[] = [];
  for (let k = 1; k <= historyMonths; k++) {
    const p = shiftPeriod(first, -k);
    if (yoy.has(p)) hist.push(yoy.get(p)!);
  }
  const tm = mean(tv);
  const hm = mean(hist);
  const hs = sd(hist);
  const z = hs > 0 ? (tm - hm) / hs : tm === hm ? 0 : Math.sign(tm - hm) * 99;
  return {
    kind: "seasonal_z",
    target_yoy: round(tm, 6),
    history_mean: round(hm, 6),
    history_sd: round(hs, 6),
    z: round(z, 3),
    history_n: hist.length,
    coverage: round(target.length ? tv.length / target.length : 0, 4),
  };
}

export function pearson(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 3) return NaN;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : NaN;
}

export interface LagPoint {
  lag: number;
  r: number;
  n: number;
}

export interface LaggedAssoc {
  kind: "lagged_assoc";
  best_lag: number;
  r: number;
  n: number;
  by_lag: LagPoint[];
}

/**
 * Correlation between the outcome's YoY change and the driver's YoY change
 * shifted by `lag` months (driver leads outcome), over the analysis window.
 */
export function laggedAssociation(outcome: Point[], driver: Point[], window: string[], lags: number[]): LaggedAssoc {
  const oy = yoySeries(toMap(outcome));
  const dy = yoySeries(toMap(driver));
  const byLag: LagPoint[] = lags.map((lag) => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of window) {
      const o = oy.get(p);
      const d = dy.get(shiftPeriod(p, -lag));
      if (o !== undefined && d !== undefined) {
        xs.push(d);
        ys.push(o);
      }
    }
    return { lag, r: round(pearson(xs, ys), 4), n: xs.length };
  });
  let best: LagPoint | null = null;
  for (const x of byLag) {
    if (!Number.isFinite(x.r)) continue;
    if (best === null || Math.abs(x.r) > Math.abs(best.r)) best = x;
  }
  return { kind: "lagged_assoc", best_lag: best?.lag ?? NaN, r: best?.r ?? NaN, n: best?.n ?? 0, by_lag: byLag };
}

export interface MarginDecomposition {
  kind: "margin_decomposition";
  margin_baseline: number;
  margin_target: number;
  delta_margin_pp: number;
  cost_effect_pp: number;
  price_effect_pp: number;
  cost_share: number | null;
  price_share: number | null;
}

export interface Totals {
  revenue: number;
  cogs: number;
  units: number;
}

/**
 * Gross margin m = 1 - unit_cost / unit_price. Splits the margin change into the
 * part explained by unit cost (price held at baseline) and the remainder explained
 * by unit price. Values in percentage points.
 */
export function marginDecomposition(base: Totals, target: Totals): MarginDecomposition {
  const p0 = base.revenue / base.units;
  const c0 = base.cogs / base.units;
  const p1 = target.revenue / target.units;
  const c1 = target.cogs / target.units;
  const m0 = 1 - c0 / p0;
  const m1 = 1 - c1 / p1;
  const cost = -(c1 - c0) / p0;
  const total = m1 - m0;
  const price = total - cost;
  const share = (x: number) => (Math.abs(total) > 1e-9 ? round(x / total, 4) : null);
  return {
    kind: "margin_decomposition",
    margin_baseline: round(m0 * 100, 3),
    margin_target: round(m1 * 100, 3),
    delta_margin_pp: round(total * 100, 3),
    cost_effect_pp: round(cost * 100, 3),
    price_effect_pp: round(price * 100, 3),
    cost_share: share(cost),
    price_share: share(price),
  };
}

/** Sum a window of ledger rows. */
export function sumWindow(rows: { period: string; revenue: number; cogs: number; units: number }[], window: string[]): Totals & { months: number } {
  const set = new Set(window);
  const sel = rows.filter((r) => set.has(r.period));
  return {
    revenue: sum(sel.map((r) => r.revenue)),
    cogs: sum(sel.map((r) => r.cogs)),
    units: sum(sel.map((r) => r.units)),
    months: sel.length,
  };
}

/**
 * Ratio that links an old index base to a new one over their overlap
 * (mean(new) / mean(old) over shared months). Used to splice HICP 2015=100 onto 2025=100.
 */
export function spliceRatio(oldSeries: Point[], newSeries: Point[]): { ratio: number; overlap: number } {
  const o = toMap(oldSeries);
  const n = toMap(newSeries);
  const shared = [...o.keys()].filter((p) => n.has(p));
  if (shared.length === 0) return { ratio: NaN, overlap: 0 };
  return {
    ratio: round(mean(shared.map((p) => n.get(p)!)) / mean(shared.map((p) => o.get(p)!)), 8),
    overlap: shared.length,
  };
}
