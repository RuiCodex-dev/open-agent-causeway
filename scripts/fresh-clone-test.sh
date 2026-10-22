#!/usr/bin/env bash
# Fresh-clone test: clone the repo into a temp dir, build the Docker image with NO .env, run it in sample mode and
# post all five input examples. Prints PASS/FAIL per check and removes the container afterwards.
#   bash scripts/fresh-clone-test.sh [repo-url-or-path]
set -u
SRC="${1:-$(git rev-parse --show-toplevel)}"
WORK="$(mktemp -d)"
NAME="causeway-fresh-$$"
PORT_API=18000
PORT_UI=18080
fail=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1; rm -rf "$WORK"; }
trap cleanup EXIT

git clone -q "$SRC" "$WORK/repo" || { echo "FAIL clone"; exit 1; }
cd "$WORK/repo"
check "no .env in a fresh clone" '[ ! -f .env ]'
docker build -q -t causeway:fresh . >/dev/null || { echo "FAIL docker build"; exit 1; }
echo "PASS docker build"
docker run -d --name "$NAME" -p "$PORT_API:8000" -p "$PORT_UI:8080" -e SAMPLE_MODE=true -e MODEL_PROVIDER=offline causeway:fresh >/dev/null
for i in $(seq 1 60); do curl -sf "localhost:$PORT_API/health" >/dev/null && break; sleep 2; done
check "health" 'curl -sf localhost:$PORT_API/health | grep -q "\"status\":\"ok\""'
check "ui served" 'curl -sf localhost:$PORT_UI/ | grep -qi "<!doctype html"'
mkdir -p "$WORK/out"
for n in 1 2 3 4 5; do
  curl -s -X POST "localhost:$PORT_API/run" -H 'content-type: application/json' -d @"input_examples/example_$n.json" > "$WORK/out/$n.json"
  check "example_$n returns a status" 'grep -q "\"status\":\"\(success\|needs_clarification\)\"" "$WORK/out/$n.json"'
done
check "example_5 asks a clarifying question" 'grep -q "needs_clarification" "$WORK/out/5.json"'
check "outputs differ by input" '[ "$(md5sum "$WORK"/out/1.json | cut -c1-32)" != "$(md5sum "$WORK"/out/2.json | cut -c1-32)" ]'
check "trace logs written in the container" 'docker exec "$NAME" sh -c "ls /app/logs/trace-*.jsonl" >/dev/null 2>&1'
check "world model log written" 'docker exec "$NAME" sh -c "ls /app/logs/worldmodel-*.jsonl" >/dev/null 2>&1'
python3 - "$WORK/out/1.json" <<'PY' && echo "PASS example_1 cocoa supported with verified claims" || { echo "FAIL example_1 content"; fail=1; }
import json, sys
d = json.load(open(sys.argv[1]))
assert d["status"] == "success", d.get("status")
assert any(h["cause_type"] == "input_cost_cocoa" and h["verdict"] == "supported" for h in d["hypotheses"])
assert d["output"]["claims"] and all(c["verified"] for c in d["output"]["claims"])
PY
[ $fail -eq 0 ] && echo "FRESH-CLONE TEST: PASS" || echo "FRESH-CLONE TEST: FAIL"
exit $fail
