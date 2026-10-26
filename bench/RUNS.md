# Causeway Bench — run history (kept honest)

The holdout split is meant to be "never tuned on". This file records what was changed between runs, and **which case
triggered each change**, so a reader can discount holdout cases that influenced a fix.

## Run 1 — 2026-10-22 ~06:20 CEST, offline reasoner, snapshot of 2026-10-22
| Split | Main cause found | Notes |
|---|---|---|
| Tune (B01, B02, B04, B06, B07) | 4/5 | B06 missed: retail volume moved -3.9 % (under the 5 % "material" threshold) and the sector-distress lag association was not sign-oriented, so bankruptcies were wrongly supported. |
| Holdout (B03, B05, B08, B09, B10, B11, B12) | 5/7 | B03 missed: Easter was never tested because nothing was supported and the Skeptic only challenged supported verdicts. B08: energy found, but cocoa was also "supported" for a bakery (catalogue listed NACE C10.7 for cocoa). |

## Changes after run 1
1. **Association sign orientation** (bug fix; found on tune case B06): the lag association is now multiplied by the cause's
   effect sign on the associated series (for example, more bankruptcies should go with *fewer* units).
2. **Material-change threshold 5 % -> 3 %** (tuning on tune case B06).
3. **Skeptic challenges the null** (design change; prompted by holdout case B03): when nothing is supported, the Skeptic
   demands the calendar and own-action tests before the team concludes that nothing external happened.
4. **Catalogue: cocoa no longer applies to NACE C10.7 bakeries** (domain correction; prompted by holdout case B08).
5. **Scoring**: a "false support" is now any supported cause that is not in the case's expected causes (it previously
   only counted the explicit `not_causes` list) — stricter.

Because changes 3 and 4 were prompted by holdout cases B03 and B08, those two cases are **no longer clean holdouts**.
The clean holdout set after run 1 is B05, B09, B10, B11, B12.

## Run 2 — after the changes above
See `report-offline.md` / `results-offline.json` (generated). No change was made in response to run 2's holdout results.

## Run 3 — 2026-10-22, Nemotron called directly (NVIDIA API)
Kept as `report-nvidia-2026-10-22.md` / `results-nvidia-2026-10-22.json`: main cause 12/12, null controls 2/2,
one false support (B11, `sector_distress`), 0 ungrounded numbers.

## Runs 4–10 — 2026-10-23 and 26, Nemotron through Meterless Nightshift 1.2.3 (lane `nemotron-3.5-lightning-30b-a3b`)
Every Framer, Hypothesiser, Skeptic and Writer call went through Nightshift (45 calls in run 4, 0 failovers); the input
guard calls NVIDIA Content Safety directly.

| Run | Commit | Main cause | Null controls | False supports | Ungrounded numbers | Verifier strikes | What it led to |
|---|---|---|---|---|---|---|---|
| 4 | `057688f` | 12/12 | 2/2 | 1 (B11) | 0 | 3 | The 3 strikes were **Verifier false positives**: "14,068" was read as 14.068. Fixed in `d6ade0e` (thousands separators). Found on B03, B04, B09; it changes no verdict, only the Verifier. |
| 5 | `d6ade0e` | **11/12** | 2/2 | 2 (B11, B12) | 0 | 0 | **B12 missed**: the Framer model read "gross margin" as `revenue`, so the run tested the wrong figure. Fixed in `77281cc`: a metric or period the question states is parsed by code and wins over the model. **Prompted by holdout case B12, so B12 is no longer a clean holdout.** |
| 6 | `77281cc` | 12/12 | 2/2 | 1 (B11) | 0 | 0 | none |
| 7 | `77281cc` (+ report row) | 12/12 | 2/2 | 1 (B11) | 0 | 0 | none (repeat, for stability) |
| 8 | `e66c3d1` | 12/12 | 2/2 | 1 (B11) | 0 | 0 | none |
| 9 | `353328b` | 12/12 | 2/2 | 1 (B11) | 0 | 3 | Verifier now also checks percentage points (`353328b`, prompted by the UI demo, not by a case). The 3 strikes are real catches, each fixed by the Writer's one revision: B04 and B09 wrote a share of 95.43 % / 56.21 % as "pp", B03 wrote "5,030.00" with precision the evidence does not have. |
| 10 (26 Oct, post-freeze) | `ac24f0c` | 12/12 | 2/2 | 1 (B11) | 0 | 1 | Attribution check added after the live Zetaris re-check (`ac24f0c`, prompted by the live hero run, not by a Bench case): a clause naming one cause may only quote that cause's figures, and the headline verdict is number-checked. 1 strike (B03, a number in no evidence), fixed in the revision. **This is `report.md` / `results.json`.** |

Runs 6–8 are the same product code three times: identical per-case results. Across their 36 case runs, code overruled
the Framer model once (`gross_margin_pct` kept where the model said `revenue`).

**Also changed on 10-23, not prompted by any Bench case:** one Nightshift scope per investigation (`7abf49f`; without it
Nightshift injected its own stored memories into prompts and could replay cached answers across cases), and a Verifier
rule that strikes prose naming a cause the run never tested (`4a0e2ec`; seen in a demo run, not in the Bench).

**B11 stays a false support, reported as is.** For a bike shop's 2024 unit sales, Belgian retail bankruptcies (real
Eurostat) rose 11 % and the synthetic unit series correlates with them at r = 0.54 (lag 2), which passes the rule
"material change tracked by the outcome" (|change| ≥ 3 %, r ≥ 0.5). The generator puts no bankruptcy effect in this
business, so this is a weakness of that rule (a shared trend is enough to pass it). B11 is a clean holdout; we have not
changed the rule to fix it, because doing so after seeing the case would make B11 a tuned case.

Clean holdout after 10-23: **B05, B09, B10, B11** (B03, B08, B12 each prompted a change).
