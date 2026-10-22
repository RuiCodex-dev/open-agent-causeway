// Sample-mode data adapter: the Zetaris snapshot (data/snapshot/*.parquet, written by scripts/snapshot.ts
// THROUGH Zetaris) loaded into an in-memory DuckDB. The agent runs the same compiled SQL on it as on Zetaris.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import type { DataAdapter, QueryResult } from "./zetaris.ts";
import { USL_TABLES } from "../data/uslSchema.ts";

export interface SnapshotManifest {
  created_at: string;
  source: string;
  tables: Record<string, { sql: string; executed_at: string; row_count: number; sha256: string; file: string }>;
}

export class SnapshotDuckdb implements DataAdapter {
  readonly engine = "duckdb-snapshot" as const;
  private conn: DuckDBConnection | null = null;
  manifest: SnapshotManifest | null = null;

  constructor(private dir = "data/snapshot") {}

  static available(dir = "data/snapshot"): boolean {
    return existsSync(join(dir, "manifest.json"));
  }

  private async connect(): Promise<DuckDBConnection> {
    if (this.conn) return this.conn;
    const manifestPath = join(this.dir, "manifest.json");
    if (!existsSync(manifestPath)) throw new Error(`snapshot manifest missing: ${manifestPath}`);
    this.manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SnapshotManifest;
    const inst = await DuckDBInstance.create(":memory:");
    const conn = await inst.connect();
    for (const table of Object.keys(USL_TABLES)) {
      const entry = this.manifest.tables[table];
      if (!entry) throw new Error(`snapshot has no table ${table}`);
      const file = join(this.dir, entry.file).replace(/\\/g, "/");
      await conn.run(`CREATE TABLE ${table} AS SELECT * FROM read_parquet('${file}')`);
    }
    this.conn = conn;
    return conn;
  }

  async query(sql: string): Promise<QueryResult> {
    const conn = await this.connect();
    const started = Date.now();
    const reader = await conn.runAndReadAll(sql);
    const columns = reader.columnNames();
    const rows = reader.getRowsJS() as unknown[][];
    return { columns, rows, engine: this.engine, elapsed_ms: Date.now() - started };
  }
}
