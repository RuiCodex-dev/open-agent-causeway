// The rule table: verdicts are decided here, in code, from statistics. Never by a model.

export type Verdict = "supported" | "contradicted" | "inconclusive";
export type Sign = 1 | -1;

export interface RuleInputs {
  /** Expected direction of the driver's change for this explanation to hold (+1 rise / -1 fall). */
  expected_sign: Sign;
  /** Did the outcome itself move beyond its own noise band? */
  outcome_moved: boolean;
  /** Seasonal z of the driver's YoY change in the window. */
  driver_z: number;
  /** Lagged association between outcome and driver (null if not computed). Sign already oriented so + supports. */
  assoc_r: number | null;
  best_lag: number | null;
  /** Declared plausible lag range in months. */
  lag_window: [number, number];
  /** Share of the outcome change attributed to this driver, if decomposable. */
  contribution_share: number | null;
  /** Data coverage of the test window (0..1). */
  coverage: number;
  /** Relative change of the driver between the windows (e.g. 0.107 = +10.7 %), if measured. */
  driver_change?: number | null;
}

export interface RuleResult {
  verdict: Verdict;
  rule: string;
  confidence: "high" | "medium" | "low";
}

export const THRESHOLDS = {
  minCoverage: 0.8,
  supportZ: 2,
  highZ: 3,
  flatZ: 1,
  minAssocR: 0.3,
  minShare: 0.15,
  /** A driver change this large counts as material even when its YoY path was already unusual before. */
  materialChange: 0.03,
  flatChange: 0.02,
  materialAssocR: 0.5,
} as const;

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

/** z as text; |z| = 99 is the cap used when a series had no historical variation. */
function zText(z: number): string {
  return Math.abs(z) >= 99 ? `${z > 0 ? ">+" : "<-"}99, a step with no earlier variation` : z.toFixed(2);
}

function finite(x: number | null): x is number {
  return x !== null && Number.isFinite(x);
}

/**
 * supported:    driver moved unusually (|z| >= 2) in the expected direction, lag inside the declared window,
 *               association (if measured) not against it, contribution share (if measured) >= 15 %.
 * contradicted: driver flat (|z| < 1) while the outcome moved, or it moved the opposite way,
 *               or its measured contribution has the wrong sign.
 * inconclusive: coverage < 80 % or anything in between.
 */
export function applyRules(x: RuleInputs): RuleResult {
  const T = THRESHOLDS;
  if (!(x.coverage >= T.minCoverage)) {
    return { verdict: "inconclusive", rule: `coverage ${pct(x.coverage)} < ${pct(T.minCoverage)}`, confidence: "low" };
  }
  const absZ = Math.abs(x.driver_z);
  const dir = Math.sign(x.driver_z);
  const change = finite(x.driver_change ?? null) ? (x.driver_change as number) : null;
  const flatByChange = change === null || Math.abs(change) < T.flatChange;
  if (x.outcome_moved && absZ < T.flatZ && flatByChange) {
    return { verdict: "contradicted", rule: `driver flat (|z|=${absZ.toFixed(2)} < ${T.flatZ}${change === null ? "" : `, change ${pct(change)}`}) while the outcome moved`, confidence: "medium" };
  }
  // Material path: a large move in the expected direction that the outcome-side series tracks closely.
  const material =
    change !== null && Math.abs(change) >= T.materialChange && Math.sign(change) === x.expected_sign &&
    finite(x.assoc_r) && x.assoc_r >= T.materialAssocR;
  if ((absZ >= T.supportZ && dir === -x.expected_sign) || (change !== null && Math.abs(change) >= T.materialChange && Math.sign(change) === -x.expected_sign && absZ >= T.flatZ)) {
    return { verdict: "contradicted", rule: `driver moved the opposite way (z=${zText(x.driver_z)}${change === null ? "" : `, change ${pct(change)}`})`, confidence: "medium" };
  }
  if (finite(x.contribution_share) && x.contribution_share < 0 && absZ >= T.supportZ) {
    return { verdict: "contradicted", rule: `contribution has the wrong sign (share ${pct(x.contribution_share)})`, confidence: "medium" };
  }
  if (finite(x.assoc_r) && x.assoc_r <= -T.minAssocR && absZ >= T.supportZ) {
    return { verdict: "contradicted", rule: `association runs against the explanation (r=${x.assoc_r.toFixed(2)})`, confidence: "medium" };
  }
  const lagOk = !finite(x.best_lag) || (x.best_lag >= x.lag_window[0] && x.best_lag <= x.lag_window[1]);
  const shareOk = !finite(x.contribution_share) || x.contribution_share >= T.minShare;
  const assocOk = !finite(x.assoc_r) || x.assoc_r > -T.minAssocR;
  if (((absZ >= T.supportZ && dir === x.expected_sign) || material) && lagOk && shareOk && assocOk) {
    const high = (absZ >= T.highZ || (material && (x.assoc_r ?? 0) >= 0.8)) && (!finite(x.contribution_share) || x.contribution_share >= 0.3);
    return {
      verdict: "supported",
      rule: `${material && absZ < T.supportZ ? `material change ${pct(change as number)} tracked by the outcome (r=${(x.assoc_r as number).toFixed(2)})` : `z=${zText(x.driver_z)} (|z| >= ${T.supportZ}) in the expected direction`}; lag ${finite(x.best_lag) ? x.best_lag : "n/a"} in [${x.lag_window.join(",")}]; share ${finite(x.contribution_share) ? pct(x.contribution_share) : "n/a"}`,
      confidence: high ? "high" : "medium",
    };
  }
  return {
    verdict: "inconclusive",
    rule: `within noise or mixed signals (z=${zText(x.driver_z)}, r=${finite(x.assoc_r) ? x.assoc_r.toFixed(2) : "n/a"}, lag ok=${lagOk}, share ok=${shareOk})`,
    confidence: "low",
  };
}
