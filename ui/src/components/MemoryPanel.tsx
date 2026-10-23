import { useState, type FormEvent } from "react";
import { titleForCause, type OwnerFact } from "../types";

export interface MemoryPanelProps {
  facts: OwnerFact[];
  usedMemoryIds: Set<string>;
  disabled?: boolean;
  onAddFact: (text: string) => Promise<void>;
  onForget: (id: string) => Promise<void>;
  /** Memory changed after the last answer: offer to ask the same question again. */
  canReask?: boolean;
  onReask?: () => void;
}

/** How the fact will be used: the cause it lets the Analyst test, or that it is stored without a test. */
function interpretation(f: OwnerFact): string {
  if (!f.cause_type) return "Stored; no matching test in the catalogue yet";
  const from = f.params?.from ? ` from ${f.params.from}` : "";
  return `Will be tested as: ${titleForCause(f.cause_type)}${from}`;
}

export function MemoryPanel({ facts, usedMemoryIds, disabled, onAddFact, onForget, canReask, onReask }: MemoryPanelProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guarded = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || busy || disabled) return;
    await guarded(async () => {
      await onAddFact(trimmed);
      setText("");
    });
  };

  return (
    <section className="memory-panel" aria-labelledby="memory-heading">
      <h3 id="memory-heading" className="panel__subtitle">
        Memory
      </h3>
      <p className="hint">Facts the owner confirmed. Stored per business in Meterless H-MEM and recalled before the next investigation.</p>

      {facts.length === 0 ? (
        <p className="muted empty">No facts stored yet.</p>
      ) : (
        <ul className="fact-list" aria-label="Owner facts">
          {facts.map((f) => {
            const used = usedMemoryIds.has(f.id);
            return (
              <li key={f.id} className={used ? "fact fact--used" : "fact"}>
                <div className="fact__row">
                  <span className="fact__text">{f.text}</span>
                  <button
                    type="button"
                    className="fact__forget"
                    onClick={() => void guarded(() => onForget(f.id))}
                    disabled={disabled || busy}
                    aria-label={`Forget: ${f.text}`}
                  >
                    Forget
                  </button>
                </div>
                <span className={f.cause_type ? "fact__meaning" : "fact__meaning fact__meaning--none"}>{interpretation(f)}</span>
                {used && <span className="fact__badge">used in this run</span>}
              </li>
            );
          })}
        </ul>
      )}

      <form className="memory-form" onSubmit={submit}>
        <label htmlFor="new-fact" className="sr-only">
          Add a fact the owner confirmed
        </label>
        <input
          id="new-fact"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. We switched couverture supplier in May 2025"
          disabled={disabled || busy}
          maxLength={400}
        />
        <button type="submit" className="btn-secondary" disabled={disabled || busy || text.trim().length < 5}>
          Add
        </button>
      </form>
      {canReask && onReask && (
        <div className="reask" role="status">
          <p>Memory changed since the last answer.</p>
          <button type="button" className="btn-primary" onClick={onReask} disabled={disabled || busy}>
            Ask the same question again
          </button>
        </div>
      )}
      {error && (
        <p className="error-inline" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
