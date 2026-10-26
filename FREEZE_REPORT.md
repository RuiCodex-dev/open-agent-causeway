# Causeway: feature-freeze report

**Freeze:** Sun 25 Oct 2026, 18:00 CET. **Frozen code:** `8bf13b5` (last product commit, 23 Oct 18:25 CEST). No feature work since then.
**Re-verified at freeze (26 Oct):** 71/71 unit tests; offline sample run of the hero; fresh-clone Docker test from the GitHub origin 16/16 PASS, `docs/evidence/fresh-clone-2026-10-26-freeze.txt`.

Track 02, "The Agent That Can Explain Why". The submission is still a draft. The repo, video and deck stay private until the owner approves each one.

## 1. What works end to end

A small-business owner asks *"Why did our gross margin fall in the first half of 2025?"*. The answer comes back as an explanation card. Every claim on it links to the SQL query that produced the number.

| Step | Who | What decides |
|---|---|---|
| Input guard | NVIDIA Nemotron Content Safety (deny-list without a key) | the classifier |
| Frame the question | Framer (Nemotron) | **code** when the question states the metric or period; the model only fills gaps |
| Recall owner facts | Memory Keeper (Meterless H-MEM, per business) | stored facts |
| Propose rival causes | Hypothesiser (Nemotron) | typed catalogue: out-of-catalogue proposals are rejected |
| Test each cause | Analyst: SQL on Zetaris (ledger joined with Eurostat in the USL `causeway`) | **rule table in code** (z-scores, association, lag, contribution share) |
| Challenge | Skeptic (Nemotron, veto) | it must name an untested confounder; the confounder is then tested. It also challenges a "nothing explains it" result |
| Write | Writer (Nemotron, one revision) | prose only; it cannot change a verdict |
| Verify | Verifier (no LLM) | re-executes every cited query (hash match). It strikes any claim whose number is absent from the evidence, whose percentage points are not pp in the evidence, or that names a cause never tested |

**Memory changes the answer:**
1. Ask the hero question. Only cocoa costs are supported.
2. The owner adds *"We switched to a more expensive single-origin couverture supplier in May 2025"*. The UI shows *"Will be tested as: Supplier change from 2025-05"*.
3. Press *Ask the same question again*. Supplier change is now tested and supported. The card shows a Before/Now table.

Facts can be forgotten again, and the trust ledger keeps the deletion. Screenshots: `docs/evidence/ui-memory-1-first-answer.png`, `-2-fact-added.png`, `-3-reask.png`.

**Data (Zetaris):**
- The Zetaris live path is the PostgreSQL ledger datasource `CAUSEWAY_LEDGER` plus 7 Eurostat REST tables, unified in the USL `lightning.metastore.causeway_ns.causeway` (5 tables, 4 foreign keys).
- Live and snapshot runs agree hash for hash: 5/5 tables, 3/3 join queries, and 14/14 evidence hashes in the CP2 hero run (`docs/evidence/parity-2026-10-22.txt`, `cp2-*.json`).
- A judge with an empty `.env` gets the bundled Zetaris snapshot through DuckDB and the offline reasoner. That runs the full loop with real SQL, statistics and rule-table verdicts; nothing is replayed.

**Meterless engines:**
- World Model is the shared evidence graph.
- H-MEM holds owner facts, verdict history and the trust ledger.
- Markovian provides the bounded carryover between Skeptic rounds and for the Writer.
- Conformance of the vendored engines (unmodified): World Model 8/8, H-MEM 13/13, Markovian 8/8.

**Surfaces:**
- CLI (`npm run ask`).
- API on :8000: `/run`, `/runs` with SSE, `/memory` (GET, POST, DELETE), `/businesses`, `/health`.
- Web UI on :8080: live board of hypotheses, Skeptic challenges and query count; explanation card; evidence drawer with SQL, result hash and rows; memory panel.
- Docker image (`docker compose up`), with five input examples in `input_examples/`.

