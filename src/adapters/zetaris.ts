// Zetaris Lightning REST adapter: the only live data path of Causeway.
// POST {ZETARIS_REST_URL}/sql-editor/sqls/run with a bearer API key, the numeric org id and a fresh
// request id. One statement per call, no trailing semicolon (Lightning SQL rule).
import { randomUUID } from "node:crypto";

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  engine: "zetaris" | "duckdb-snapshot";
  elapsed_ms: number;
}

export interface DataAdapter {
  readonly engine: QueryResult["engine"];
  query(sql: string, opts?: { limit?: number; signal?: AbortSignal }): Promise<QueryResult>;
}

export class ZetarisError extends Error {
  constructor(message: string, readonly status: number | null, readonly retryable: boolean) {
    super(message);
    this.name = "ZetarisError";
  }
}

export interface ZetarisOptions {
  restUrl: string;
  apiKey: string;
  orgId: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface RunResponse {
  data?: unknown[][] | null;
  columns?: unknown;
  schema?: unknown;
  header?: unknown;
  fields?: unknown;
  [k: string]: unknown;
}

/** Extract column names from the various shapes the run endpoint may use. */
export function extractColumns(res: RunResponse): string[] {
  for (const key of ["headers", "columns", "schema", "header", "fields", "columnNames", "column_names"]) {
    const v = res[key];
    if (Array.isArray(v) && v.length > 0) {
      return v.map((c) => (typeof c === "string" ? c : String((c as Record<string, unknown>).name ?? (c as Record<string, unknown>).columnName ?? (c as Record<string, unknown>).label ?? "")));
    }
  }
  return [];
}

export function assertSingleStatement(sql: string): string {
  const s = sql.trim().replace(/;+\s*$/, "");
  // A multi-table COMPILE USL is the one documented statement that carries inner semicolons.
  if (/^COMPILE\s+USL\s/i.test(s)) return s;
  // A semicolon outside quotes means more than one statement.
  let inS = false;
  let inD = false;
  let inB = false;
  for (const ch of s) {
    if (ch === "'" && !inD && !inB) inS = !inS;
    else if (ch === '"' && !inS && !inB) inD = !inD;
    else if (ch === "`" && !inS && !inD) inB = !inB;
    else if (ch === ";" && !inS && !inD && !inB) throw new ZetarisError("only one SQL statement per call", null, false);
  }
  return s;
}

export class ZetarisRest implements DataAdapter {
  readonly engine = "zetaris" as const;
  private base: string;
  private fetchImpl: typeof fetch;

  constructor(private opts: ZetarisOptions) {
    if (!opts.restUrl || !opts.apiKey || !opts.orgId) throw new Error("Zetaris REST needs ZETARIS_REST_URL, ZETARIS_API_KEY and ZETARIS_ORG_ID");
    this.base = opts.restUrl.replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async query(sql: string, opts: { limit?: number; signal?: AbortSignal } = {}): Promise<QueryResult> {
    const statement = assertSingleStatement(sql);
    const timeout = AbortSignal.timeout(this.opts.timeoutMs ?? 60_000);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    const started = Date.now();
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/sql-editor/sqls/run`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.opts.apiKey}`,
          "x-org-id": this.opts.orgId,
          "x-request-id": randomUUID(),
          "content-type": "application/json",
        },
        body: JSON.stringify({ queryId: randomUUID(), sql: statement, source: "SqlEditor", limit: opts.limit ?? 5000 }),
        signal,
      });
    } catch (e) {
      throw new ZetarisError(`Zetaris unreachable (${(e as Error).name})`, null, true);
    }
    const text = await res.text();
    if (!res.ok) {
      throw new ZetarisError(`Zetaris HTTP ${res.status}: ${text.slice(0, 300)}`, res.status, res.status >= 500);
    }
    const body = (text ? JSON.parse(text) : {}) as RunResponse;
    const rows = Array.isArray(body.data) ? body.data : [];
    return { columns: extractColumns(body), rows, engine: "zetaris", elapsed_ms: Date.now() - started };
  }

  /** Lightweight health probe used by auto mode. */
  async healthy(): Promise<boolean> {
    try {
      const r = await this.query("SELECT 1", { limit: 1 });
      return r.rows.length === 1;
    } catch {
      return false;
    }
  }
}
