// Test compiler: typed test specs -> portable SQL (valid in Zetaris Lightning / Spark SQL and in DuckDB).
// No model ever writes SQL. Table references are {{T:<usl table>}} placeholders resolved per engine.
import { USL_PREFIX } from "../data/uslSchema.ts";

export type Metric = "revenue" | "units" | "gross_margin_pct" | "avg_ticket" | "unit_cost" | "unit_price";

export const METRICS: Record<Metric, { label: string; expr: string }> = {
  revenue: { label: "revenue (EUR)", expr: "SUM(b.revenue)" },
  units: { label: "units sold", expr: "SUM(b.units)" },
  gross_margin_pct: { label: "gross margin (%)", expr: "ROUND(100 * (1 - SUM(b.cogs) / SUM(b.revenue)), 4)" },
  avg_ticket: { label: "average ticket (EUR)", expr: "ROUND(SUM(b.revenue) / SUM(b.transactions), 4)" },
  unit_cost: { label: "unit cost (EUR)", expr: "ROUND(SUM(b.cogs) / SUM(b.units), 6)" },
  unit_price: { label: "unit price (EUR)", expr: "ROUND(SUM(b.revenue) / SUM(b.units), 6)" },
};

export type TestSpec =
  | { kind: "outcome_series"; business_id: string; metric: Metric; from: string; to: string }
  | { kind: "driver_series"; series_id: string; from: string; to: string }
  | { kind: "window_totals"; business_id: string; periods: string[] }
  | { kind: "calendar"; periods: string[] }
  | { kind: "outcome_vs_driver"; business_id: string; metric: Metric; series_id: string; from: string; to: string };

const ID = /^[a-z0-9_.:-]{1,64}$/i;
const PERIOD = /^\d{4}-\d{2}$/;

function q(v: string, re: RegExp): string {
  if (!re.test(v)) throw new Error(`invalid literal: ${v}`);
  return `'${v}'`;
}

/** Compile a spec into SQL with {{T:...}} placeholders. Inputs are validated: specs come from models. */
export function compile(spec: TestSpec): string {
  switch (spec.kind) {
    case "outcome_series":
      return `SELECT b.period AS period, ${METRICS[spec.metric].expr} AS value FROM {{T:business_period}} b WHERE b.business_id = ${q(spec.business_id, ID)} AND b.period BETWEEN ${q(spec.from, PERIOD)} AND ${q(spec.to, PERIOD)} GROUP BY b.period ORDER BY b.period`;
    case "driver_series":
      return `SELECT d.period AS period, d.value AS value, d.source_period AS source_period FROM {{T:driver_month}} d WHERE d.series_id = ${q(spec.series_id, ID)} AND d.period BETWEEN ${q(spec.from, PERIOD)} AND ${q(spec.to, PERIOD)} ORDER BY d.period`;
    case "window_totals":
      if (spec.periods.length === 0) throw new Error("window_totals needs periods");
      return `SELECT SUM(b.revenue) AS revenue, SUM(b.cogs) AS cogs, SUM(b.units) AS units, SUM(b.transactions) AS transactions, COUNT(*) AS months FROM {{T:business_period}} b WHERE b.business_id = ${q(spec.business_id, ID)} AND b.period IN (${spec.periods.map((p) => q(p, PERIOD)).join(", ")})`;
    case "calendar":
      return `SELECT c.period AS period, c.easter_share AS easter_share, c.easter_date AS easter_date FROM {{T:calendar_month}} c WHERE c.period IN (${spec.periods.map((p) => q(p, PERIOD)).join(", ")}) ORDER BY c.period`;
    case "outcome_vs_driver":
      return `SELECT b.period AS period, ${METRICS[spec.metric].expr} AS outcome, MAX(d.value) AS driver FROM {{T:business_period}} b JOIN {{T:driver_month}} d ON d.period = b.period AND d.series_id = ${q(spec.series_id, ID)} WHERE b.business_id = ${q(spec.business_id, ID)} AND b.period BETWEEN ${q(spec.from, PERIOD)} AND ${q(spec.to, PERIOD)} GROUP BY b.period ORDER BY b.period`;
  }
}

/** Resolve placeholders for an engine: Zetaris uses the fully qualified USL name, DuckDB the bare table. */
export function resolve(sql: string, engine: "zetaris" | "duckdb-snapshot"): string {
  return sql.replace(/\{\{T:([a-z_]+)\}\}/g, (_, t: string) => (engine === "zetaris" ? `${USL_PREFIX}.${t}` : t));
}
