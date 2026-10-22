import { useState, type FormEvent } from "react";
import type { OwnerFact } from "../types";

export interface MemoryPanelProps {
  facts: OwnerFact[];
  usedMemoryIds: Set<string>;
  disabled?: boolean;
  onAddFact: (text: string) => Promise<void>;
}

export function MemoryPanel({ facts, usedMemoryIds, disabled, onAddFact }: MemoryPanelProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      await onAddFact(trimmed);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="memory-panel" aria-labelledby="memory-heading">
      <h3 id="memory-heading" className="panel__subtitle">
        Memory
      </h3>
      <p className="hint">Facts the owner confirmed (Meterless H-MEM)</p>

      {facts.length === 0 ? (
        <p className="muted empty">No facts stored yet.</p>
      ) : (
        <ul className="fact-list" aria-label="Owner facts">
          {facts.map((f) => {
            const used = usedMemoryIds.has(f.id);
            return (
              <li key={f.id} className={used ? "fact fact--used" : "fact"}>
                <span className="fact__text">{f.text}</span>
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
          placeholder="Add a fact the owner confirmed"
          disabled={disabled || busy}
          maxLength={400}
        />
        <button type="submit" className="btn-secondary" disabled={disabled || busy || text.trim().length < 5}>
          Add
        </button>
      </form>
      {error && (
        <p className="error-inline" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
