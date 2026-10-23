import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import type { EvidenceItem, HypothesisResult, ModelCall, RunResult } from "../types";

export interface ExplanationCardProps {
  result: RunResult | null;
  /** The previous answer to the same question (before the owner changed memory), for a before/after view. */
  previous?: RunResult | null;
  onOpenEvidence: (id: string) => void;
  questionRef?: RefObject<HTMLTextAreaElement>;
}

interface MemoryDelta {
  title: string;
  before: string;
  after: string;
}

function label(h: HypothesisResult | undefined): string {
  if (!h) return "not tested";
  return h.role === "offset" ? `${h.verdict} (offset)` : h.verdict;
}

/** Per cause: the verdict in the previous answer against the verdict now. Only rows that changed are returned. */
export function memoryDeltas(previous: RunResult, current: RunResult): MemoryDelta[] {
  const before = new Map((previous.hypotheses ?? []).map((h) => [h.cause_type, h]));
  const after = new Map((current.hypotheses ?? []).map((h) => [h.cause_type, h]));
  const keys = [...new Set([...before.keys(), ...after.keys()])];
  return keys
    .map((k) => ({ title: (after.get(k) ?? before.get(k))!.title, before: label(before.get(k)), after: label(after.get(k)) }))
    .filter((d) => d.before !== d.after);
}

