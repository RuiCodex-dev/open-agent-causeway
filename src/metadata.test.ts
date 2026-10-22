// metadata.json must stay true: every file or folder it names exists, and src/ never reads hidden truth or outputs.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const meta = JSON.parse(readFileSync("metadata.json", "utf8"));

function collectFiles(o: unknown, out: string[] = []): string[] {
  if (Array.isArray(o)) o.forEach((x) => collectFiles(x, out));
  else if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o)) {
      if ((k === "files" || k === "file") && (Array.isArray(v) || typeof v === "string")) out.push(...(Array.isArray(v) ? v : [v]));
      else collectFiles(v, out);
    }
  }
  return out;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("metadata.json", () => {
  it("names only paths that exist", () => {
    const files = collectFiles(meta);
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect(existsSync(f), f).toBe(true);
  });
  it("src/ never reads the Bench truth or saved example outputs", () => {
    for (const f of walk("src").filter((p) => p.endsWith(".ts") && !p.endsWith(".test.ts"))) {
      const text = readFileSync(f, "utf8");
      expect(text.includes("bench/truth"), f).toBe(false);
      expect(text.includes("output_examples"), f).toBe(false);
      expect(text.includes("businesses.ts"), f).toBe(false);
    }
  });
});
