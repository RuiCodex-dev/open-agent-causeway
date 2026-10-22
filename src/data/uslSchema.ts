// The USL "causeway" tables as the agent sees them, with the column types used for the snapshot.
// Live mode queries these through Zetaris; sample mode queries the same names in DuckDB.

export const USL_PREFIX = "lightning.metastore.causeway_ns.causeway";

export type ColType = "VARCHAR" | "DOUBLE" | "INTEGER" | "BOOLEAN";

export const USL_TABLES: Record<string, Record<string, ColType>> = {
  business: { business_id: "VARCHAR", name: "VARCHAR", city: "VARCHAR", nace: "VARCHAR", sector: "VARCHAR", synthetic: "BOOLEAN" },
  calendar_month: { period: "VARCHAR", easter_date: "VARCHAR", easter_share: "DOUBLE", days_in_month: "INTEGER" },
  driver_series: { series_id: "VARCHAR", dataset: "VARCHAR", label: "VARCHAR", unit_label: "VARCHAR", source_grain: "VARCHAR", licence: "VARCHAR" },
  business_period: {
    row_key: "VARCHAR",
    business_id: "VARCHAR",
    period: "VARCHAR",
    units: "INTEGER",
    transactions: "INTEGER",
    revenue: "DOUBLE",
    cogs: "DOUBLE",
    gross_margin_pct: "DOUBLE",
    avg_ticket: "DOUBLE",
    synthetic: "BOOLEAN",
  },
  driver_month: { obs_key: "VARCHAR", series_id: "VARCHAR", period: "VARCHAR", value: "DOUBLE", source_period: "VARCHAR" },
};

/** Fully qualified Zetaris name of a USL table. */
export function uslName(table: keyof typeof USL_TABLES | string): string {
  return `${USL_PREFIX}.${table}`;
}

/** Cast a Zetaris REST cell (strings) to the declared type. */
export function castCell(v: unknown, t: ColType): string | number | boolean | null {
  if (v === null || v === undefined || v === "" || v === "null") return null;
  switch (t) {
    case "DOUBLE":
      return Number(v);
    case "INTEGER":
      return Math.round(Number(v));
    case "BOOLEAN":
      return v === true || v === "true" || v === "1";
    default:
      return String(v);
  }
}
