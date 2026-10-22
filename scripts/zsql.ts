// Run one Lightning SQL statement (or a .sql file, statement by statement) against Zetaris over REST.
// Usage: npx tsx scripts/zsql.ts "SELECT 1"      |   npx tsx scripts/zsql.ts --file zetaris/sql/02_eurostat.sql [--skip-exists] [--dry-run]
// Credentials come from the environment (.env locally); nothing secret is printed.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { ZetarisRest } from "../src/adapters/zetaris.ts";

export function splitStatements(sqlText: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inS = false;
  let inD = false;
  let inB = false;
  const lines = sqlText.split(/\r?\n/).filter((l) => !/^\s*--/.test(l));
  const text = lines.join("\n");
  for (const ch of text) {
    if (ch === "'" && !inD && !inB) inS = !inS;
    else if (ch === '"' && !inS && !inB) inD = !inD;
    else if (ch === "`" && !inS && !inD) inB = !inB;
    if (ch === ";" && !inS && !inD && !inB) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const z = new ZetarisRest({ restUrl: process.env.ZETARIS_REST_URL ?? "", apiKey: process.env.ZETARIS_API_KEY ?? "", orgId: process.env.ZETARIS_ORG_ID ?? "", timeoutMs: 300_000 });
  const fileIdx = args.indexOf("--file");
  const statements = fileIdx >= 0 ? splitStatements(readFileSync(args[fileIdx + 1]!, "utf8")) : [args.filter((a) => !a.startsWith("--")).join(" ")];
  const skipExists = args.includes("--skip-exists");
  const dry = args.includes("--dry-run");
  let failed = 0;
  for (const [i, s] of statements.entries()) {
    const head = s.replace(/\s+/g, " ").slice(0, 110);
    if (dry) {
      console.log(`[${i + 1}/${statements.length}] DRY ${head}`);
      continue;
    }
    try {
      const r = await z.query(s, { limit: 50 });
      console.log(`[${i + 1}/${statements.length}] OK ${r.elapsed_ms}ms rows=${r.rows.length} cols=${JSON.stringify(r.columns)} ${head}`);
      for (const row of r.rows.slice(0, 8)) console.log("   ", JSON.stringify(row).slice(0, 200));
    } catch (e) {
      const msg = (e as Error).message;
      if (skipExists && /already exist/i.test(msg)) {
        console.log(`[${i + 1}/${statements.length}] EXISTS ${head}`);
        continue;
      }
      failed++;
      console.log(`[${i + 1}/${statements.length}] FAIL ${head}\n    ${msg.slice(0, 400)}`);
      if (!args.includes("--continue")) break;
    }
  }
  if (failed) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "/$1:")}` || process.argv[1]?.endsWith("zsql.ts")) {
  await main();
}
