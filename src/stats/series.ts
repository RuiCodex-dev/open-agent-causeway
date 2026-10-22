// Monthly series helpers. Periods are "YYYY-MM" strings; values are numbers or null (missing).

export interface Point {
  period: string;
  value: number | null;
}

export function parsePeriod(p: string): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(p);
  if (!m) throw new Error(`invalid monthly period: ${p}`);
  return { year: Number(m[1]), month: Number(m[2]) };
}

export function shiftPeriod(p: string, months: number): string {
  const { year, month } = parsePeriod(p);
  const idx = year * 12 + (month - 1) + months;
  const y = Math.floor(idx / 12);
  const mo = (idx % 12) + 1;
  return `${y}-${String(mo).padStart(2, "0")}`;
}

/** Inclusive list of monthly periods from start to end. */
export function periodRange(start: string, end: string): string[] {
  const out: string[] = [];
  let p = start;
  let guard = 0;
  while (p <= end && guard++ < 10_000) {
    out.push(p);
    p = shiftPeriod(p, 1);
  }
  return out;
}

/** Expand "2025-H1", "2025-Q2", "2025" or "2025-03..2025-06" into monthly periods. */
export function expandPeriodSpec(spec: string): string[] {
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-H([12])$/.exec(spec))) {
    const y = m[1];
    return m[2] === "1" ? periodRange(`${y}-01`, `${y}-06`) : periodRange(`${y}-07`, `${y}-12`);
  }
  if ((m = /^(\d{4})-Q([1-4])$/.exec(spec))) {
    const q = Number(m[2]);
    const s = String((q - 1) * 3 + 1).padStart(2, "0");
    const e = String(q * 3).padStart(2, "0");
    return periodRange(`${m[1]}-${s}`, `${m[1]}-${e}`);
  }
  if ((m = /^(\d{4})$/.exec(spec))) return periodRange(`${m[1]}-01`, `${m[1]}-12`);
  if ((m = /^(\d{4}-\d{2})\.\.(\d{4}-\d{2})$/.exec(spec))) return periodRange(m[1], m[2]);
  if (/^\d{4}-\d{2}$/.test(spec)) return [spec];
  throw new Error(`unsupported period spec: ${spec}`);
}

/** The same window shifted back by whole years (default one year). */
export function baselineFor(spec: string, years = 1): string[] {
  return expandPeriodSpec(spec).map((p) => shiftPeriod(p, -12 * years));
}

export function toMap(points: Point[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of points) if (p.value !== null && Number.isFinite(p.value)) m.set(p.period, p.value);
  return m;
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function sd(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

export function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

/** Share of requested periods that have a value. */
export function coverage(points: Map<string, number>, periods: string[]): number {
  if (periods.length === 0) return 0;
  return periods.filter((p) => points.has(p)).length / periods.length;
}

/** Year-over-year relative change per month, for months where both values exist. */
export function yoySeries(points: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [p, v] of points) {
    const prev = points.get(shiftPeriod(p, -12));
    if (prev !== undefined && prev !== 0) out.set(p, v / prev - 1);
  }
  return out;
}

export function round(x: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
