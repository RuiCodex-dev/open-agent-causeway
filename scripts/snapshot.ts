// Snapshot of the USL "causeway" read THROUGH Zetaris (SELECT * per table), stored as Parquet plus a manifest.
// This is cached DATA (not cached answers): sample mode and the Bench run new SQL on it with DuckDB.
//   npx tsx scripts/snapshot.ts
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { DuckDBInstance } from "@duckdb/node-api";
import { ZetarisRest } from "../src/adapters/zetaris.ts";
import { resultHash } from "../src/adapters/resultHash.ts";
import { USL_TABLES, castCell, uslName } from "../src/data/uslSchema.ts";

const DIR = "data/snapshot";
const z = new ZetarisRest({ restUrl: process.env.ZETARIS_REST_URL ?? "", apiKey: process.env.ZETARIS_API_KEY ?? "", orgId: process.env.ZETARIS_ORG_ID ?? "", timeoutMs: 600_000 });
mkdirSync(DIR, { recursive: true });
const inst = await DuckDBInstance.create(":memory:");
const conn = await inst.connect();
const manifest: Record<string, unknown> = {};

for (const [table, cols] of Object.entries(USL_TABLES)) {
  const names = Object.keys(cols);
  const sql = `SELECT ${names.join(", ")} FROM ${uslName(table)} ORDER BY ${names[0]}`;
  const executed_at = new Date().toISOString();
  const res = await z.query(sql, { limit: 100_000 });
  if (res.columns.join(",") !== names.join(",")) throw new Error(`${table}: unexpected columns ${res.columns.join(",")}`);
  const typed = res.rows.map((r) => r.map((v, i) => castCell(v, cols[names[i]!]!)));
  await conn.run(`CREATE OR REPLACE TABLE ${table} (${names.map((n) => `${n} ${cols[n]}`).join(", ")})`);
  const appender = await conn.createAppender(table);
  for (const row of typed) {
    for (const [i, v] of row.entries()) {
      const t = cols[names[i]!]!;
      if (v === null) appender.appendNull();
      else if (t === "DOUBLE") appender.appendDouble(v as number);
      else if (t === "INTEGER") appender.appendInteger(v as number);
      else if (t === "BOOLEAN") appender.appendBoolean(v as boolean);
      else appender.appendVarchar(v as string);
    }
    appender.endRow();
  }
  appender.closeSync();
  const file = `${table}.parquet`;
  await conn.run(`COPY ${table} TO '${DIR}/${file}' (FORMAT parquet)`);
  manifest[table] = { sql, executed_at, row_count: typed.length, sha256: resultHash(res.columns, res.rows), file, engine: "zetaris" };
  console.log(`${table.padEnd(16)} rows=${String(typed.length).padStart(4)} sha256=${(manifest[table] as { sha256: string }).sha256.slice(0, 12)}`);
}

writeFileSync(
  `${DIR}/manifest.json`,
  JSON.stringify(
    {
      created_at: new Date().toISOString(),
      source: "Zetaris Lightning 2.4.3.1 (local), USL lightning.metastore.causeway_ns.causeway, read over REST",
      note: "Business ledgers are SYNTHETIC (labelled). Driver series are real Eurostat data (re-use with attribution).",
      tables: manifest,
    },
    null,
    2,
  ) + "\n",
);
console.log("snapshot written to data/snapshot/");
