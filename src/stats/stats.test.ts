import { describe, expect, it } from "vitest";
import { baselineFor, expandPeriodSpec, mean, periodRange, sd, shiftPeriod, yoySeries, toMap, type Point } from "./series.ts";
import { laggedAssociation, marginDecomposition, pearson, seasonalZ, spliceRatio, sumWindow, windowDelta } from "./tests.ts";
import { applyRules, type RuleInputs } from "./rules.ts";

const series = (start: string, values: (number | null)[]): Point[] =>
  values.map((value, i) => ({ period: shiftPeriod(start, i), value }));

describe("series helpers", () => {
  it("shifts periods across year boundaries", () => {
    expect(shiftPeriod("2025-01", -1)).toBe("2024-12");
    expect(shiftPeriod("2024-12", 1)).toBe("2025-01");
    expect(shiftPeriod("2025-06", -12)).toBe("2024-06");
  });
  it("expands period specs", () => {
    expect(expandPeriodSpec("2025-H1")).toEqual(["2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06"]);
    expect(expandPeriodSpec("2025-Q3")).toEqual(["2025-07", "2025-08", "2025-09"]);
    expect(expandPeriodSpec("2024")).toHaveLength(12);
    expect(expandPeriodSpec("2025-11..2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(() => expandPeriodSpec("last spring")).toThrow();
  });
  it("builds a same-window baseline one year back", () => {
    expect(baselineFor("2025-H1")).toEqual(periodRange("2024-01", "2024-06"));
  });
  it("computes mean and sample sd", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(Number.isNaN(sd([1]))).toBe(true);
  });
  it("computes YoY only where both months exist", () => {
    const yoy = yoySeries(toMap(series("2024-01", [100, 100, ...Array(10).fill(100), 110, null])));
    expect(yoy.get("2025-01")).toBeCloseTo(0.1, 10);
    expect(yoy.has("2025-02")).toBe(false);
  });
});

describe("windowDelta", () => {
  it("compares window means and reports coverage", () => {
    const pts = series("2024-01", [10, 10, 10, 10, 10, 10, ...Array(6).fill(0), 12, 12, 12, 12, null, 12]);
    const d = windowDelta(pts, expandPeriodSpec("2025-H1"), baselineFor("2025-H1"));
    expect(d.target_mean).toBe(12);
    expect(d.baseline_mean).toBe(10);
    expect(d.rel_change).toBeCloseTo(0.2, 10);
    expect(d.coverage).toBeCloseTo(5 / 6, 3);
  });
});

describe("seasonalZ", () => {
  it("flags a jump in YoY growth against a stable history", () => {
    // 3 years of steady 2 % growth, then a 25 % jump in the target window.
    const vals: number[] = [];
    let v = 100;
    for (let i = 0; i < 48; i++) {
      v *= i >= 36 && i < 42 ? 1.04 : 1.0016 + (i % 2) * 0.0002;
      vals.push(v);
    }
    const pts = series("2022-01", vals);
    const z = seasonalZ(pts, periodRange("2025-01", "2025-06"));
    expect(z.z).toBeGreaterThan(3);
    expect(z.history_n).toBeGreaterThan(10);
  });
  it("returns about zero for an unchanged pattern", () => {
    const vals = Array.from({ length: 48 }, (_, i) => 100 + (i % 12) + (i % 3) * 0.1);
    const z = seasonalZ(series("2022-01", vals), periodRange("2025-01", "2025-06"));
    expect(Math.abs(z.z)).toBeLessThan(1.5);
  });
});

describe("pearson and lagged association", () => {
  it("pearson is 1 for a linear relation and NaN for too few points", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
    expect(Number.isNaN(pearson([1, 2], [1, 2]))).toBe(true);
  });
  it("finds the lag at which the driver leads the outcome", () => {
    const driverVals = Array.from({ length: 60 }, (_, i) => 100 + 10 * Math.sin(i / 3) + i * 0.2);
    const driver = series("2021-01", driverVals);
    // outcome follows the driver with a 2-month delay
    const outcome = series("2021-01", driverVals.map((_, i) => driverVals[Math.max(0, i - 2)]! * 0.5 + 40));
    const res = laggedAssociation(outcome, driver, periodRange("2023-01", "2025-06"), [0, 1, 2, 3, 4]);
    expect(res.best_lag).toBe(2);
    expect(res.r).toBeGreaterThan(0.95);
    expect(res.by_lag).toHaveLength(5);
  });
});

