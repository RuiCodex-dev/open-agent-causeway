// SYNTHETIC businesses for the demo and Causeway Bench. Every value here is invented and labelled synthetic.
// The drivers they respond to are real Eurostat series; the responses (elasticities, weights) are
// the hidden ground truth the agent has to recover.

export type DriverId = "choc" | "elec" | "gas" | "retail" | "tourism";

export interface BusinessSpec {
  id: string;
  name: string;
  city: string;
  nace: string;
  sector: string;
  base: { unit_price: number; unit_cost: number; units: number };
  seasonality: number[]; // 12 multipliers, Jan..Dec
  easter_uplift: number; // extra share of a month's units when the full pre-Easter window falls in it
  price_drift_per_year: number;
  cost_drift_per_year: number;
  price_elasticity: number;
  units_per_ticket: number;
  noise_sd: number;
  /** Input-cost share of unit cost, driver lag in months, and pass-through power (cost moves rel^power). */
  cost_weights: { driver: DriverId; weight: number; lag: number; power?: number }[];
  demand_elasticities: { driver: DriverId; elasticity: number }[];
  actions: { type: "price_change" | "unit_cost_step"; from: string; pct: number; owner_fact: string }[];
  /** Ground truth for the bench question(s). */
  truth: { question: string; metric: string; period: string; baseline: string; causes: string[]; not_causes: string[] }[];
}

const flat = Array(12).fill(1);

export const BUSINESSES: BusinessSpec[] = [
  {
    id: "atelier-noir",
    name: "Atelier Noir",
    city: "Ghent",
    nace: "G47.24",
    sector: "Chocolatier (retail of confectionery)",
    base: { unit_price: 9.5, unit_cost: 3.6, units: 5200 },
    seasonality: [0.85, 1.25, 0.95, 0.95, 0.85, 0.8, 0.85, 0.85, 0.9, 1.0, 1.15, 1.6],
    easter_uplift: 0.6,
    price_drift_per_year: 0.015,
    cost_drift_per_year: 0.01,
    price_elasticity: -0.6,
    units_per_ticket: 1.7,
    noise_sd: 0.025,
    cost_weights: [
      { driver: "choc", weight: 0.62, lag: 1, power: 2.5 },
      { driver: "elec", weight: 0.06, lag: 0 },
    ],
    demand_elasticities: [{ driver: "tourism", elasticity: 0.35 }],
    actions: [
      { type: "price_change", from: "2025-04", pct: 0.06, owner_fact: "We raised our list prices by 6% on 1 April 2025." },
      { type: "unit_cost_step", from: "2025-05", pct: 0.04, owner_fact: "We switched to a more expensive single-origin couverture supplier in May 2025." },
    ],
    truth: [
      {
        question: "Why did our gross margin fall in the first half of 2025?",
        metric: "gross_margin_pct",
        period: "2025-H1",
        baseline: "2024-H1",
        causes: ["input_cost_cocoa", "supplier_change"],
        not_causes: ["energy_cost", "tourism_demand", "easter_shift"],
      },
    ],
  },
  {
    id: "cafe-sablon",
    name: "Café Sablon",
    city: "Brussels",
    nace: "I56.30",
    sector: "Café (beverage serving)",
    base: { unit_price: 4.2, unit_cost: 1.3, units: 14000 },
    seasonality: [0.8, 0.85, 0.95, 1.05, 1.1, 1.1, 1.2, 1.2, 1.05, 0.95, 0.85, 0.9],
    easter_uplift: 0.15,
    price_drift_per_year: 0.03,
    cost_drift_per_year: 0.025,
    price_elasticity: -0.3,
    units_per_ticket: 2.1,
    noise_sd: 0.03,
    cost_weights: [{ driver: "elec", weight: 0.08, lag: 0 }],
    demand_elasticities: [{ driver: "tourism", elasticity: 0.9 }],
    actions: [],
    truth: [
      {
        question: "Why did our revenue change in Q2 2026 compared with Q2 2025?",
        metric: "revenue",
        period: "2026-Q2",
        baseline: "2025-Q2",
        causes: ["tourism_demand"],
        not_causes: ["input_cost_cocoa", "retail_demand"],
      },
    ],
  },
  {
    id: "velo-schelde",
    name: "Velo Schelde",
    city: "Antwerp",
    nace: "G47.64",
    sector: "Bicycle shop (retail of sporting goods)",
    base: { unit_price: 820, unit_cost: 560, units: 95 },
    seasonality: [0.6, 0.7, 1.0, 1.3, 1.35, 1.3, 1.15, 1.05, 1.0, 0.85, 0.75, 0.95],
    easter_uplift: 0,
    price_drift_per_year: 0.02,
    cost_drift_per_year: 0.02,
    price_elasticity: -0.8,
    units_per_ticket: 1.05,
    noise_sd: 0.04,
    cost_weights: [],
    demand_elasticities: [{ driver: "retail", elasticity: 1.6 }],
    actions: [],
    truth: [
      {
        question: "Why did the number of bikes we sold change in 2024 compared with 2023?",
        metric: "units",
        period: "2024",
        baseline: "2023",
        causes: ["retail_demand"],
        not_causes: ["tourism_demand", "energy_cost", "easter_shift"],
      },
    ],
  },
  {
    id: "fleur-leuven",
    name: "Fleur Leuven",
    city: "Leuven",
    nace: "G47.76",
    sector: "Florist (null control: noise only)",
    base: { unit_price: 24, unit_cost: 11, units: 1500 },
    seasonality: flat,
    easter_uplift: 0,
    price_drift_per_year: 0.02,
    cost_drift_per_year: 0.02,
    price_elasticity: 0,
    units_per_ticket: 1.2,
    noise_sd: 0.035,
    cost_weights: [],
    demand_elasticities: [],
    actions: [],
    truth: [
      {
        question: "Why did our revenue change in the first half of 2025?",
        metric: "revenue",
        period: "2025-H1",
        baseline: "2024-H1",
        causes: [],
        not_causes: ["tourism_demand", "retail_demand", "energy_cost", "input_cost_cocoa", "easter_shift"],
      },
    ],
  },
];
