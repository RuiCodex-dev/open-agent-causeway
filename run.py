#!/usr/bin/env python3
"""Programmatic entry point (standard library only).

    python run.py --input input_examples/example_1.json            # run one investigation via the CLI (needs Node 22)
    python run.py --input input_examples/example_1.json --api      # or POST it to a running API (docker compose up)

Prints the result JSON (the same shape as POST /run) to stdout; the trace goes to logs/.
"""
import argparse
import json
import subprocess
import sys
import urllib.request


def main() -> int:
    p = argparse.ArgumentParser(description="Run a Causeway investigation")
    p.add_argument("--input", required=True, help="JSON file in the POST /run request shape")
    p.add_argument("--api", action="store_true", help="POST to a running API instead of calling the CLI")
    p.add_argument("--url", default="http://localhost:8000/run")
    args = p.parse_args()

    if args.api:
        with open(args.input, "rb") as f:
            req = urllib.request.Request(args.url, data=f.read(), headers={"content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=300) as resp:
            sys.stdout.write(resp.read().decode("utf-8") + "\n")
        return 0

    cmd = ["npx", "tsx", "src/cli.ts", "--input", args.input, "--json"]
    out = subprocess.run(cmd, capture_output=True, text=True, shell=sys.platform == "win32")
    if out.returncode != 0:
        sys.stderr.write(out.stderr or out.stdout)
        return out.returncode
    # The CLI prints the result JSON; validate it parses before echoing.
    start = out.stdout.find("{")
    result = json.loads(out.stdout[start:])
    sys.stdout.write(json.dumps(result, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
