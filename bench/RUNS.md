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
