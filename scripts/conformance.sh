#!/usr/bin/env bash
# Runs each vendored Meterless engine's own conformance suite against the exact engine code Causeway imports
# (vendor/meterless/<engine>/reference/src). Output is saved under docs/evidence/ as Build-rule evidence.
set -u
cd "$(dirname "$0")/.."
mkdir -p docs/evidence
for e in hmem world-model markovian; do
  echo "== $e"
  ( cd "vendor/meterless/$e/conformance" && npx tsx runner.ts ) > "docs/evidence/conformance-$e.txt" 2>&1
  echo "exit=$?" >> "docs/evidence/conformance-$e.txt"
  tail -4 "docs/evidence/conformance-$e.txt"
done
