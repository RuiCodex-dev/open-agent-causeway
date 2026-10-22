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
  /**
   * Ground truth for Causeway Bench. `causes` must come out supported (the first is the main one);
   * `not_causes` must NOT come out supported. Empty `causes` = a null control (nothing external happened).
   * `fact` (optional) is an owner fact stored in H-MEM before the run.
   */
  truth: { case_id: string; split: "tune" | "holdout"; question: string; metric: string; period: string; baseline: string; causes: string[]; not_causes: string[]; fact?: string }[];
}

const flat = Array(12).fill(1);
const bikeSeason = [0.6, 0.7, 1.0, 1.3, 1.35, 1.3, 1.15, 1.05, 1.0, 0.85, 0.75, 0.95];

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
      { case_id: "B01", split: "tune", question: "Why did our gross margin fall in the first half of 2025?", metric: "gross_margin_pct", period: "2025-H1", baseline: "2024-H1", causes: ["input_cost_cocoa"], not_causes: ["energy_cost", "easter_shift", "own_price_change"] },
      { case_id: "B02", split: "tune", question: "Why did our gross margin fall in the first half of 2025?", metric: "gross_margin_pct", period: "2025-H1", baseline: "2024-H1", causes: ["input_cost_cocoa", "supplier_change"], not_causes: ["energy_cost", "easter_shift"], fact: "We switched to a more expensive single-origin couverture supplier in May 2025." },
      { case_id: "B03", split: "holdout", question: "Why did our revenue fall in Q2 2024 compared with Q2 2023?", metric: "revenue", period: "2024-Q2", baseline: "2023-Q2", causes: ["easter_shift"], not_causes: ["retail_demand", "sector_distress"] },
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
    easter_uplift: 0,
    price_drift_per_year: 0.03,
    cost_drift_per_year: 0.025,
    price_elasticity: -0.3,
    units_per_ticket: 2.1,
    noise_sd: 0.03,
    cost_weights: [{ driver: "elec", weight: 0.08, lag: 0 }],
    demand_elasticities: [{ driver: "tourism", elasticity: 0.9 }],
    actions: [],
    truth: [
      { case_id: "B04", split: "tune", question: "Why did our revenue rise in Q2 2022 compared with Q2 2021?", metric: "revenue", period: "2022-Q2", baseline: "2021-Q2", causes: ["tourism_demand"], not_causes: ["easter_shift", "own_price_change"] },
      { case_id: "B05", split: "holdout", question: "Why did our revenue fall in 2020?", metric: "revenue", period: "2020", baseline: "2019", causes: ["tourism_demand"], not_causes: ["easter_shift", "own_price_change"] },
    ],
  },
  {
    id: "velo-schelde",
    name: "Velo Schelde",
    city: "Antwerp",
    nace: "G47.64",
    sector: "Bicycle shop (retail of sporting goods)",
    base: { unit_price: 820, unit_cost: 560, units: 95 },
    seasonality: bikeSeason,
    easter_uplift: 0,
    price_drift_per_year: 0.02,
    cost_drift_per_year: 0.02,
    price_elasticity: -0.8,
    units_per_ticket: 1.05,
    noise_sd: 0.03,
    cost_weights: [],
    demand_elasticities: [{ driver: "retail", elasticity: 3.0 }],
    actions: [],
    truth: [
      { case_id: "B06", split: "tune", question: "Why did the number of bikes we sold fall in 2023 compared with 2022?", metric: "units", period: "2023", baseline: "2022", causes: ["retail_demand"], not_causes: ["own_price_change", "easter_shift"] },
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
      { case_id: "B07", split: "tune", question: "Why did our revenue change in the first half of 2025?", metric: "revenue", period: "2025-H1", baseline: "2024-H1", causes: [], not_causes: ["tourism_demand", "retail_demand", "sector_distress", "easter_shift", "own_price_change"] },
    ],
  },
  {
    id: "bakkerij-mechelen",
    name: "Bakkerij De Korenaar",
    city: "Mechelen",
    nace: "C10.71",
    sector: "Bakery (bread and fresh pastry)",
    base: { unit_price: 3.4, unit_cost: 1.5, units: 22000 },
    seasonality: [0.95, 0.95, 1.0, 1.0, 1.0, 0.95, 0.9, 0.9, 1.0, 1.05, 1.05, 1.25],
    easter_uplift: 0.05,
    price_drift_per_year: 0.02,
    cost_drift_per_year: 0.015,
    price_elasticity: -0.2,
    units_per_ticket: 2.4,
    noise_sd: 0.02,
    cost_weights: [{ driver: "elec", weight: 0.3, lag: 0, power: 1.4 }],
    demand_elasticities: [],
    actions: [],
    truth: [
      { case_id: "B08", split: "holdout", question: "Why did our gross margin fall in the second half of 2022?", metric: "gross_margin_pct", period: "2022-H2", baseline: "2021-H2", causes: ["energy_cost"], not_causes: ["own_price_change", "easter_shift"] },
    ],
  },
  {
    id: "pralines-brugge",
    name: "Pralines Minnewater",
    city: "Bruges",
    nace: "G47.24",
    sector: "Praline shop (Easter-heavy confectionery retail)",
    base: { unit_price: 12, unit_cost: 5.5, units: 2400 },
    seasonality: [0.7, 1.1, 0.8, 0.8, 0.8, 0.8, 0.9, 0.9, 0.8, 0.9, 1.1, 1.8],
    easter_uplift: 1.6,
    price_drift_per_year: 0.02,
    cost_drift_per_year: 0.02,
    price_elasticity: -0.4,
    units_per_ticket: 1.4,
    noise_sd: 0.025,
    cost_weights: [],
    demand_elasticities: [],
    actions: [],
    truth: [
      { case_id: "B09", split: "holdout", question: "Why did our revenue rise in Q2 2025 compared with Q2 2024?", metric: "revenue", period: "2025-Q2", baseline: "2024-Q2", causes: ["easter_shift"], not_causes: ["tourism_demand", "retail_demand", "own_price_change"] },
    ],
  },
  {
    id: "kapsalon-hasselt",
    name: "Kapsalon Lumière",
    city: "Hasselt",
    nace: "S96.02",
    sector: "Hair salon (null control: noise only)",
    base: { unit_price: 38, unit_cost: 14, units: 900 },
    seasonality: [0.9, 0.95, 1.0, 1.0, 1.0, 1.05, 0.9, 0.85, 1.0, 1.05, 1.05, 1.25],
    easter_uplift: 0,
    price_drift_per_year: 0.025,
    cost_drift_per_year: 0.025,
    price_elasticity: 0,
    units_per_ticket: 1,
    noise_sd: 0.03,
    cost_weights: [],
    demand_elasticities: [],
    actions: [],
    truth: [
      { case_id: "B10", split: "holdout", question: "Why did our revenue change in 2024 compared with 2023?", metric: "revenue", period: "2024", baseline: "2023", causes: [], not_causes: ["energy_cost", "own_price_change"] },
    ],
  },
  {
    id: "fietsen-gent",
    name: "Fietsen Kouter",
    city: "Ghent",
    nace: "G47.64",
    sector: "Bicycle shop that raised prices (own action)",
    base: { unit_price: 900, unit_cost: 600, units: 110 },
    seasonality: bikeSeason,
    easter_uplift: 0,
    price_drift_per_year: 0,
    cost_drift_per_year: 0,
    price_elasticity: -1.4,
    units_per_ticket: 1.05,
    noise_sd: 0.025,
    cost_weights: [],
    demand_elasticities: [],
    actions: [{ type: "price_change", from: "2024-03", pct: 0.15, owner_fact: "We raised all bike prices by 15% in March 2024." }],
    truth: [
      { case_id: "B11", split: "holdout", question: "Why did the number of bikes we sold fall in 2024 compared with 2023?", metric: "units", period: "2024", baseline: "2023", causes: ["own_price_change"], not_causes: ["sector_distress", "easter_shift"] },
      { case_id: "B12", split: "holdout", question: "Why did our gross margin change in 2024 compared with 2023?", metric: "gross_margin_pct", period: "2024", baseline: "2023", causes: ["own_price_change"], not_causes: ["energy_cost", "easter_shift"] },
    ],
  },
];
