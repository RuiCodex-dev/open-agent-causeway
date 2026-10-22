import { useEffect, useId, useRef } from "react";
import type { EvidenceItem } from "../types";

export interface EvidenceDrawerProps {
  evidence: EvidenceItem | null;
  open: boolean;
  onClose: () => void;
}

export function EvidenceDrawer({ evidence, open, onClose }: EvidenceDrawerProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open, evidence?.id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      previousFocus.current?.focus?.();
      return;
    }
    const panel = panelRef.current;
    if (!panel) return;

    const focusables = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1);

    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const nodes = focusables();
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    panel.addEventListener("keydown", trap);
    return () => panel.removeEventListener("keydown", trap);
  }, [open]);

  if (!open || !evidence) return null;

  const engineLabel =
    evidence.engine === "zetaris"
      ? "Zetaris Lightning"
      : evidence.engine === "duckdb-snapshot"
        ? "Zetaris snapshot / DuckDB"
        : evidence.engine;

  const shortSha = evidence.sha256.slice(0, 12);

  const copySql = async () => {
    try {
      await navigator.clipboard.writeText(evidence.sql);
    } catch {
      /* clipboard may be unavailable */
    }
  };

  return (
    <div className="drawer-root" role="presentation">
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className="drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="drawer-header">
          <h2 id={titleId} className="drawer-title">
            Evidence
          </h2>
          <button ref={closeRef} type="button" className="btn-icon" onClick={onClose} aria-label="Close evidence drawer">
            Esc
          </button>
        </header>

        <div className="drawer-body">
          <p className="drawer-purpose">{evidence.purpose}</p>
          <span className="engine-badge">{engineLabel}</span>

          <div className="sql-block">
            <div className="sql-block__head">
              <span>SQL</span>
              <button type="button" className="btn-secondary btn-small" onClick={copySql}>
                Copy
              </button>
            </div>
            <pre className="sql-code">
              <code>{evidence.sql}</code>
            </pre>
          </div>

          <div className="table-wrap">
            <table className="preview-table">
              <caption className="sr-only">First rows of the query result</caption>
              <thead>
                <tr>
                  {evidence.columns.map((c) => (
                    <th key={c} scope="col">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {evidence.rows_preview.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci}>{formatCell(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <dl className="meta-list">
            <div>
              <dt>Rows</dt>
              <dd>{evidence.row_count}</dd>
            </div>
            <div>
              <dt>sha256</dt>
              <dd>
                <code title={evidence.sha256}>{shortSha}…</code>
              </dd>
            </div>
            <div>
              <dt>Source tables</dt>
              <dd>{evidence.source_tables.join(", ") || "—"}</dd>
            </div>
            <div>
              <dt>Executed</dt>
              <dd>
                <time dateTime={evidence.executed_at}>{formatTime(evidence.executed_at)}</time>
              </dd>
            </div>
            <div>
              <dt>Id</dt>
              <dd>
                <code>{evidence.id}</code>
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v == null) return "null";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : String(v);
  return String(v);
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "medium",
    });
  } catch {
    return iso;
  }
}
