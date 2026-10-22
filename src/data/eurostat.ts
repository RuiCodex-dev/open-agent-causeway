// Eurostat source catalogue and JSON-stat helpers.
// Live data reaches the agent ONLY through Zetaris (REST tables + decode views, see zetaris/sql).
// This module defines which series we use, builds the exact request URLs Zetaris registers,
// and validates dimension codes before onboarding: Eurostat answers an invalid code with an
// EMPTY result rather than an error, so every code is checked against category.index first.

export const EUROSTAT_BASE = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";

export interface EurostatSeries {
  /** Short id used for the Zetaris REST table and USL column naming. */
  id: string;
  dataset: string;
  /** Dimension filters (dimension -> code). */
  filters: Record<string, string>;
  grain: "month" | "quarter" | "half_year";
  label: string;
  unit_label: string;
  since: string;
}

export const SERIES: EurostatSeries[] = [
  {
    id: "hicp_choc_i15",
    dataset: "prc_hicp_midx",
    filters: { geo: "BE", coicop: "CP01183", unit: "I15", freq: "M" },
    grain: "month",
    label: "HICP Belgium - chocolate (2015=100)",
    unit_label: "index 2015=100",
    since: "2016-01",
  },
  {
    id: "hicp_choc_i25",
    dataset: "prc_hicp_minr",
    filters: { geo: "BE", coicop18: "CP01183", unit: "I25", freq: "M" },
    grain: "month",
    label: "HICP Belgium - chocolate (2025=100, ECOICOP v2)",
    unit_label: "index 2025=100",
    since: "2024-01",
  },
  {
    id: "elec_nonhh",
    dataset: "nrg_pc_205",
    filters: { geo: "BE", nrg_cons: "MWH20-499", tax: "I_TAX", currency: "EUR", unit: "KWH", freq: "S" },
    grain: "half_year",
    label: "Electricity price, non-household 20-499 MWh, excl. VAT (Belgium)",
    unit_label: "EUR/kWh",
    since: "2016-S1",
  },
  {
    id: "gas_nonhh",
    dataset: "nrg_pc_203",
    filters: { geo: "BE", nrg_cons: "GJ1000-9999", tax: "I_TAX", currency: "EUR", unit: "KWH", freq: "S" },
    grain: "half_year",
    label: "Gas price, non-household 1,000-9,999 GJ, excl. VAT (Belgium)",
    unit_label: "EUR/kWh",
    since: "2016-S1",
  },
  {
    id: "retail_vol_g47",
    dataset: "sts_trtu_m",
    filters: { geo: "BE", nace_r2: "G47", indic_bt: "VOL_SLS", s_adj: "CA", unit: "I21", freq: "M" },
    grain: "month",
    label: "Retail trade volume, Belgium (G47, calendar adjusted, 2021=100)",
    unit_label: "index 2021=100",
    since: "2016-01",
  },
  {
    id: "tourism_nights",
    dataset: "tour_occ_nim",
    filters: { geo: "BE", nace_r2: "I551-I553", c_resid: "TOTAL", unit: "NR", freq: "M" },
    grain: "month",
    label: "Nights spent in tourist accommodation, Belgium",
    unit_label: "nights",
    since: "2016-01",
  },
  {
    id: "bankruptcies_g",
    dataset: "sts_rb_q",
    filters: { geo: "BE", nace_r2: "G", indic_bt: "BKRT", s_adj: "NSA", unit: "I21", freq: "Q" },
    grain: "quarter",
    label: "Bankruptcy declarations, wholesale and retail trade (G), Belgium (2021=100)",
    unit_label: "index 2021=100",
    since: "2016-Q1",
  },
];

export function sinceParam(s: EurostatSeries): string {
  return s.since;
}

export function requestUrl(s: EurostatSeries): string {
  const q = new URLSearchParams({ format: "JSON", lang: "EN", ...s.filters, sinceTimePeriod: s.since });
  return `${EUROSTAT_BASE}/${s.dataset}?${q.toString()}`;
}

export interface JsonStat {
  label?: string;
  updated?: string;
  id: string[];
  size: number[];
  value: Record<string, number> | number[];
  dimension: Record<string, { category: { index: Record<string, number> | string[]; label?: Record<string, string> } }>;
  error?: unknown;
}

/** Map a JSON-stat 2.0 response with all non-time dimensions fixed to one code into period -> value. */
export function decodeSingleSeries(js: JsonStat): { period: string; value: number }[] {
  const timeIdx = js.dimension.time?.category.index;
  if (!timeIdx) throw new Error("JSON-stat response has no time dimension");
  for (const [i, dim] of js.id.entries()) {
    if (dim !== "time" && js.size[i] !== 1) throw new Error(`dimension ${dim} is not fixed to a single code (size ${js.size[i]})`);
  }
  const index: Record<string, number> = Array.isArray(timeIdx)
    ? Object.fromEntries(timeIdx.map((p, i) => [p, i]))
    : timeIdx;
  const values = js.value;
  const out: { period: string; value: number }[] = [];
  for (const [period, pos] of Object.entries(index)) {
    const v = Array.isArray(values) ? values[pos] : values[String(pos)];
    if (typeof v === "number" && Number.isFinite(v)) out.push({ period, value: v });
  }
  return out.sort((a, b) => (a.period < b.period ? -1 : 1));
}

/** Throws unless every requested code is present in the response's category index. */
export function validateCodes(s: EurostatSeries, js: JsonStat): void {
  for (const [dim, code] of Object.entries(s.filters)) {
    const cat = js.dimension[dim]?.category.index;
    if (!cat) throw new Error(`${s.id}: dimension ${dim} missing from ${s.dataset}`);
    const codes = Array.isArray(cat) ? cat : Object.keys(cat);
    if (!codes.includes(code)) throw new Error(`${s.id}: code ${dim}=${code} not in ${s.dataset} (got ${codes.slice(0, 8).join(", ")})`);
  }
}

/** Normalise Eurostat period labels: 2025M03 / 2025-03 -> 2025-03; 2025Q2 -> 2025-Q2; 2025S1 -> 2025-S1. */
export function normalisePeriod(p: string): string {
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-?M?(\d{2})$/.exec(p))) return `${m[1]}-${m[2]}`;
  if ((m = /^(\d{4})-?Q([1-4])$/.exec(p))) return `${m[1]}-Q${m[2]}`;
  if ((m = /^(\d{4})-?S([12])$/.exec(p))) return `${m[1]}-S${m[2]}`;
  return p;
}
