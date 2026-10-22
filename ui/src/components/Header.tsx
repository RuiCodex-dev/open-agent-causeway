import { formatDataMode, formatReasoner, type HealthResponse, type ModelCall, type Reasoner, type DataMode } from "../types";

export interface HeaderProps {
  dataMode?: DataMode;
  reasoner?: Reasoner;
  modelCalls?: ModelCall[];
  health?: HealthResponse | null;
}

export function Header({ dataMode, reasoner, modelCalls, health }: HeaderProps) {
  const modeLabel = formatDataMode(dataMode, health ?? undefined);
  const reasonerLabel = formatReasoner(reasoner, modelCalls, health ?? undefined);

  return (
    <header className="site-header" role="banner">
      <div className="brand-block">
        <h1 className="wordmark">Causeway</h1>
        <p className="tagline">The agent that argues with itself before it tells you why</p>
      </div>
      <div
        className="mode-badge"
        role="status"
        aria-label={`Data mode ${modeLabel}; reasoner ${reasonerLabel}`}
      >
        <span className="mode-badge__mode">{modeLabel}</span>
        <span className="mode-badge__sep" aria-hidden="true">
          ·
        </span>
        <span className="mode-badge__reasoner">{reasonerLabel}</span>
      </div>
    </header>
  );
}
