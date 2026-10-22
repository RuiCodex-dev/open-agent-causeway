// Developer check: run the Analyst over every catalogue cause for a business/question on the snapshot
// (or live Zetaris with --live) and print the verdict table. No model involved.
//   npx tsx scripts/dev-analyst.ts atelier-noir gross_margin_pct 2025-H1 2024-H1 [--live] [--fact supplier_change:2025-05]
import "dotenv/config";
import { Analyst } from "../src/agents/analyst.ts";
import { applicableCauses, CAUSES } from "../src/agents/catalogue.ts";
import { SnapshotDuckdb } from "../src/adapters/snapshotDuckdb.ts";
import { ZetarisRest } from "../src/adapters/zetaris.ts";
import type { Metric } from "../src/tests/compiler.ts";
import type { Hypothesis } from "../src/agents/types.ts";

const [business_id = "atelier-noir", metric = "gross_margin_pct", period = "2025-H1", baseline = "2024-H1"] = process.argv.slice(2).filter((a) => !a.startsWith("--") && !a.includes(":"));
const live = process.argv.includes("--live");
const factArg = process.argv.find((a) => /^[a-z_]+:\d{4}-\d{2}$/.test(a));
const data = live
  ? new ZetarisRest({ restUrl: process.env.ZETARIS_REST_URL ?? "", apiKey: process.env.ZETARIS_API_KEY ?? "", orgId: process.env.ZETARIS_ORG_ID ?? "" })
  : new SnapshotDuckdb();
const naceRes = await data.query(live ? `SELECT nace FROM lightning.metastore.causeway_ns.causeway.business WHERE business_id = '${business_id}'` : `SELECT nace FROM business WHERE business_id = '${business_id}'`);
const nace = String(naceRes.rows[0]?.[0] ?? "");
const facts = factArg ? [{ cause_type: factArg.split(":")[0]! }] : [];
const analyst = new Analyst({ frame: { business_id, metric: metric as Metric, period, baseline, geo: "BE", question: "dev" }, data, budget: { sql: 200 } });
const causes = applicableCauses(metric as Metric, nace, facts);
console.log(`${business_id} (${nace}) ${metric} ${period} vs ${baseline} on ${data.engine}; ${causes.length} causes`);
let i = 0;
for (const c of causes) {
  const hyp: Hypothesis = { id: `hyp-${++i}`, cause_type: c.type, title: c.title, mechanism: c.mechanism, proposed_by: "Hypothesiser", params: c.type === "supplier_change" && factArg ? { from: factArg.split(":")[1]! } : undefined };
  const r = await analyst.test(hyp);
  console.log(`${r.verdict.padEnd(13)} ${r.confidence.padEnd(6)} ${r.role.padEnd(6)} ${CAUSES[c.type].title.padEnd(32)} ${r.rule}`);
  console.log(`   ${JSON.stringify(r.numbers)}`);
}
console.log(`evidence nodes: ${analyst.evidence.size}`);
