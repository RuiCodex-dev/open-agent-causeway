#!/usr/bin/env node
// Secret scan: fails if a likely credential is staged (default) or tracked (--all).
// Prints file names and line numbers only, never the matched value.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";

const PATTERNS = [
  /nvapi-[A-Za-z0-9_-]{20,}/,
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/,
  /lin_api_[A-Za-z0-9]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:api[_-]?key|secret|token|password)["']?\s*[:=]\s*["'][^"'$<{\s]{12,}["']/i,
];
const SKIP_EXT = /\.(parquet|png|jpe?g|gif|mp4|webm|pdf|woff2?|ttf|ico|zip)$/i;
const MAX_LINE = 4000;

const all = process.argv.includes("--all");
const out = all
  ? execFileSync("git", ["ls-files"], { encoding: "utf8" })
  : execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACM"], { encoding: "utf8" });
const files = out.split(/\r?\n/).filter(Boolean);

let hits = 0;
for (const f of files) {
  const base = f.split("/").pop() ?? f;
  if (/^\.env(\..+)?$/.test(base) && base !== ".env.example") {
    console.log(`secret-scan: env file tracked/staged: ${f}`);
    hits++;
    continue;
  }
  if (SKIP_EXT.test(f) || base === "package-lock.json" || !existsSync(f) || statSync(f).size > 5_000_000) continue;
  const lines = readFileSync(f, "utf8").split(/\r?\n/);
  const bad = [];
  lines.forEach((line, i) => {
    const s = line.length > MAX_LINE ? line.slice(0, MAX_LINE) : line;
    if (PATTERNS.some((re) => re.test(s))) bad.push(i + 1);
  });
  if (bad.length) {
    console.log(`secret-scan: possible secret in ${f} at line(s) ${bad.join(", ")}`);
    hits++;
  }
}
if (hits) {
  console.log("secret-scan: FAILED");
  process.exit(1);
}
console.log(`secret-scan: clean (${files.length} files)`);
