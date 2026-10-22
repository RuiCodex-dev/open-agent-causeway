// Engine-independent result hashing: Zetaris REST returns strings, DuckDB returns typed values.
// Both are normalised the same way so the same SQL on the same data gives the same sha256.
import { createHash } from "node:crypto";

export function normaliseCell(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return normaliseNumber(Number(v));
  if (typeof v === "number") return normaliseNumber(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = String(v);
  if (s === "null") return null;
  if (s === "true" || s === "false") return s;
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s.trim())) return normaliseNumber(Number(s));
  return s;
}

function normaliseNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(10)));
}

export function normaliseRows(rows: unknown[][]): (string | null)[][] {
  return rows.map((r) => r.map(normaliseCell));
}

export function resultHash(columns: string[], rows: unknown[][]): string {
  const payload = JSON.stringify({ c: columns.map((c) => c.toLowerCase()), r: normaliseRows(rows) });
  return createHash("sha256").update(payload).digest("hex");
}
