# HackOS submission worksheet (draft; final numbers are filled from bench/report.md at submission)

- **Track:** The Agent That Can Explain Why (Track 02)
- **Team:** Rui Codex (solo), GitHub member: `altinayselman`
- **Title:** Causeway
- **GitHub:** https://github.com/RuiCodex-dev/open-agent-causeway (public)
- **Video:** https://youtu.be/AyXejKr6Fyc
- **Deck:** https://github.com/RuiCodex-dev/open-agent-causeway/blob/main/deck/Causeway-deck.pdf

## Description (150-2,000 characters; the form has no separate sponsor or pre-existing fields)

Causeway answers "why did our margin/revenue change?" for small-business owners and their accountants, and shows the
evidence behind every sentence. It runs an investigation instead of writing a paragraph:
- rival explanations are proposed from a typed catalogue (NVIDIA Nemotron);
- each one is tested with SQL on Zetaris, joining the owner's ledger with live Eurostat drivers, and decided by a rule
  table in code;
- a Skeptic agent with veto power forces confounder tests (Easter timing, own price changes) before any verdict stands;
- a Verifier re-executes every cited query and strikes any number not in the evidence or credited to the wrong cause.

Models propose, code decides: no model writes SQL or issues a verdict.

**Zetaris:**
- the only live data path;
- a PostgreSQL ledger datasource plus 7 Eurostat REST tables, unified in the USL `causeway` (5 tables, 4 foreign keys);
- live and snapshot runs are hash-identical.

**Meterless:**
- World Model is the shared evidence graph for all agents;
- H-MEM remembers owner facts ("we switched supplier in May") and changes the answer on re-ask;
- Markovian carries bounded state between Skeptic rounds;
- Meterless Nightshift is the primary provider and routes every reasoning call;
- the engine conformance suites pass.

**NVIDIA:**
- Nemotron 3.5 Lightning (via Nightshift), Super and Content Safety;
- Nebius Nemotron as failover.

**Cursor:**
- rules, plus headless sessions that built the scaffold, the Runtime provider, the UI and the README draft;
- every session is logged in `docs/cursor-sessions`.

**Causeway Bench:** 12 synthetic cases with hidden truth, including null controls. The main cause was found in 12/12
cases, with 0 ungrounded numbers (one false support, reported).

**Pre-existing, declared:**
- design documents (written before the window);
- the Meterless reference engines (Apache-2.0, unmodified);
- the pattern of Zetaris' Eurostat recipe.

Synthetic businesses are labelled as synthetic everywhere.
