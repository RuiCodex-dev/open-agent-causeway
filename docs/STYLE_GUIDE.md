# Causeway — style guide (draft)

Direction: **editorial evidence desk** — the calm authority of a well-set financial newspaper and an archivist's
index card, not a neon AI dashboard. Paper, ink, one signal colour. No gradient blobs, no glow.

## Palette (tokens)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | #F6F3EC | #14161A | page background |
| `--ink` | #1C1F24 | #ECE8DF | body text |
| `--rule` | #D8D2C4 | #2C3038 | hairlines, table rules |
| `--muted` | #6B6F76 | #9A9EA6 | secondary text |
| `--signal` | #1F5FBF | #6FA2F0 | links, focus, active evidence |
| `--support` | #2F7A4F | #6CC08F | "supported" verdicts |
| `--refute` | #B4442E | #E2826C | "contradicted" verdicts, struck claims |

Inconclusive uses `--muted` with a dotted rule — never a third bright colour.

## Type

- Headings and verdict sentence: **Source Serif 4** (SIL OFL), optical sizes on.
- UI, tables, SQL: **IBM Plex Sans** / **IBM Plex Mono** (SIL OFL).
- Self-hosted, licences recorded in `CREDITS.md` in the product repo.

## Layout and motion

- 8 px spacing scale (4, 8, 12, 16, 24, 32, 48, 64).
- Evidence rows enter with a 160 ms fade + 4 px rise, staggered 40 ms; verdict stamps with a 220 ms ease-out.
  All motion disabled under `prefers-reduced-motion`.
- Struck claims animate a single ink line through the text (the verifier's moment in the demo).

## Imagery

- Product UI is the hero; no generated people. Optional mood stills (Google Flow, hesap5) in a single style:
  overhead paper-desk photography, soft window light, muted grade — used only on the deck title and video intro.
  Image models never render text. Every generated asset logged in `design/GENERATED_ASSETS.md`.

## Video (HyperFrames)

- 1080p30, ~3:00, English neural narration + burned-in captions, real browser captures as the backbone.
- End card: "Causeway — by Rui Codex".
