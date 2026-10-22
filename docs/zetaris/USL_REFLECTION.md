# Reflecting on the `causeway` Unified Semantic Layer

Zetaris asked participants to reflect on three things: how the USL could save time, how it could be useful beyond the
hackathon, and how it could be improved. These are our notes from building and using `lightning.metastore.causeway_ns.causeway`.

## How it saved us time
- **One join key for two worlds.** The owner's ledger (a PostgreSQL datasource) and seven Eurostat REST endpoints meet on
  one `calendar_month.period` key. Without the USL, every analysis query would repeat the JSON-stat decode and the
  half-year/quarter roll-down. With it, the Analyst's SQL templates are 1-3 line joins (`src/tests/compiler.ts`).
- **The agent's vocabulary is the USL's vocabulary.** The cause catalogue names `driver_month.series_id` values. Adding a
  new explanation the agent can test (for example a new Eurostat series) is one REST table and one line in the
  activation `UNION ALL`. No agent code changes.
- **Declared types and keys caught real mistakes early.** Activation refused nullable columns for `NOT NULL` keys. That
  forced us to make the period keys explicit (`COALESCE`), which in turn made the result hashes stable across engines.
- **A stable contract for a cached copy.** Because the USL fixes the table shapes, the sample-mode snapshot is just
  `SELECT *` per USL table. The same compiled SQL runs on Zetaris and on the snapshot with identical result hashes
  (5/5 tables, 3/3 join queries, 14/14 evidence queries of a full investigation).

## Useful beyond the hackathon
- **Accountants and advisers** serve many small clients with the same "why" questions. A per-client ledger datasource
  plus a shared public-statistics layer is exactly the USL shape: public drivers onboarded once, each client's books
  joined to them.
- **Regional economic-development offices** could publish the driver half of this USL (prices, energy, tourism, retail,
  bankruptcies by NACE and region) as a governed product. Local businesses or their advisers would then bring only
  their own ledger.
- **Evidence-grade answers.** Because every number traces to a re-executable query over a declared semantic model, the
  same layer supports audits ("show me how you got 10 points") as well as the explanation itself.

## What we would improve (feedback for Zetaris)
1. **Grain-aware relationships.** Monthly ledgers, half-year energy prices and quarterly bankruptcies needed manual
   roll-down SQL. A declared grain on a USL table, plus generated roll-up/roll-down views, would remove the most
   error-prone part of federating official statistics.
2. **First-class JSON-stat decoding.** Eurostat (and many other statistics offices) publish JSON-stat. A built-in decoder
   for REST tables (dimension index to labels to values) would replace the `from_json(to_json(...))` double-explode.
3. **Code validation for REST parameters.** Eurostat silently returns an empty dimension for an invalid code. We validate
   every code against `category.index` before onboarding. A "required non-empty" option on a REST table would surface
   this at creation time.
4. **Idempotent onboarding.** `IF NOT EXISTS` for `CREATE LIGHTNING REST TABLE`, `CREATE DATASOURCE` and
   `ACTIVATE USL TABLE` (or a re-activate verb) would make onboarding scripts safely re-runnable without parsing
   "already exists" errors.
5. **Column names on the REST SQL endpoint** come back as `headers`, with all values as strings. Typed values (or a typed
   schema next to `headers`) would let clients skip re-casting.
6. **Description text** in `DESCRIBE BY` rejects common punctuation such as parentheses. Relaxing that would allow
   richer self-documenting sources.
