// Pre-onboarding check: every Eurostat series we register in Zetaris must exist, have valid codes
// and return data. Fails loudly (exit 1). Prints counts and last periods, never data dumps.
import { SERIES, decodeSingleSeries, normalisePeriod, requestUrl, validateCodes, type JsonStat } from "../src/data/eurostat.ts";

let failed = 0;
for (const s of SERIES) {
  const url = requestUrl(s);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const js = (await res.json()) as JsonStat;
    if (!res.ok || js.error) throw new Error(`HTTP ${res.status} ${JSON.stringify(js.error ?? "").slice(0, 200)}`);
    validateCodes(s, js);
    const pts = decodeSingleSeries(js);
    if (pts.length === 0) throw new Error("no values");
    const first = normalisePeriod(pts[0]!.period);
    const last = normalisePeriod(pts[pts.length - 1]!.period);
    console.log(`OK   ${s.id.padEnd(16)} ${s.dataset.padEnd(14)} n=${String(pts.length).padStart(3)} ${first}..${last} updated=${js.updated ?? "?"}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${s.id.padEnd(16)} ${s.dataset.padEnd(14)} ${(e as Error).message}`);
  }
}
if (failed) {
  console.log(`${failed} series failed`);
  process.exit(1);
}
