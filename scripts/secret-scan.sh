#!/usr/bin/env bash
# Fails if a likely secret is staged (or, with --all, present in the tree).
# Pattern from the HackOS Technical Execution guide, plus provider key prefixes.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
PATTERN='(nvapi-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|lin_api_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(api[_-]?key|secret|token|password)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"'$<{ ]{12,}["'"'"'])'
if [[ "${1:-}" == "--all" ]]; then
  files=$(git ls-files)
else
  files=$(git diff --cached --name-only --diff-filter=ACM)
fi
[[ -z "$files" ]] && exit 0
hits=0
while IFS= read -r f; do
  [[ -f "$f" ]] || continue
  case "$f" in *.parquet|*.png|*.jpg|*.mp4|*.pdf|*.woff2|package-lock.json) continue;; esac
  if grep -nIE "$PATTERN" "$f" >/dev/null 2>&1; then
    echo "secret-scan: possible secret in $f (line numbers only):"
    grep -nIE "$PATTERN" "$f" | cut -d: -f1 | sed 's/^/  line /'
    hits=1
  fi
  case "$f" in .env|.env.*) [[ "$f" != ".env.example" ]] && { echo "secret-scan: env file staged: $f"; hits=1; };; esac
done <<< "$files"
if [[ $hits -ne 0 ]]; then echo "secret-scan: FAILED"; exit 1; fi
echo "secret-scan: clean ($(echo "$files" | wc -l | tr -d ' ') files)"
