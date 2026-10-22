// Calendar facts used as a confounder (Easter timing shifts chocolate, café and florist sales between months).

/** Western (Gregorian) Easter Sunday, anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Share of the 14-day pre-Easter selling window (Easter Sunday and the 13 days before it)
 * that falls in each month. Returns e.g. { "2024-03": 1 } or { "2026-03": 0.29, "2026-04": 0.71 }.
 */
export function easterWindowShares(year: number, days = 14): Record<string, number> {
  const easter = easterSunday(year);
  const shares: Record<string, number> = {};
  for (let k = 0; k < days; k++) {
    const d = new Date(easter.getTime() - k * 86_400_000);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    shares[key] = (shares[key] ?? 0) + 1 / days;
  }
  for (const k of Object.keys(shares)) shares[k] = Math.round(shares[k]! * 10_000) / 10_000;
  return shares;
}

export interface CalendarRow {
  period: string;
  easter_date: string;
  easter_share: number;
  days_in_month: number;
}

/** Monthly calendar table for a range of years (loaded into the ledger database and exposed via the USL). */
export function calendarTable(fromYear: number, toYear: number): CalendarRow[] {
  const rows: CalendarRow[] = [];
  for (let y = fromYear; y <= toYear; y++) {
    const shares = easterWindowShares(y);
    const easter = isoDate(easterSunday(y));
    for (let m = 1; m <= 12; m++) {
      const period = `${y}-${String(m).padStart(2, "0")}`;
      rows.push({
        period,
        easter_date: easter,
        easter_share: shares[period] ?? 0,
        days_in_month: new Date(Date.UTC(y, m, 0)).getUTCDate(),
      });
    }
  }
  return rows;
}
