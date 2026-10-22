// Seeded generator for the SYNTHETIC business ledgers (labelled synthetic everywhere).
//
// Each ledger is driven by REAL Eurostat series (fetched here, at generation time) through documented
// elasticities, plus seasonality, the Easter calendar, owner actions and noise. The generator's
// parameters are the hidden ground truth for Causeway Bench: they are written to bench/truth/ and
// the agent never reads that folder (only the ledger rows, through Zetaris or the snapshot).
//
// Usage: npx tsx scripts/gen-ledgers.ts [--seed 2610]
import { mkdirSync, writeFileSync } from "node:fs";
import { SERIES, decodeSingleSeries, normalisePeriod, requestUrl, type JsonStat } from "../src/data/eurostat.ts";
import { calendarTable, easterWindowShares } from "../src/data/calendar.ts";
import { periodRange, shiftPeriod } from "../src/stats/series.ts";
import { BUSINESSES, type BusinessSpec } from "./businesses.ts";

const START = "2019-01";
const END = "2026-06";
const seedArg = process.argv.indexOf("--seed");
const SEED = seedArg > 0 ? Number(process.argv[seedArg + 1]) : 2610;

// ---------------------------------------------------------------- RNG
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function hashSeed(s: string, base: number): number {
  let h = base;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 2654435761) >>> 0;
  return h;
}

// ---------------------------------------------------------------- drivers (real Eurostat series)
async function fetchSeries(id: string): Promise<Map<string, number>> {
  const s = SERIES.find((x) => x.id === id);
  if (!s) throw new Error(`unknown series ${id}`);
  const res = await fetch(requestUrl(s), { signal: AbortSignal.timeout(30_000) });
  const js = (await res.json()) as JsonStat;
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
  return new Map(decodeSingleSeries(js).map((p) => [normalisePeriod(p.period), p.value]));
}

function monthlyFromHalfYear(h: Map<string, number>): Map<string, number> {
  const m = new Map<string, number>();
  for (const [p, v] of h) {
    const mm = /^(\d{4})-S([12])$/.exec(p);
    if (!mm) continue;
    const first = mm[2] === "1" ? 1 : 7;
    for (let k = 0; k < 6; k++) m.set(`${mm[1]}-${String(first + k).padStart(2, "0")}`, v);
  }
  return m;
}

/** Splice the 2025=100 HICP onto the 2015=100 base using the 2025 overlap (as the Analyst does). */
function spliceChoc(i15: Map<string, number>, i25: Map<string, number>): Map<string, number> {
  const overlap = [...i15.keys()].filter((p) => i25.has(p));
  const ratio = overlap.reduce((a, p) => a + i25.get(p)!, 0) / overlap.reduce((a, p) => a + i15.get(p)!, 0);
  const out = new Map(i15);
  for (const [p, v] of i25) if (!out.has(p)) out.set(p, v / ratio);
  return out;
}

function relTo(series: Map<string, number>, period: string, basePeriods: string[]): number {
  const base = basePeriods.map((p) => series.get(p)).filter((x): x is number => x !== undefined);
  const b = base.reduce((a, x) => a + x, 0) / base.length;
  const v = series.get(period);
  if (v === undefined) throw new Error(`driver missing value for ${period}`);
  return v / b;
}

// ---------------------------------------------------------------- generation
interface LedgerRow {
  business_id: string;
  period: string;
  units: number;
  transactions: number;
  revenue: number;
  cogs: number;
  gross_margin_pct: number;
  avg_ticket: number;
  synthetic: boolean;
}

