// Typed cause catalogue: which explanations exist, when they apply, and how they are tested.
import type { Metric } from "../tests/compiler.ts";
import type { CauseType } from "./types.ts";

export interface CauseDef {
  type: CauseType;
  title: string;
  mechanism: string;
  /** Eurostat-backed driver series in the USL (null for ledger- or calendar-based causes). */
  driver: string | null;
  /** Splice partner: a newer index base that continues the driver series. */
  driver_continuation?: string;
  /** Effect of a RISE in the driver on each metric it can explain (+1 / -1). */
  effects: Partial<Record<Metric, 1 | -1>>;
  /** Outcome series the driver is associated with (for the lag test). */
  assoc_metric: Metric | null;
  lag_window: [number, number];
  /** NACE prefixes the cause is plausible for (empty = all). */
  nace: string[];
  /** Only proposed when an owner-confirmed fact supports it (from memory). */
  needs_fact?: boolean;
}

export const CAUSES: Record<CauseType, CauseDef> = {
  input_cost_cocoa: {
    type: "input_cost_cocoa",
    title: "Cocoa-driven input costs",
    mechanism: "Chocolate and cocoa prices rose, raising the cost of each unit sold and squeezing the margin.",
    driver: "hicp_choc_i15",
    driver_continuation: "hicp_choc_i25",
    effects: { gross_margin_pct: -1, unit_cost: 1 },
    assoc_metric: "unit_cost",
    lag_window: [0, 3],
    nace: ["G47.24", "C10.82", "I56"],
  },
  energy_cost: {
    type: "energy_cost",
    title: "Energy costs",
    mechanism: "Electricity prices for small business users moved, changing production and shop running costs.",
    driver: "elec_nonhh",
    effects: { gross_margin_pct: -1, unit_cost: 1 },
    assoc_metric: "unit_cost",
    lag_window: [0, 6],
    nace: [],
  },
  tourism_demand: {
    type: "tourism_demand",
    title: "Tourist demand",
    mechanism: "More (or fewer) visitor nights in Belgium changed footfall and sales.",
    driver: "tourism_nights",
    effects: { revenue: 1, units: 1 },
    assoc_metric: "units",
    lag_window: [0, 1],
    nace: ["I55", "I56", "G47.24", "G47.76", "G47.7"],
  },
  retail_demand: {
    type: "retail_demand",
    title: "General retail demand",
    mechanism: "Belgian retail sales volumes moved, carrying this shop's sales with them.",
    driver: "retail_vol_g47",
    effects: { revenue: 1, units: 1 },
    assoc_metric: "units",
    lag_window: [0, 2],
    nace: ["G47"],
  },
  sector_distress: {
    type: "sector_distress",
    title: "Sector distress (bankruptcies)",
    mechanism: "More retail and wholesale bankruptcies signal weaker trading conditions across the sector.",
    driver: "bankruptcies_g",
    effects: { revenue: -1, units: -1 },
    assoc_metric: "units",
    lag_window: [0, 3],
    nace: ["G"],
  },
  easter_shift: {
    type: "easter_shift",
    title: "Easter timing",
    mechanism: "Easter fell in a different month, moving seasonal sales between the compared periods.",
    driver: null,
    effects: { revenue: 1, units: 1, gross_margin_pct: 1 },
    assoc_metric: null,
    lag_window: [0, 0],
    nace: ["G47.24", "G47.76", "I56", "C10.82"],
  },
  own_price_change: {
    type: "own_price_change",
    title: "Our own price changes",
    mechanism: "A change in our selling prices moved revenue per unit and therefore the margin.",
    driver: null,
    effects: { gross_margin_pct: 1, revenue: 1, units: -1, avg_ticket: 1 },
    assoc_metric: null,
    lag_window: [0, 0],
    nace: [],
  },
  supplier_change: {
    type: "supplier_change",
    title: "Supplier change",
    mechanism: "A change of supplier moved unit costs beyond what market prices explain.",
    driver: null,
    effects: { gross_margin_pct: -1, unit_cost: 1 },
    assoc_metric: null,
    lag_window: [0, 0],
    nace: [],
    needs_fact: true,
  },
};

export function causeApplies(c: CauseDef, metric: Metric, nace: string): boolean {
  if (c.effects[metric] === undefined) return false;
  if (c.nace.length === 0) return true;
  return c.nace.some((p) => nace === p || nace.startsWith(p));
}

/** Causes the catalogue allows for this business and metric (supplier_change only with a fact). */
export function applicableCauses(metric: Metric, nace: string, facts: { cause_type: string }[] = []): CauseDef[] {
  return Object.values(CAUSES).filter(
    (c) => causeApplies(c, metric, nace) && (!c.needs_fact || facts.some((f) => f.cause_type === c.type)),
  );
}
