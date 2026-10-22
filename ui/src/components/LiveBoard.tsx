import { useState } from "react";
import type { LiveChallenge, LiveHypothesis, TraceLine } from "../types";

export interface LiveBoardProps {
  hypotheses: LiveHypothesis[];
  challenges: LiveChallenge[];
  queryCount: number;
  trace: TraceLine[];
  running: boolean;
}

function statusLabel(status: LiveHypothesis["status"]): string {
  return status;
}

export function LiveBoard({ hypotheses, challenges, queryCount, trace, running }: LiveBoardProps) {
  // Live runs query Zetaris; sample mode queries the Zetaris snapshot in DuckDB. Say which.
  const onSnapshot = trace.some((l) => l.action === "query_snapshot");
  const queryLabel = `${onSnapshot ? "snapshot" : "Zetaris"} quer${queryCount === 1 ? "y" : "ies"}`;
  const [traceOpen, setTraceOpen] = useState(false);

  return (
    <section className="panel live-board" aria-labelledby="live-heading" aria-live="polite">
      <div className="live-board__head">
        <h2 id="live-heading" className="panel__title">
          Live board
        </h2>
        <p className="query-count" aria-label={`${queryCount} ${queryLabel}`}>
          <span className="query-count__n">{queryCount}</span> {queryLabel}
        </p>
      </div>

      {hypotheses.length === 0 ? (
        <p className="muted empty">
          {running ? "Waiting for the Hypothesiser…" : "Run a question to watch rival hypotheses compete."}
        </p>
      ) : (
        <ul className="hyp-list" aria-label="Hypotheses">
          {hypotheses.map((h, i) => {
            const threaded = challenges.filter((c) => c.target_hypothesis_id === h.id);
            return (
              <li
                key={h.id}
                className={`hyp-row hyp-row--${h.status}`}
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <div className="hyp-row__main">
                  <span className={`status-pill status-pill--${h.status}`} aria-label={`Status ${statusLabel(h.status)}`}>
                    {statusLabel(h.status)}
                  </span>
                  <div className="hyp-row__body">
                    <strong className="hyp-row__title">{h.title}</strong>
                    <span className="proposed-by">proposed by {h.proposed_by}</span>
                    {h.rule && <p className="hyp-row__rule">{h.rule}</p>}
                  </div>
                </div>
                {threaded.length > 0 && (
                  <ul className="challenge-thread" aria-label={`Challenges to ${h.title}`}>
                    {threaded.map((c) => (
                      <li key={c.id} className={c.resolved ? "challenge challenge--resolved" : "challenge"}>
                        <span className="challenge__label">Skeptic</span>
                        <p className="challenge__arg">
                          <strong>{c.confounder}</strong> — {c.argument}
                        </p>
                        {c.outcome && <p className="challenge__outcome">{c.outcome}</p>}
                        {!c.resolved && !c.outcome && <p className="challenge__pending">Challenge pending…</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <details
        className="trace-details"
        open={traceOpen}
        onToggle={(e) => setTraceOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary>Raw trace ({trace.length})</summary>
        {trace.length === 0 ? (
          <p className="muted empty">No events yet.</p>
        ) : (
          <ol className="trace-list" aria-label="Trace events">
            {trace.map((line) => (
              <li key={`${line.run_id}-${line.step}`}>
                <span className="trace-step">{line.step}</span>
                <span className="trace-agent">{line.agent}</span>
                <span className="trace-action">{line.action}</span>
                <code className="trace-json">{summarizeTrace(line)}</code>
              </li>
            ))}
          </ol>
        )}
      </details>
    </section>
  );
}

function summarizeTrace(line: TraceLine): string {
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(line)) {
    if (k === "ts" || k === "run_id" || k === "step" || k === "agent" || k === "action") continue;
    rest[k] = v;
  }
  try {
    const s = JSON.stringify(rest);
    return s.length > 160 ? `${s.slice(0, 157)}…` : s;
  } catch {
    return "";
  }
}