function generate(spec: BusinessSpec, drivers: Record<string, Map<string, number>>): LedgerRow[] {
  const rand = mulberry32(hashSeed(spec.id, SEED));
  const base2021 = periodRange("2021-01", "2021-12");
  const rows: LedgerRow[] = [];
  for (const period of periodRange(START, END)) {
    const month = Number(period.slice(5, 7));
    const year = Number(period.slice(0, 4));
    // price: drift plus owner price changes
    let price = spec.base.unit_price * (1 + spec.price_drift_per_year) ** (year - 2021 + (month - 1) / 12);
    for (const a of spec.actions) if (a.type === "price_change" && period >= a.from) price *= 1 + a.pct;
    // unit cost: weighted input indices (with lag) plus owner cost steps
    let costIndex = 1 - spec.cost_weights.reduce((a, w) => a + w.weight, 0);
    for (const w of spec.cost_weights) costIndex += w.weight * relTo(drivers[w.driver]!, shiftPeriod(period, -w.lag), base2021.map((p) => shiftPeriod(p, -w.lag))) ** (w.power ?? 1);
    let unitCost = spec.base.unit_cost * costIndex * (1 + spec.cost_drift_per_year) ** (year - 2021);
    for (const a of spec.actions) if (a.type === "unit_cost_step" && period >= a.from) unitCost *= 1 + a.pct;
    // demand
    let units = spec.base.units * spec.seasonality[month - 1]!;
    const easter = easterWindowShares(year)[period] ?? 0;
    units *= 1 + spec.easter_uplift * easter;
    for (const e of spec.demand_elasticities) units *= relTo(drivers[e.driver]!, period, base2021) ** e.elasticity;
    const refPrice = spec.base.unit_price * (1 + spec.price_drift_per_year) ** (year - 2021 + (month - 1) / 12);
    units *= (price / refPrice) ** spec.price_elasticity;
    units *= Math.exp(spec.noise_sd * gaussian(rand));
    const u = Math.max(1, Math.round(units));
    const revenue = Math.round(u * price * 100) / 100;
    const cogs = Math.round(u * unitCost * Math.exp(0.004 * gaussian(rand)) * 100) / 100;
    const transactions = Math.max(1, Math.round(u / spec.units_per_ticket));
    rows.push({
      business_id: spec.id,
      period,
      units: u,
      transactions,
      revenue,
      cogs,
      gross_margin_pct: Math.round((1 - cogs / revenue) * 10_000) / 100,
      avg_ticket: Math.round((revenue / transactions) * 100) / 100,
      synthetic: true,
    });
  }
  return rows;
}

function toCsv<T extends object>(rows: T[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]!) as (keyof T)[];
  return [cols.join(","), ...rows.map((r) => cols.map((c) => String(r[c])).join(","))].join("\n") + "\n";
}

async function main() {
  const [i15, i25, elec, gas, retail, tourism] = await Promise.all([
    fetchSeries("hicp_choc_i15"),
    fetchSeries("hicp_choc_i25"),
    fetchSeries("elec_nonhh"),
    fetchSeries("gas_nonhh"),
    fetchSeries("retail_vol_g47"),
    fetchSeries("tourism_nights"),
  ]);
  const drivers: Record<string, Map<string, number>> = {
    choc: spliceChoc(i15, i25),
    elec: monthlyFromHalfYear(elec),
    gas: monthlyFromHalfYear(gas),
    retail: retail,
    tourism: tourism,
  };
  const all: LedgerRow[] = [];
  mkdirSync("data/ledger", { recursive: true });
  mkdirSync("bench/truth", { recursive: true });
  for (const spec of BUSINESSES) {
    const rows = generate(spec, drivers);
    all.push(...rows);
    writeFileSync(
      `bench/truth/${spec.id}.json`,
      JSON.stringify({ business_id: spec.id, seed: SEED, generator: "scripts/gen-ledgers.ts", spec, eurostat_updated_note: "drivers fetched live from Eurostat at generation time" }, null, 2) + "\n",
    );
  }
  writeFileSync("data/ledger/ledger.csv", toCsv(all));
  writeFileSync(
    "data/ledger/businesses.csv",
    toCsv(BUSINESSES.map((b) => ({ business_id: b.id, name: b.name, city: b.city, nace: b.nace, sector: b.sector, synthetic: true }))),
  );
  writeFileSync("data/ledger/calendar.csv", toCsv(calendarTable(2019, 2026)));
  console.log(`generated ${BUSINESSES.length} synthetic ledgers, ${all.length} rows, seed ${SEED}`);
}

await main();