**Cursor:** sessions S1 (scaffold), S2 (Meterless Runtime provider), S4 (UI) and S5 (README) are logged in `docs/cursor-sessions/`. Cursor became optional in the rules on 23 Oct; the logs stay.

## 2. Bench

The Bench is 12 synthetic businesses' cases with a hidden ground truth. The truth is the ledger generator's parameters, which `src/` never reads. The drivers are real Eurostat series. There is a tune/holdout split and two null controls. The Bench measures whether planted causes are recovered. **It does not prove real-world causality.**

Main report: `bench/report.md`, run 9, commit `353328b`, through Meterless Nightshift:

| Split | Cases | Main cause | All causes | False supports / case | Null controls | Ungrounded numbers in final prose | Verifier strikes |
|---|---|---|---|---|---|---|---|
| All | 12 | **12/12** | 100 % | 0.08 | **2/2** | **0** | 3 (all real errors, each fixed in the Writer's one revision) |
| Clean holdout (B05, B09, B10, B11) | 4 | 4/4 | 100 % | 0.25 | 1/1 | 0 | 1 |

- **B11: an honest false support, present in every run.** For a bike shop's 2024 unit sales, the agent supports the real cause (own price rise). It **also** supports `sector_distress`: Belgian retail bankruptcies (real Eurostat) rose 11 %, and the synthetic sales track them at r = 0.54 with a 2-month lag. That passes the rule "material change tracked by the outcome" (change ≥ 3 %, r ≥ 0.5). The generator puts no bankruptcy effect in this business, so the rule is too permissive: a shared trend is enough to pass it. B11 is a clean holdout case, so the rule was **not** changed after seeing it. Changing it would turn B11 into a tuned case. It is written up in `bench/RUNS.md`, the README and the submission text.
- **Run history is complete** (`bench/RUNS.md`): 2 offline runs, 1 NVIDIA-direct run, and 6 runs through Nightshift.
  - **Run 5 missed B12 (11/12).** The Framer model read "gross margin" as revenue; code now decides any metric the question states.
  - **Run 4's 3 strikes were Verifier false positives.** "14,068" was read as 14.068; this is fixed.
  - Holdout cases B03, B08 and B12 each prompted a fix, so they are listed as no longer clean.
- **Stability:** runs 6 to 9 gave identical supported causes on every case.

## 3. Nightshift status

- **Installed:** Nightshift 1.2.3 (Windows). It was installed on 23 Oct, only after its published SHA-256 matched the downloaded installer (owner decision of 21 Oct). The 1.2.1 listing had carried two disagreeing values, so we waited.
- **Primary provider:** `MODEL_PROVIDER=meterless` is the default. In the demo and all 6 Nightshift Bench runs, every Framer, Hypothesiser, Skeptic and Writer call went through Nightshift, with 0 failovers. Nightshift holds the NVIDIA key in its own provider settings. Its signed receipts record the routed model for every call.
- **Lane:** pinned to `nvidia/nemotron-3.5-lightning-30b-a3b`.
  - Nightshift lists Nemotron 3.5 Super VL as temporarily excluded.
  - The Ultra 550B lane works but took about 97 s for one Skeptic call.
  - `meterless/auto` also works.
- **Three integration fixes, each found on the live runtime:**
  1. One `meterless-scope` per investigation. Under the default scope, Nightshift injected its own stored memories into our prompts (`hmem.injected: 2` in the receipts) and keyed its answer cache the same way. One demo run named a supplier change no owner had reported. Receipts now show messages-only context and a cache miss.
  2. `enable_thinking=false` for structured calls. Without it, the lanes could return empty answers.
  3. The input guard calls NVIDIA directly, because content safety is not a Nightshift lane.
- **Fallback:** NVIDIA direct, then Nebius.

## 4. Known gaps (none hidden in the submission)

1. **B11 false support:** the material-change rule accepts a shared trend (section 2). A principled fix would require a contribution share before support, or have the Skeptic test competing supported causes against each other. It is deliberately not done after the freeze, and not after seeing a holdout case.
2. **Nightshift is not reachable from the Docker container.** Nightshift listens on 127.0.0.1, so the Docker path was validated with NVIDIA direct and with the offline reasoner. Running with Nightshift means running Causeway on the same host (`npm run dev`). The README says so.
3. **The pinned lane is the smaller model.** The demo and Bench reasoner through Nightshift is Lightning 30B; Super VL is used only when calling NVIDIA directly. The results above are with Lightning. Meterless announced a major release for 25 Oct evening; whether it brings Super back will be re-checked before recording.
4. **The live Zetaris run was last executed on 22 Oct (CP2)**, before the 23 Oct changes to the Framer, Verifier and Writer. Those changes do not touch the data path, and snapshot parity is hash-identical. The live hero will still be re-run on the frozen code before the video is recorded.
5. **The Verifier checks numbers, units and named causes, but not attribution wording.** A sentence such as "explaining the majority of the decline" is not checked against the contribution shares. Prose quality from Lightning is sometimes clumsy (e.g. "with 11% of the outcome tracked").
6. **The business ledgers are synthetic.** They are labelled `synthetic` in every row and in the UI. The public drivers are real.
7. **Markovian carryover savings are about 0 %** on these short runs. Reported as is.
8. **H-MEM keeps the reference hash embedder.** The vendored engines are unmodified by design.

## 5. Next (Mon/Tue)

1. **Deck** (Mon): built from this report and the README; no claim beyond the evidence above.
2. **Video** (Tue): HyperFrames, made from real screen recordings of the UI and CLI. It covers the Nightshift receipts, the Zetaris USL and the live run, and the memory demo, with motion graphics and narration. It shows no mocked UI and no staged results.
3. **Internal submit target:** Tue 27 Oct 22:00 CET; the deadline is 23:45 UTC.
4. **Owner approval first:** making the repo public, publishing the video, sharing the deck and submitting on HackOS each wait for the owner's OK, relayed by the coordinator. A secret scan runs before the repo goes public.

## 6. Addendum, Mon 26 Oct: live Zetaris re-check on the frozen code

- **Eurostat changed under us, and parity caught it.** `sts_trtu_m` (retail volume) was republished on 24 Oct with September 2026 listed but not yet filled (`positions-with-no-data.time = [128]`). The Zetaris REST table, whose JSON schema was inferred on 22 Oct, could not read that (Spark `ArrayIndexOutOfBounds`); the other 6 series were fine. We recreated that one REST table with the same endpoint (`DROP LIGHTNING DATABASE TABLE` + the `CREATE` in `zetaris/sql/02_eurostat_rest.sql`). Live vs snapshot is again 5/5 tables and 3/3 join queries hash-identical (`docs/evidence/parity-2026-10-26-freeze.txt`).
- **Known gap 5 showed up in the live hero, so it was fixed.** The Writer credited cocoa's -12.16 pp cost effect to the supplier change: a true number, wrong cause, and the headline verdict was not number-checked at all. This was a correctness fix, not a feature (`ac24f0c`). A clause that names one cause may now quote only that cause's figures plus the shared outcome. The verdict is checked for grounded, correctly attributed numbers; otherwise the code-built verdict replaces it.
  - Live re-run on Zetaris through Nightshift: correct attribution, 0 struck (`docs/evidence/freeze-live-zetaris-run.json`).
  - Bench run 10: 12/12, 2/2, 0 ungrounded, 1 strike, B11 unchanged.
  - Tests: 74/74.
- Gap 5 now reads: *the Verifier checks numbers, units, named causes and per-cause attribution; it does not judge wording such as "the majority of".*
- Gap 4 is closed: the live Zetaris run was re-executed on the frozen code.
