import { useRef, type FormEvent, type KeyboardEvent, type RefObject } from "react";
import { isSynthetic, type Business, type OwnerFact, type ReasonerChoice } from "../types";
import { MemoryPanel } from "./MemoryPanel";

const EXAMPLES = [
  "Why did our gross margin fall in the first half of 2025?",
  "Why are things bad lately?",
];

export interface AskPanelProps {
  businesses: Business[];
  businessId: string;
  onBusinessChange: (id: string) => void;
  question: string;
  onQuestionChange: (q: string) => void;
  period: string;
  onPeriodChange: (v: string) => void;
  baseline: string;
  onBaselineChange: (v: string) => void;
  reasoner: ReasonerChoice;
  onReasonerChange: (r: ReasonerChoice) => void;
  running: boolean;
  onSubmit: () => void;
  facts: OwnerFact[];
  usedMemoryIds: Set<string>;
  onAddFact: (text: string) => Promise<void>;
  questionRef?: RefObject<HTMLTextAreaElement>;
}

export function AskPanel({
  businesses,
  businessId,
  onBusinessChange,
  question,
  onQuestionChange,
  period,
  onPeriodChange,
  baseline,
  onBaselineChange,
  reasoner,
  onReasonerChange,
  running,
  onSubmit,
  facts,
  usedMemoryIds,
  onAddFact,
  questionRef,
}: AskPanelProps) {
  const localRef = useRef<HTMLTextAreaElement>(null);
  const taRef = questionRef ?? localRef;
  const selected = businesses.find((b) => b.business_id === businessId);

  const handleSubmit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!running && question.trim() && businessId) onSubmit();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <section className="panel ask-panel" aria-labelledby="ask-heading">
      <h2 id="ask-heading" className="panel__title">
        Ask
      </h2>

      <form className="ask-form" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="business">Business</label>
          <select
            id="business"
            value={businessId}
            onChange={(e) => onBusinessChange(e.target.value)}
            disabled={running || businesses.length === 0}
            aria-describedby={selected ? "business-meta" : undefined}
          >
            {businesses.length === 0 && <option value="">Loading…</option>}
            {businesses.map((b) => (
              <option key={b.business_id} value={b.business_id}>
                {b.name}
                {isSynthetic(b.synthetic) ? " (synthetic)" : ""}
              </option>
            ))}
          </select>
          {selected && (
            <p id="business-meta" className="business-meta">
              <span>
                {selected.city} · {selected.sector}
              </span>
              {isSynthetic(selected.synthetic) && (
                <span className="synthetic-tag" title="Demo business with synthetic ledger data">
                  synthetic
                </span>
              )}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="question">Question</label>
          <textarea
            id="question"
            ref={taRef}
            rows={4}
            value={question}
            onChange={(e) => onQuestionChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Why did our gross margin change?"
            disabled={running}
            aria-label="Investigation question"
          />
          <p className="hint">Enter to run · Shift+Enter for a new line</p>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="period">Period</label>
            <input
              id="period"
              type="text"
              value={period}
              onChange={(e) => onPeriodChange(e.target.value)}
              placeholder="e.g. 2025-H1"
              disabled={running}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="baseline">Baseline</label>
            <input
              id="baseline"
              type="text"
              value={baseline}
              onChange={(e) => onBaselineChange(e.target.value)}
              placeholder="e.g. 2024-H1"
              disabled={running}
              autoComplete="off"
            />
          </div>
        </div>

        <fieldset className="reasoner-switch" disabled={running}>
          <legend>Reasoner</legend>
          <label className="radio">
            <input
              type="radio"
              name="reasoner"
              value="auto"
              checked={reasoner === "auto"}
              onChange={() => onReasonerChange("auto")}
            />
            Nemotron
          </label>
          <label className="radio">
            <input
              type="radio"
              name="reasoner"
              value="offline"
              checked={reasoner === "offline"}
              onChange={() => onReasonerChange("offline")}
            />
            Offline
          </label>
        </fieldset>

        <button type="submit" className="btn-primary" disabled={running || !question.trim() || !businessId}>
          {running ? "Running…" : "Run"}
        </button>

        <div className="example-chips" role="group" aria-label="Example questions">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="chip"
              disabled={running}
              onClick={() => onQuestionChange(ex)}
            >
              {ex}
            </button>
          ))}
        </div>
      </form>

      <MemoryPanel
        facts={facts}
        usedMemoryIds={usedMemoryIds}
        disabled={running || !businessId}
        onAddFact={onAddFact}
      />
    </section>
  );
}
