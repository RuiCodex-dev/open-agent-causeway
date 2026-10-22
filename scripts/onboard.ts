// Onboards Causeway's sources and the Unified Semantic Layer "causeway" into a Zetaris instance.
//
//   npx tsx scripts/onboard.ts            -> writes zetaris/sql/*.sql only (reviewable, no secrets)
//   npx tsx scripts/onboard.ts --run      -> also runs every statement over REST (skips "already exists")
//   npx tsx scripts/onboard.ts --run --only usl
//
// The SQL is generated from src/data/eurostat.ts so the catalogue has one source of truth. The ledger
// datasource password is read from CAUSEWAY_LEDGER_PASSWORD at run time and is written to the .sql
// file only as a placeholder.
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { SERIES, requestUrl, type EurostatSeries } from "../src/data/eurostat.ts";
import { ZetarisRest } from "../src/adapters/zetaris.ts";

export const NS = "lightning.metastore.causeway_ns";
export const USL = `${NS}.causeway`;

const decode = (table: string) =>
  `SELECT time_label AS src_period, CAST(v AS DOUBLE) AS value
FROM eurostat_rest.${table}
LATERAL VIEW explode(from_json(to_json(value), 'map<string,double>')) AS time_key, v
LATERAL VIEW explode(from_json(to_json(dimension.time.category.index), 'map<string,bigint>')) AS time_label, idx
WHERE CAST(time_key AS INT) = idx`;

/** Monthly rows for one series; quarters and half-years are expanded to their months (roll-down is explicit). */
function driverMonthSelect(s: EurostatSeries): string {
  const base = `(${decode(s.id)}) d`;
  const lit = `'${s.id}'`;
  if (s.grain === "month") {
    return `SELECT ${lit} AS series_id, d.src_period AS period, d.value AS value, d.src_period AS source_period FROM ${base}`;
  }
  const per = s.grain === "quarter" ? 3 : 6;
  const tag = s.grain === "quarter" ? "Q" : "S";
  return `SELECT ${lit} AS series_id,
  concat(substr(d.src_period, 1, 4), '-', lpad(CAST((CAST(substr(d.src_period, 7, 1) AS INT) - 1) * ${per} + m AS STRING), 2, '0')) AS period,
  d.value AS value, d.src_period AS source_period
FROM ${base} LATERAL VIEW explode(sequence(1, ${per})) AS m
WHERE substr(d.src_period, 6, 1) = '${tag}'`;
}

export function ledgerStatements(): { label: string; sql: string; secret?: boolean }[] {
  return [
    {
      label: "ledger datasource",
      secret: true,
      sql: `CREATE DATASOURCE CAUSEWAY_LEDGER DESCRIBE BY "Owner ledger, PostgreSQL, synthetic" OPTIONS (jdbcdriver "org.postgresql.Driver", jdbcurl "jdbc:postgresql://causeway-ledger:5432/causeway", username "causeway", password "\${CAUSEWAY_LEDGER_PASSWORD}", fetchsize "1000")`,
    },
    { label: "ledger tables", sql: "REGISTER DATASOURCE TABLES FROM CAUSEWAY_LEDGER" },
  ];
}

export function eurostatStatements(): { label: string; sql: string }[] {
  const out = [{ label: "lightning database", sql: `CREATE LIGHTNING DATABASE EUROSTAT_REST DESCRIBE BY "Eurostat REST API JSON-stat source, Causeway"` }];
  for (const s of SERIES) {
    out.push({
      label: `rest table ${s.id}`,
      sql: `CREATE LIGHTNING REST TABLE ${s.id} FROM EUROSTAT_REST REQUEST(endpoint "${requestUrl(s)}", method "get", response_type "json", http_encoding "URLENCODED") HEADER () BODY ()`,
    });
  }
  return out;
}

