// Parity check: the same SQL on Zetaris (live) and on the DuckDB snapshot must give the same result hash.
//   npx tsx scripts/parity.ts            -> snapshot tables vs manifest hashes (no Zetaris needed)
//   npx tsx scripts/parity.ts --live     -> also runs portable join queries on both engines and compares
import "dotenv/config";
import { readFileSync } from "node:fs";
import { SnapshotDuckdb } from "../src/adapters/snapshotDuckdb.ts";
import { ZetarisRest } from "../src/adapters/zetaris.ts";
import { resultHash } from "../src/adapters/resultHash.ts";
import { USL_PREFIX } from "../src/data/uslSchema.ts";

const local = (sql: string) => sql.split(`${USL_PREFIX}.`).join("");
const snap = new SnapshotDuckdb();
const manifest = JSON.parse(readFileSync("data/snapshot/manifest.json", "utf8")) as { tables: Record<string, { sql: string; sha256: string }> };
let failed = 0;
for (const [t, m] of Object.entries(manifest.tables)) {
  const r = await snap.query(local(m.sql));
  const h = resultHash(r.columns, r.rows);
  const ok = h === m.sha256;
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "DIFF"} snapshot ${t.padEnd(16)} ${h.slice(0, 12)} vs manifest ${m.sha256.slice(0, 12)}`);
}

if (process.argv.includes("--live")) {
  const z = new ZetarisRest({ restUrl: process.env.ZETARIS_REST_URL ?? "", apiKey: process.env.ZETARIS_API_KEY ?? "", orgId: process.env.ZETARIS_ORG_ID ?? "" });
  const q = [
    `SELECT b.period, b.gross_margin_pct, d.value AS hicp FROM ${USL_PREFIX}.business_period b JOIN ${USL_PREFIX}.driver_month d ON d.period = b.period AND d.series_id = 'hicp_choc_i15' WHERE b.business_id = 'atelier-noir' AND b.period BETWEEN '2024-01' AND '2025-06' ORDER BY b.period`,
    `SELECT d.series_id, COUNT(*) AS n, ROUND(AVG(d.value), 6) AS mean_value FROM ${USL_PREFIX}.driver_month d GROUP BY d.series_id ORDER BY d.series_id`,
    `SELECT b.business_id, SUM(b.revenue) AS revenue, SUM(b.cogs) AS cogs, SUM(b.units) AS units FROM ${USL_PREFIX}.business_period b WHERE b.period BETWEEN '2025-01' AND '2025-06' GROUP BY b.business_id ORDER BY b.business_id`,
  ];
  for (const [i, sql] of q.entries()) {
    const a = await z.query(sql);
    const b = await snap.query(local(sql));
    const ha = resultHash(a.columns, a.rows);
    const hb = resultHash(b.columns, b.rows);
    if (ha !== hb) failed++;
    console.log(`${ha === hb ? "OK  " : "DIFF"} live-vs-snapshot query ${i + 1}: zetaris ${ha.slice(0, 12)} duckdb ${hb.slice(0, 12)} (${a.rows.length} rows)`);
  }
}
if (failed) process.exit(1);