describe("marginDecomposition", () => {
  it("attributes a margin fall to unit cost when prices stay flat", () => {
    const base = { revenue: 1000, cogs: 400, units: 100 }; // price 10, cost 4, margin 60 %
    const target = { revenue: 1000, cogs: 500, units: 100 }; // cost 5, margin 50 %
    const d = marginDecomposition(base, target);
    expect(d.margin_baseline).toBe(60);
    expect(d.margin_target).toBe(50);
    expect(d.delta_margin_pp).toBe(-10);
    expect(d.cost_effect_pp).toBe(-10);
    expect(d.price_effect_pp).toBe(0);
    expect(d.cost_share).toBe(1);
  });
  it("splits cost pressure partly offset by a price rise", () => {
    const base = { revenue: 1000, cogs: 400, units: 100 }; // p 10, c 4
    const target = { revenue: 1080, cogs: 500, units: 100 }; // p 10.8, c 5
    const d = marginDecomposition(base, target);
    expect(d.cost_effect_pp).toBe(-10);
    expect(d.price_effect_pp).toBeGreaterThan(0);
    expect(d.cost_effect_pp + d.price_effect_pp).toBeCloseTo(d.delta_margin_pp, 2);
  });
  it("sums ledger rows over a window", () => {
    const rows = [
      { period: "2025-01", revenue: 10, cogs: 4, units: 1 },
      { period: "2025-02", revenue: 20, cogs: 8, units: 2 },
      { period: "2025-03", revenue: 30, cogs: 12, units: 3 },
    ];
    expect(sumWindow(rows, ["2025-01", "2025-02"])).toEqual({ revenue: 30, cogs: 12, units: 3, months: 2 });
  });
});

describe("spliceRatio", () => {
  it("links two index bases over their overlap", () => {
    const old = series("2025-01", [150, 150, 150]);
    const neu = series("2025-01", [100, 100, 100, 101]);
    expect(spliceRatio(old, neu)).toEqual({ ratio: 0.66666667, overlap: 3 });
    expect(spliceRatio(series("2020-01", [1]), neu).overlap).toBe(0);
  });
});

describe("rule table", () => {
  const base: RuleInputs = {
    expected_sign: 1,
    outcome_moved: true,
    driver_z: 3.4,
    assoc_r: 0.6,
    best_lag: 1,
    lag_window: [0, 3],
    contribution_share: 0.7,
    coverage: 1,
  };
  it("supports a strong, timely, well-aligned driver with high confidence", () => {
    const r = applyRules(base);
    expect(r.verdict).toBe("supported");
    expect(r.confidence).toBe("high");
  });
  it("is inconclusive when coverage is low", () => {
    expect(applyRules({ ...base, coverage: 0.5 }).verdict).toBe("inconclusive");
  });
  it("contradicts a flat driver when the outcome moved", () => {
    expect(applyRules({ ...base, driver_z: 0.4 }).verdict).toBe("contradicted");
  });
  it("contradicts a driver that moved the opposite way", () => {
    expect(applyRules({ ...base, driver_z: -2.5 }).verdict).toBe("contradicted");
  });
  it("contradicts a driver whose contribution has the wrong sign", () => {
    expect(applyRules({ ...base, contribution_share: -0.3 }).verdict).toBe("contradicted");
  });
  it("does not support when the lag is outside the declared window", () => {
    expect(applyRules({ ...base, best_lag: 9 }).verdict).toBe("inconclusive");
  });
  it("does not support a driver that explains too little of the change", () => {
    expect(applyRules({ ...base, contribution_share: 0.05 }).verdict).toBe("inconclusive");
  });
  it("gives medium confidence for a z between 2 and 3", () => {
    const r = applyRules({ ...base, driver_z: 2.4 });
    expect(r.verdict).toBe("supported");
    expect(r.confidence).toBe("medium");
  });
});