export function uslStatements(): { label: string; sql: string }[] {
  const seriesRows = SERIES.map(
    (s) => `SELECT '${s.id}' AS series_id, '${s.dataset}' AS dataset, '${s.label.replace(/'/g, "")}' AS label, '${s.unit_label}' AS unit_label, '${s.grain}' AS source_grain, 'Eurostat, re-use with attribution' AS licence`,
  ).join("\nUNION ALL\n");
  return [
    { label: "metastore root (needed once per instance)", sql: "CREATE NAMESPACE IF NOT EXISTS lightning.metastore" },
    { label: "namespace", sql: `CREATE NAMESPACE IF NOT EXISTS ${NS}` },
    {
      label: "compile USL causeway",
      sql: `COMPILE USL IF NOT EXISTS causeway DEPLOY NAMESPACE ${NS} DDL
CREATE TABLE business (
    business_id varchar(64) NOT NULL PRIMARY KEY,
    name varchar(200) NOT NULL,
    city varchar(100),
    nace varchar(16),
    sector varchar(200),
    synthetic boolean NOT NULL
);
CREATE TABLE calendar_month (
    period varchar(7) NOT NULL PRIMARY KEY,
    easter_date varchar(10),
    easter_share double,
    days_in_month int
);
CREATE TABLE driver_series (
    series_id varchar(32) NOT NULL PRIMARY KEY,
    dataset varchar(32) NOT NULL,
    label varchar(300),
    unit_label varchar(64),
    source_grain varchar(16),
    licence varchar(200)
);
CREATE TABLE business_period (
    row_key varchar(80) NOT NULL PRIMARY KEY,
    business_id varchar(64) NOT NULL FOREIGN KEY REFERENCES business(business_id),
    period varchar(7) NOT NULL FOREIGN KEY REFERENCES calendar_month(period),
    units int,
    transactions int,
    revenue double,
    cogs double,
    gross_margin_pct double,
    avg_ticket double,
    synthetic boolean NOT NULL
);
CREATE TABLE driver_month (
    obs_key varchar(48) NOT NULL PRIMARY KEY,
    series_id varchar(32) NOT NULL FOREIGN KEY REFERENCES driver_series(series_id),
    period varchar(7) NOT NULL FOREIGN KEY REFERENCES calendar_month(period),
    value double,
    source_period varchar(8)
);`,
    },
    {
      label: "describe USL",
      sql: `UPDATE USL ${USL} SET DESCRIPTION 'Causeway: a small business ledger federated with Eurostat drivers for evidence-backed why-questions. Ledger data is synthetic and labelled.'`,
    },
    {
      label: "activate business",
      sql: `ACTIVATE USL TABLE ${USL}.business AS SELECT business_id, name, city, nace, sector, synthetic FROM causeway_ledger.businesses`,
    },
    {
      label: "activate calendar_month",
      sql: `ACTIVATE USL TABLE ${USL}.calendar_month AS SELECT period, easter_date, easter_share, days_in_month FROM causeway_ledger.calendar_monthly`,
    },
    { label: "activate driver_series", sql: `ACTIVATE USL TABLE ${USL}.driver_series AS ${seriesRows}` },
    {
      label: "activate business_period",
      sql: `ACTIVATE USL TABLE ${USL}.business_period AS SELECT concat(business_id, ':', period) AS row_key, business_id, period, units, transactions, revenue, cogs, gross_margin_pct, avg_ticket, synthetic FROM causeway_ledger.ledger_monthly`,
    },
    {
      label: "activate driver_month",
      sql: `ACTIVATE USL TABLE ${USL}.driver_month AS SELECT COALESCE(concat(series_id, ':', period), '') AS obs_key, series_id, COALESCE(period, '') AS period, value, source_period FROM (\n${SERIES.map(driverMonthSelect).join("\nUNION ALL\n")}\n) AS drivers`,
    },
  ];
}

function writeFiles(): void {
  mkdirSync("zetaris/sql", { recursive: true });
  const header = (t: string) => `-- ${t}\n-- Generated by scripts/onboard.ts from src/data/eurostat.ts. One statement per call (Zetaris Lightning SQL).\n-- The COMPILE USL statement is multi-table and must be sent as ONE statement.\n\n`;
  const fmt = (xs: { label: string; sql: string }[]) => xs.map((x) => `-- ${x.label}\n${x.sql};\n`).join("\n");
  writeFileSync("zetaris/sql/01_ledger_datasource.sql", header("Owner ledger (PostgreSQL, synthetic) as a Zetaris JDBC datasource") + fmt(ledgerStatements()));
  writeFileSync("zetaris/sql/02_eurostat_rest.sql", header("Eurostat REST tables (JSON-stat, geo=BE)") + fmt(eurostatStatements()));
  writeFileSync("zetaris/sql/03_usl_causeway.sql", header("Unified Semantic Layer 'causeway': tables, relationships, activation") + fmt(uslStatements()));
}

async function run(only: string | null): Promise<void> {
  const z = new ZetarisRest({ restUrl: process.env.ZETARIS_REST_URL ?? "", apiKey: process.env.ZETARIS_API_KEY ?? "", orgId: process.env.ZETARIS_ORG_ID ?? "", timeoutMs: 600_000 });
  const groups: [string, { label: string; sql: string; secret?: boolean }[]][] = [
    ["ledger", ledgerStatements()],
    ["eurostat", eurostatStatements()],
    ["usl", uslStatements()],
  ];
  if (process.argv.includes("--refresh")) {
    // Recreate the REST tables so their endpoints match the catalogue (e.g. a changed sinceTimePeriod).
    for (const s of SERIES) {
      try {
        await z.query(`DROP LIGHTNING DATABASE TABLE EUROSTAT_REST.${s.id}`);
        console.log(`DROPPED eurostat/${s.id}`);
      } catch (e) {
        console.log(`(drop ${s.id}: ${(e as Error).message.slice(0, 120)})`);
      }
    }
  }
  for (const [name, stmts] of groups) {
    if (only && only !== name) continue;
    for (const s of stmts) {
      const sql = s.secret ? s.sql.replace("${CAUSEWAY_LEDGER_PASSWORD}", process.env.CAUSEWAY_LEDGER_PASSWORD ?? "") : s.sql;
      try {
        const r = await z.query(sql, { limit: 10 });
        console.log(`OK     ${name}/${s.label} (${r.elapsed_ms} ms)`);
      } catch (e) {
        const msg = (e as Error).message;
        if (/already exist|exists/i.test(msg)) console.log(`EXISTS ${name}/${s.label}`);
        else {
          console.log(`FAIL   ${name}/${s.label}: ${msg.replace(/password "[^"]*"/g, 'password "***"').slice(0, 500)}`);
          process.exitCode = 1;
          return;
        }
      }
    }
  }
}

writeFiles();
console.log("wrote zetaris/sql/01_ledger_datasource.sql, 02_eurostat_rest.sql, 03_usl_causeway.sql");
if (process.argv.includes("--run")) {
  const i = process.argv.indexOf("--only");
  await run(i > 0 ? process.argv[i + 1]! : null);
}