export function ExplanationCard({ result, previous, onOpenEvidence, questionRef }: ExplanationCardProps) {
  const clarifyingRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (result?.status === "needs_clarification") {
      questionRef?.current?.focus();
      clarifyingRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [result, questionRef]);

  if (!result) {
    return (
      <section className="panel explanation-card explanation-card--empty" aria-labelledby="expl-heading">
        <h2 id="expl-heading" className="panel__title">
          Explanation
        </h2>
        <p className="muted empty">The verdict and evidence appear here when a run finishes.</p>
      </section>
    );
  }

  if (result.status === "error") {
    const type = result.error?.type ?? "Error";
    const message = result.error?.message ?? "Something went wrong.";
    return (
      <section className="panel explanation-card" aria-labelledby="expl-heading" role="alert">
        <h2 id="expl-heading" className="panel__title">
          Error
        </h2>
        <p className="error-block">
          <strong>{type}</strong>
          <span>{message}</span>
        </p>
      </section>
    );
  }

  if (result.status === "needs_clarification") {
    const q = result.output?.clarifying_question ?? "Please clarify your question.";
    return (
      <section className="panel explanation-card" aria-labelledby="expl-heading">
        <h2 id="expl-heading" className="panel__title">
          Clarification needed
        </h2>
        <p ref={clarifyingRef} className="clarifying" tabIndex={-1}>
          {q}
        </p>
        <p className="hint">Edit your question on the left and run again.</p>
      </section>
    );
  }

  const out = result.output;
  if (!out?.verdict) {
    return (
      <section className="panel explanation-card" aria-labelledby="expl-heading">
        <h2 id="expl-heading" className="panel__title">
          Explanation
        </h2>
        <p className="muted empty">No explanation in this result.</p>
      </section>
    );
  }

  const evidenceById = new Map((result.evidence ?? []).map((e) => [e.id, e]));
  const openFirst = (ids: string[]) => {
    const id = ids[0];
    if (id) onOpenEvidence(id);
  };

  const onClaimKey = (e: KeyboardEvent<HTMLLIElement>, ids: string[]) => {
    if (e.key === "e" || e.key === "E") {
      e.preventDefault();
      openFirst(ids);
    }
  };

  return (
    <section className="panel explanation-card" aria-labelledby="expl-heading">
      <h2 id="expl-heading" className="sr-only">
        Explanation
      </h2>

      <p className="verdict" aria-live="polite">
        {out.verdict}
      </p>

      {previous?.output?.verdict && (
        <div className="card-section memory-delta">
          <h3 className="panel__subtitle">What the owner&apos;s memory changed</h3>
          <p className="memory-delta__before">
            <span className="memory-delta__tag">Before</span> {previous.output.verdict}
          </p>
          {(() => {
            const rows = memoryDeltas(previous, result);
            return rows.length === 0 ? (
              <p className="muted">No verdict changed: the same causes are supported as before.</p>
            ) : (
              <table className="memory-delta__table">
                <thead>
                  <tr>
                    <th scope="col">Cause</th>
                    <th scope="col">Before</th>
                    <th scope="col">Now</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.title}>
                      <th scope="row">{r.title}</th>
                      <td>{r.before}</td>
                      <td className={`verdict-${r.after.split(" ")[0]}`}>{r.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })()}
        </div>
      )}

      {out.chain && out.chain.length > 0 && (
        <div className="card-section">
          <h3 className="panel__subtitle">Causal chain</h3>
          <ol className="chain-list">
            {out.chain.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      )}

      {out.claims && out.claims.length > 0 && (
        <div className="card-section">
          <h3 className="panel__subtitle">Claims</h3>
          <ul className="claim-list" aria-label="Verified claims">
            {out.claims.map((c) => (
              <li
                key={c.id}
                className="claim"
                tabIndex={0}
                onKeyDown={(e) => onClaimKey(e, c.evidence_ids)}
                aria-label={`Claim: ${c.text}. Press E to open evidence.`}
              >
                <p className="claim__text">{c.text}</p>
                <EvidenceChips ids={c.evidence_ids} evidenceById={evidenceById} onOpen={onOpenEvidence} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {out.struck_claims && out.struck_claims.length > 0 && (
        <div className="card-section">
          <h3 className="panel__subtitle">Struck claims</h3>
          <ul className="claim-list claim-list--struck" aria-label="Struck claims">
            {out.struck_claims.map((c) => (
              <li
                key={c.id}
                className="claim claim--struck"
                tabIndex={0}
                onKeyDown={(e) => onClaimKey(e, c.evidence_ids)}
              >
                <p className="claim__text struck-text">{c.text}</p>
                {c.struck_reason && <p className="struck-reason">Verifier: {c.struck_reason}</p>}
                <EvidenceChips ids={c.evidence_ids} evidenceById={evidenceById} onOpen={onOpenEvidence} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {out.offsets && out.offsets.length > 0 && (
        <div className="card-section">
          <h3 className="panel__subtitle">Offsets</h3>
          <ul className="rival-list">
            {out.offsets.map((o, i) => (
              <li key={i}>
                <strong>{o.hypothesis}</strong>
                <span> — {o.why}</span>
                <EvidenceChips ids={o.evidence_ids} evidenceById={evidenceById} onOpen={onOpenEvidence} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {out.rejected && out.rejected.length > 0 && (
        <div className="card-section">
          <h3 className="panel__subtitle">Rejected rivals</h3>
          <ul className="rival-list">
            {out.rejected.map((r, i) => (
              <li key={i}>
                <strong>{r.hypothesis}</strong>
                <span> — {r.why}</span>
                <EvidenceChips ids={r.evidence_ids} evidenceById={evidenceById} onOpen={onOpenEvidence} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {out.limitations && out.limitations.length > 0 && (
        <div className="card-section">
          <h3 className="panel__subtitle">Limitations</h3>
          <ul className="plain-list">
            {out.limitations.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      )}

      {out.what_would_change && out.what_would_change.length > 0 && (
        <div className="card-section">
          <h3 className="panel__subtitle">What would change this</h3>
          <ul className="plain-list">
            {out.what_would_change.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      )}

      {out.actions && out.actions.length > 0 && (
        <div className="card-section">
          <h3 className="panel__subtitle">Actions</h3>
          <ul className="plain-list">
            {out.actions.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      )}

      <footer className="expl-footer">
        <span>
          Re-executed {result.verification?.requery?.length ?? 0} quer
          {(result.verification?.requery?.length ?? 0) === 1 ? "y" : "ies"}
        </span>
        <span aria-hidden="true">·</span>
        <span>Struck {result.verification?.struck ?? 0}</span>
        <span aria-hidden="true">·</span>
        <span>{formatSeconds(result.execution_time_seconds)}</span>
        <span aria-hidden="true">·</span>
        <span>{formatModelCalls(result.model_calls)}</span>
      </footer>
    </section>
  );
}

function EvidenceChips({
  ids,
  evidenceById,
  onOpen,
}: {
  ids: string[];
  evidenceById: Map<string, EvidenceItem>;
  onOpen: (id: string) => void;
}) {
  if (!ids.length) return null;
  return (
    <div className="evidence-chips" role="group" aria-label="Evidence">
      {ids.map((id) => {
        const ev = evidenceById.get(id);
        const label = ev?.purpose ? `${id}: ${ev.purpose}` : id;
        return (
          <button
            key={id}
            type="button"
            className="evidence-chip"
            onClick={() => onOpen(id)}
            title={label}
            aria-label={`Open evidence ${id}`}
          >
            {id}
          </button>
        );
      })}
    </div>
  );
}

function formatSeconds(s?: number): string {
  if (s == null || Number.isNaN(s)) return "—";
  return `${s.toFixed(1)} s`;
}

function formatModelCalls(calls?: ModelCall[]): string {
  if (!calls || calls.length === 0) return "no model calls";
  const by: Record<string, number> = {};
  for (const c of calls) {
    by[c.provider] = (by[c.provider] ?? 0) + 1;
  }
  return Object.entries(by)
    .map(([p, n]) => `${n}× ${p}`)
    .join(", ");
}
