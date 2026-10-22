import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getBusinesses, getHealth, getMemory, postMemory, startRun, subscribeRunEvents } from "./api";
import { AskPanel } from "./components/AskPanel";
import { EvidenceDrawer } from "./components/EvidenceDrawer";
import { ExplanationCard } from "./components/ExplanationCard";
import { Header } from "./components/Header";
import { LiveBoard } from "./components/LiveBoard";
import {
  titleForCause,
  type Business,
  type Challenge,
  type DataMode,
  type HealthResponse,
  type LiveChallenge,
  type LiveHypothesis,
  type OwnerFact,
  type ReasonerChoice,
  type RunResult,
  type TraceLine,
  type Verdict,
} from "./types";

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [catalogDataMode, setCatalogDataMode] = useState<DataMode | undefined>();
  const [businessId, setBusinessId] = useState("");
  const [question, setQuestion] = useState("");
  const [period, setPeriod] = useState("");
  const [baseline, setBaseline] = useState("");
  const [reasoner, setReasoner] = useState<ReasonerChoice>("auto");
  const [facts, setFacts] = useState<OwnerFact[]>([]);
  const [running, setRunning] = useState(false);
  const [hypotheses, setHypotheses] = useState<LiveHypothesis[]>([]);
  const [challenges, setChallenges] = useState<LiveChallenge[]>([]);
  const [queryCount, setQueryCount] = useState(0);
  const [trace, setTrace] = useState<TraceLine[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const questionRef = useRef<HTMLTextAreaElement>(null);
  const disposeRef = useRef<(() => void) | null>(null);

  const usedMemoryIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of result?.output?.memory_used ?? []) {
      if (m.memory_id) ids.add(m.memory_id);
    }
    return ids;
  }, [result]);

  const loadMemory = useCallback(async (id: string) => {
    if (!id) {
      setFacts([]);
      return;
    }
    try {
      const mem = await getMemory(id);
      setFacts(mem.facts ?? []);
    } catch (e) {
      setFacts([]);
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [h, b] = await Promise.all([getHealth(), getBusinesses()]);
        if (cancelled) return;
        setHealth(h);
        setBusinesses(b.businesses);
        setCatalogDataMode(b.data_mode);
        const first = b.businesses[0]?.business_id ?? "";
        setBusinessId(first);
        if (first) {
          const mem = await getMemory(first);
          if (!cancelled) setFacts(mem.facts ?? []);
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      disposeRef.current?.();
    };
  }, []);

  const onBusinessChange = (id: string) => {
    setBusinessId(id);
    void loadMemory(id);
  };

  const applyTrace = useCallback((line: TraceLine) => {
    setTrace((prev) => [...prev, line]);

    if (line.agent === "Hypothesiser" && line.action === "proposed") {
      const list = (line.hypotheses as { id: string; cause_type: string; proposed_by: string }[] | undefined) ?? [];
      setHypotheses((prev) => {
        const map = new Map(prev.map((h) => [h.id, h]));
        for (const h of list) {
          map.set(h.id, {
            id: h.id,
            title: titleForCause(h.cause_type),
            cause_type: h.cause_type,
            proposed_by: h.proposed_by,
            status: map.get(h.id)?.status ?? "pending",
          });
        }
        return [...map.values()];
      });
    }

    if (line.agent === "Analyst" && (line.action === "query_zetaris" || line.action === "query_snapshot")) {
      setQueryCount((n) => n + 1);
      const hypId = line.hypothesis_id as string | undefined;
      if (hypId && hypId !== "frame") {
        setHypotheses((prev) =>
          prev.map((h) =>
            h.id === hypId && h.status === "pending" ? { ...h, status: "tested" } : h,
          ),
        );
      }
    }

    if (line.agent === "Analyst" && line.action === "verdict") {
      const hypId = String(line.hypothesis_id ?? "");
      const causeType = String(line.cause_type ?? "");
      const verdict = line.verdict as Verdict;
      setHypotheses((prev) => {
        const existing = prev.find((h) => h.id === hypId);
        if (existing) {
          return prev.map((h) =>
            h.id === hypId
              ? {
                  ...h,
                  status: verdict,
                  rule: typeof line.rule === "string" ? line.rule : h.rule,
                  confidence: typeof line.confidence === "string" ? line.confidence : h.confidence,
                  role: typeof line.role === "string" ? line.role : h.role,
                }
              : h,
          );
        }
        return [
          ...prev,
          {
            id: hypId,
            title: titleForCause(causeType),
            cause_type: causeType,
            proposed_by: "Skeptic",
            status: verdict,
            rule: typeof line.rule === "string" ? line.rule : undefined,
            confidence: typeof line.confidence === "string" ? line.confidence : undefined,
            role: typeof line.role === "string" ? line.role : undefined,
          },
        ];
      });
    }

    if (line.agent === "Skeptic" && line.action === "challenge") {
      const list = (line.challenges as Challenge[] | undefined) ?? [];
      setChallenges((prev) => {
        const map = new Map(prev.map((c) => [c.id, c]));
        for (const c of list) {
          map.set(c.id, {
            id: c.id,
            target_hypothesis_id: c.target_hypothesis_id,
            confounder: c.confounder,
            argument: c.argument,
            resolved: c.resolved,
            outcome: c.outcome,
          });
        }
        return [...map.values()];
      });
    }

    if (line.agent === "Skeptic" && line.action === "challenge_resolved") {
      const id = String(line.challenge ?? "");
      const outcome = typeof line.outcome === "string" ? line.outcome : undefined;
      setChallenges((prev) =>
        prev.map((c) => (c.id === id ? { ...c, resolved: true, outcome: outcome ?? c.outcome } : c)),
      );
    }
  }, []);

  const onResult = useCallback(
    (res: RunResult) => {
      setResult(res);
      setRunning(false);
      disposeRef.current = null;

      if (res.hypotheses?.length) {
        setHypotheses(
          res.hypotheses.map((h) => ({
            id: h.id,
            title: h.title,
            cause_type: h.cause_type,
            proposed_by: h.proposed_by,
            status: h.verdict,
            rule: h.rule,
            confidence: h.confidence,
            role: h.role,
          })),
        );
      }
      if (res.challenges?.length) {
        setChallenges(
          res.challenges.map((c) => ({
            id: c.id,
            target_hypothesis_id: c.target_hypothesis_id,
            confounder: c.confounder,
            argument: c.argument,
            resolved: c.resolved,
            outcome: c.outcome,
          })),
        );
      }
      if (res.status === "needs_clarification") {
        questionRef.current?.focus();
      }
      void loadMemory(businessId);
    },
    [businessId, loadMemory],
  );

  const run = async () => {
    if (running || !question.trim() || !businessId) return;
    disposeRef.current?.();
    setRunning(true);
    setResult(null);
    setHypotheses([]);
    setChallenges([]);
    setQueryCount(0);
    setTrace([]);
    setDrawerId(null);
    setLoadError(null);

    try {
      const body = {
        input: {
          question: question.trim(),
          business_id: businessId,
          ...(period.trim() ? { period: period.trim() } : {}),
          ...(baseline.trim() ? { baseline: baseline.trim() } : {}),
        },
        options: {
          reasoner,
        },
      };
      const accepted = await startRun(body);
      disposeRef.current = subscribeRunEvents(accepted.run_id, {
        onTrace: applyTrace,
        onResult,
        onError: (err) => {
          setRunning(false);
          setResult({
            run_id: accepted.run_id,
            data_mode: "snapshot",
            reasoner: reasoner === "offline" ? "offline" : "nemotron",
            status: "error",
            error: { type: "StreamError", message: err.message },
          });
        },
      });
    } catch (e) {
      setRunning(false);
      const err = e as Error & { type?: string };
      setResult({
        run_id: "",
        data_mode: "snapshot",
        reasoner: reasoner === "offline" ? "offline" : "nemotron",
        status: "error",
        error: { type: err.type ?? "HttpError", message: err.message },
      });
    }
  };

  const onAddFact = async (text: string) => {
    await postMemory(businessId, text);
    await loadMemory(businessId);
  };

  const evidenceMap = useMemo(() => {
    const m = new Map((result?.evidence ?? []).map((e) => [e.id, e]));
    return m;
  }, [result]);

  const openEvidence = (id: string) => setDrawerId(id);
  const closeDrawer = () => setDrawerId(null);

  const dataMode = result?.data_mode ?? catalogDataMode;
  const reasonerMode = result?.reasoner;

  return (
    <div className="app-shell">
      <Header
        dataMode={dataMode}
        reasoner={reasonerMode}
        modelCalls={result?.model_calls}
        health={health}
      />

      {loadError && !businesses.length && (
        <p className="banner-error" role="alert">
          Could not reach the API: {loadError}
        </p>
      )}

      <main className="workspace">
        <AskPanel
          businesses={businesses}
          businessId={businessId}
          onBusinessChange={onBusinessChange}
          question={question}
          onQuestionChange={setQuestion}
          period={period}
          onPeriodChange={setPeriod}
          baseline={baseline}
          onBaselineChange={setBaseline}
          reasoner={reasoner}
          onReasonerChange={setReasoner}
          running={running}
          onSubmit={() => void run()}
          facts={facts}
          usedMemoryIds={usedMemoryIds}
          onAddFact={onAddFact}
          questionRef={questionRef}
        />

        <LiveBoard
          hypotheses={hypotheses}
          challenges={challenges}
          queryCount={queryCount}
          trace={trace}
          running={running}
        />

        <ExplanationCard result={result} onOpenEvidence={openEvidence} questionRef={questionRef} />
      </main>

      <EvidenceDrawer
        open={drawerId != null && evidenceMap.has(drawerId)}
        evidence={drawerId ? evidenceMap.get(drawerId) ?? null : null}
        onClose={closeDrawer}
      />
    </div>
  );
}
