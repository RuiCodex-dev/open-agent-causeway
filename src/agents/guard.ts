// Input guard (Responsible AI): NVIDIA Nemotron Content Safety classifies the owner's question before any agent
// runs. Without an NVIDIA route, a small deterministic deny-list is used and labelled as such.
import type { ModelRouter } from "../models/router.ts";
import type { Trace } from "../orchestrator/trace.ts";

const DENY = /\b(poison|kill|bomb|weapon|explosive|suicide|self-harm|launder|fraud(ulent)? invoice|evade tax|hack (into|their)|steal)\b/i;

export async function guardQuestion(question: string, router: ModelRouter | null, trace?: Trace): Promise<{ safe: boolean; source: "nemotron-content-safety" | "rules"; label: string }> {
  if (router && router.primaryId === "nvidia") {
    try {
      const r = await router.chat({ role: "guard", messages: [{ role: "user", content: question }], maxTokens: 20 });
      const unsafe = /user safety:\s*unsafe/i.test(r.text);
      const res = { safe: !unsafe, source: "nemotron-content-safety" as const, label: r.text.slice(0, 60) };
      trace?.log("Guard", "classify", { ...res, model: r.model });
      return res;
    } catch (e) {
      trace?.log("Guard", "fallback_rules", { error: (e as Error).message.slice(0, 160) });
    }
  }
  const safe = !DENY.test(question);
  const res = { safe, source: "rules" as const, label: safe ? "no deny-list match" : "deny-list match" };
  trace?.log("Guard", "classify", res);
  return res;
}
